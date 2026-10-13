import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'
import { boardDiagnostics } from '../lib/board.js'

const snapshot = value => JSON.stringify(value)
const plain = value => JSON.parse(snapshot(value))
const element = (id, x = 0) => ({
  id, type: 'rect', x, y: 0, width: 280, height: 140,
  text: '处理输入', math: 'y = f(x)',
  mathExpressions: [{ id: 'constraint', value: 'x ≥ 0', evidence: { reviewed: true } }],
  implementation: { language: 'JavaScript', code: 'return input;', note: '返回处理结果', extra: { preserve: true } },
  anchors: [{ file: 'src/process.js', symbol: 'processInput', sha256: 'a'.repeat(64), role: 'implementation', reason: '处理输入', extra: { preserve: true } }],
  targets: [{ kind: 'organ', id: 'origin' }],
  extensions: { preserve: true }
})
const fixture = () => ({ version: 1, layout: { mode: 'manual' }, elements: [element('a'), element('b', 400)] })

// Exercise the same inline client and DOM delegation used by the real page.
function runtime(board, options = {}) {
  const nodes = new Map(), callbacks = new Map(), storage = options.storage || new Map()
  const node = id => {
    if (nodes.has(id)) return nodes.get(id)
    const listeners = {}
    const result = {
      id, value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, attributes: {}, listeners,
      hidden: false, open: false,
      classList: { add() {}, remove() {}, toggle() { return true } },
      setAttribute(key, value) { this.attributes[key] = value },
      getAttribute(key) { return this.attributes[key] },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
      querySelector() { return null }, querySelectorAll() { return [] },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 } },
      setPointerCapture() {}, showModal() { this.open = true }, close() { this.open = false },
      focus() {}, select() {}, click() {}, appendChild() {}, remove() {}, contains() { return false }
    }
    nodes.set(id, result)
    return result
  }
  const document = {
    compatMode: 'CSS1Compat', getElementById: node, querySelectorAll: () => [], querySelector: () => null,
    body: node('body'), addEventListener(type, fn) { callbacks.set(type, fn) }, createElement: () => node('download')
  }
  const context = {
    document, window: { addEventListener() {} },
    localStorage: { setItem(key, value) { storage.set(key, value) }, getItem(key) { return storage.get(key) }, removeItem(key) { storage.delete(key) } },
    structuredClone, console, Blob, URL, AbortController,
    setTimeout: () => 0, clearTimeout() {}, ...options.globals
  }
  const organs = [{ id: 'origin', name: '输入来源', gist: '交付待处理输入。' }]
  const html = renderAnatomy({ slug: 'canvas-test', title: '画板编辑回归', board }, organs, [])
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context)
  const api = context.window.__anatomyBoard
  const fire = (id, type, event = {}) => { for (const fn of node(id).listeners[type] || []) fn(event) }
  return {
    api, node, storage, callbacks, fire,
    text(value) { node('canvas-text-input').value = value; fire('canvas-text-input', 'input', { target: node('canvas-text-input') }) },
    program(path, value) { fire('inspector', 'input', { target: { dataset: { field: path }, value, type: 'textarea' } }) },
    style(path, value) { fire('style-content', 'input', { target: { dataset: { field: path }, value: String(value), type: 'number' } }) }
  }
}

test('画板文字确认与取消保持数学和机读映射，程序内容不能进入人读层', () => {
  const board = fixture(), r = runtime(board), original = snapshot(r.api.board)
  r.api.select('a'); r.api.canvas.openTextEditor('a'); r.text('接收输入后检查约束。')
  assert.equal(r.api.board.elements[0].text, '处理输入')
  r.api.canvas.cancel(); assert.equal(snapshot(r.api.board), original)
  r.api.canvas.openTextEditor('a'); r.text('const input = 1;')
  assert.equal(r.api.canvas.confirm(), false)
  assert.match(r.node('canvas-text-error').textContent, /自然语言|程序/)
  assert.equal(snapshot(r.api.board), original)
  r.text('接收输入后检查约束。'); assert.equal(r.api.canvas.confirm(), true)
  const updated = r.api.board.elements[0]
  assert.equal(updated.text, '接收输入后检查约束。')
  assert.deepEqual(plain(updated.implementation), board.elements[0].implementation)
  assert.deepEqual(plain(updated.anchors), board.elements[0].anchors)
  assert.deepEqual(plain(updated.mathExpressions), board.elements[0].mathExpressions)
  assert.ok(!r.node('world').innerHTML.includes('return input;'))
})

test('画板文字确认形成完整一步撤销重做，未确认编辑不写入画板历史', () => {
  const r = runtime(fixture()), original = snapshot(r.api.board)
  r.api.canvas.openTextEditor('a'); r.text('检查输入边界。')
  r.fire('canvas-text-confirm', 'click')
  const confirmed = snapshot(r.api.board)
  assert.notEqual(confirmed, original)
  r.api.undo(); assert.equal(snapshot(r.api.board), original)
  r.api.redo(); assert.equal(snapshot(r.api.board), confirmed)
  r.api.canvas.openTextEditor('a'); r.text('尚未确认的修改。'); r.fire('canvas-text-cancel', 'click')
  assert.equal(snapshot(r.api.board), confirmed)
  r.api.undo(); assert.equal(snapshot(r.api.board), original)
})

test('画板编辑锁定打开部位，选择切换不会误写其他图元', () => {
  const r = runtime(fixture())
  r.api.select('a'); r.api.canvas.openTextEditor('a'); r.text('只修改入口说明。')
  r.api.select('b')
  assert.equal(r.api.canvas.draft.target, 'a')
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].text, '只修改入口说明。')
  assert.equal(r.api.board.elements[1].text, '处理输入')
})

test('陈旧文字编辑拒绝覆盖同字段，无关映射与几何变化保留', () => {
  const r = runtime(fixture())
  r.api.canvas.openTextEditor('a'); r.text('尚未确认的说明。')
  r.api.change(() => { r.api.board.elements[0].text = '新版入口说明。' })
  assert.equal(r.api.canvas.confirm(), false)
  assert.match(r.node('canvas-text-error').textContent, /变化|重新/)
  assert.equal(r.api.board.elements[0].text, '新版入口说明。')
  assert.ok(r.api.canvas.draft)
  r.api.canvas.cancel(); r.api.canvas.openTextEditor('a'); r.text('已核对的新说明。')
  r.api.change(() => { r.api.board.elements[0].x = 130; r.api.board.elements[0].implementation.note = '新版程序依据' })
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].x, 130)
  assert.equal(r.api.board.elements[0].implementation.note, '新版程序依据')
})

test('原位编辑目标删除后确认拒绝且保留草稿', () => {
  const r = runtime(fixture())
  r.api.canvas.openTextEditor('a'); r.text('目标上的待确认说明。')
  r.api.change(() => { r.api.board.elements = r.api.board.elements.filter(e => e.id !== 'a') })
  assert.equal(r.api.canvas.confirm(), false)
  assert.ok(r.api.canvas.draft)
  assert.equal(r.api.board.elements.length, 1)
  assert.equal(r.api.board.elements[0].id, 'b')
})

test('机读确认保留扩展、源码哈希和引用，取消不会写入半成品', () => {
  const board = fixture(), r = runtime(board), original = snapshot(r.api.board)
  r.api.select('a'); r.api.canvas.openProgram('a')
  r.program('implementation.code', 'return transform(input);')
  assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
  r.fire('program-cancel', 'click'); assert.equal(snapshot(r.api.board), original)
  r.api.canvas.openProgram('a'); r.program('implementation.code', 'return transform(input);')
  r.program('anchors.0.symbol', 'transformInput')
  assert.equal(r.api.canvas.confirm(), true)
  const updated = r.api.board.elements[0]
  assert.equal(updated.implementation.code, 'return transform(input);')
  assert.equal(updated.implementation.extra.preserve, true)
  assert.equal(updated.anchors[0].sha256, 'a'.repeat(64))
  assert.equal(updated.anchors[0].symbol, 'transformInput')
  assert.equal(updated.anchors[0].extra.preserve, true)
  assert.deepEqual(plain(updated.targets), board.elements[0].targets)
  assert.deepEqual(plain(updated.extensions), board.elements[0].extensions)
  assert.ok(!r.node('world').innerHTML.includes('transform(input)'))
  const confirmed = snapshot(r.api.board)
  r.api.undo(); assert.equal(snapshot(r.api.board), original)
  r.api.redo(); assert.equal(snapshot(r.api.board), confirmed)
})

test('机读确认对完整画板校验，不能带入空源码路径或失效工程引用', () => {
  for (const mutate of [
    r => r.program('anchors.0.file', ''),
    r => { r.api.canvas.draft.value.targets.push({ kind: 'organ', id: 'missing' }) },
    r => { r.api.change(() => { r.api.board.elements[1].text = 'const x = 1;' }) }
  ]) {
    const r = runtime(fixture())
    r.api.canvas.openProgram('a'); r.program('implementation.code', 'return transform(input);'); mutate(r)
    const beforeConfirm = snapshot(r.api.board)
    assert.equal(r.api.canvas.confirm(), false)
    assert.equal(snapshot(r.api.board), beforeConfirm)
    assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
    assert.ok(r.api.canvas.draft)
    assert.ok(r.node('program-error').textContent)
  }
})

test('机读编辑拒绝陈旧映射，同时保留并发自然语言和几何变化', () => {
  const r = runtime(fixture())
  r.api.canvas.openProgram('a'); r.program('implementation.code', 'return transform(input);')
  r.api.change(() => { r.api.board.elements[0].anchors[0].reason = '另一版本已经复核映射' })
  assert.equal(r.api.canvas.confirm(), false)
  assert.equal(r.api.board.elements[0].anchors[0].reason, '另一版本已经复核映射')
  r.api.canvas.cancel(); r.api.canvas.openProgram('a'); r.program('implementation.code', 'return transform(input);')
  r.api.change(() => { r.api.board.elements[0].text = '新版的人读说明。'; r.api.board.elements[0].x = 120 })
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].text, '新版的人读说明。')
  assert.equal(r.api.board.elements[0].x, 120)
  assert.equal(r.api.board.elements[0].implementation.code, 'return transform(input);')
})

test('样式确认与撤销保留内容映射，非法尺寸不能确认', () => {
  const r = runtime(fixture()), original = snapshot(r.api.board)
  r.api.canvas.openStyle('a'); r.style('width', -10)
  assert.equal(r.api.canvas.confirm(), false)
  assert.equal(snapshot(r.api.board), original)
  r.style('width', 360); assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].width, 360)
  assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
  assert.deepEqual(boardDiagnostics(r.api.board, [{ id: 'origin' }]), [])
  r.api.undo(); assert.equal(snapshot(r.api.board), original)
})

test('未确认画板文字刷新后恢复，仍与原值对照且确认后清理草稿', () => {
  const board = fixture(), r = runtime(board)
  r.api.canvas.openTextEditor('a'); r.text('刷新后继续校对的说明。')
  const draftKey = [...r.storage.keys()].find(key => key.endsWith(':canvas-editor'))
  assert.ok(draftKey)
  const restored = runtime(board, { storage: r.storage })
  restored.api.canvas.resume()
  assert.equal(restored.node('canvas-text-input').value, '刷新后继续校对的说明。')
  assert.equal(restored.api.board.elements[0].text, '处理输入')
  assert.equal(restored.api.canvas.confirm(), true)
  assert.equal(restored.api.board.elements[0].text, '刷新后继续校对的说明。')
  assert.equal(r.storage.has(draftKey), false)
})

test('有未确认画板编辑时保存明确阻止，确认后才保存完整工程意图', async () => {
  let posted = null
  const r = runtime(fixture(), { globals: { fetch: async (path, options = {}) => {
    if (path === '/api/versions' && options.method === 'POST') {
      posted = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true, selected: { id: 'saved', revision: 'saved-revision' }, versions: [] }) }
    }
    return { ok: true, json: async () => ({ ok: true, selected: null, versions: [] }) }
  } } })
  await r.api.versions.refresh()
  r.api.canvas.openTextEditor('a'); r.text('真正需要保存的工程意图。')
  assert.equal(await r.api.versions.save(), false)
  assert.equal(posted, null)
  assert.match(r.node('toast').textContent, /确认|取消/)
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')))
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(await r.api.versions.save(), true)
  assert.equal(posted.board.elements[0].text, '真正需要保存的工程意图。')
  assert.equal(posted.board.elements[0].implementation.code, 'return input;')
  assert.ok(posted.baseHash)
  assert.equal(posted.expectedSelection, null)
})

test('刷新选定版本保留未确认文字草稿，陈旧编辑不能覆盖新版内容', async () => {
  let selected = null, snapshotReads = 0
  const r = runtime(fixture(), { globals: { fetch: async path => {
    if (path === '/api/versions/current') {
      snapshotReads++
      const board = fixture(); board.elements[0].text = '服务端另一版本的说明。'
      return { ok: true, json: async () => ({ ok: true, selected, versions: [], board }) }
    }
    return { ok: true, json: async () => ({ ok: true, selected, versions: [] }) }
  } } })
  await r.api.versions.refresh()
  r.api.canvas.openTextEditor('a'); r.text('正在校对的本地说明。')
  selected = { id: 'other', revision: 'other-revision' }
  await r.api.versions.refresh(true)
  assert.equal(snapshotReads, 1)
  assert.equal(r.api.canvas.draft.value, '正在校对的本地说明。')
  assert.equal(r.api.board.elements[0].text, '服务端另一版本的说明。')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')))
  assert.equal(r.api.canvas.confirm(), false)
  assert.equal(r.api.board.elements[0].text, '服务端另一版本的说明。')
  assert.equal(r.api.canvas.draft.value, '正在校对的本地说明。')
})

test('浏览器存储无法清理时确认与取消仍完成，画板映射不丢失', () => {
  const storage = new Map(), r = runtime(fixture(), { storage, globals: { localStorage: {
    setItem(key, value) { storage.set(key, value) },
    getItem(key) { return storage.get(key) },
    removeItem() { throw Error('浏览器存储暂不可用') }
  } } })
  r.api.canvas.openTextEditor('a'); r.text('保留已确认的说明。')
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.node('canvas-text-editor').hidden, true)
  assert.equal(r.api.board.elements[0].text, '保留已确认的说明。')
  assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
  r.api.canvas.openTextEditor('a'); r.text('取消的说明。')
  assert.doesNotThrow(() => r.api.canvas.cancel())
  assert.equal(r.api.board.elements[0].text, '保留已确认的说明。')
  assert.equal(r.node('canvas-text-editor').hidden, true)
})

test('损坏的机读与样式草稿缓存不使编辑器崩溃，原缓存保留供恢复', () => {
  const board = fixture(), seed = runtime(board)
  seed.api.canvas.openTextEditor('a'); seed.text('用来定位草稿缓存的说明。')
  const key = [...seed.storage.keys()].find(key => key.endsWith(':canvas-editor'))
  for (const draft of [
    { kind: 'program', target: 'a', before: {}, value: null },
    { kind: 'program', target: 'a', before: {}, value: { anchors: [null] } },
    { kind: 'style', target: 'a', before: {}, value: [] },
    { kind: 'text', target: 'a', before: '原说明', value: {} }
  ]) {
    const storage = new Map([[key, JSON.stringify(draft)]])
    const r = runtime(board, { storage })
    assert.equal(r.api.canvas.draft, null)
    assert.equal(storage.get(key), JSON.stringify(draft))
    assert.doesNotThrow(() => r.api.canvas.openProgram('a'))
    assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
  }
})

const pointerEvent = (x, y, id, expression) => ({
  button: 0, clientX: x, clientY: y, pointerId: 1, preventDefault() {},
  target: { closest(selector) {
    if (selector === '[data-id]') return { getAttribute: () => id }
    if (selector === '[data-expression]' && expression) return { getAttribute: () => expression }
    return null
  } }
})

test('两次近距真实指针点击重绘后的文字仍打开原位编辑并锁定正确部位', () => {
  const r = runtime(fixture())
  // Each pointer event represents a newly rendered SVG node; no native
  // dblclick is emitted because selecting replaces the SVG descendants.
  r.fire('surface', 'pointerdown', pointerEvent(600, 300, 'b'))
  r.fire('surface', 'pointerup', pointerEvent(600, 300, 'b'))
  r.fire('surface', 'pointerdown', pointerEvent(602, 301, 'b'))
  assert.equal(r.node('paper-dialog').open, true)
  assert.equal(r.api.canvas.draft.kind, 'paper')
  assert.equal(r.api.canvas.draft.target, 'b')
  r.api.paper.text('双击编辑输出部位。'); r.fire('paper-confirm', 'click')
  assert.equal(r.api.board.elements[0].text, '处理输入')
  assert.equal(r.api.board.elements[1].text, '双击编辑输出部位。')
})

test('两次真实指针点击额外公式按稳定标识编辑，保留原有主公式', () => {
  const r = runtime(fixture())
  r.fire('surface', 'pointerdown', pointerEvent(220, 320, 'a', 'constraint'))
  r.fire('surface', 'pointerup', pointerEvent(220, 320, 'a', 'constraint'))
  r.fire('surface', 'pointerdown', pointerEvent(221, 321, 'a', 'constraint'))
  assert.equal(r.node('paper-dialog').open, true)
  assert.equal(r.node('formula-dialog').open, false)
  assert.equal(r.api.canvas.draft.value.mathExpressions[0].value, 'x ≥ 0')
  r.api.paper.equation('constraint', 'x > 0')
  r.fire('paper-confirm', 'click')
  assert.equal(r.api.board.elements[0].math, 'y = f(x)')
  assert.equal(r.api.board.elements[0].mathExpressions[0].id, 'constraint')
  assert.equal(r.api.board.elements[0].mathExpressions[0].value, 'x > 0')
  assert.equal(r.api.board.elements[0].mathExpressions[0].evidence.reviewed, true)
})


test('关闭未改动纸页后原生双击仍可重新打开并直接编辑', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('a'); r.fire('paper-close', 'click')
  assert.equal(r.node('paper-dialog').open, false)
  r.fire('surface', 'dblclick', pointerEvent(600, 300, 'b'))
  assert.equal(r.node('paper-dialog').open, true)
  assert.equal(r.api.canvas.draft.target, 'b')
  r.api.paper.text('重新打开后修改。'); assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[1].text, '重新打开后修改。')
})
