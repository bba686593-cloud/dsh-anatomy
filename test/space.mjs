import test from 'node:test'
import assert from 'node:assert/strict'
import { spaceScene, autoDepth, spaceLinks, spaceTranslateElement, spaceStrokePoints, spaceClipStroke, spacePenRig, spacePenLengths, spacePenPoint, spaceRotateVector, spacePosePoint, spaceUnposePoint, spaceShapeOutline, spaceHasGeometry } from '../lib/board-space.js'
import { boardDiagnostics } from '../lib/board.js'

const card = (id, x, y, extra = {}) => ({ id, type: 'rect', x, y, width: 200, height: 100, text: id, ...extra })
const link = (id, from, to) => ({ id, type: 'arrow', x: 0, y: 0, width: 1, height: 1, from, to })
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, actual + ' ≈ ' + expected)

test('three-axis pose uses X then Y then Z and its inverse restores absolute board coordinates', () => {
  const vector = Object.freeze({ x: 1, y: 2, z: 3 }), rotated = spaceRotateVector(vector, 90, 90, 90)
  close(rotated.x, 3); close(rotated.y, 2); close(rotated.z, -1)
  const element = Object.freeze(card('pose', 10, 20, { width: 60, height: 80, z: 20, rotationX: 90, rotationY: 90, rotation: 90 }))
  const point = Object.freeze({ x: 41, y: 62, z: 23 }), posed = spacePosePoint(element, point)
  close(posed.x, 43); close(posed.y, 62); close(posed.z, 19)
  for (const angles of [[31, -47, 83], [-130, 94, 279], [0, 0, 90], [0, 0, 0]]) {
    const e = { ...element, rotationX: angles[0], rotationY: angles[1], rotation: angles[2] }
    for (const p of [point, { x: -250, y: 372, z: -95 }, { x: 40, y: 60, z: 20 }]) {
      const restored = spaceUnposePoint(e, spacePosePoint(e, p))
      for (const axis of ['x', 'y', 'z']) close(restored[axis], p[axis])
    }
  }
  assert.deepEqual(spacePosePoint(card('flat', 0, 0), point), point)
})

test('closed profiles remain absolute and unposed with normalized polygon points authoritative', () => {
  const polygon = card('profile', 40, -30, { type: 'polygon', width: 200, height: 80, z: 15, rotationX: 90, extrusion: -40, points: [[0, 0], [1, .25], [.5, 1]] })
  assert.deepEqual(spaceShapeOutline(polygon), [{ x: 40, y: -30, z: 15 }, { x: 240, y: -10, z: 15 }, { x: 140, y: 50, z: 15 }])
  const ellipse = spaceShapeOutline(card('oval', 0, 0, { type: 'ellipse', z: 70 }))
  assert.equal(ellipse.length, 64)
  assert.deepEqual(ellipse[0], { x: 200, y: 50, z: 70 })
  assert.ok(ellipse.every((p) => p.z === 70))
  assert.notDeepEqual(ellipse[0], ellipse.at(-1))
  assert.deepEqual(spaceShapeOutline({ type: 'pen' }), [])
})

test('fit bounds include both signed extrusion faces after an out-of-plane tilt', () => {
  const element = card('solid', 0, 0, { width: 20, height: 10, z: 30, rotationX: 90, rotation: 90, extrusion: 5 })
  const positive = spaceScene({ elements: [element] }).bounds
  for (const [key, value] of Object.entries({ minX: 10, maxX: 15, minY: -5, maxY: 15, minZ: 25, maxZ: 35 })) close(positive[key], value)
  const negative = spaceScene({ elements: [{ ...element, extrusion: -5 }] }).bounds
  for (const [key, value] of Object.entries({ minX: 5, maxX: 10, minY: -5, maxY: 15, minZ: 25, maxZ: 35 })) close(negative[key], value)
  assert.equal(element.extrusion, 5)
})

test('tilting absolute ink preserves its vertex heights in fit bounds', () => {
  const ink = card('ink', 0, 0, { type: 'pen', width: 100, height: 100, z: 20, rotationX: 90, points: [[0, 0], [1, 1]], points3d: [[0, 0, 20], [100, 100, 40]] })
  const bounds = spaceScene({ elements: [ink] }).bounds
  for (const [key, value] of Object.entries({ minX: 0, maxX: 100, minY: 30, maxY: 50, minZ: -30, maxZ: 70 })) close(bounds[key], value)
  assert.deepEqual(ink.points3d, [[0, 0, 20], [100, 100, 40]])
})

test('links attach to a tilted profile in local coordinates and return its real world height', () => {
  const edges = spaceLinks([card('a', 0, 0, { z: 80, rotationY: 60 }), card('b', 400, 0, { z: 80 }), link('a-b', 'a', 'b')])
  close(edges[0].a.x, 150); close(edges[0].a.y, 50); close(edges[0].a.z, 80 - 100 * Math.sin(Math.PI / 3))
  assert.deepEqual(edges[0].b, { x: 400, y: 50, z: 80 })
  const triangle = card('triangle', 0, 0, { type: 'polygon', width: 100, height: 100, points: [[0, 0], [1, 0], [.5, 1]] })
  const polygonEdge = spaceLinks([triangle, card('b', 200, 0, { width: 100 }), link('edge', 'triangle', 'b')])[0]
  close(polygonEdge.a.x, 75); close(polygonEdge.a.y, 50)
})

test('a concave profile attaches links to its real boundary when its box center lies in the opening', () => {
  const points = [[0, 0], [1, 0], [1, 1], [.7, 1], [.7, .3], [.3, .3], [.3, 1], [0, 1]]
  for (const pose of [{}, { rotationX: 30, rotationY: -20, rotation: 25, extrusion: 40 }]) {
    const profile = card('u', 0, 0, { type: 'polygon', width: 100, height: 100, z: 10, points, ...pose })
    const localTarget = { x: 50, y: 200, z: 10 + (pose.extrusion || 0) / 2 }, target = spacePosePoint(profile, localTarget)
    const edge = { id: 'edge', type: 'line', from: 'u', x: 0, y: 0, width: target.x, height: target.y, z: 10, endZ: target.z }
    const attachment = spaceUnposePoint(profile, spaceLinks([profile, edge])[0].a)
    close(attachment.y, 100)
    close(Math.abs(attachment.x - 50), 20)
    close(attachment.z, localTarget.z)
    close(Math.hypot(attachment.x - localTarget.x, attachment.y - localTarget.y), Math.hypot(20, 100))
  }
})

test('links toward an extruded normal attach to its cap for either extrusion sign', () => {
  for (const depth of [40, -40]) {
    const solid = card('a', 0, 0, { z: 80, rotationX: 90, extrusion: depth })
    const target = card('b', 0, depth > 0 ? -550 : 450, { z: 80 })
    const edge = spaceLinks([solid, target, link('a-b', 'a', 'b')])[0]
    close(edge.a.x, 100); close(edge.a.y, 50 - depth); close(edge.a.z, 80)
  }
  const flat = spaceLinks([card('a', 0, 0, { z: 80, rotationX: 90 }), card('b', 0, -550, { z: 80 }), link('a-b', 'a', 'b')])[0]
  close(flat.a.x, 100); close(flat.a.y, 50); close(flat.a.z, 80)
})

test('free connectors pose both endpoints once, including their independent end height', () => {
  const line = { id: 'free', type: 'line', x: 0, y: 0, width: 100, height: 0, z: 10, endZ: 30, rotationY: 90 }
  const edge = spaceLinks([line])[0]
  for (const [axis, value] of Object.entries({ x: 50, y: 0, z: 60 })) close(edge.a[axis], value)
  for (const [axis, value] of Object.entries({ x: 70, y: 0, z: -40 })) close(edge.b[axis], value)
})

test('opening a connected legacy board preserves the drawing plane and document', () => {
  const board = { version: 1, elements: [card('a', 0, 0), card('b', 400, 0), link('a-b', 'a', 'b')] }, before = JSON.stringify(board)
  const scene = spaceScene(board)
  assert.equal(scene.cards.length, 2); assert.equal(scene.edges.length, 1)
  assert.deepEqual(scene.cards.map((entry) => entry.z), [0, 0])
  assert.equal(JSON.stringify(board), before)
})
test('explicit depth is retained without deriving neighbouring heights', () => {
  const scene = spaceScene({ elements: [card('a', 0, 0, { z: 520 }), card('b', 400, 0), link('a-b', 'a', 'b')] })
  assert.deepEqual(scene.cards.map((entry) => entry.z), [520, 0])
  assert.equal(scene.edges[0].a.z, 520); assert.equal(scene.edges[0].b.z, 0)
})
test('links terminate on card boundaries and fallback endpoints retain depth', () => {
  const edges = spaceLinks([card('a', 0, 0, { z: 80 }), card('b', 400, 0, { z: 160 }), link('a-b', 'a', 'b'), { id: 'free', type: 'line', x: 10, y: 20, width: -100, height: 50, z: -70 }])
  assert.deepEqual(edges[0].a, { x: 200, y: 50, z: 80 }); assert.deepEqual(edges[0].b, { x: 400, y: 50, z: 160 })
  assert.deepEqual(edges[1].a, { x: 10, y: 20, z: -70 }); assert.deepEqual(edges[1].b, { x: -90, y: 70, z: -70 })
})
test('rotated node boundary and corners share one geometry', () => {
  const edges = spaceLinks([card('a', 0, 0, { rotation: 90 }), card('b', 400, 0), link('a-b', 'a', 'b')])
  close(edges[0].a.x, 150); close(edges[0].a.y, 50)
})
test('free lines alone participate in fit bounds at their real location', () => {
  const scene = spaceScene({ elements: [{ id: 'free', type: 'line', x: 10000, y: -9000, width: -600, height: 250, z: 800 }] })
  assert.deepEqual(scene.center, { x: 9700, y: -8875, z: 800 })
  assert.deepEqual(scene.bounds, { minX: 9400, maxX: 10000, minY: -9000, maxY: -8750, minZ: 800, maxZ: 800 })
  assert.ok(scene.radius >= 325)
})
test('fit bounds contain every rotated corner and absolute 3D stroke', () => {
  const scene = spaceScene({ elements: [card('a', 0, 0, { rotation: 90 }), { id: 'ink', type: 'pen', x: 0, y: 0, width: 1, height: 1, points3d: [[-500, -600, -700], [800, 900, 1000]] }] })
  assert.deepEqual(scene.bounds, { minX: -500, maxX: 800, minY: -600, maxY: 900, minZ: -700, maxZ: 1000 })
  const rotated = spaceScene({ elements: [card('a', 0, 0, { rotation: 90 })] })
  close(rotated.bounds.minX, 50); close(rotated.bounds.maxX, 150); close(rotated.bounds.minY, -50); close(rotated.bounds.maxY, 150)
})
test('explicit layering is deterministic across input order and disconnected components', () => {
  const nodes = Array.from({ length: 18 }, (_, i) => card('n' + String(i).padStart(2, '0'), i * 200, 0))
  const edges = nodes.slice(1).map((node, i) => link('e' + i, nodes[i].id, node.id))
  const other = [card('second-a', 0, 300), card('second-b', 400, 300), link('other', 'second-a', 'second-b')]
  const all = [...nodes, ...edges, ...other], first = autoDepth(all), reordered = autoDepth([...all].reverse())
  assert.deepEqual([...first].sort(), [...reordered].sort())
  assert.equal(first.get('n17'), 17 * 180)
  assert.equal(first.get('second-a'), 0); assert.equal(first.get('second-b'), 180)
})
test('dependency depth follows directed predecessors, condenses cycles and ignores frames and undirected lines', () => {
  const nodes=['a','b','c','d','isolated'].map(id=>card(id,0,0)),edges=[link('ab','a','b'),link('ba','b','a'),link('bc','b','c'),link('cd','c','d'),{...link('line','isolated','d'),type:'line'}]
  const elements=[{...card('frame',0,0),type:'frame',height:900000},...nodes,...edges],before=structuredClone(elements),depth=autoDepth(elements)
  assert.deepEqual([...depth],[['a',0],['b',0],['c',180],['d',360],['isolated',0]])
  assert.deepEqual(autoDepth([...elements].reverse()),depth)
  assert.deepEqual(elements,before)
})
test('explicit parent structure takes precedence over a return flow and malformed parent cycles remain finite', () => {
  const nodes=[card('parent',0,0),{...card('child',0,0),structure:{parent:'parent'}},{...card('leaf',0,0),structure:{parent:'child'}}]
  const depths=autoDepth([...nodes,link('return','leaf','parent')])
  assert.equal(depths.get('parent'),0);assert.equal(depths.get('child'),180);assert.equal(depths.get('leaf'),360)
  nodes[0].structure={parent:'child'}
  const cyclic=autoDepth(nodes)
  assert.equal(cyclic.get('parent'),0);assert.equal(cyclic.get('child'),0);assert.equal(cyclic.get('leaf'),180)
})
test('bidirectional exchange shares one dependency level before downstream nodes', () => {
  const depths=autoDepth([card('a',0,0),card('b',0,0),card('c',0,0),{...link('ab','a','b'),direction:'two-way'},link('bc','b','c')])
  assert.deepEqual([...depths],[['a',0],['b',0],['c',180]])
})
test('spatial detection recognizes explicit zero-valued geometry without turning ordinary paper rotation into space', () => {
  assert.equal(spaceHasGeometry({elements:[card('a',0,0,{rotation:30})]}),false)
  for(const key of ['z','endZ','rotationX','rotationY','extrusion'])assert.equal(spaceHasGeometry({elements:[card('a',0,0,{[key]:0})]}),true,key)
  assert.equal(spaceHasGeometry({elements:[{points3d:[[0,0,0],[1,1,1]]}]}),true)
  assert.equal(spaceHasGeometry({spatialRig:spacePenRig(),elements:[]}),true)
})
test('translation keeps absolute ink and document geometry together', () => {
  const e = { id: 'ink', type: 'pen', x: 10, y: 20, width: 100, height: 50, z: 40, points: [[0, 0], [1, 1]], points3d: [[10, 20, 40], [110, 70, 70]] }
  assert.equal(spaceTranslateElement(e, 200, -50, 30), e)
  assert.deepEqual([e.x, e.y, e.z], [210, -30, 70])
  assert.deepEqual(e.points3d, [[210, -30, 70], [310, 20, 100]])
  assert.deepEqual(spaceStrokePoints(e), [{ x: 210, y: -30, z: 70 }, { x: 310, y: 20, z: 100 }])
  assert.deepEqual(e.points, [[0, 0], [1, 1]])
  delete e.points3d; delete e.z
  assert.deepEqual(spaceStrokePoints(e), [{ x: 210, y: -30, z: 0 }, { x: 310, y: 20, z: 0 }])
})
test('2D movement, resize and duplicate use current normalized geometry with per-point depth', () => {
  const original = { id: 'ink', type: 'pen', x: 10, y: 20, width: 100, height: 50, z: 40, points: [[0, 0], [0.4, 0.8], [1, 1]], points3d: [[10, 20, 40], [50, 60, 55], [110, 70, 70]] }
  const resized = structuredClone(original)
  Object.assign(resized, { x: 210, y: -30, width: 200, height: 150 })
  assert.deepEqual(spaceStrokePoints(resized), [{ x: 210, y: -30, z: 40 }, { x: 290, y: 90, z: 55 }, { x: 410, y: 120, z: 70 }])
  const duplicate = { ...structuredClone(resized), id: 'copy', x: 235, y: -5 }
  assert.deepEqual(spaceStrokePoints(duplicate), [{ x: 235, y: -5, z: 40 }, { x: 315, y: 115, z: 55 }, { x: 435, y: 145, z: 70 }])
  assert.deepEqual(spaceStrokePoints(original), [{ x: 10, y: 20, z: 40 }, { x: 50, y: 60, z: 55 }, { x: 110, y: 70, z: 70 }])
})
test('sparse line erasing splits intersections and preserves unhit ends', () => {
  const points = [{ x: -100, y: 0, z: 40 }, { x: 100, y: 0, z: 40 }]
  const runs = spaceClipStroke(points, (p) => p, { x: 0, y: 0 }, 20)
  assert.deepEqual(runs, [[{ x: -100, y: 0, z: 40 }, { x: -20, y: 0, z: 40 }], [{ x: 20, y: 0, z: 40 }, { x: 100, y: 0, z: 40 }]])
  assert.equal(points.length, 2)
})
test('perspective eraser intersections map back to the exact screen circle', () => {
  const points = [{ x: -200, y: 0, z: 100 }, { x: 200, y: 0, z: 500 }]
  const project = (p) => ({ x: p.x * 600 / (1000 - p.z), y: 0, depth: 1000 - p.z })
  const runs = spaceClipStroke(points, project, { x: 0, y: 0 }, 20)
  assert.equal(runs.length, 2)
  close(project(runs[0][1]).x, -20); close(project(runs[1][0]).x, 20)
})
test('eraser preserves tangents and can remove an entire small stroke', () => {
  const distant = [{ x: -100, y: 20, z: 0 }, { x: 100, y: 20, z: 0 }]
  assert.deepEqual(spaceClipStroke(distant, (p) => p, { x: 0, y: 0 }, 20), [distant])
  assert.deepEqual(spaceClipStroke([{ x: -2, y: 0 }, { x: 2, y: 0 }], (p) => p, { x: 0, y: 0 }, 20), [])
})
test('an unhit stroke preserves its exact floating-point endpoints', () => {
  const points = [{ x: -4214.7532643807, y: 187.619, z: 10.5 }, { x: 0.0000001, y: 219.37, z: 180.25 }]
  const runs = spaceClipStroke(points, (p) => ({ ...p, depth: 1000 - p.z }), { x: 90000, y: 90000 }, 20)
  assert.deepEqual(runs, [points])
})
test('empty input stays finite and shared board validation rejects invalid depth', () => {
  assert.equal(spaceScene().cards.length, 0); assert.ok(spaceScene().radius > 0)
  assert.deepEqual(spaceLinks([null, undefined]), [])
  assert.ok(boardDiagnostics({ version: 1, elements: [card('a', 0, 0, { z: 'deep' })] }).some((e) => e.code === 'board/depth'))
})
test('four fixed alternating corners surround the initial board without mutating it', () => {
  const board = { elements: [card('a', -600, 50, { z: -90 }), card('b', 900, 450, { z: 710 })] }, before = structuredClone(board)
  const rig = spacePenRig(board), originalRig = structuredClone(rig), scene = spaceScene(board)
  assert.deepEqual(rig.anchors.map((anchor) => anchor.id), ['A', 'B', 'C', 'D'])
  assert.deepEqual(rig.tip, scene.center)
  assert.ok(rig.bounds.minX < scene.bounds.minX && rig.bounds.maxX > scene.bounds.maxX)
  assert.ok(rig.bounds.minY < scene.bounds.minY && rig.bounds.maxY > scene.bounds.maxY)
  assert.ok(rig.bounds.minZ < scene.bounds.minZ && rig.bounds.maxZ > scene.bounds.maxZ)
  const recovered = spacePenPoint(rig.anchors, spacePenLengths(rig.anchors, rig.tip))
  close(recovered.x, rig.tip.x); close(recovered.y, rig.tip.y); close(recovered.z, rig.tip.z)
  assert.deepEqual(board, before)
  board.elements[0].x += 10000; board.elements.push(card('new', 50000, -9000))
  spaceScene(board); spacePenRig(board)
  assert.deepEqual(rig, originalRig)
})
test('an empty board has a finite usable four-corner pen volume', () => {
  const rig = spacePenRig()
  assert.deepEqual(rig.tip, { x: 0, y: 0, z: 0 })
  assert.ok(rig.bounds.maxX - rig.bounds.minX >= 640)
  assert.ok(rig.bounds.maxY - rig.bounds.minY >= 480)
  assert.ok(rig.bounds.maxZ - rig.bounds.minZ >= 520)
  const point = spacePenPoint(rig.anchors, spacePenLengths(rig.anchors, rig.tip))
  close(point.x, 0); close(point.y, 0); close(point.z, 0)
})
test('four cable lengths recover points at different heights and outside the cage', () => {
  const { anchors } = spacePenRig({ elements: [card('a', 500, -500, { z: 75 })] })
  for (const point of [{ x: 623.25, y: -425.5, z: -200 }, { x: 623.25, y: -425.5, z: 0 }, { x: 623.25, y: -425.5, z: 300 }, { x: 2300, y: 1600, z: 1500 }]) {
    const lengths = spacePenLengths(anchors, point), recovered = spacePenPoint(anchors, lengths)
    assert.equal(lengths.length, 4); assert.ok(lengths.every((length) => length > 0))
    assert.ok(recovered)
    close(recovered.x, point.x); close(recovered.y, point.y); close(recovered.z, point.z)
  }
})
test('large translations and drawing dimensions do not cause squared-coordinate drift', () => {
  const { anchors } = spacePenRig(), point = { x: 123.25, y: -79.5, z: 197.75 }, translation = { x: 1e12, y: -2e12, z: 3e12 }
  const translated = anchors.map((anchor) => ({ ...anchor, x: anchor.x + translation.x, y: anchor.y + translation.y, z: anchor.z + translation.z })), target = { x: point.x + translation.x, y: point.y + translation.y, z: point.z + translation.z }
  assert.deepEqual(spacePenLengths(translated, target), spacePenLengths(anchors, point))
  const recovered = spacePenPoint(translated, spacePenLengths(translated, target))
  assert.deepEqual(recovered, target)
  const large = translated.map((anchor) => ({ x: translation.x + (anchor.x - translation.x) * 1e6, y: translation.y + (anchor.y - translation.y) * 1e6, z: translation.z + (anchor.z - translation.z) * 1e6 })), largeTarget = { x: translation.x + point.x * 1e6, y: translation.y + point.y * 1e6, z: translation.z + point.z * 1e6 }
  const largeRecovered = spacePenPoint(large, spacePenLengths(large, largeTarget))
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(largeRecovered[axis] - largeTarget[axis]) < 0.001)
})
test('an oblique rig recovers the same point without moving over repeated readings', () => {
  const rotate = (point) => ({ x: 1400 + point.z, y: -900 + (point.x - point.y) / Math.SQRT2, z: 700 + (point.x + point.y) / Math.SQRT2 })
  const { anchors } = spacePenRig(), oblique = anchors.map(rotate), target = rotate({ x: 123.25, y: -79.5, z: 197.75 })
  let point = target
  for (let index = 0; index < 1000; index++) point = spacePenPoint(oblique, spacePenLengths(oblique, point))
  assert.ok(point)
  close(point.x, target.x); close(point.y, target.y); close(point.z, target.z)
})
test('coplanar or contradictory cables cannot produce a fictitious pen position', () => {
  const coplanar = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }], point = { x: 5, y: 5, z: 15 }
  assert.equal(spacePenPoint(coplanar, spacePenLengths(coplanar, point)), null)
  assert.equal(spacePenPoint([coplanar[0], coplanar[0], coplanar[0], coplanar[0]], [10, 10, 10, 10]), null)
  const { anchors, tip } = spacePenRig(), lengths = spacePenLengths(anchors, tip)
  lengths[3] += 1
  assert.equal(spacePenPoint(anchors, lengths), null)
  assert.equal(spacePenPoint(anchors, [1, 1, 1, 1]), null)
})
test('pen geometry rejects invalid input and never changes its anchors or lengths', () => {
  const { anchors, tip } = spacePenRig()
  anchors.forEach(Object.freeze); Object.freeze(anchors)
  const lengths = Object.freeze(spacePenLengths(anchors, tip)), before = JSON.stringify({ anchors, lengths })
  assert.ok(spacePenPoint(anchors, lengths)); assert.ok(spacePenLengths(anchors, tip))
  assert.equal(JSON.stringify({ anchors, lengths }), before)
  for (const invalid of [null, [], Array(4), [1, 2, 3, NaN], [1, 2, 3, Infinity], [1, 2, 3, -1], [1, 2, 3, 0]]) assert.equal(spacePenPoint(anchors, invalid), null)
  for (const invalid of [null, [], Array(4), [{ x: 0, y: 0, z: NaN }, ...anchors.slice(1)]]) {
    assert.equal(spacePenPoint(invalid, lengths), null)
    assert.equal(spacePenLengths(invalid, tip), null)
  }
  assert.equal(spacePenLengths(anchors, { x: Infinity, y: 0, z: 0 }), null)
  assert.equal(spacePenLengths(anchors, anchors[0]), null)
})
test('persisted pen corners and tip survive reopening after distant artwork is added', () => {
  const board = { elements: [card('a', -100, 250)] }, rig = spacePenRig(board)
  rig.tip = { x: 135.25, y: 329.5, z: 170.75 }
  board.spatialRig = { version: 1, anchors: structuredClone(rig.anchors), tip: structuredClone(rig.tip) }
  board.elements.push(card('far', 900000, -700000, { z: 500000 }))
  const before = structuredClone(board), reopened = spacePenRig(board)
  assert.deepEqual(reopened, rig)
  assert.deepEqual(board, before)
  assert.notEqual(reopened.anchors, board.spatialRig.anchors)
  for (let index = 0; index < 4; index++) assert.notEqual(reopened.anchors[index], board.spatialRig.anchors[index])
  assert.notEqual(reopened.tip, board.spatialRig.tip)
  reopened.anchors[0].x -= 50; reopened.tip.z += 75
  assert.deepEqual(board, before)
  assert.deepEqual(spacePenRig(board), rig)
})
test('persisted oblique corners derive their own bounds without writing the board', () => {
  const rig = spacePenRig(), rotate = (point) => ({ ...point, x: 500 + point.z, y: -300 + (point.x - point.y) / Math.SQRT2, z: 700 + (point.x + point.y) / Math.SQRT2 })
  const anchors = rig.anchors.map(rotate), tip = rotate({ x: 50, y: 70, z: 90 }), board = { spatialRig: { version: 1, anchors, tip, bounds: { minX: -99999 } }, elements: [] }, before = structuredClone(board)
  board.spatialRig.anchors.forEach(Object.freeze); Object.freeze(board.spatialRig.anchors); Object.freeze(board.spatialRig.tip); Object.freeze(board.spatialRig); Object.freeze(board)
  const reopened = spacePenRig(board)
  assert.deepEqual(reopened.anchors, anchors); assert.deepEqual(reopened.tip, { x: tip.x, y: tip.y, z: tip.z })
  assert.deepEqual(reopened.bounds, { minX: Math.min(...anchors.map((anchor) => anchor.x)), maxX: Math.max(...anchors.map((anchor) => anchor.x)), minY: Math.min(...anchors.map((anchor) => anchor.y)), maxY: Math.max(...anchors.map((anchor) => anchor.y)), minZ: Math.min(...anchors.map((anchor) => anchor.z)), maxZ: Math.max(...anchors.map((anchor) => anchor.z)) })
  assert.deepEqual(board, before)
})
test('invalid saved positioning data is rejected without silently replacing its corners', () => {
  const { anchors, tip } = spacePenRig(), coplanar = anchors.map((anchor) => ({ ...anchor, z: 0 }))
  for (const spatialRig of [null, undefined, {}, { version: 2, anchors, tip }, { version: 1, anchors: Array(4), tip }, { version: 1, anchors: coplanar, tip: { x: 0, y: 0, z: 100 } }, { version: 1, anchors, tip: { ...tip, z: Infinity } }, { version: 1, anchors, tip: anchors[0] }]) {
    const board = { elements: [card('far', 900000, -700000)], spatialRig }, before = structuredClone(board)
    assert.throws(() => spacePenRig(board), { message: '空间笔定位框数据无效' })
    assert.deepEqual(board, before)
  }
})
