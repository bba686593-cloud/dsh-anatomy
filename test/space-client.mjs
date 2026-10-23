// Run the real controller, shared board history, and save commands against a
// deterministic renderer and minimal DOM; replace only browser boundaries.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { boardDiagnostics, deleteElements, elementMathEntries } from '../lib/board.js'
import { drawingStaleInk, drawingClientSource } from '../lib/drawing.js'
import { parseImageSource } from '../lib/images.js'
import { partTitle } from '../lib/reading.js'
import { appendSurfaceErasure, surfaceErased, surfaceVisualSource } from '../lib/surface.js'
import { autoDepth, spaceStructureLayout, isSpaceLink, spaceLinks, spaceTranslateElement, spaceStrokePoints, spaceClipStroke, spacePenRig, spacePenLengths, spacePenPoint, spaceRotateVector, spacePosePoint, spaceUnposePoint, spaceShapeOutline } from '../lib/board-space.js'

const controller = readFileSync(new URL('../lib/board-space-client.js', import.meta.url), 'utf8')
const keyboardInput = readFileSync(new URL('../lib/board-space-input.js', import.meta.url), 'utf8')
const boardClient = readFileSync(new URL('../lib/board-client.js', import.meta.url), 'utf8')
const editClient = readFileSync(new URL('../lib/board-edit-client.js', import.meta.url), 'utf8')
const imageClient = readFileSync(new URL('../lib/board-image-client.js', import.meta.url), 'utf8')
const drawingClient = readFileSync(new URL('../lib/board-drawing-client.js', import.meta.url), 'utf8')
const graphicsClient = readFileSync(new URL('../lib/board-graphics-client.js', import.meta.url), 'utf8')
const recognitionAdapter = readFileSync(new URL('../lib/board-space-recognition.js', import.meta.url), 'utf8')
const versionsClient = readFileSync(new URL('../lib/board-versions-client.js', import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const card = (id = 'a', extra = {}) => ({ id, type: 'rect', x: 10, y: 10, width: 100, height: 60, text: '部位', ...extra })
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} should be close to ${expected}`)

function definition(source, name) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'))
  assert.notEqual(start, -1, 'shared command exists: ' + name)
  const rest = source.slice(start), next = rest.slice(1).search(/^(?:async )?function /m)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

function runtime(elements = [card()], options = {}) {
  const nodes = new Map(), frames = new Map(), messages = [], posts = [], savedLocally = []
  const rendererCalls = [], cameraCalls = [], captures = new Set(), openedEditors = []
  let frameId = 0, frameTime = 0, rendererOptions, lastSave, nextId = 0
  const target = id => {
    const listeners = new Map()
    return {
      id, style: {}, dataset: {}, attributes: {}, value: '', hidden: false,
      classList: { toggle() {}, add() {}, remove() {} }, parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      addEventListener(type, fn, capture = false) {
        const list = listeners.get(type) || []
        list.push({ fn, capture: capture === true || !!capture?.capture }); listeners.set(type, list)
      },
      emit(type, ev, capture) {
        for (const entry of listeners.get(type) || []) {
          if (capture !== undefined && entry.capture !== capture) continue
          entry.fn(ev)
          if (ev.immediate) break
        }
      },
      setAttribute(key, value) { this.attributes[key] = value },
      getAttribute(key) { return this.attributes[key] ?? null },
      hasAttribute(key) { return Object.hasOwn(this.attributes, key) },
      removeAttribute(key) { delete this.attributes[key] },
      getBoundingClientRect: () => ({ left: 100, top: 80, width: 1000, height: 700 }),
      focus() {}, closest() { return null }, matches() { return false },
      setPointerCapture(pointer) { captures.add(pointer) },
      releasePointerCapture(pointer) {
        if (captures.delete(pointer)) this.emit('lostpointercapture', event({ pointerId: pointer }))
      },
      click() { dispatch(this, 'click') },
      showModal() { this.open = true }, close() { this.open = false; this.emit('close', {}) },
    }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, target(id)); return nodes.get(id) }
  const document = Object.assign(target('document'), { getElementById: node, querySelector: () => null, querySelectorAll: () => [], body: node('body') })
  const window = Object.assign(target('window'), { __anatomyBoard: { images: {} } })
  const engine = {
    picked: null, penPicked: false, regionPicked: [], regions: [],
    sync(board, selected) { rendererCalls.push({ board: plain(board), selected: [...selected] }) },
    setPlane(z, grid, step) { this.plane = { z, grid, step } }, draw() {}, resize() {}, dispose() { this.disposed = true },
    preview(points) { this.draft = points ? plain(points) : null },
    fit(...args) { cameraCalls.push(['fit', ...args]) }, pan(...args) { cameraCalls.push(['pan', ...args]) },
    fitPenRig(...args) { cameraCalls.push(['fitPenRig', ...plain(args)]) },
    orbit(...args) { cameraCalls.push(['orbit', ...args]) }, zoom(...args) { cameraCalls.push(['zoom', ...args]) },
    // A slanted plane makes height distinguishable from y.
    unproject(x, y, z) { return { x: x - 100, y: y - 80 + z, z } },
    unprojectView(x, y, point) { return { x: x - 100, y: y - 80 + point.z, z: point.z } },
    unprojectPlane(x, y, plane) {
      const sx = x - 100, sy = y - 80, n = plane.normal, p = plane.point, denominator = n.y + n.z
      if (Math.abs(denominator) < 1e-8) return null
      const z = (n.x * (p.x - sx) + n.y * (p.y - sy) + n.z * p.z) / denominator
      return { x: sx, y: sy + z, z }
    },
    viewDirection() { return { x: 0, y: 0, z: -1 } },
    project(p) { return { x: p.x, y: p.y - p.z, scale: 1, depth: 1000 } },
    pick(x, y) { return typeof this.picked === 'function' ? this.picked(x, y) : this.picked },
    pickRegion(region) { this.regions.push(plain(region)); return typeof this.regionPicked === 'function' ? this.regionPicked(region) : this.regionPicked },
    setPenRig(rig, options) { this.penRig = rig ? plain(rig) : null; this.penOptions = options ? plain(options) : null },
    setPlacement(element) { this.placement = element ? plain(element) : null },
    setManipulator(value) { this.manipulator = value ? plain(value) : null },
    pickManipulator(x, y) { return typeof this.handlePicked === 'function' ? this.handlePicked(x, y) : this.handlePicked || null },
    pickPen(x, y) { return typeof this.penPicked === 'function' ? this.penPicked(x, y) : this.penPicked },
    info() { return { objects: context.board.elements.length, yaw: options.yaw || 0 } },
  }
  function event(values = {}) {
    return Object.assign({ target: node('space'), pointerId: 1, clientX: 130, clientY: 110,
      button: 0, detail: 1, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      preventDefault() { this.defaultPrevented = true },
      stopPropagation() { this.stopped = true },
      stopImmediatePropagation() { this.immediate = true; this.stopped = true },
    }, values)
  }
  function dispatch(destination, type, values) {
    const ev = event({ target: destination, ...values })
    document.emit(type, ev, true)
    if (!ev.stopped) destination.emit(type, ev)
    if (!ev.stopped) document.emit(type, ev, false)
    return ev
  }
  const context = {
    console, structuredClone, Set, Map, Number, Math, document, window,
    performance: { now: () => frameTime },
    board: { version: 1, layout: { mode: 'manual' }, elements: structuredClone(elements) },
    selected: new Set(), undoStack: [], redoStack: [], fieldSnapshot: null,
    graphicBusy: false, drag: null, polygon: [], tool: 'select',
    A: { organs: [], flows: [], body: { slug: 'controller-test' }, anatomyHash: 'source-hash' },
    surface: node('surface'), versionSession: { selected: { id: 'v1', revision: 'r1' }, versions: [], busy: false },
    $: node, boardDiagnostics, deleteElements, drawingStaleInk, appendSurfaceErasure, surfaceErased, surfaceVisualSource, autoDepth, spaceStructureLayout, isSpaceLink, spaceLinks, spaceTranslateElement, spaceStrokePoints, spaceClipStroke, spacePenRig, spacePenLengths, spacePenPoint, spaceRotateVector, spacePosePoint, spaceUnposePoint, spaceShapeOutline,
    inlineWritingOpen: () => false, canvasDraftPending: () => false, readingDraftChanged: () => false,
    finishInlineWriting: () => true, editingTarget: value => !!value?.editing,
    readingActive: () => false, readingIndex: -1,
    status() {}, renderEditor() {}, renderReading() {}, renderVersions() {},
    renderScene() {}, render() { context.renderScene() },
    positionInlineWriting() {}, openPaperEditor(id) { openedEditors.push(id) },
    get: id => context.board.elements.find(e => e.id === id),
    message: value => messages.push(value),
    saveLocal: () => savedLocally.push(JSON.stringify(context.board)),
    manualDrawing: () => { context.board.layout = { ...(context.board.layout || {}), mode: 'manual' } },
    setTool: next => { context.tool = next },
    remove: () => context.change(() => { deleteElements(context.board, context.selected); context.selected.clear() }),
    duplicate() {}, insertBoardImages() {}, importBoardImages() {},
    uid: () => 'new-' + (++nextId),
    createSpaceRenderer(host, callbacks) { rendererOptions = callbacks; return engine },
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId },
    cancelAnimationFrame(id) { frames.delete(id) },
    fetch: async (path, init = {}) => {
      const payload = init.body ? JSON.parse(init.body) : null
      posts.push({ path, payload })
      return options.response ? options.response(path, payload) : { ok: true, json: async () => ({ ok: true, selected: { id: 'v2', revision: 'r2' }, versions: [] }) }
    },
  }
  vm.createContext(context)
  if (options.canvasTools) {
    Object.assign(context, { lassoRegion: null, lassoInkSlices: [], canvasDraft: null,
      canvasDraftChanged: () => false, partTitle, chosen: () => context.get([...context.selected][0]) })
    node('canvas-text-editor').hidden = true; node('inline-writing').hidden = true
    vm.runInContext(definition(editClient, 'renderCanvasTools'), context)
    context.renderEditor = () => context.renderCanvasTools()
  }
  const commands = ['remember', 'fieldChanged', 'change', 'finishHistoryInteraction', 'undo', 'redo', 'flushField', 'select', 'makeElement', 'normalizedPoints']
  vm.runInContext(commands.map(name => definition(boardClient, name)).join('\n'), context)
  vm.runInContext(definition(imageClient, 'imageAt'), context)
  vm.runInContext(['versionRequest', 'updateVersionSession', 'saveProjectVersion'].map(name => definition(versionsClient, name)).join('\n'), context)
  const save = context.saveProjectVersion
  context.saveProjectVersion = (...args) => { lastSave = save(...args); return lastSave }
  // The original 2D handler is registered first, exactly as on the real page.
  vm.runInContext(boardClient.split('\n').find(line => line.startsWith("document.addEventListener('keydown',")), context)
  node('fit').addEventListener('click', () => cameraCalls.push(['legacy-2d-fit']))
  node('save').addEventListener('click', () => context.saveProjectVersion())
  node('eraser-size').value = '24'; node('eraser-mode').value = 'part'
  vm.runInContext(keyboardInput, context, { filename: 'board-space-input.js' })
  vm.runInContext(controller, context, { filename: 'board-space-client.js' })
  function flush() {
    let count = 0
    while (frames.size) {
      assert.ok(count++ < 10, 'paint invalidation must settle')
      const pending = [...frames.values()]; frames.clear()
      for (const fn of pending) fn(frameTime)
      if (options.frameDriven) break
    }
  }
  const result = {
    context, node, engine, messages, posts, captures, openedEditors, rendererCalls, cameraCalls, savedLocally, flush,
    tick(milliseconds = 16) { frameTime += milliseconds; flush() },
    get board() { return context.board }, get history() { return context.undoStack },
    get rendererOptions() { return rendererOptions }, get lastSave() { return lastSave },
    enter() { assert.equal(context.setSpaceMode(true), true); flush() },
    pointer(type, values) { const ev = dispatch(node('space'), type, values); flush(); return ev },
    pointerAt(id, type, values) { const ev = dispatch(node(id), type, values); flush(); return ev },
    key(key, values = {}) { const ev = event({ key, ...values }); document.emit('keydown', ev, true); if (!ev.stopped) document.emit('keydown', ev, false); flush(); return ev },
    keyup(key, values = {}) { const ev = event({ key, ...values }); document.emit('keyup', ev, true); if (!ev.stopped) document.emit('keyup', ev, false); flush(); return ev },
    click(id) { const button = node(id); button.closest = selector => selector === 'button' ? button : null; const ev = dispatch(button, 'click'); flush(); return ev },
    blur() { window.emit('blur', event()); flush() },
  }
  if (options.enter !== false) result.enter()
  return result
}

const recognitionPNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
function recognitionRuntime(elements = [card()], options = {}) {
  const r = runtime(elements, options), c = r.context
  let draft = null
  for (const id of ['ink-choice-dialog', 'ink-dialog']) Object.assign(r.node(id), { open: false, showModal() { this.open = true }, close() { this.open = false } })
  Object.assign(c, {
    view: { x: 0, y: 0, scale: 1 }, elementMathEntries, parseImageSource,
    inkApplying: false, inkRevision: 0, inkRecognition: null, inkLassoSession: null, inkSourceIds: [], inkMode: 'text', lassoChoiceSession: null,
    inkChanged() { c.inkRevision++; c.inkRecognition = null; r.node('ink-result').value = '' },
    setInkMode(mode) { c.inkMode = mode; c.inkChanged() }, updateInkPresentation() {}, previewInkResult() {}, checkInkService() {},
    loadInkDraft: () => draft,
    saveInkDraft() { draft = { mode: c.inkMode, result: r.node('ink-result').value, candidate: plain(c.inkRecognition), lassoSession: plain(c.inkLassoSession) } },
    closeInk() { r.node('ink-dialog').close(); c.inkLassoSession = null; c.inkRevision++ },
    closeLassoRecognitionChoice() { c.lassoChoiceSession = null; r.node('ink-choice-dialog').close() },
    recognizeInk() { throw Error('this unit must not submit a recognition request') },
    rasterFormula: options.rasterFormula || (async () => ({ src: recognitionPNG, width: 3, height: 2, displayWidth: 60, displayHeight: 30 })),
  })
  r.engine.captureRecognition = ({ region }) => {
    if (options.captureError) throw Error(options.captureError)
    return { src: recognitionPNG, bounds: { x: Math.min(...region.map(p => p.x)), y: Math.min(...region.map(p => p.y)), width: 100, height: 60 } }
  }
  vm.runInContext(drawingClientSource(), c)
  vm.runInContext(definition(boardClient, 'textLines') + '\n' + definition(drawingClient, 'drawingMapping') + '\n' + definition(graphicsClient, 'formulaImageElement'), c)
  vm.runInContext(recognitionAdapter, c, { filename: 'board-space-recognition.js' })
  return r
}

function startMove(r, end = { clientX: 167, clientY: 124 }) {
  r.context.spaceState.editScene = true
  r.context.setTool('select')
  r.engine.picked = 'a'
  r.pointer('pointerdown')
  r.pointer('pointermove', end)
  return end
}

function advanceHeldKey(r, key, values = {}, frames = 8) {
  const ev = r.key(key, values)
  for (let i = 0; i < frames; i++) r.tick(16)
  return ev
}

test('controller loads independently; entering shares the board and leaves document coordinates unchanged', () => {
  const r = runtime([card()], { enter: false }), original = plain(r.board)
  assert.equal(r.context.spaceMode, false)
  r.enter()
  assert.equal(r.context.spaceMode, true)
  assert.equal(r.context.tool, 'pen')
  assert.equal(r.context.spaceState.editScene, true)
  assert.equal(r.context.spaceState.navigation, false)
  assert.equal(r.node('surface').hidden, true)
  assert.equal(r.node('space-toggle').attributes['aria-pressed'], 'true')
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.deepEqual(r.rendererCalls.at(-1).board, original)
  r.context.setSpaceMode(false)
  assert.equal(r.node('surface').hidden, false)
})

test('reentering three dimensions follows the tool selected in two dimensions and clears stale placement', () => {
  const r = runtime(), original = plain(r.board)
  r.context.setTool('rect'); r.flush()
  assert.equal(r.engine.placement.type, 'rect')
  r.context.setSpaceMode(false)
  r.context.setTool('pen')
  r.enter()
  assert.equal(r.context.tool, 'pen')
  assert.equal(r.engine.placement, null)
  assert.equal(r.context.spaceState.navigation, false)
  r.context.setSpaceMode(false)
  r.context.setTool('rect')
  r.enter()
  assert.equal(r.context.tool, 'rect')
  assert.equal(r.engine.placement.type, 'rect')
  assert.equal(r.context.spaceState.navigation, false)
  r.context.setSpaceMode(false)
  r.context.setTool('pan')
  r.enter()
  assert.equal(r.context.tool, 'pan')
  assert.equal(r.engine.placement, null)
  assert.equal(r.context.spaceState.navigation, true)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('explicitly locking component positions preserves selection while blocking a drag', () => {
  const r = runtime(), original = plain(r.board), before = r.cameraCalls.length
  r.click('space-edit-scene')
  r.context.setTool('select'); r.engine.picked = 'a'
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 200, clientY: 170 })
  r.pointer('pointerup', { clientX: 200, clientY: 170 })
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
  assert.deepEqual(r.cameraCalls.slice(before), [])
  assert.deepEqual([...r.context.selected], ['a'])
  assert.equal(r.context.spaceState.editScene, false, 'selecting an element never unlocks the project')
})

test('a locked selection shows its title and guidance and can open content without unlocking its position', () => {
  const r = runtime([card()], { canvasTools: true }), original = plain(r.board)
  const mouse = { pointerId: 1, pointerType: 'mouse' }
  r.click('space-edit-scene')
  r.context.setTool('select'); r.engine.picked = 'a'
  r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
  r.pointer('pointerup', { ...mouse, button: 0, buttons: 0 })
  assert.deepEqual([...r.context.selected], ['a'])
  assert.equal(r.context.spaceState.editScene, false)
  assert.match(r.node('space-note').textContent, /已选 1 个/)
  assert.match(r.node('space-note').textContent, /位置已锁定/)
  assert.equal(r.node('canvas-tools').hidden, false)
  assert.equal(r.node('canvas-selection-title').hidden, false)
  assert.equal(r.node('canvas-selection-title').textContent, '部位')
  r.pointer('dblclick', { ...mouse, button: 0, buttons: 0, detail: 2 })
  assert.deepEqual(r.openedEditors, ['a'])
  assert.equal(r.context.spaceState.editScene, false)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

test('a blank left drag leaves the camera fixed until left-drag navigation is enabled', () => {
  const r = runtime(), original = plain(r.board), before = r.cameraCalls.length
  r.context.setTool('select')
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 200, clientY: 170 })
  r.pointer('pointerup', { clientX: 200, clientY: 170 })
  assert.deepEqual(plain(r.board), original)
  assert.deepEqual(r.cameraCalls.slice(before), [])
  assert.equal(r.history.length, 0)
  r.context.spaceState.navigation = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 160, clientY: 125 })
  r.pointer('pointerup', { clientX: 160, clientY: 125 })
  assert.ok(r.cameraCalls.slice(before).some(call => call[0] === 'orbit'))
  assert.deepEqual(plain(r.board), original)
})

for (const tool of ['pen', 'select', 'rect', 'eraser']) {
  for (const control of [
    { button: 2, mode: 'orbit', label: 'right drag' },
    { button: 1, mode: 'pan', label: 'middle drag' },
    { button: 2, shiftKey: true, mode: 'pan', label: 'Shift+right drag' },
  ]) {
    test(`${tool}: ${control.label} navigates while the project stays locked`, () => {
      const r = runtime(), original = plain(r.board), before = r.cameraCalls.length
      const rig = plain(r.context.spaceState.penRig)
      r.context.setTool(tool)
      r.engine.picked = 'a'; r.engine.penPicked = true
      assert.equal(r.context.spaceState.navigation, false)
      r.pointer('pointerdown', control)
      assert.equal(r.context.spaceState.viewDrag.mode, control.mode)
      r.pointer('pointermove', { ...control, clientX: 160, clientY: 125 })
      r.pointer('pointerup', { ...control, clientX: 160, clientY: 125 })
      assert.deepEqual(r.cameraCalls.slice(before), [[control.mode, 30, 15]])
      assert.deepEqual(plain(r.board), original)
      assert.deepEqual(plain(r.context.spaceState.penRig), rig)
      assert.equal(r.history.length, 0)
      assert.equal(r.savedLocally.length, 0)
      assert.equal(r.captures.size, 0)
    })
  }
}

for (const control of [
  { buttons: 3, button: 2, mode: 'orbit', label: 'right button' },
  { buttons: 5, button: 1, mode: 'pan', label: 'middle button' },
  { buttons: 3, button: 2, shiftKey: true, mode: 'pan', label: 'Shift+right button' },
]) {
  test(`the same mouse can pause a pen drag with ${control.label} and resume without a jump`, () => {
    const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
    const initial = plain(r.context.spaceState.penRig), before = r.cameraCalls.length
    r.engine.penPicked = true
    r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
    const drawn = plain(r.context.spaceState.penRig.tip)
    // Chording does not emit a second pointerdown or an intermediate pointerup.
    r.pointer('pointermove', { ...mouse, ...control, clientX: 170, clientY: 140 })
    r.pointer('pointermove', { ...mouse, ...control, button: -1, clientX: 210, clientY: 170 })
    const navigation = r.cameraCalls.slice(before).filter(call => call[0] === control.mode)
    assert.ok(navigation.length > 0)
    near(navigation.reduce((sum, call) => sum + call[1], 0), 40)
    near(navigation.reduce((sum, call) => sum + call[2], 0), 30)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), drawn)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    r.pointer('pointermove', { ...mouse, button: control.button, buttons: 1, clientX: 210, clientY: 170 })
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), drawn, 'releasing the camera button only rebases the drawing gesture')
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 220, clientY: 180 })
    near(r.context.spaceState.penRig.tip.x, drawn.x + 10)
    near(r.context.spaceState.penRig.tip.y, drawn.y + 10)
    near(r.context.spaceState.penRig.tip.z, drawn.z)
    r.pointer('pointerup', { ...mouse, button: 0, buttons: 0, clientX: 220, clientY: 180 })
    const stroke = r.board.elements.at(-1)
    assert.equal(r.board.elements.length, original.elements.length + 1)
    assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
    assert.equal(stroke.type, 'pen')
    assert.equal(stroke.points3d.length, 3, 'navigation coordinates never become pen samples')
    assert.deepEqual(plain(stroke.points3d[0]), [initial.tip.x, initial.tip.y, initial.tip.z])
    assert.deepEqual(plain(stroke.spatialInput.anchors), initial.anchors)
    assert.equal(r.history.length, 1)
    assert.equal(r.savedLocally.length, 1)
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.context.spaceState.viewDrag, null)
    assert.equal(r.captures.size, 0)
  })
}

test('releasing the left button before the right button commits the pen once and keeps navigating', () => {
  const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
  r.engine.penPicked = true
  r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
  const drawn = plain(r.context.spaceState.penRig.tip)
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 3, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 3, clientX: 210, clientY: 170 })
  r.pointer('pointermove', { ...mouse, button: 0, buttons: 2, clientX: 210, clientY: 170 })
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.context.spaceState.gesture, null)
  assert.ok(r.context.spaceState.viewDrag)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), drawn)
  const committed = plain(r.board), before = r.cameraCalls.length
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 2, clientX: 230, clientY: 180 })
  assert.ok(r.cameraCalls.slice(before).some(call => call[0] === 'orbit' && call[1] !== 0))
  r.pointer('pointerup', { ...mouse, button: 2, buttons: 0, clientX: 230, clientY: 180 })
  assert.deepEqual(plain(r.board), committed)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.context.spaceState.viewDrag, null)
  assert.equal(r.captures.size, 0)
})

test('an unlocked selection drag rebases after same-mouse navigation and still undoes in one step', () => {
  const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
  r.context.spaceState.editScene = true; r.context.setTool('select'); r.engine.picked = 'a'
  r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
  const paused = plain(r.board)
  assert.notDeepEqual(paused, original)
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 3, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 3, clientX: 210, clientY: 170 })
  assert.deepEqual(plain(r.board), paused, 'camera navigation does not alter the selected project geometry')
  assert.ok(r.cameraCalls.some(call => call[0] === 'orbit'))
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 1, clientX: 210, clientY: 170 })
  assert.deepEqual(plain(r.board), paused, 'the resumed pointer origin is rebased without resetting the element')
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 220, clientY: 180 })
  near(r.board.elements[0].x, paused.elements[0].x + 10)
  near(r.board.elements[0].y, paused.elements[0].y + 10)
  r.pointer('pointerup', { ...mouse, button: 0, buttons: 0, clientX: 220, clientY: 180 })
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.captures.size, 0)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('capture loss after a partial auxclick forwards the remaining mouse chord through document exactly once', () => {
  const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
  r.engine.penPicked = true
  r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
  const drawing = r.context.spaceState.gesture
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 3, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 3, clientX: 210, clientY: 170 })
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 1, clientX: 210, clientY: 170 })
  const tip = plain(r.context.spaceState.penRig.tip)
  r.pointer('auxclick', { ...mouse, type: 'auxclick', button: 2, buttons: 1, clientX: 210, clientY: 170 })
  r.captures.delete(1) // Chromium clears capture after this partial button release.
  r.pointer('lostpointercapture', { ...mouse, type: 'lostpointercapture', buttons: 1, clientX: 210, clientY: 170 })
  assert.equal(r.context.spaceState.gesture, drawing)
  assert.deepEqual(plain(r.context.spaceState.captureResume), { pointer: 1, recover: true })
  assert.equal(r.captures.has(1), false, 'the partial native loss switches this chord to document forwarding')
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), tip)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  let canvasMoves = 0, projections = 0
  r.node('space').addEventListener('pointermove', () => canvasMoves++)
  const unproject = r.engine.unprojectView
  r.engine.unprojectView = (...args) => { projections++; return unproject(...args) }
  const recovery = r.pointer('pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 1, clientX: 220, clientY: 180 })
  assert.equal(recovery.immediate, true)
  assert.equal(canvasMoves, 0, 'capture-phase routing prevents the canvas target handlers from processing the event again')
  assert.equal(projections, 1)
  assert.equal(r.captures.has(1), false)
  assert.deepEqual(plain(r.context.spaceState.captureResume), { pointer: 1, recover: true })
  near(r.context.spaceState.penRig.tip.x, tip.x + 10)
  near(r.context.spaceState.penRig.tip.y, tip.y + 10)
  let outsideMoves = 0
  r.node('outside').addEventListener('pointermove', () => outsideMoves++)
  r.pointerAt('outside', 'pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 1, clientX: 230, clientY: 190 })
  assert.equal(outsideMoves, 0)
  assert.equal(projections, 2, 'each forwarded move updates the pen once')
  near(r.context.spaceState.penRig.tip.x, tip.x + 20)
  near(r.context.spaceState.penRig.tip.y, tip.y + 20)
  assert.equal(r.captures.has(1), false)
  const release = r.pointerAt('outside', 'pointerup', { ...mouse, type: 'pointerup', button: 0, buttons: 0, clientX: 230, clientY: 190 })
  assert.equal(release.immediate, true)
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.context.spaceState.captureResume, null)
  assert.equal(r.captures.size, 0)
})

test('capture loss after a partial primary click recovers a right-button view drag even outside the canvas', () => {
  const r = runtime(), mouse = { pointerId: 1, pointerType: 'mouse' }
  r.engine.penPicked = true
  r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { ...mouse, button: 2, buttons: 3, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { ...mouse, button: -1, buttons: 3, clientX: 210, clientY: 170 })
  r.pointer('pointermove', { ...mouse, button: 0, buttons: 2, clientX: 210, clientY: 170 })
  const view = r.context.spaceState.viewDrag, committed = plain(r.board), before = r.cameraCalls.length
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.history.length, 1)
  r.pointer('click', { ...mouse, type: 'click', button: 0, buttons: 2, clientX: 210, clientY: 170 })
  r.captures.delete(1)
  r.pointer('lostpointercapture', { ...mouse, type: 'lostpointercapture', buttons: 2, clientX: 210, clientY: 170 })
  assert.equal(r.context.spaceState.viewDrag, view)
  assert.deepEqual(plain(r.context.spaceState.captureResume), { pointer: 1, recover: true })
  assert.equal(r.captures.has(1), false)
  let outsideMoves = 0
  r.node('outside').addEventListener('pointermove', () => outsideMoves++)
  const recovery = r.pointerAt('outside', 'pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 2, clientX: 230, clientY: 180 })
  assert.equal(recovery.immediate, true)
  assert.equal(outsideMoves, 0)
  assert.deepEqual(r.cameraCalls.slice(before), [['orbit', 20, 10]], 'an outside recovery event moves the camera exactly once')
  assert.equal(r.captures.has(1), false)
  assert.deepEqual(plain(r.context.spaceState.captureResume), { pointer: 1, recover: true })
  r.pointerAt('outside', 'pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 2, clientX: 250, clientY: 190 })
  assert.deepEqual(r.cameraCalls.slice(before), [['orbit', 20, 10], ['orbit', 20, 10]])
  assert.equal(outsideMoves, 0)
  assert.equal(r.captures.has(1), false)
  const release = r.pointerAt('outside', 'pointerup', { ...mouse, type: 'pointerup', button: 2, buttons: 0, clientX: 250, clientY: 190 })
  assert.equal(release.immediate, true)
  assert.deepEqual(plain(r.board), committed)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.context.spaceState.viewDrag, null)
  assert.equal(r.context.spaceState.captureResume, null)
  assert.equal(r.captures.size, 0)
})

for (const marker of ['absent', 'expired after a move']) {
  test(`capture loss while a button is held still cancels when its partial-click marker is ${marker}`, () => {
    const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
    const initial = plain(r.context.spaceState.penRig.tip)
    r.engine.penPicked = true
    r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
    if (marker !== 'absent') {
      r.pointer('auxclick', { ...mouse, type: 'auxclick', button: 2, buttons: 1, clientX: 170, clientY: 140 })
      r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 180, clientY: 150 })
    }
    r.captures.delete(1)
    r.pointer('lostpointercapture', { ...mouse, type: 'lostpointercapture', buttons: 1, clientX: 180, clientY: 150 })
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.context.spaceState.viewDrag, null)
    assert.equal(r.captures.size, 0)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

for (const action of ['outside cancellation', 'a new canvas press']) {
  test(`document forwarding ends safely on ${action}`, () => {
    const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
    const initial = plain(r.context.spaceState.penRig.tip)
    r.engine.penPicked = true
    r.pointer('pointerdown', { ...mouse, type: 'pointerdown', button: 0, buttons: 1 })
    r.pointer('pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 1, clientX: 170, clientY: 140 })
    const oldGesture = r.context.spaceState.gesture
    r.pointer('auxclick', { ...mouse, type: 'auxclick', button: 2, buttons: 1, clientX: 170, clientY: 140 })
    r.captures.delete(1)
    r.pointer('lostpointercapture', { ...mouse, type: 'lostpointercapture', buttons: 1, clientX: 170, clientY: 140 })
    assert.equal(r.context.spaceState.captureResume.recover, true)
    if (action === 'outside cancellation') {
      const cancel = r.pointerAt('outside', 'pointercancel', { ...mouse, type: 'pointercancel', buttons: 0 })
      assert.equal(cancel.immediate, true)
      assert.equal(r.context.spaceState.gesture, null)
      assert.equal(r.captures.size, 0)
    } else {
      r.pointer('pointerdown', { ...mouse, type: 'pointerdown', button: 0, buttons: 1, clientX: 150, clientY: 130 })
      assert.ok(r.context.spaceState.gesture)
      assert.notEqual(r.context.spaceState.gesture, oldGesture)
      assert.equal(r.context.spaceState.gesture.startX, 150)
      assert.equal(r.context.spaceState.gesture.startY, 130)
    }
    assert.equal(r.context.spaceState.captureResume, null)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
    if (action === 'a new canvas press') {
      r.pointer('pointermove', { ...mouse, type: 'pointermove', button: -1, buttons: 1, clientX: 160, clientY: 140 })
      near(r.context.spaceState.penRig.tip.x, initial.x + 10)
      near(r.context.spaceState.penRig.tip.y, initial.y + 10)
      r.pointer('pointerup', { ...mouse, type: 'pointerup', button: 0, buttons: 0, clientX: 160, clientY: 140 })
      assert.equal(r.board.elements.length, original.elements.length + 1)
      assert.equal(r.history.length, 1)
      assert.equal(r.captures.size, 0)
    }
  })
}

for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur', 'escape']) {
  test(`${cancellation} clears both parts of a same-mouse drawing and navigation chord`, () => {
    const r = runtime(), original = plain(r.board), mouse = { pointerId: 1, pointerType: 'mouse' }
    const initial = plain(r.context.spaceState.penRig.tip)
    r.engine.penPicked = true
    r.pointer('pointerdown', { ...mouse, button: 0, buttons: 1 })
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 170, clientY: 140 })
    r.pointer('pointermove', { ...mouse, button: 2, buttons: 3, clientX: 170, clientY: 140 })
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 3, clientX: 210, clientY: 170 })
    assert.ok(r.cameraCalls.some(call => call[0] === 'orbit'), 'the cancellation covers a live chord navigation')
    if (cancellation === 'blur') r.blur()
    else if (cancellation === 'escape') r.key('Escape', { code: 'Escape' })
    else r.pointer(cancellation, { ...mouse, buttons: 0 })
    assert.equal(r.context.spaceMode, true)
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.context.spaceState.viewDrag, null)
    assert.equal(r.captures.size, 0)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
    const before = r.cameraCalls.length
    r.pointer('pointermove', { ...mouse, button: -1, buttons: 1, clientX: 230, clientY: 180 })
    r.pointer('pointerup', { ...mouse, button: 0, buttons: 0, clientX: 230, clientY: 180 })
    assert.equal(r.cameraCalls.length, before)
    assert.deepEqual(plain(r.board), original)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

test('wheel zoom is available while drawing tools are active, and Alt+wheel moves only the tip', () => {
  const r = runtime(), original = plain(r.board), before = r.cameraCalls.length
  const initial = plain(r.context.spaceState.penRig)
  r.pointer('wheel', { deltaY: -40 })
  const calls = r.cameraCalls.slice(before)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'zoom')
  assert.ok(calls[0][1] > 1)
  assert.deepEqual(plain(r.context.spaceState.penRig), initial)
  r.pointer('wheel', { deltaY: -40, altKey: true })
  assert.notDeepEqual(plain(r.context.spaceState.penRig.tip), initial.tip)
  assert.deepEqual(plain(r.context.spaceState.penRig.anchors), initial.anchors)
  assert.equal(r.cameraCalls.length, before + 1)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

for (const control of ['button', 'toolbar-gap']) {
  test(`ordinary wheel over ${control} zooms the camera without changing the carrier or document`, () => {
    const r = runtime(), original = plain(r.board), tip = plain(r.context.spaceState.penRig.tip), before = r.cameraCalls.length
    const target = r.node(control)
    target.closest = selector => selector === '.space-tools' ? r.node('toolbar') : null
    const event = r.pointer('wheel', { target, deltaY: -50 })
    assert.equal(event.defaultPrevented, true)
    assert.equal(r.cameraCalls.at(-1)[0], 'zoom')
    assert.equal(r.cameraCalls.length, before + 1)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), tip)
    assert.deepEqual(plain(r.board), original)
  })
}

for (const selector of ['input', 'textarea', 'select', '[contenteditable=true]', '.space-advanced[open] > div']) {
  test(`wheel in ${selector} remains a native control action and does not zoom`, () => {
    const r = runtime(), before = r.cameraCalls.length, target = r.node('native-control')
    target.closest = value => value.split(',').includes(selector) ? target : null
    const event = r.pointer('wheel', { target, deltaY: 50 })
    assert.equal(event.defaultPrevented, undefined)
    assert.equal(r.cameraCalls.length, before)
  })
}

test('an overflowing control panel consumes its wheel while a non-overflowing toolbar permits zoom', () => {
  const r = runtime(), target = r.node('panel-button'), panel = r.node('scroll-panel'), before = r.cameraCalls.length
  panel.scrollHeight = 500; panel.clientHeight = 100; panel.overflowY = 'auto'; panel.parentElement = r.node('space')
  target.parentElement = panel
  r.context.getComputedStyle = node => ({ overflowY: node.overflowY || 'visible' })
  assert.equal(r.pointer('wheel', { target, deltaY: 50 }).defaultPrevented, undefined)
  assert.equal(r.cameraCalls.length, before)
  panel.scrollHeight = panel.clientHeight
  assert.equal(r.pointer('wheel', { target, deltaY: 50 }).defaultPrevented, true)
  assert.equal(r.cameraCalls.at(-1)[0], 'zoom')
})

test('wheel line and page delta modes use consistent pixel scaling, and zero or invalid deltas do nothing', () => {
  const r = runtime(), original = plain(r.board), tip = plain(r.context.spaceState.penRig.tip)
  const factor = (deltaY, deltaMode) => { r.pointer('wheel', { deltaY, deltaMode }); return r.cameraCalls.at(-1)[1] }
  near(factor(-3, 1), factor(-48, 0))
  near(factor(-1, 2), factor(-120, 0))
  const before = r.cameraCalls.length
  for (const deltaY of [0, NaN, Infinity, -Infinity]) {
    assert.equal(r.pointer('wheel', { deltaY }).defaultPrevented, undefined)
    assert.equal(r.pointer('wheel', { deltaY, altKey: true }).defaultPrevented, undefined)
  }
  assert.equal(r.cameraCalls.length, before)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), tip)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('wheel during a live stroke rebases its camera-plane grab so an unchanged pointer cannot add a jump', () => {
  const r = runtime(), original = plain(r.board)
  let scale = 1
  r.engine.zoom = factor => { scale *= factor; r.cameraCalls.push(['zoom', factor]) }
  r.engine.project = point => ({ x: point.x * scale, y: (point.y - point.z) * scale, scale, depth: 1000 })
  r.engine.unprojectView = (x, y, point) => ({ x: (x - 100) / scale, y: (y - 80) / scale + point.z, z: point.z })
  r.engine.penPicked = true
  r.pointer('pointerdown', { buttons: 1 })
  r.pointer('pointermove', { buttons: 1, clientX: 170, clientY: 140 })
  const tip = plain(r.context.spaceState.penRig.tip), samples = r.context.spaceState.gesture.runs[0].length
  r.pointer('wheel', { deltaY: -80, clientX: 170, clientY: 140 })
  r.pointer('pointermove', { buttons: 1, clientX: 170, clientY: 140 })
  for (const axis of ['x', 'y', 'z']) near(r.context.spaceState.penRig.tip[axis], tip[axis])
  assert.equal(r.context.spaceState.gesture.runs[0].length, samples)
  assert.deepEqual(plain(r.board), original)
  r.pointer('pointermove', { buttons: 1, clientX: 190, clientY: 140 })
  near(r.context.spaceState.penRig.tip.x, tip.x + 20 / scale)
  r.pointer('pointerup', { buttons: 0, clientX: 190, clientY: 140 })
  assert.equal(r.history.length, 1)
})

test('wheel during a held camera drag preserves navigation and resumes with the next pointer delta', () => {
  const r = runtime(), original = plain(r.board), tip = plain(r.context.spaceState.penRig.tip)
  r.pointer('pointerdown', { button: 2, buttons: 2 })
  r.pointer('pointermove', { button: -1, buttons: 2, clientX: 180, clientY: 140 })
  r.pointer('wheel', { deltaY: -60, clientX: 180, clientY: 140 })
  assert.equal(r.cameraCalls.at(-1)[0], 'zoom')
  assert.ok(r.context.spaceState.viewDrag)
  r.pointer('pointermove', { button: -1, buttons: 2, clientX: 190, clientY: 145 })
  assert.deepEqual(r.cameraCalls.at(-1), ['orbit', 10, 5])
  r.pointer('pointerup', { button: 2, buttons: 0, clientX: 190, clientY: 145 })
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), tip)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

for (const mode of ['point', 'box', 'lasso']) {
  test(`${mode} selection collects real object IDs including ink without editing the document`, () => {
    const ink = card('ink', { type: 'pen', points: [[0, 0], [1, 1]], points3d: [[10, 10, 20], [110, 70, 40]] })
    const r = runtime([card(), card('b'), ink]), original = plain(r.board)
    r.context.setTool('select'); r.click('space-select-' + mode)
    r.context.selected.add('a'); r.engine.picked = mode === 'point' ? null : 'a'; r.engine.regionPicked = ['b', 'ink', 'missing']
    r.pointer('pointerdown', { clientX: 130, clientY: 160 })
    r.pointer('pointermove', { clientX: 240, clientY: 160 })
    r.pointer('pointermove', { clientX: 240, clientY: 260 })
    r.pointer('pointermove', { clientX: 130, clientY: 260 })
    assert.equal(r.node('space-selection-overlay').style.display, 'block')
    assert.deepEqual([...r.context.selected], ['a'], 'a live region is only a selection preview')
    r.pointer('pointerup', { clientX: mode === 'lasso' ? 130 : 240, clientY: 260 })
    assert.deepEqual([...r.context.selected], ['b', 'ink'])
    assert.equal(r.context.spaceState.selectionMode, mode)
    assert.equal(r.context.tool, 'select', 'selection lasso never enters the modeling lasso')
    assert.equal(r.node('space-selection-overlay').style.display, 'none')
    assert.equal(r.engine.regions.length, 1)
    assert.ok(r.engine.regions[0].every(point => point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 700))
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

test('Shift range selection adds a union, and a straight-line range preserves the old selection', () => {
  const r = runtime([card(), card('b')]), original = plain(r.board)
  r.context.setTool('select'); r.click('space-select-lasso'); r.context.selected.add('a'); r.engine.regionPicked = ['b']
  r.pointer('pointerdown', { shiftKey: true, clientX: 130, clientY: 160 })
  r.pointer('pointermove', { clientX: 240, clientY: 160 })
  r.pointer('pointermove', { clientX: 240, clientY: 260 })
  r.pointer('pointerup', { clientX: 130, clientY: 260 })
  assert.deepEqual([...r.context.selected], ['a', 'b'])
  r.engine.regionPicked = ['b']
  r.pointer('pointerdown', { clientX: 130, clientY: 160 })
  r.pointer('pointermove', { clientX: 240, clientY: 160 })
  r.pointer('pointerup', { clientX: 260, clientY: 160 })
  assert.deepEqual([...r.context.selected], ['a', 'b'])
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('point selection can select a pen and transform it with the selected objects in one undo step', () => {
  const ink = card('ink', { type: 'pen', z: 20, points: [[0, 0], [1, 1]], points3d: [[10, 10, 20], [110, 70, 40]] })
  const r = runtime([card(), ink], { frameDriven: true }), original = plain(r.board)
  r.context.setTool('select'); r.engine.picked = 'ink'
  r.pointer('pointerdown'); r.pointer('pointerup')
  assert.deepEqual([...r.context.selected], ['ink'])
  assert.equal(r.history.length, 0)
  for (const [key, code] of [['d', 'KeyD'], ['i', 'KeyI'], ['j', 'KeyJ'], ['x', 'KeyX']]) r.key(key, { code })
  r.tick(16); r.tick(32)
  for (const [key, code] of [['d', 'KeyD'], ['i', 'KeyI'], ['j', 'KeyJ'], ['x', 'KeyX']]) r.keyup(key, { code })
  const moved = r.context.get('ink')
  assert.ok(moved.x > ink.x)
  for (const field of ['rotationX', 'rotationY', 'rotation']) assert.ok(moved[field] > 0)
  assert.deepEqual(plain(r.context.get('a')), original.elements[0])
  assert.equal(r.history.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

for (const cancel of ['escape', 'pointercancel', 'lostpointercapture', 'blur', 'right-drag', 'wheel']) {
  test(`${cancel} cancels a range preview and preserves its previous selection and document`, () => {
    const r = runtime([card(), card('b')]), original = plain(r.board)
    r.context.setTool('select'); r.click('space-select-box'); r.context.selected.add('a'); r.engine.regionPicked = ['b']
    r.pointer('pointerdown', { clientX: 130, clientY: 160, buttons: 1 })
    r.pointer('pointermove', { clientX: 240, clientY: 260, buttons: 1 })
    if (cancel === 'escape') r.key('Escape', { code: 'Escape' })
    else if (cancel === 'blur') r.blur()
    else if (cancel === 'right-drag') r.pointer('pointermove', { button: 2, buttons: 3, clientX: 240, clientY: 260 })
    else if (cancel === 'wheel') r.pointer('wheel', { deltaY: -40 })
    else r.pointer(cancel)
    assert.equal(r.context.spaceState.gesture, null)
    assert.deepEqual([...r.context.selected], ['a'])
    assert.equal(r.node('space-selection-overlay').style.display, 'none')
    assert.equal(r.context.spaceMode, true)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

test('held arrow-key navigation cancels an unfinished range and rotates on the first hold', () => {
  const r = runtime([card(), card('b')], { frameDriven: true }), original = plain(r.board)
  r.context.setTool('select'); r.click('space-select-lasso'); r.context.selected.add('a')
  r.pointer('pointerdown', { clientX: 130, clientY: 160, buttons: 1 })
  r.pointer('pointermove', { clientX: 240, clientY: 260, buttons: 1 })
  r.key('ArrowRight', { code: 'ArrowRight' }); r.tick(16); r.tick(32)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.node('space-selection-overlay').style.display, 'none')
  assert.equal(r.context.spaceInput.busy(), true)
  assert.ok(r.cameraCalls.some(call => call[0] === 'orbit' && call[1] > 0))
  assert.deepEqual([...r.context.selected], ['a'])
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.keyup('ArrowRight', { code: 'ArrowRight' })
  assert.equal(r.context.spaceInput.busy(), false)
})

test('holding a movement key draws with the tip and commits one shared undo step on release', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig)
  assert.equal(advanceHeldKey(r, 'd', { code: 'KeyD' }).defaultPrevented, true)
  assert.equal(r.context.tool, 'pen')
  assert.equal(r.context.spaceState.gesture.mode, 'laser')
  assert.equal(r.context.spaceState.gesture.input, 'keyboard')
  assert.notDeepEqual(plain(r.context.spaceState.penRig.tip), initial.tip)
  assert.deepEqual(plain(r.context.spaceState.penRig.anchors), initial.anchors)
  assert.deepEqual(plain(r.board), original, 'held movement is a preview until all movement keys are released')
  assert.equal(r.history.length, 0)
  r.keyup('d', { code: 'KeyD' })
  const stroke = r.board.elements.at(-1)
  assert.equal(stroke.type, 'pen')
  assert.ok(stroke.points3d.length >= 2)
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.deepEqual(plain(stroke.spatialInput.anchors), initial.anchors)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('a raised pen can move with game controls without altering the locked project or adding ink', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig)
  r.click('space-pen-down')
  advanceHeldKey(r, 'e', { code: 'KeyE' })
  r.keyup('e', { code: 'KeyE' })
  assert.ok(r.context.spaceState.penRig.tip.z > initial.tip.z)
  assert.deepEqual(plain(r.context.spaceState.penRig.anchors), initial.anchors)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

test('game movement follows the camera facing while Q/E keep the world height axis', () => {
  const r = runtime([card()], { frameDriven: true, yaw: Math.PI / 2 })
  const initial = plain(r.context.spaceState.penRig.tip)
  r.click('space-pen-down')
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  r.keyup('d', { code: 'KeyD' })
  near(r.context.spaceState.penRig.tip.x, initial.x)
  assert.ok(r.context.spaceState.penRig.tip.y < initial.y)
  near(r.context.spaceState.penRig.tip.z, initial.z)
  const sideways = plain(r.context.spaceState.penRig.tip)
  advanceHeldKey(r, 'e', { code: 'KeyE' })
  r.keyup('e', { code: 'KeyE' })
  near(r.context.spaceState.penRig.tip.x, sideways.x)
  near(r.context.spaceState.penRig.tip.y, sideways.y)
  assert.ok(r.context.spaceState.penRig.tip.z > sideways.z)
  assert.equal(r.history.length, 0)
})

for (const cancellation of ['escape', 'blur', 'hidden', 'tool', 'exit']) {
  test(`${cancellation} stops held movement and discards an unfinished keyboard stroke`, () => {
    const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
    const initial = plain(r.context.spaceState.penRig)
    advanceHeldKey(r, 'w', { code: 'KeyW' })
    assert.notDeepEqual(plain(r.context.spaceState.penRig.tip), initial.tip)
    if (cancellation === 'escape') r.key('Escape', { code: 'Escape' })
    else if (cancellation === 'blur') r.blur()
    else if (cancellation === 'hidden') { r.context.document.hidden = true; r.context.document.emit('visibilitychange', {}) }
    else if (cancellation === 'tool') r.context.setTool('select')
    else r.context.setSpaceMode(false)
    r.flush()
    const stopped = plain(r.context.spaceState.penRig.tip)
    for (let i = 0; i < 6; i++) r.tick(16)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), stopped)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial.tip)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.context.spaceInput.busy(), false)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

test('typing and reserved shortcuts cannot start game movement or replace the current drawing tool', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig)
  r.key('d', { code: 'KeyD', target: { editing: true } })
  r.tick(32)
  r.keyup('d', { code: 'KeyD', target: { editing: true } })
  r.key('a', { code: 'KeyA', ctrlKey: true })
  r.tick(32)
  assert.deepEqual([...r.context.selected], ['a'])
  assert.equal(r.context.tool, 'pen')
  assert.equal(r.context.spaceInput.busy(), false)
  assert.deepEqual(plain(r.context.spaceState.penRig), initial)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('arrow keys rotate the view without moving the pen or project', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig), before = r.cameraCalls.length
  advanceHeldKey(r, 'ArrowRight', { code: 'ArrowRight' })
  r.keyup('ArrowRight', { code: 'ArrowRight' })
  assert.ok(r.cameraCalls.slice(before).some(call => call[0] === 'orbit' && call[1] > 0))
  assert.deepEqual(plain(r.context.spaceState.penRig), initial)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('rotating with the mouse while a game key is held preserves the active stroke transaction', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  const drawing = r.context.spaceState.gesture, before = r.cameraCalls.length
  r.pointer('pointerdown', { button: 2, pointerId: 2 })
  r.pointer('pointermove', { button: 2, pointerId: 2, clientX: 170, clientY: 140 })
  r.pointer('pointerup', { button: 2, pointerId: 2, clientX: 170, clientY: 140 })
  assert.deepEqual(r.cameraCalls.slice(before), [['orbit', 40, 30]])
  assert.equal(r.context.spaceState.gesture, drawing)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.tick(16)
  r.keyup('d', { code: 'KeyD' })
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.equal(r.history.length, 1)
})

test('held arrow keys can rotate the view throughout a mouse-drawn stroke', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 170, clientY: 140 })
  const drawing = r.context.spaceState.gesture, before = r.cameraCalls.length
  advanceHeldKey(r, 'ArrowRight', { code: 'ArrowRight' })
  r.keyup('ArrowRight', { code: 'ArrowRight' })
  assert.ok(r.cameraCalls.slice(before).filter(call => call[0] === 'orbit').length > 1)
  assert.equal(r.context.spaceState.gesture, drawing)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.pointer('pointerup', { clientX: 170, clientY: 140 })
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.equal(r.history.length, 1)
})

test('Escape cancels both held view controls and the mouse stroke without leaving the view', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig.tip)
  r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 170, clientY: 140 })
  advanceHeldKey(r, 'ArrowRight', { code: 'ArrowRight' })
  r.key('Escape', { code: 'Escape' })
  assert.equal(r.context.spaceMode, true)
  assert.equal(r.context.spaceInput.busy(), false)
  assert.equal(r.context.spaceState.gesture, null)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.captures.size, 0)
})

test('Escape releases a mouse view drag while keeping the three-dimensional view open', () => {
  const r = runtime(), original = plain(r.board)
  r.pointer('pointerdown', { button: 2 })
  r.pointer('pointermove', { button: 2, clientX: 170, clientY: 140 })
  r.key('Escape', { code: 'Escape' })
  assert.equal(r.context.spaceMode, true)
  assert.equal(r.context.spaceState.viewDrag, null)
  assert.equal(r.captures.size, 0)
  const before = r.cameraCalls.length
  r.pointer('pointermove', { button: 2, clientX: 210, clientY: 170 })
  assert.equal(r.cameraCalls.length, before)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('Escape cancels a keyboard stroke and concurrent mouse view drag together', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  r.pointer('pointerdown', { button: 2, pointerId: 2 })
  r.pointer('pointermove', { button: 2, pointerId: 2, clientX: 170, clientY: 140 })
  r.key('Escape', { code: 'Escape' })
  assert.equal(r.context.spaceMode, true)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.context.spaceState.viewDrag, null)
  assert.equal(r.context.spaceInput.busy(), false)
  assert.equal(r.captures.size, 0)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('a sidebar component can be positioned and rotated with keys before Enter places it once', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.key('3', { code: 'Digit3' })
  assert.equal(r.context.tool, 'rect')
  assert.equal(r.engine.placement.type, 'rect')
  const first = plain(r.engine.placement)
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  r.keyup('d', { code: 'KeyD' })
  advanceHeldKey(r, 'e', { code: 'KeyE' })
  r.keyup('e', { code: 'KeyE' })
  advanceHeldKey(r, 'x', { code: 'KeyX' })
  r.keyup('x', { code: 'KeyX' })
  const ghost = plain(r.engine.placement)
  assert.notEqual(ghost.x, first.x)
  assert.ok(ghost.z > first.z)
  assert.ok(ghost.rotation > (first.rotation || 0))
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.key('Enter', { code: 'Enter' })
  r.key('Enter', { code: 'Enter', repeat: true })
  const placed = r.board.elements.at(-1)
  assert.equal(r.board.elements.length, original.elements.length + 1)
  for (const field of ['type', 'x', 'y', 'z', 'width', 'height', 'rotation']) assert.equal(placed[field], ghost[field], field)
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
})

test('the optional scene lock blocks game movement until explicitly unlocked', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.click('space-edit-scene')
  r.context.setTool('select'); r.context.selected.add('a')
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  r.keyup('d', { code: 'KeyD' })
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.context.spaceState.editScene = true
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  assert.notDeepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  r.keyup('d', { code: 'KeyD' })
  assert.equal(r.board.elements[0].x > original.elements[0].x, true)
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('selection moves and rotates existing components on all three axes by default in one undo step', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.context.setTool('select'); r.engine.picked = 'a'
  r.pointer('pointerdown'); r.pointer('pointerup')
  assert.equal(r.context.spaceState.editScene, true)
  assert.deepEqual([...r.context.selected], ['a'])
  for (const [key, code] of [['d', 'KeyD'], ['i', 'KeyI'], ['j', 'KeyJ'], ['x', 'KeyX']]) r.key(key, { code })
  r.tick(16); r.tick(32)
  assert.ok(r.board.elements[0].x > original.elements[0].x)
  for (const field of ['rotationX', 'rotationY', 'rotation']) assert.ok(r.board.elements[0][field] > 0, field)
  assert.equal(r.history.length, 0)
  for (const [key, code] of [['d', 'KeyD'], ['i', 'KeyI'], ['j', 'KeyJ'], ['x', 'KeyX']]) r.keyup(key, { code })
  assert.equal(r.history.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original, 'undo removes pose fields absent from the original component')
})

for (const tool of ['rect', 'ellipse', 'diamond', 'polygon', 'line', 'arrow', 'text', 'math', 'frame']) {
  test(`${tool} is carried as a preview until the explicit place action, never free ink`, () => {
    const r = runtime(), original = plain(r.board)
    r.context.setTool(tool)
    r.pointer('pointerdown', { clientX: 180, clientY: 220 })
    r.pointer('pointermove', { clientX: 270, clientY: 280 })
    r.pointer('pointerup', { clientX: 270, clientY: 280 })
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    for (const [field, value] of [['rotationX', 25], ['rotationY', -35], ['rotation', 40]]) r.context.spaceSetPoseField(field, value)
    const ghost = plain(r.engine.placement)
    assert.equal(ghost.type, tool)
    r.click('space-place')
    assert.equal(r.board.elements.length, original.elements.length + 1)
    const placed = r.board.elements.at(-1)
    for (const field of ['type', 'x', 'y', 'z', 'rotationX', 'rotationY', 'rotation']) assert.equal(placed[field], ghost[field], field)
    assert.equal(r.history.length, 1)
    assert.deepEqual(boardDiagnostics(r.board), [])
  })
}

test('a three-dimensional lasso closes a tilted planar profile, extrudes along its normal, and places once', () => {
  const r = runtime(), original = plain(r.board)
  r.key('b', { code: 'KeyB' })
  assert.equal(r.context.tool, 'lasso')
  assert.equal(r.context.spaceMode, true)
  for (const [field, value] of [['rotationX', 20], ['rotationY', 15], ['rotation', 35]]) r.context.spaceSetPoseField(field, value)
  r.pointer('pointerdown', { clientX: 260, clientY: 260 })
  for (const [clientX, clientY] of [[420, 260], [420, 390], [260, 390], [260, 260]]) r.pointer('pointermove', { clientX, clientY })
  r.pointer('pointerup', { clientX: 260, clientY: 260 })
  assert.equal(r.context.spaceState.profileReady, true)
  assert.equal(r.context.spaceState.transform, 'extrude')
  assert.equal(r.engine.placement.type, 'polygon')
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.deepEqual(r.engine.manipulator.normal, plain(spaceRotateVector({ x: 0, y: 0, z: 1 }, 20, 15, 35)))
  r.context.spaceSetExtrusion(-120)
  assert.equal(r.engine.placement.extrusion, -120)
  const ghost = plain(r.engine.placement)
  r.key('Enter', { code: 'Enter' })
  const placed = r.board.elements.at(-1)
  assert.equal(placed.type, 'polygon')
  assert.equal(placed.extrusion, -120)
  assert.equal(placed.rotationX, 20); assert.equal(placed.rotationY, 15); assert.equal(placed.rotation, 35)
  assert.deepEqual(plain(placed.points), ghost.points)
  assert.equal(r.context.spaceState.profileReady, false)
  assert.equal(r.history.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('canceling an in-flight tilted lasso keeps the project and history unchanged', () => {
  const r = runtime(), original = plain(r.board), initial = plain(r.context.spaceState.penRig.tip)
  r.context.setTool('lasso')
  r.context.spaceSetPoseField('rotationY', 25)
  r.pointer('pointerdown', { clientX: 260, clientY: 260 })
  r.pointer('pointermove', { clientX: 420, clientY: 260 })
  r.key('Escape', { code: 'Escape' })
  assert.equal(r.context.spaceMode, true)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.context.spaceState.profileReady, false)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

for (const [axis, field] of [['x', 'rotationX'], ['y', 'rotationY'], ['z', 'rotation']]) {
  test(`the ${axis.toUpperCase()} rotation handle changes only that pose axis and records one undo step`, () => {
    const r = runtime(), original = plain(r.board)
    r.context.setTool('select'); r.context.selected.add('a')
    r.engine.handlePicked = { mode: 'rotate', axis }
    r.pointer('pointerdown')
    r.pointer('pointermove', { clientX: 170, clientY: 100 })
    r.pointer('pointerup', { clientX: 170, clientY: 100 })
    near(r.board.elements[0][field], 35)
    for (const other of ['rotationX', 'rotationY', 'rotation'].filter(name => name !== field)) assert.equal(r.board.elements[0][other], original.elements[0][other])
    assert.equal(r.board.elements.length, original.elements.length, 'a rotation never records free ink')
    assert.equal(r.history.length, 1)
    r.key('z', { code: 'KeyZ', ctrlKey: true })
    assert.deepEqual(plain(r.board), original)
  })
}

for (const [mode, axis] of [['move', 'x'], ['rotate', 'x'], ['rotate', 'y'], ['rotate', 'z']]) {
  test(`${mode}/${axis} handle movement back to its starting point leaves no mutation or history`, () => {
    const r = runtime(), original = plain(r.board)
    r.context.setTool('select'); r.context.selected.add('a')
    r.engine.handlePicked = { mode, axis }
    r.pointer('pointerdown')
    r.pointer('pointermove', { clientX: 170, clientY: 100 })
    assert.notDeepEqual(plain(r.board), original)
    r.pointer('pointermove', { clientX: 130, clientY: 110 })
    r.pointer('pointerup', { clientX: 130, clientY: 110 })
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
  })
}

test('Undo synchronizes the selected pose before a subsequent absolute angle input', () => {
  const r = runtime(), original = plain(r.board)
  r.context.setTool('select'); r.context.selected.add('a'); r.context.spacePaint()
  r.context.spaceSetPoseField('rotationX', 35)
  assert.equal(r.board.elements[0].rotationX, 35)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.context.spaceState.pose.rotationX, 0)
  r.context.spaceSetPoseField('rotationX', 40)
  assert.equal(r.board.elements[0].rotationX, 40)
  assert.equal(r.node('space-rotationX').value, '40')
})

test('a top-view extrusion handle remains usable when its normal projects to one screen point', () => {
  const r = runtime(), original = plain(r.board)
  r.context.setTool('select'); r.context.selected.add('a')
  r.engine.project = p => ({ x: p.x, y: p.y, scale: 1, depth: 1000 })
  r.engine.handlePicked = { mode: 'extrude', axis: 'z' }
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 130, clientY: 70 })
  r.pointer('pointerup', { clientX: 130, clientY: 70 })
  near(r.board.elements[0].extrusion, 40)
  assert.equal(r.history.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('imported images remain on the carrier until Enter places each image with its full pose', () => {
  const r = runtime(), original = plain(r.board)
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
  const images = ['输入示意', '输出示意'].map(alt => ({ src, alt, width: 3, height: 2 }))
  assert.equal(r.context.insertBoardImages(images), true)
  assert.equal(r.context.tool, 'image')
  assert.deepEqual(plain(r.board), original)
  r.context.spaceSetPoseField('rotationX', 30); r.context.spaceSetPoseField('rotationY', -20)
  for (let i = 0; i < images.length; i++) {
    assert.equal(r.engine.placement.image.alt, images[i].alt)
    r.key('Enter', { code: 'Enter' })
    const placed = r.board.elements.at(-1)
    assert.equal(placed.type, 'image')
    assert.equal(placed.rotationX, 30); assert.equal(placed.rotationY, -20)
    assert.deepEqual(plain(placed.image), images[i])
    assert.equal(r.board.elements.length, original.elements.length + i + 1)
    assert.equal(r.history.length, i + 1)
  }
  assert.deepEqual(boardDiagnostics(r.board), [])
})

test('Escape rolls back held movement of an unlocked component without saving its transient position', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.context.spaceState.editScene = true; r.context.setTool('select'); r.context.selected.add('a')
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  assert.notDeepEqual(plain(r.board), original)
  r.key('Escape', { code: 'Escape' })
  for (let i = 0; i < 6; i++) r.tick(16)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
  assert.equal(r.context.spaceInput.busy(), false)
})

test('pressing a component number while moving the pen cancels that stroke before changing tools', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  const initial = plain(r.context.spaceState.penRig.tip)
  advanceHeldKey(r, 'd', { code: 'KeyD' })
  r.key('3', { code: 'Digit3' })
  assert.equal(r.context.tool, 'rect')
  assert.equal(r.context.spaceInput.busy(), false)
  assert.equal(r.context.spaceState.gesture, null)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
  assert.equal(r.engine.placement.type, 'rect')
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

test('dragging a component tip repositions its ghost without drawing ink or placing the component', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.key('3', { code: 'Digit3' })
  const initial = plain(r.context.spaceState.penRig.tip), ghost = plain(r.engine.placement)
  r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 170, clientY: 140 })
  r.pointer('wheel', { deltaY: -40, altKey: true })
  r.pointer('pointerup', { clientX: 170, clientY: 140 })
  assert.notDeepEqual(plain(r.context.spaceState.penRig.tip), initial)
  assert.notEqual(r.engine.placement.x, ghost.x)
  assert.notEqual(r.engine.placement.z, ghost.z)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
  r.key('Enter', { code: 'Enter' })
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.equal(r.board.elements.at(-1).type, 'rect')
  assert.equal(r.history.length, 1)
})

test('Enter while dragging a component tip finishes placement as one transaction', () => {
  const r = runtime([card()], { frameDriven: true }), original = plain(r.board)
  r.key('3', { code: 'Digit3' }); r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 170, clientY: 140 })
  r.key('Enter', { code: 'Enter' })
  assert.equal(r.board.elements.length, original.elements.length + 1)
  assert.equal(r.history.length, 1)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.captures.size, 0)
  r.pointer('pointerup', { clientX: 170, clientY: 140 })
  assert.equal(r.history.length, 1)
  assert.equal(r.savedLocally.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('Enter during mouse erasure cannot replace its original undo snapshot', () => {
  const ink = card('ink', { type: 'pen', x: 0, y: 100, width: 100, height: 1, z: 40,
    points: [[0, 0], [1, 0]], points3d: [[0, 100, 40], [100, 100, 40]] })
  const r = runtime([ink]), original = plain(r.board)
  r.context.setTool('eraser'); r.node('eraser-size').value = '10'
  r.pointer('pointerdown', { clientX: 150, clientY: 140 })
  assert.notDeepEqual(plain(r.board), original)
  r.key('Enter', { code: 'Enter' })
  r.pointer('pointerup', { clientX: 150, clientY: 140 })
  assert.equal(r.history.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('pen height changes leave selected locked project elements untouched', () => {
  const r = runtime([card('a', { z: 40 })]), original = plain(r.board)
  r.context.selected.add('a')
  const height = r.context.spaceState.workZ
  r.click('space-layer-up')
  near(r.context.spaceState.workZ, height + 60)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

test('one pixel of pointer jitter cannot move an explicitly unlocked project element', () => {
  const r = runtime(), original = plain(r.board)
  r.context.spaceState.editScene = true; r.context.setTool('select'); r.engine.picked = 'a'
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 131, clientY: 111 })
  r.pointer('pointerup', { clientX: 131, clientY: 111 })
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

for (const cancellation of ['pointercancel', 'lostpointercapture', 'escape', 'blur', 'tool']) {
  test(cancellation + ' rolls back the live edit without a history or storage write', () => {
    const r = runtime(), original = plain(r.board)
    startMove(r)
    assert.equal(r.board.elements[0].x, 47)
    if (cancellation === 'escape') r.key('Escape')
    else if (cancellation === 'blur') r.blur()
    else if (cancellation === 'tool') r.context.setTool('pen')
    else r.pointer(cancellation)
    r.flush()
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
    assert.equal(r.captures.size, 0)
    assert.deepEqual(r.rendererCalls.at(-1).board, original)
  })
}

test('pointerup records exactly one history step despite many move events and capture loss', () => {
  const r = runtime(), original = JSON.stringify(r.board)
  startMove(r)
  r.pointer('pointermove', { clientX: 180, clientY: 140 })
  assert.equal(r.history.length, 0)
  r.pointer('pointerup', { clientX: 180, clientY: 140 })
  r.pointer('pointerup', { clientX: 180, clientY: 140 })
  assert.equal(r.history.length, 1)
  assert.equal(r.history[0], original)
  assert.equal(r.savedLocally.length, 1)
  assert.equal(r.captures.size, 0)
  assert.equal(r.board.elements[0].x, 60)
})

test('a different pointer cannot finish or cancel the active gesture', () => {
  const r = runtime()
  startMove(r)
  r.pointer('pointercancel', { pointerId: 2 })
  r.pointer('pointerup', { pointerId: 2 })
  assert.equal(r.context.spaceState.gesture.pointer, 1)
  assert.equal(r.history.length, 0)
  r.pointer('pointerup')
  assert.equal(r.history.length, 1)
})

test('Ctrl+Z and Ctrl+Y update geometry, absolute ink, and the renderer through shared history', () => {
  const ink = card('a', { type: 'pen', points: [[0, 0], [1, 1]], points3d: [[10, 10, 0], [110, 70, 30]] })
  const r = runtime([ink]), original = plain(r.board)
  startMove(r)
  r.pointer('pointerup')
  const moved = plain(r.board)
  assert.deepEqual(moved.elements[0].points3d, [[47, 24, 0], [147, 84, 30]])
  assert.equal(r.key('z', { ctrlKey: true }).defaultPrevented, true)
  assert.deepEqual(plain(r.board), original)
  assert.deepEqual(r.rendererCalls.at(-1).board, original)
  assert.equal(r.context.redoStack.length, 1, '2D bubble handler must not undo a second time')
  r.key('y', { ctrlKey: true })
  assert.deepEqual(plain(r.board), moved)
  assert.deepEqual(r.rendererCalls.at(-1).board, moved)
})

test('Ctrl+Z and Ctrl+S during a live gesture cannot commit or save transient geometry', () => {
  const r = runtime()
  startMove(r)
  r.key('z', { ctrlKey: true })
  r.key('s', { ctrlKey: true })
  assert.equal(r.history.length, 0)
  assert.equal(r.posts.length, 0)
  assert.ok(r.context.spaceState.gesture)
  r.pointer('pointercancel')
})

test('dragging the four-cable tip saves its changing world coordinates while keeping project geometry fixed', () => {
  const r = runtime(), original = plain(r.board), rig = r.context.spaceState.penRig
  const anchors = plain(rig.anchors), lengths = spacePenLengths(rig.anchors, rig.tip), samples = [plain(rig.tip)]
  r.engine.penPicked = true
  const start = r.engine.project(rig.tip), x = start.x + 100, y = start.y + 80
  r.pointer('pointerdown', { clientX: x, clientY: y })
  assert.equal(r.context.spaceState.gesture.mode, 'laser')
  r.pointer('pointermove', { clientX: x + 30, clientY: y + 10 })
  samples.push(plain(rig.tip))
  r.pointer('wheel', { deltaY: -40, altKey: true })
  samples.push(plain(rig.tip))
  r.pointer('pointermove', { clientX: x + 40, clientY: y + 20 })
  samples.push(plain(rig.tip))
  assert.deepEqual(plain(r.board), original, 'the active preview is not durable document geometry')
  assert.deepEqual(plain(rig.anchors), anchors, 'cable anchors stay fixed while the tip moves')
  const changed = spacePenLengths(rig.anchors, rig.tip)
  assert.equal(changed.length, 4)
  assert.ok(changed.every((length, i) => Math.abs(length - lengths[i]) > 1e-6))
  assert.ok(samples.at(-1).x !== samples[0].x && samples.at(-1).y !== samples[0].y && samples.at(-1).z !== samples[0].z)
  r.pointer('pointerup', { clientX: x + 40, clientY: y + 20 })
  const stroke = r.board.elements.at(-1)
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.deepEqual(plain(stroke.points3d), samples.map(p => [p.x, p.y, p.z]))
  assert.deepEqual(plain(stroke.spatialInput), { version: 1, type: 'four-anchor', anchors })
  near(stroke.z, samples[0].z)
  near(r.context.spaceState.workZ, samples.at(-1).z)
  assert.equal(r.context.tool, 'pen')
  assert.equal(r.history.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
  assert.deepEqual(r.engine.penRig.anchors, anchors)
})

test('the pen can start away from the tip while preserving existing components', () => {
  const r = runtime(), original = plain(r.board), tip = plain(r.context.spaceState.penRig.tip)
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 230, clientY: 210 })
  r.pointer('pointerup', { clientX: 230, clientY: 210 })
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.equal(r.board.elements.at(-1).type, 'pen')
  assert.notDeepEqual(plain(r.context.spaceState.penRig.tip), tip)
  assert.equal(r.context.spaceState.gesture, null)
  assert.equal(r.history.length, 1)
})

for (const cancellation of ['pointercancel', 'lostpointercapture', 'escape', 'blur', 'tool']) {
  test(cancellation + ' cancels a laser stroke and restores the tip without changing existing project geometry', () => {
    const r = runtime(), original = plain(r.board), rig = r.context.spaceState.penRig
    const initial = plain(rig.tip), anchors = plain(rig.anchors)
    r.engine.penPicked = true
    r.pointer('pointerdown')
    r.pointer('pointermove', { clientX: 190, clientY: 170 })
    r.pointer('wheel', { deltaY: -60, altKey: true })
    assert.notDeepEqual(plain(rig.tip), initial)
    if (cancellation === 'escape') r.key('Escape')
    else if (cancellation === 'blur') r.blur()
    else if (cancellation === 'tool') r.context.setTool('select')
    else r.pointer(cancellation)
    r.flush()
    assert.deepEqual(plain(rig.tip), initial)
    assert.deepEqual(plain(rig.anchors), anchors)
    assert.deepEqual(plain(r.board), original)
    assert.equal(r.context.spaceState.gesture, null)
    assert.equal(r.history.length, 0)
    assert.equal(r.savedLocally.length, 0)
    assert.equal(r.captures.size, 0)
  })
}

test('moving the raised pen changes cable lengths without recording a stroke', () => {
  const r = runtime(), original = plain(r.board), rig = r.context.spaceState.penRig
  const initial = plain(rig.tip), anchors = plain(rig.anchors)
  r.engine.penPicked = true
  r.click('space-pen-down')
  assert.equal(r.context.spaceState.penDown, false)
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 190, clientY: 170 })
  r.pointer('pointerup', { clientX: 190, clientY: 170 })
  assert.notDeepEqual(plain(rig.tip), initial)
  assert.deepEqual(plain(rig.anchors), anchors)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.savedLocally.length, 0)
})

test('temporarily raising the tip leaves a gap instead of bridging separate strokes', () => {
  const r = runtime(), original = plain(r.board)
  r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 150, clientY: 120 })
  const firstEnd = plain(r.context.spaceState.penRig.tip)
  r.key(' ')
  r.pointer('pointermove', { clientX: 170, clientY: 130 })
  const lifted = plain(r.context.spaceState.penRig.tip)
  r.keyup(' ')
  r.pointer('pointermove', { clientX: 190, clientY: 140 })
  const secondStart = plain(r.context.spaceState.penRig.tip)
  r.pointer('pointermove', { clientX: 200, clientY: 150 })
  r.pointer('pointerup', { clientX: 200, clientY: 150 })
  const strokes = r.board.elements.slice(original.elements.length)
  assert.equal(strokes.length, 2)
  assert.deepEqual(plain(strokes[0].points3d.at(-1)), [firstEnd.x, firstEnd.y, firstEnd.z])
  assert.deepEqual(plain(strokes[1].points3d[0]), [secondStart.x, secondStart.y, secondStart.z])
  assert.ok(!strokes.some(stroke => stroke.points3d.some(p => p[0] === lifted.x && p[1] === lifted.y && p[2] === lifted.z)))
  assert.deepEqual(plain(r.board.elements.slice(0, original.elements.length)), original.elements)
  assert.equal(r.history.length, 1)
})

test('document changes and reopening the view cannot recenter the cached cable anchors', () => {
  const r = runtime(), initial = plain(r.context.spaceState.penRig)
  r.context.change(() => { r.board.elements.push(card('far', { x: 20000, y: -9000, z: 5000 })) })
  r.flush()
  assert.deepEqual(plain(r.context.spaceState.penRig), initial)
  assert.deepEqual(r.engine.penRig.anchors, initial.anchors)
  r.context.setSpaceMode(false)
  r.enter()
  assert.deepEqual(plain(r.context.spaceState.penRig), initial)
  assert.deepEqual(r.engine.penRig.anchors, initial.anchors)
})

test('saving during a laser gesture discards its preview and restores the tip before snapshotting', async () => {
  const r = runtime(), original = plain(r.board), initial = plain(r.context.spaceState.penRig.tip)
  r.engine.penPicked = true
  r.pointer('pointerdown')
  r.pointer('pointermove', { clientX: 190, clientY: 170 })
  r.click('save')
  assert.equal(await r.lastSave, true)
  assert.deepEqual(r.posts[0].payload.board, original)
  assert.deepEqual(plain(r.context.spaceState.penRig.tip), initial)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('a component preview follows carrier height without inheriting a hovered component layer', () => {
  const r = runtime([card('high', { z: 400 })])
  r.engine.picked = 'high'; r.context.setTool('rect')
  r.context.spacePositionPen({ ...r.context.spaceState.penRig.tip, z: 37 })
  r.pointer('pointerdown', { clientX: 150, clientY: 180 })
  r.pointer('pointermove', { clientX: 240, clientY: 250 })
  r.pointer('pointerup', { clientX: 240, clientY: 250 })
  assert.equal(r.board.elements.length, 1)
  assert.equal(r.history.length, 0)
  r.key('Enter', { code: 'Enter' })
  near(r.board.elements.at(-1).z, 37)
  near(r.context.spaceState.workZ, 37)
})

test('footer fit intercepts the 2D layout handler', () => {
  const r = runtime(), before = r.cameraCalls.length
  const ev = r.click('fit')
  assert.equal(ev.defaultPrevented, true)
  assert.deepEqual(r.cameraCalls.slice(before), [['fitPenRig', false]])
})

test('clicking save cancels a live gesture before the existing save command captures its snapshot', async () => {
  const r = runtime(), original = plain(r.board)
  startMove(r)
  r.click('save')
  assert.equal(await r.lastSave, true)
  assert.deepEqual(r.posts[0].payload.board, original)
  assert.equal(r.posts[0].payload.expectedSelection, 'r1')
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('a version conflict preserves the committed board and its undo history', async () => {
  const r = runtime([card()], { response: async () => ({ ok: false, json: async () => ({ ok: false, error: { message: '选定版本已变化' } }) }) })
  startMove(r); r.pointer('pointerup')
  const committed = plain(r.board)
  r.key('s', { ctrlKey: true })
  assert.equal(await r.lastSave, false)
  assert.deepEqual(plain(r.board), committed)
  assert.equal(r.history.length, 1)
  assert.equal(r.context.versionSession.selected.revision, 'r1')
  assert.match(r.context.versionSession.error, /选定版本已变化/)
})

test('an attached line dragged alone detaches both ends while retaining their heights', () => {
  const elements = [card('a', { z: 10 }), card('b', { x: 310, z: 90 }),
    { id: 'edge', type: 'arrow', x: 0, y: 0, width: 1, height: 1, from: 'a', to: 'b' }]
  const before = spaceLinks(elements)[0], r = runtime(elements)
  r.context.spaceState.editScene = true; r.context.setTool('select')
  r.engine.picked = 'edge'
  r.pointer('pointerdown', { clientX: 280, clientY: 120 })
  r.pointer('pointermove', { clientX: 300, clientY: 130 })
  r.pointer('pointerup', { clientX: 300, clientY: 130 })
  const edge = r.board.elements.find(e => e.id === 'edge'), moved = spaceLinks(r.board.elements)[0]
  assert.equal(edge.from, undefined); assert.equal(edge.to, undefined)
  assert.deepEqual(moved.a, { x: before.a.x + 20, y: before.a.y + 10, z: 10 })
  assert.deepEqual(moved.b, { x: before.b.x + 20, y: before.b.y + 10, z: 90 })
  assert.equal(r.history.length, 1)
  r.key('z', { ctrlKey: true })
  assert.deepEqual(plain(r.board.elements.find(e => e.id === 'edge')), elements[2])
})

test('an in-flight version save blocks new pointer edits and captures the committed snapshot', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const r = runtime([card()], { response: () => pending }), original = plain(r.board)
  r.click('save')
  assert.equal(r.context.versionSession.busy, true)
  startMove(r); r.pointer('pointerup')
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
  assert.equal(r.context.spaceState.gesture, null)
  release({ ok: true, json: async () => ({ ok: true, selected: { id: 'v2', revision: 'r2' }, versions: [] }) })
  assert.equal(await r.lastSave, true)
  assert.deepEqual(r.posts[0].payload.board, original)
  assert.equal(r.context.versionSession.busy, false)
})

test('context loss forces a safe 2D fallback even while a version request is busy', () => {
  const r = runtime()
  r.context.versionSession.busy = true
  r.rendererOptions.onContextLost()
  r.flush()
  assert.equal(r.context.spaceMode, false)
  assert.equal(r.node('surface').hidden, false)
  assert.equal(r.context.spaceState.engine, null)
  assert.equal(r.engine.disposed, true)
})

test('3D erasure keeps the first fragment identity, linked guide, and stale recognition semantics', () => {
  const ink = card('ink', { type: 'pen', x: 0, y: 100, width: 100, height: 1, z: 40,
    points: [[0, 0], [1, 0]], points3d: [[0, 100, 40], [100, 100, 40]],
    handwriting: { source: 'old-whole-stroke' }, recognition: { provider: 'local', reviewed: true },
    extension: { preserve: true } })
  const r = runtime([ink, card('b', { x: 300, y: 100, z: 150 }),
    { id: 'edge', type: 'line', x: 0, y: 0, width: 1, height: 1, from: 'ink', to: 'b' }])
  r.context.board.reading = { summary: '理解笔迹。', steps: [{ element: 'ink', title: '笔迹', description: '核对原稿。' }] }
  r.context.setTool('eraser'); r.node('eraser-size').value = '10'
  r.pointer('pointerdown', { clientX: 150, clientY: 140 })
  r.pointer('pointerup', { clientX: 150, clientY: 140 })
  const pieces = r.board.elements.filter(e => e.type === 'pen')
  assert.equal(pieces.length, 2)
  assert.equal(pieces[0].id, 'ink')
  assert.equal(r.board.elements.find(e => e.id === 'edge').from, 'ink')
  assert.equal(r.board.reading.steps[0].element, 'ink')
  for (const piece of pieces) {
    assert.equal(piece.handwriting, undefined)
    assert.equal(piece.recognition.stale, true)
    assert.deepEqual(plain(piece.extension), { preserve: true })
  }
  assert.equal(r.history.length, 1)
  assert.deepEqual(boardDiagnostics(r.board), [])
  // Removing all surviving ink must detach its linked endpoint and remove the
  // authored guide step, then undo must restore both associations.
  r.node('eraser-size').value = '200'
  r.pointer('pointerdown', { clientX: 150, clientY: 140 })
  r.pointer('pointerup', { clientX: 150, clientY: 140 })
  assert.equal(r.board.elements.filter(e => e.type === 'pen').length, 0)
  assert.equal(r.board.elements.find(e => e.id === 'edge').from, undefined)
  assert.equal(r.board.elements.find(e => e.id === 'edge').z, 40)
  assert.equal(r.board.reading.steps.length, 0)
  assert.deepEqual(boardDiagnostics(r.board), [])
  r.key('z', { ctrlKey: true })
  assert.equal(r.board.reading.steps[0].element, 'ink')
  assert.equal(r.board.elements.find(e => e.id === 'edge').from, 'ink')
})

test('erasing three-axis tilted ink bakes surviving fragments in world space and Undo restores the pose', () => {
  const ink = card('tilted-ink', { type: 'pen', x: 0, y: 100, width: 200, height: 1, z: 40,
    rotationX: 25, rotationY: 35, rotation: 15,
    points: [[0, 0], [1, 0]], points3d: [[0, 100, 40], [200, 100, 80]], extension: { keep: true } })
  const r = runtime([ink]), original = plain(r.board)
  const world = spaceStrokePoints(ink).map(point => spacePosePoint(ink, point))
  const middle = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, (world[0][axis] + world[1][axis]) / 2]))
  const screen = r.engine.project(middle)
  r.context.setTool('eraser'); r.node('eraser-size').value = '10'
  const at = { clientX: screen.x + 100, clientY: screen.y + 80 }
  r.pointer('pointerdown', at); r.pointer('pointerup', at)
  const pieces = r.board.elements.filter(e => e.type === 'pen')
  assert.equal(pieces.length, 2)
  const nearPoint = (actual, expected) => { for (const axis of ['x', 'y', 'z']) near(actual[axis], expected[axis]) }
  nearPoint(spaceStrokePoints(pieces[0])[0], world[0])
  nearPoint(spaceStrokePoints(pieces.at(-1)).at(-1), world[1])
  const direction = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, world[1][axis] - world[0][axis]]))
  const lengthSquared = Object.values(direction).reduce((sum, value) => sum + value * value, 0)
  for (const piece of pieces) {
    for (const field of ['rotation', 'rotationX', 'rotationY']) assert.equal(piece[field], undefined, field)
    for (const point of spaceStrokePoints(piece)) {
      const t = ['x', 'y', 'z'].reduce((sum, axis) => sum + (point[axis] - world[0][axis]) * direction[axis], 0) / lengthSquared
      assert.ok(t >= -1e-8 && t <= 1 + 1e-8)
      nearPoint(point, Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, world[0][axis] + direction[axis] * t])))
    }
    assert.deepEqual(plain(piece.extension), { keep: true })
  }
  assert.equal(r.history.length, 1)
  r.key('z', { code: 'KeyZ', ctrlKey: true })
  assert.deepEqual(plain(r.board), original)
})

test('pen Undo and Redo keep the rendered tip aligned with the saved spatial rig', () => {
  const r = runtime()
  const draw = (x, y) => {
    r.pointer('pointerdown', { clientX: x, clientY: y })
    r.pointer('pointermove', { clientX: x + 70, clientY: y + 35 })
    r.pointer('pointerup', { clientX: x + 70, clientY: y + 35 })
    return plain(r.board)
  }
  const first = draw(160, 180), second = draw(280, 260)
  assert.notDeepEqual(first.spatialRig.tip, second.spatialRig.tip)
  const matchesSavedTip = expected => {
    assert.deepEqual(plain(r.board), expected)
    assert.deepEqual(plain(r.context.spaceState.penRig.tip), expected.spatialRig.tip)
    assert.deepEqual(r.engine.penRig.tip, expected.spatialRig.tip)
    assert.deepEqual(r.engine.project(r.engine.penRig.tip), r.engine.project(expected.spatialRig.tip))
    near(r.context.spaceState.workZ, expected.spatialRig.tip.z)
  }
  matchesSavedTip(second)
  r.key('z', { code: 'KeyZ', ctrlKey: true }); matchesSavedTip(first)
  r.key('y', { code: 'KeyY', ctrlKey: true }); matchesSavedTip(second)
})

test('an empty three-dimensional profile opens an explicit empty choice without discarding its extrusion', async () => {
  const r = recognitionRuntime([]), c = r.context
  c.setTool('lasso')
  c.spaceState.placement = card('space-placement', { type: 'polygon', text: '', points: [[0, 0], [1, 0], [1, 1], [0, 1]], extrusion: -80 })
  c.spaceState.profileReady = true; c.spaceState.transform = 'extrude'; c.spacePaint()
  const before = c.spaceRecognitionState()
  assert.equal(c.spaceRecognitionRequest(), true)
  assert.equal(r.node('ink-choice-dialog').open, true)
  assert.match(r.node('ink-choice-feedback').textContent, /没有可识别/)
  assert.equal(await c.spaceRecognitionStart('text'), false)
  assert.equal(r.node('ink-choice-dialog').open, true)
  assert.equal(c.spaceRecognitionState(), before)
  assert.equal(r.history.length, 0)
  assert.equal(r.posts.length, 0)
})

for (const mutation of ['board', 'revision', 'selection', 'pose', 'tip', 'camera', 'viewport']) {
  test(`a spatial recognition snapshot rejects a changed ${mutation}`, () => {
    const r = recognitionRuntime(), c = r.context
    c.setTool('select'); c.selected.add('a'); c.spacePaint()
    const session = c.spaceRecognitionScope()
    assert.equal(c.spaceRecognitionCurrent(session), true)
    if (mutation === 'board') c.board.elements[0].text += '变更'
    else if (mutation === 'revision') c.versionSession.selected.revision = 'changed'
    else if (mutation === 'selection') c.selected.clear()
    else if (mutation === 'pose') c.spaceState.pose.rotationX += 5
    else if (mutation === 'tip') c.spaceState.penRig.tip.z += 5
    else if (mutation === 'camera') r.engine.info = () => ({ yaw: 1 })
    else r.node('space').getBoundingClientRect = () => ({ left: 100, top: 80, width: 800, height: 700 })
    assert.equal(c.spaceRecognitionCurrent(session), false)
  })
}

test('capture errors preserve the selected source and show a retryable spatial preview error', async () => {
  const r = recognitionRuntime([card()], { captureError: '测试图形捕获失败' }), c = r.context
  c.setTool('select'); c.selected.add('a'); c.spacePaint()
  const session = c.spaceRecognitionScope(), before = c.spaceRecognitionState()
  assert.equal(await c.spaceRecognitionOpen({ mode: 'text', session }), false)
  assert.equal(c.spaceRecognitionState(), before)
  assert.equal(r.node('ink-dialog').open, true)
  assert.match(r.node('ink-feedback').textContent, /测试图形捕获失败.*保留/)
  assert.equal(c.inkLassoSession.captureError, true)
  assert.equal(r.history.length, 0)
})

test('reopening the unchanged spatial region restores its saved unconfirmed candidate', async () => {
  const r = recognitionRuntime(), c = r.context
  c.setTool('select'); c.selected.add('a'); c.spacePaint()
  assert.equal(await c.spaceRecognitionOpen({ mode: 'text' }), true)
  r.node('ink-result').value = '待确认识别说明'
  c.inkRecognition = { text: '待确认识别说明', engine: 'test-fixture' }
  c.saveInkDraft(); c.closeInk()
  assert.equal(await c.spaceRecognitionOpen({ mode: 'text' }), true)
  assert.equal(r.node('ink-result').value, '待确认识别说明')
  assert.deepEqual(plain(c.inkRecognition), { text: '待确认识别说明', engine: 'test-fixture' })
  assert.match(r.node('ink-feedback').textContent, /恢复/)
  assert.equal(r.history.length, 0)
})

for (const mode of ['text', 'math']) {
  test(`confirmed spatial ${mode} adds a result at the snapshotted pose without replacing the pending profile`, async () => {
    const source = card('source', { text: '原始区域说明', z: 40, rotationX: 20, rotationY: -15, rotation: 35,
      anchors: [{ file: 'example.js', symbol: 'run', role: '实现', reason: '原始映射' }], extension: { keep: true } })
    const r = recognitionRuntime([source]), c = r.context, original = plain(r.board)
    c.setTool('lasso')
    c.spaceState.pose = { rotationX: 20, rotationY: -15, rotation: 35 }
    c.spaceState.placement = { ...structuredClone(source), id: 'space-placement', type: 'polygon', text: '', points: [[0, 0], [1, 0], [1, 1], [0, 1]], extrusion: -80 }
    c.spaceState.profileReady = true; c.spaceState.transform = 'extrude'; c.spacePaint()
    const pending = JSON.stringify({ profile: c.spaceState.placement, pose: c.spaceState.pose, tip: c.spaceState.penRig.tip })
    const session = c.spaceRecognitionScope(), value = mode === 'text' ? '校对后的区域说明' : 'x+1'
    assert.deepEqual(plain(session.originals).map(e => e.id), ['source'])
    c.inkLassoSession = session; c.inkSourceIds = ['source']; c.inkMode = mode
    r.node('ink-dialog').showModal(); r.node('ink-result').value = value
    const candidate = await c.spaceRecognitionApply(value, { mode, reviewed: true, candidate: { text: value, engine: 'test-fixture' }, strokes: [] })
    r.flush()
    assert.equal(candidate.type, mode === 'text' ? 'text' : 'image')
    assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
    assert.equal(candidate.rotationX, 20); assert.equal(candidate.rotationY, -15); assert.equal(candidate.rotation, 35)
    assert.equal(candidate.extrusion, undefined)
    assert.equal(candidate.recognition.space.profile.extrusion, -80)
    assert.equal(JSON.stringify({ profile: c.spaceState.placement, pose: c.spaceState.pose, tip: c.spaceState.penRig.tip }), pending)
    assert.deepEqual(plain(candidate.anchors), source.anchors)
    assert.equal(r.history.length, 1)
    assert.deepEqual(boardDiagnostics(r.board), [])
  })
}

test('a relation label with placeholder stored geometry recognizes at its actual linked midpoint', async () => {
  const elements = [card('from', { x: 300, y: 200, z: 80 }), card('to', { x: 800, y: 500, z: 240 }),
    { id: 'relation', type: 'arrow', x: 0, y: 0, width: 1, height: 1, from: 'from', to: 'to', text: '传递输入' }]
  const r = recognitionRuntime(elements), c = r.context, original = plain(r.board)
  c.setTool('select'); c.selected = new Set(['relation']); c.spacePaint()
  const link = spaceLinks(r.board.elements).find(e => e.id === 'relation'), session = c.spaceRecognitionScope()
  const expected = { x: (link.a.x + link.b.x) / 2, y: (link.a.y + link.b.y) / 2, z: (link.a.z + link.b.z) / 2 + 2 }
  near(session.target.x + session.target.width / 2, expected.x)
  near(session.target.y + session.target.height / 2, expected.y)
  near(session.target.z, expected.z)
  assert.ok(session.originals.some(e => e.id === 'relation'))
  c.inkLassoSession = session; c.inkSourceIds = session.originals.map(e => e.id); c.inkMode = 'text'
  r.node('ink-dialog').showModal(); r.node('ink-result').value = '校对后的传递说明'
  const result = await c.spaceRecognitionApply('校对后的传递说明', { mode: 'text', reviewed: true, candidate: null, strokes: [] })
  near(result.x + result.width / 2, expected.x); near(result.y + result.height / 2, expected.y); near(result.z, expected.z)
  assert.deepEqual(plain(r.board.elements.slice(0, -1)), original.elements)
  assert.equal(r.history.length, 1)
})

test('an async formula result cannot apply after the selected version changes', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const r = recognitionRuntime([card()], { rasterFormula: () => pending }), c = r.context, original = plain(r.board)
  c.setTool('select'); c.selected.add('a'); c.spacePaint()
  c.inkLassoSession = c.spaceRecognitionScope(); c.inkSourceIds = ['a']; c.inkMode = 'math'
  r.node('ink-dialog').showModal(); r.node('ink-result').value = 'x+1'
  const applying = c.spaceRecognitionApply('x+1', { mode: 'math', reviewed: true, candidate: null, strokes: [] })
  c.versionSession.selected.revision = 'new-revision'
  release({ src: recognitionPNG, width: 3, height: 2, displayWidth: 60, displayHeight: 30 })
  await assert.rejects(applying, /已变化/)
  assert.deepEqual(plain(r.board), original)
  assert.equal(r.history.length, 0)
})

test('a multi-object recognition selection rejects any source projected behind the camera before boxing it', () => {
  const r = recognitionRuntime([card('front'), card('behind', { x: 600 })]), c = r.context
  c.setTool('select'); c.selected = new Set(['front', 'behind']); c.spacePaint()
  r.engine.project = p => ({ x: p.x, y: p.y, scale: 1, depth: p.x >= 600 ? -1 : 1000 })
  assert.throws(() => c.spaceRecognitionScope(), /视图/)
  assert.equal(r.history.length, 0)
})

test('a partially visible profile clips semantic source selection to the viewport', () => {
  const r = recognitionRuntime([card('visible', { x: 10, y: 20, width: 20, height: 20 }), card('offscreen', { x: -80, y: 20, width: 20, height: 20 })]), c = r.context
  c.setTool('lasso'); c.spacePositionPen({ x: 50, y: 50, z: 0 })
  c.spaceState.placement = card('space-placement', { type: 'polygon', text: '', width: 300, height: 100, points: [[0, 0], [1, 0], [1, 1], [0, 1]] })
  c.spaceState.profileReady = true; c.spacePaint()
  const session = c.spaceRecognitionScope()
  assert.deepEqual(plain(session.originals).map(e => e.id), ['visible'])
  assert.ok(session.region.every(p => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 700))
  assert.equal(r.history.length, 0)
})

test('recognition refuses more than 500 semantic sources without submitting or changing the board', () => {
  const r = recognitionRuntime(Array.from({ length: 501 }, (_, i) => card('source-' + i))), c = r.context, original = plain(r.board)
  c.setTool('select'); c.selected.add('source-0'); c.spacePaint()
  assert.equal(c.spaceRecognitionRequest(), false)
  assert.match(r.messages.at(-1), /来源太多/)
  assert.equal(r.node('ink-choice-dialog').open, false)
  assert.equal(r.posts.length, 0)
  assert.equal(r.history.length, 0)
  assert.deepEqual(plain(r.board), original)
})

test('关系空间布局先预览 XYZ，取消保留原稿，应用与撤销只记一步且四角固定',()=>{
  const elements=[card('frame',{type:'frame',x:0,y:0,width:1200,height:800,rotation:25,rotationX:12,rotationY:-18}),card('root',{x:400,y:350,frame:'frame'}),...['a','b','c'].map(id=>card(id,{frame:'frame'})),
    card('ink',{type:'pen',x:0,y:250,width:100,height:70,z:20,rotation:23,rotationX:-15,points:[[0,0],[1,1]],points3d:[[0,250,20],[100,320,50]],frame:'frame'}),
    ...['a','b','c','ink'].map(id=>({id:'root-'+id,type:'arrow',from:'root',to:id,x:0,y:0,width:1,height:1,text:'传递输入'}))]
  const r=runtime(elements),c=r.context,before=plain(r.board),rig=plain(c.spaceState.penRig.anchors)
  r.click('space-layers')
  assert.equal(r.node('space-layer-preview-dialog').open,true)
  assert.deepEqual(plain(r.board),before)
  assert.equal(r.history.length,0)
  const preview=plain(r.rendererCalls.at(-1).board)
  for(const axis of ['x','y','z'])assert.ok(before.elements.some(e=>e.type!=='frame'&&preview.elements.find(p=>p.id===e.id)[axis]!==e[axis]),axis+' changes in the preview')
  const oldInk=before.elements.find(e=>e.id==='ink'),newInk=preview.elements.find(e=>e.id==='ink')
  for(let i=0;i<oldInk.points3d.length;i++)for(const [index,axis] of ['x','y','z'].entries())near(newInk.points3d[i][index]-oldInk.points3d[i][index],newInk[axis]-oldInk[axis])
  for(const axis of ['rotation','rotationX','rotationY'])assert.equal(preview.elements.find(e=>e.id==='frame')[axis],before.elements.find(e=>e.id==='frame')[axis])
  assert.notEqual(preview.elements.find(e=>e.id==='frame').width,before.elements.find(e=>e.id==='frame').width)
  for(const edge of before.elements.filter(e=>e.type==='arrow'))assert.deepEqual(preview.elements.find(e=>e.id===edge.id),edge,'layout leaves bound connector geometry and identities intact')
  assert.equal(c.spaceCanEdit(),false)
  r.click('space-layer-preview-cancel')
  assert.deepEqual(r.rendererCalls.at(-1).board,before)
  assert.deepEqual(plain(r.board),before)
  assert.equal(r.history.length,0)
  r.click('space-layers');r.click('space-layer-preview-apply')
  assert.deepEqual(plain(r.board),preview)
  assert.equal(r.history.length,1)
  assert.deepEqual(plain(c.spaceState.penRig.anchors),rig)
  c.undo();r.flush()
  assert.deepEqual(plain(r.board),before)
  assert.deepEqual(r.rendererCalls.at(-1).board,before)
  assert.equal(r.history.length,0)
  c.redo();r.flush()
  assert.deepEqual(plain(r.board),preview)
  assert.equal(r.history.length,1)
})

test('a changed source invalidates a relationship preview before it can overwrite newer content',()=>{
  const r=runtime([card('a'),card('b',{x:300}),{id:'ab',type:'arrow',from:'a',to:'b',x:0,y:0,width:1,height:1}]),c=r.context
  const before=plain(r.board)
  r.click('space-layers');c.change(()=>{c.board.elements[0].text='另一页面的新说明'});r.flush()
  assert.equal(c.spaceState.depthPreview,null)
  assert.equal(r.node('space-layer-preview-dialog').open,false)
  assert.equal(r.board.elements[0].text,'另一页面的新说明')
  for(let i=0;i<before.elements.length;i++)for(const axis of ['x','y','z'])assert.equal(r.board.elements[i][axis],before.elements[i][axis])
  r.click('space-layer-preview-apply')
  assert.equal(r.board.elements[0].text,'另一页面的新说明')
  assert.equal(r.history.length,1,'only the external content change is durable')
})


test('关系识别跟随实际避让标签，标签位置改变使旧候选失效，收起时提示聚焦',()=>{
  const r=recognitionRuntime([card('from'),card('to',{x:400}),{id:'ab',type:'arrow',from:'from',to:'to',x:0,y:0,width:1,height:1,text:'完整关系说明'}]),c=r.context
  let label={id:'ab',visible:true,carrier:{x:200,y:260,z:30,width:180,height:60,rotationX:0,rotationY:0,rotation:0},corners:[{x:200,y:260,z:30},{x:380,y:260,z:30},{x:380,y:320,z:30},{x:200,y:320,z:30}]}
  r.engine.labelGeometry=id=>id==='ab'?label:null
  r.engine.info=()=>({objects:r.board.elements.length,labelLayout:[label]})
  c.setTool('select');c.selected=new Set(['ab']);c.spacePaint()
  const session=c.spaceRecognitionScope()
  near(session.target.x,200);near(session.target.y,260);near(session.target.z,30)
  assert.ok(session.originals.some(e=>e.id==='ab'))
  assert.equal(c.spaceRecognitionCurrent(session),true)
  label={...label,bounds:{x:250,y:240,width:180,height:60}}
  assert.equal(c.spaceRecognitionCurrent(session),false)
  label={...label,visible:false}
  assert.throws(()=>c.spaceRecognitionScope(),/阅读大小/)
})

test('空间文字编辑使用实际标签平面，不重复叠加实体拉伸高度',()=>{
  const r=runtime([card('a',{z:30,extrusion:90})]),c=r.context
  c.canvasDraft={target:'a'};c.inlineWritingOpen=()=>true
  r.engine.labelGeometry=()=>({visible:true,carrier:{x:200,y:300,z:120,width:180,height:70,rotationX:0,rotationY:0,rotation:0}})
  c.spacePositionInlineEditor()
  near(parseFloat(r.node('inline-writing').style.top),260)
})

test('分区识别仍覆盖分区内的内容，普通形状保留真实轮廓而非文字贴图四边',()=>{
  const r=recognitionRuntime([card('area',{type:'frame',x:0,y:0,width:500,height:500}),card('inner',{x:200,y:200}),card('ellipse',{type:'ellipse',x:600,y:100,width:180,height:100})]),c=r.context
  r.engine.labelGeometry=id=>({id,visible:true,carrier:{x:0,y:0,z:0,width:70,height:20},corners:[{x:0,y:0,z:0},{x:70,y:0,z:0},{x:70,y:20,z:0},{x:0,y:20,z:0}]})
  c.setTool('select');c.selected=new Set(['area']);c.spacePaint()
  assert.ok(c.spaceRecognitionScope().originals.some(e=>e.id==='inner'))
  assert.equal(c.spaceRecognitionOutline(c.get('ellipse')).length,64)
})


test('3D partial erasure modifies all sampled surfaces and keeps object identities until one shared Undo',()=>{
  const r=runtime([card('front'),card('back',{z:-100}),{id:'relation',type:'arrow',x:0,y:0,width:200,height:80,text:'说明'}]),before=plain(r.board)
  const samples=[{id:'front',surface:'body',points:[[.4,.5,.2]],radius:[.1,.15,.1]},{id:'back',surface:'body',points:[[.4,.5,.2]],radius:[.1,.15,.1]},{id:'relation',surface:'label',points:[[.5,.5]],radius:[.1,.15]}]
  r.engine.eraseSamples=()=>samples
  r.context.setTool('eraser');r.node('eraser-size').value='24'
  r.pointer('pointerdown');r.pointer('pointerup')
  assert.deepEqual(r.board.elements.map(e=>e.id),before.elements.map(e=>e.id))
  for(const sample of samples){
    const e=r.board.elements.find(e=>e.id===sample.id)
    assert.equal(e.erasures.length,1,'identical samples do not add redundant holes')
    assert.equal(surfaceErased(e,sample.points[0],sample.surface),true)
    assert.equal(surfaceErased(e,[.9,.9,.9],sample.surface),false)
    assert.equal(e.text,before.elements.find(old=>old.id===sample.id).text)
  }
  assert.equal(r.history.length,1)
  assert.deepEqual(boardDiagnostics(r.board),[])
  r.key('z',{ctrlKey:true})
  assert.deepEqual(plain(r.board),before)
})

test('快速橡皮拖动跨过空间笔迹时沿整条鼠标路径擦除，端点均未触碰也能切开',()=>{
  const ink={id:'sweep-ink',type:'pen',x:0,y:50,z:0,width:100,height:1,points:[[0,0],[1,0]],points3d:[[0,50,0],[100,50,0]],strokeWidth:3,text:''},r=runtime([ink]),before=plain(r.board);
  r.context.setTool('eraser');r.node('eraser-size').value='10';r.pointer('pointerdown',{clientX:150,clientY:80});assert.deepEqual(plain(r.board),before);r.pointer('pointermove',{clientX:150,clientY:180});r.pointer('pointerup',{clientX:150,clientY:180});
  assert.equal(r.board.elements.length,2);const runs=r.board.elements.map(e=>spaceStrokePoints(e));assert.ok(runs[0].at(-1).x<50);assert.ok(runs[1][0].x>50);assert.equal(r.history.length,1);r.key('z',{ctrlKey:true});assert.deepEqual(plain(r.board),before);
});
