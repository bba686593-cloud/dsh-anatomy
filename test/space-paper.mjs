// Interoperation between paper edits and the same three-dimensional document.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { erasePen, clipPenToLasso, localToWorld, resizeElement, drawingClientSource } from '../lib/drawing.js'
import { boardDiagnostics, deleteElements, moveElements, elementProgram, boardBundle } from '../lib/board.js'
import { spaceLinks, spaceStrokePoints } from '../lib/board-space.js'

const plain = value => JSON.parse(JSON.stringify(value))
const pen = (extra = {}) => ({
  id: 'ink', type: 'pen', x: 0, y: 0, width: 100, height: 1, z: 0,
  points: [[0, 0], [.5, 0], [1, 0]], points3d: [[0, 0, 0], [50, 0, 50], [100, 0, 100]],
  fragmentOf: 'source-ink', derivedFrom: 'source-card',
  implementation: { language: 'JavaScript', code: 'return source', extension: { keep: true } },
  anchors: [{ file: 'src/source.js', sha256: 'a'.repeat(64) }],
  extension: { sourceKey: 'original-note', arbitrary: [1, 2, 3] }, ...extra,
})
const factory = () => { let count = 0; return () => 'fragment-' + (++count) }
const rendered = fragment => spaceStrokePoints(fragment).map(p => [p.x, p.y, p.z])
const approx = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < actual.length; i++) for (let j = 0; j < actual[i].length; j++) assert.ok(Math.abs(actual[i][j] - expected[i][j]) < 1e-7, `${actual[i]} != ${expected[i]}`)
}
function checkFragments(fragments, source) {
  for (const fragment of fragments) {
    assert.equal(fragment.points3d.length, fragment.points.length)
    approx(rendered(fragment), fragment.points3d)
    assert.equal(fragment.z, fragment.points3d[0][2])
    assert.deepEqual(fragment.implementation, source.implementation)
    assert.deepEqual(fragment.anchors, source.anchors)
    assert.deepEqual(fragment.extension, source.extension)
    assert.equal(fragment.fragmentOf, 'source-ink')
    assert.equal(fragment.derivedFrom, source.derivedFrom)
    assert.deepEqual(boardDiagnostics({ version: 1, elements: [fragment] }), [])
  }
}

test('paper erasure interpolates both cut heights and cannot resurrect the removed interval in 3D', () => {
  const source = pen(), original = structuredClone(source)
  const { changed, fragments } = erasePen(source, { x: 50, y: 0, radius: 10 }, factory())
  assert.equal(changed, true)
  assert.equal(fragments.length, 2)
  approx(rendered(fragments[0]), [[0, 0, 0], [40, 0, 40]])
  approx(rendered(fragments[1]), [[60, 0, 60], [100, 0, 100]])
  checkFragments(fragments, source)
  assert.deepEqual(source, original)
})

test('paper lasso retains exact z on inside and outside pieces', () => {
  const source = pen(), polygon = [{ x: 25, y: -10 }, { x: 75, y: -10 }, { x: 75, y: 10 }, { x: 25, y: 10 }]
  const result = clipPenToLasso(source, polygon, factory())
  assert.equal(result.changed, true)
  assert.equal(result.inside.length, 1); assert.equal(result.outside.length, 2)
  approx(rendered(result.inside[0]), [[25, 0, 25], [50, 0, 50], [75, 0, 75]])
  approx(rendered(result.outside[0]), [[0, 0, 0], [25, 0, 25]])
  approx(rendered(result.outside[1]), [[75, 0, 75], [100, 0, 100]])
  checkFragments([...result.inside, ...result.outside], source)
})

test('after paper translation, resize, and rotation, cuts use current geometry and the source vertex heights', () => {
  const source = resizeElement(pen(), 'se', { x: 200, y: 1 })
  source.x += 30; source.y += 40; source.rotation = 90
  // points3d x/y may still describe the old geometry; normalized points and
  // per-vertex heights are the shared canonical representation.
  const middle = localToWorld(source, { x: source.x + source.width / 2, y: source.y })
  const result = erasePen(source, { ...middle, radius: 20 }, factory())
  assert.equal(result.fragments.length, 2)
  const a = localToWorld(source, { x: source.x, y: source.y })
  const b = localToWorld(source, { x: source.x + source.width, y: source.y })
  approx(rendered(result.fragments[0]), [[a.x, a.y, 0], [middle.x, middle.y - 20, 40]])
  approx(rendered(result.fragments[1]), [[middle.x, middle.y + 20, 60], [b.x, b.y, 100]])
  checkFragments(result.fragments, source)
})

test('overlapping paper segments retain their distinct height branches', () => {
  const source = pen({ points: [[0, 0], [1, 0], [0, 0]], points3d: [[0, 0, 0], [100, 0, 100], [0, 0, 200]] })
  const { fragments } = erasePen(source, { x: 50, y: 0, radius: 10 }, factory())
  assert.equal(fragments.length, 3)
  approx(rendered(fragments[0]), [[0, 0, 0], [40, 0, 40]])
  approx(rendered(fragments[1]), [[60, 0, 60], [100, 0, 100], [60, 0, 140]])
  approx(rendered(fragments[2]), [[40, 0, 160], [0, 0, 200]])
  checkFragments(fragments, source)
})

test('a vertical source segment outside the eraser keeps both of its heights', () => {
  const source = pen({ points: [[0, 0], [0, 0], [1, 0]], points3d: [[0, 0, 0], [0, 0, 50], [100, 0, 100]] })
  const { fragments } = erasePen(source, { x: 75, y: 0, radius: 10 }, factory())
  approx(rendered(fragments[0]), [[0, 0, 0], [0, 0, 50], [65, 0, 82.5]])
  approx(rendered(fragments[1]), [[85, 0, 92.5], [100, 0, 100]])
})

test('ordinary 2D cuts do not invent points3d or change existing depth metadata', () => {
  const source = pen({ z: 75 }); delete source.points3d
  const { fragments } = erasePen(source, { x: 50, y: 0, radius: 10 }, factory())
  for (const fragment of fragments) { assert.equal(fragment.points3d, undefined); assert.equal(fragment.z, 75) }
})

test('mismatched legacy depth vertices fail before a paper cut can destroy source data', () => {
  const source = pen({ points3d: [[0, 0, 0], [100, 0, 100]] }), original = structuredClone(source)
  assert.throws(() => erasePen(source, { x: 50, y: 0, radius: 10 }, factory()), /顶点不一致/)
  assert.deepEqual(source, original)
})

test('the browser-inline drawing source includes depth interpolation helpers', () => {
  const context = { structuredClone, input: pen() }
  vm.runInNewContext(drawingClientSource() + ';let serial=0;output=erasePen(input,{x:50,y:0,radius:10},()=>"browser-"+(++serial));', context)
  approx(rendered(context.output.fragments[0]), [[0, 0, 0], [40, 0, 40]])
  approx(rendered(context.output.fragments[1]), [[60, 0, 60], [100, 0, 100]])
})

const linkedBoard = () => ({ version: 1, elements: [
  { id: 'low', type: 'rect', x: 0, y: 0, width: 100, height: 100, z: 120 },
  { id: 'high', type: 'rect', x: 300, y: 100, width: 100, height: 100, z: 620 },
  { id: 'edge', type: 'arrow', x: 0, y: 0, width: 1, height: 1, from: 'low', to: 'high' },
] })

test('deleting a raised node detaches its endpoint at the same x/y/z', () => {
  const board = linkedBoard(), before = spaceLinks(board.elements)[0]
  deleteElements(board, ['high'])
  const edge = board.elements.find(e => e.id === 'edge'), after = spaceLinks(board.elements)[0]
  assert.equal(edge.to, undefined); assert.equal(edge.from, 'low')
  assert.equal(edge.endZ, 620)
  approx([[after.a.x, after.a.y, after.a.z], [after.b.x, after.b.y, after.b.z]], [[before.a.x, before.a.y, before.a.z], [before.b.x, before.b.y, before.b.z]])
  assert.deepEqual(boardDiagnostics(board), [])
})

test('paper movement detaches both linked endpoints while preserving both heights', () => {
  const board = linkedBoard(), before = spaceLinks(board.elements)[0]
  moveElements(board, ['edge'], 17, -13)
  const edge = board.elements.find(e => e.id === 'edge'), after = spaceLinks(board.elements)[0]
  assert.equal(edge.from, undefined); assert.equal(edge.to, undefined)
  assert.deepEqual(after.a, { x: before.a.x + 17, y: before.a.y - 13, z: 120 })
  assert.deepEqual(after.b, { x: before.b.x + 17, y: before.b.y - 13, z: 620 })
})

test('machine mappings and exported edits retain z, endZ, and per-vertex ink heights', () => {
  const board = linkedBoard(); deleteElements(board, ['low', 'high'])
  board.elements.push(pen())
  const lineProgram = elementProgram(board.elements[0]), inkProgram = elementProgram(board.elements[1])
  assert.equal(lineProgram.geometry.z, 120); assert.equal(lineProgram.geometry.endZ, 620)
  assert.deepEqual(inkProgram.points3d, pen().points3d)
  const reloaded = JSON.parse(JSON.stringify(boardBundle({ version: 1, elements: [] }, board, 'board', 'hash'))).edits[0].patch.board
  assert.deepEqual(spaceLinks(reloaded.elements)[0].a, spaceLinks(board.elements)[0].a)
  assert.deepEqual(spaceLinks(reloaded.elements)[0].b, spaceLinks(board.elements)[0].b)
  assert.deepEqual(plain(spaceStrokePoints(reloaded.elements[1])), plain(spaceStrokePoints(board.elements[1])))
})

test('machine inspection returns current canonical xy without mutating legacy raw tuples', () => {
  const source = pen({ x: 20, y: 30 }), original = structuredClone(source)
  const output = elementProgram(source)
  approx(output.points3d, [[20, 30, 0], [70, 30, 50], [120, 30, 100]])
  assert.deepEqual(source, original)
  assert.deepEqual(output.anchors, source.anchors)
})

test('paper translation synchronizes stored tuples on every move without accumulating deltas', () => {
  const original = { version: 1, elements: [pen()] }, board = structuredClone(original)
  moveElements(board, ['ink'], 20, 30, original)
  approx(board.elements[0].points3d, [[20, 30, 0], [70, 30, 50], [120, 30, 100]])
  moveElements(board, ['ink'], 40, -10, original)
  approx(board.elements[0].points3d, [[40, -10, 0], [90, -10, 50], [140, -10, 100]])
  assert.deepEqual(board.elements[0].extension, original.elements[0].extension)
  assert.deepEqual(original.elements[0].points3d, pen().points3d)
})

test('paper resize and reflected resize synchronize xy while retaining each vertex height', () => {
  const source = pen({ points: [[0, 0], [.5, 1], [1, 0]], points3d: [[0, 0, 0], [50, 1, 50], [100, 0, 100]] })
  for (const pointer of [{ x: 200, y: 40 }, { x: -200, y: 40 }]) {
    const result = resizeElement(source, 'se', pointer)
    approx(result.points3d, rendered(result))
    assert.deepEqual(result.points3d.map(p => p[2]), [0, 50, 100])
    assert.deepEqual(result.extension, source.extension)
  }
})

function paperCommand(name, sourceFile, context) {
  const source = readFileSync(new URL('../lib/' + sourceFile, import.meta.url), 'utf8')
  const line = source.split('\n').find(value => value.startsWith('function ' + name + '('))
  assert.ok(line, 'shared paper command exists: ' + name)
  vm.runInNewContext(line, context)
}

test('the shared duplicate command persists offset points3d without moving the source', () => {
  const source = pen(), context = {
    board: { version: 1, elements: [structuredClone(source)] }, selected: new Set(['ink']),
    canvasDraftPending: () => false, structuredClone, spaceStrokePoints,
    uid: () => 'copy-ink', change: fn => fn(), manualDrawing() {},
  }
  paperCommand('duplicate', 'board-client.js', context)
  context.duplicate()
  const copy = context.board.elements[1]
  approx(copy.points3d, [[24, 24, 0], [74, 24, 50], [124, 24, 100]])
  assert.deepEqual(copy.extension, source.extension)
  assert.deepEqual(context.board.elements[0], source)
})

test('clipboard graphic paste persists the current offset tuples and source metadata', () => {
  const source = pen(), context = {
    board: { version: 1, elements: [] }, selected: new Set(),
    A: { body: { slug: 'project' }, anatomyHash: 'hash', organs: [], flows: [] },
    structuredClone, spaceStrokePoints, boardDiagnostics, uid: () => 'pasted-ink',
    change: fn => fn(), manualDrawing() {}, message() {},
  }
  paperCommand('pasteGraphicPayload', 'board-graphics-client.js', context)
  assert.equal(context.pasteGraphicPayload({ schema: 'anatomy-graphics/1', body: 'project', anatomyHash: 'hash', elements: [source] }), true)
  approx(context.board.elements[0].points3d, [[28, 28, 0], [78, 28, 50], [128, 28, 100]])
  assert.deepEqual(context.board.elements[0].extension, source.extension)
  assert.deepEqual(source.points3d, pen().points3d)
})

test('SVG drag finalization canonicalizes resized ink before history and local storage', () => {
  const original = { version: 1, elements: [pen()] }, board = structuredClone(original), snapshots = [], saves = []
  board.elements[0].x = 30; board.elements[0].width = 200
  const context = { board, selected: new Set(['ink']), A: { organs: [], flows: [] }, spaceStrokePoints, boardDiagnostics,
    get: id => context.board.elements.find(e => e.id === id), remember: s => snapshots.push(s),
    saveLocal: () => saves.push(plain(context.board)), render() {}, message() {},
  }
  const client = readFileSync(new URL('../lib/board-client.js', import.meta.url), 'utf8')
  vm.runInNewContext(client.slice(client.indexOf('function finishDragHistory('), client.indexOf('\nfunction endDrag(')), context)
  context.finishDragHistory({ id: 'ink', snapshot: JSON.stringify(original) }, false)
  approx(context.board.elements[0].points3d, [[30, 0, 0], [130, 0, 50], [230, 0, 100]])
  assert.equal(snapshots.length, 1)
  assert.deepEqual(JSON.parse(snapshots[0]), original)
  assert.deepEqual(saves[0].elements[0].points3d, plain(context.board.elements[0].points3d))
})
