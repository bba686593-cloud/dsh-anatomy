import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'
import { boardDiagnostics } from '../lib/board.js'

const snapshot = value => JSON.stringify(value)
const plain = value => JSON.parse(snapshot(value))
const ink = name => ({ mode: 'math', reviewed: true, strokes: [[[20, 30], [70, 85]]], candidate: { text: name, engine: 'local-test', extension: true }, sourceElements: ['original-ink'] })
const fixture = () => ({ version: 1, layout: { mode: 'manual' }, elements: [
  {
    id: 'input', type: 'rect', x: 0, y: 0, width: 320, height: 210,
    text: '接收输入。\n检查输入边界。', math: 'y = f(x)',
    mathExpressions: [
      { id: 'constraint', value: 'x ≥ 0', handwriting: ink('x ≥ 0'), evidence: { reviewed: true, source: '保留依据' } },
      { id: 'bound', value: 'y ≤ 10', custom: { nested: ['保留', 2] } }
    ],
    handwriting: { mode: 'text', reviewed: true, strokes: [[[10, 10], [50, 40]]], candidate: { text: '接收输入', engine: 'text-test' } },
    mathHandwriting: ink('y = f(x)'),
    implementation: { language: 'JavaScript', code: 'return process(input);', note: '处理工程输入', extra: { preserve: true } },
    anchors: [{ file: 'src/process.js', symbol: 'processInput', sha256: 'b'.repeat(64), role: 'implementation', reason: '接收输入', extension: { preserve: true } }],
    targets: [{ kind: 'organ', id: 'source' }], extension: { preserve: true }
  },
  { id: 'output', type: 'rect', x: 420, y: 0, width: 280, height: 160, text: '交付处理结果。', math: 'z = y' }
] })

function runtime(board, options = {}) {
  const nodes = new Map(), callbacks = new Map(), storage = options.storage || new Map()
  const node = id => {
    if (nodes.has(id)) return nodes.get(id)
    const listeners = {}
    const element = {
      id, value: '', innerHTML: '', innerText: '', textContent: '', style: {}, dataset: {}, attributes: {}, listeners,
      hidden: id === 'inline-writing', open: false, selectionStart: 0, selectionEnd: 0,
      classList: { add() {}, remove() {}, toggle() { return true } },
      setAttribute(key, value) { this.attributes[key] = value },
      getAttribute(key) { return this.attributes[key] },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
      querySelector() { return null }, querySelectorAll() { return [] },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 } },
      setPointerCapture() {}, showModal() { this.open = true }, close() { this.open = false },
      focus() {}, select() {}, setSelectionRange() {}, click() {}, appendChild() {}, remove() {}, contains() { return false }
    }
    nodes.set(id, element)
    return element
  }
  const document = {
    compatMode: 'CSS1Compat', getElementById: node, querySelectorAll: () => [], querySelector: () => null,
    body: node('body'), addEventListener(type, fn) { (callbacks.get(type) || callbacks.set(type, []).get(type)).push(fn) },
    createElement: () => node('created'), getSelection: () => null
  }
  const context = {
    document, window: { addEventListener() {} },
    localStorage: { setItem(key, value) { storage.set(key, value) }, getItem(key) { return storage.get(key) }, removeItem(key) { storage.delete(key) } },
    structuredClone, console, Blob, URL, AbortController, setTimeout: () => 0, clearTimeout() {}, ...options.globals
  }
  const organs = [{ id: 'source', name: '输入来源', gist: '提供待处理数据。' }]
  const html = renderAnatomy({ slug: 'paper-test', title: '工程纸页回归', board }, organs, [])
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context)
  return {
    api: context.window.__anatomyBoard, node, storage, callbacks, document,
    fire(id, type, event = {}) { for (const fn of node(id).listeners[type] || []) fn(event) },
    fireDocument(type, event = {}) { for (const fn of callbacks.get(type) || []) fn(event) }
  }
}

test('双击编辑纸页直接包含自然语言和全部数学表达，程序映射保持独立', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input', 'constraint')
  const draft = r.api.canvas.draft
  assert.equal(r.node('inline-writing').hidden, false)
  assert.equal(draft.kind, 'paper')
  assert.equal(draft.target, 'input')
  assert.equal(draft.value.text, '接收输入。\n检查输入边界。')
  assert.equal(draft.value.math, 'y = f(x)')
  assert.deepEqual(plain(draft.value.mathExpressions.map(f => f.id)), ['constraint', 'bound'])
  assert.ok(!r.node('paper-prose').innerHTML.includes('return process'))
  assert.ok(!r.node('world').innerHTML.includes('return process'))
})

test('整页确认同时改文字与数学，稳定标识、笔迹及未知映射元数据原样保留', () => {
  const board = fixture(), r = runtime(board), original = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input')
  r.api.paper.text('读取输入。\n满足约束后处理。')
  r.api.paper.equation('primary', 'y = 2x')
  r.api.paper.equation('constraint', 'x > 0')
  assert.equal(snapshot(r.api.board), original)
  assert.equal(r.api.canvas.confirm(), true)
  const e = r.api.board.elements[0], before = board.elements[0]
  assert.equal(e.text, '读取输入。\n满足约束后处理。')
  assert.equal(e.math, 'y = 2x')
  assert.equal(e.mathExpressions[0].id, 'constraint')
  assert.equal(e.mathExpressions[0].value, 'x > 0')
  for (const key of ['implementation', 'anchors', 'targets', 'extension', 'handwriting', 'mathHandwriting']) assert.deepEqual(plain(e[key]), before[key], key)
  assert.deepEqual(plain(e.mathExpressions[0].handwriting), before.mathExpressions[0].handwriting)
  assert.deepEqual(plain(e.mathExpressions[0].evidence), before.mathExpressions[0].evidence)
  assert.deepEqual(plain(e.mathExpressions[1]), before.mathExpressions[1])
})

test('插入和删除公式不重排原表达标识，也不将额外公式替换主公式', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input'); r.api.paper.insert('z = x + y')
  const added = r.api.canvas.draft.value.mathExpressions.at(-1)
  assert.ok(added.id && !['primary', 'constraint', 'bound'].includes(added.id))
  assert.equal(added.value, 'z = x + y')
  r.api.paper.remove('primary')
  assert.equal(r.api.canvas.draft.value.math, '')
  assert.deepEqual(plain(r.api.canvas.draft.value.mathExpressions.map(f => f.id)), ['constraint', 'bound', added.id])
  r.api.paper.remove('constraint'); assert.equal(r.api.canvas.confirm(), true)
  const e = r.api.board.elements[0]
  assert.equal(e.math, '')
  assert.deepEqual(plain(e.mathExpressions.map(f => f.id)), ['bound', added.id])
  assert.deepEqual(plain(e.mathExpressions[0].custom), { nested: ['保留', 2] })
  assert.equal(e.implementation.code, 'return process(input);')
})

test('纯文本修改不会滤除尚为空的额外数学表达及其原始笔迹', () => {
  const board = fixture(); board.elements[0].mathExpressions.push({ id: 'empty', value: '', handwriting: ink('旧笔迹'), extension: { preserve: true } })
  const r = runtime(board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('保留未完成的公式位置。')
  assert.equal(r.api.canvas.confirm(), true)
  assert.deepEqual(plain(r.api.board.elements[0].mathExpressions.at(-1)), board.elements[0].mathExpressions.at(-1))
})

test('纸页文字含程序或任何一条公式解析失败，整页都不确认', () => {
  for (const mutate of [
    r => r.api.paper.text('const input = 1;'),
    r => r.api.paper.equation('primary', String.raw`\frac{x`),
    r => r.api.paper.equation('constraint', String.raw`\sqrt{`),
    r => r.api.paper.insert('const answer = 42;')
  ]) {
    const r = runtime(fixture()), before = snapshot(r.api.board)
    r.api.canvas.openPaperEditor('input'); r.api.paper.text('部分正确的修改。'); mutate(r)
    assert.equal(r.api.canvas.confirm(), false)
    assert.equal(snapshot(r.api.board), before)
    assert.ok(r.api.canvas.draft)
    assert.ok(r.node('paper-error').textContent)
  }
})

test('整页确认仍校验全部画板，其他部位的失效映射不能被绕过', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('准备确认的说明。')
  r.api.change(() => { r.api.board.elements[1].targets = [{ kind: 'organ', id: 'missing' }] })
  const before = snapshot(r.api.board)
  assert.equal(r.api.canvas.confirm(), false)
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.api.board.elements[0].text, '接收输入。\n检查输入边界。')
})

test('纸页拒绝陈旧文字或数学覆盖，保留当前版本和待核对草稿', () => {
  for (const mutate of [
    e => { e.text = '另一版本的新说明。' },
    e => { e.math = 'y = 3x' },
    e => { e.mathExpressions[0].value = 'x > 5' },
    e => { e.mathExpressions.push({ id: 'concurrent', value: 'z = 1' }) }
  ]) {
    const r = runtime(fixture())
    r.api.canvas.openPaperEditor('input'); r.api.paper.text('尚未核对的整页说明。')
    r.api.change(() => mutate(r.api.board.elements[0]))
    const before = snapshot(r.api.board)
    assert.equal(r.api.canvas.confirm(), false)
    assert.equal(snapshot(r.api.board), before)
    assert.equal(r.api.canvas.draft.value.text, '尚未核对的整页说明。')
  }
})

test('纸页确认只修改人读层，并发程序映射与位置修改原样保留', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('已核对的人读说明。'); r.api.paper.equation('bound', 'y ≤ 20')
  r.api.change(() => { r.api.board.elements[0].x = 150; r.api.board.elements[0].implementation.note = '新版程序依据'; r.api.board.elements[0].anchors[0].reason = '重新核对的源码用途' })
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].x, 150)
  assert.equal(r.api.board.elements[0].implementation.note, '新版程序依据')
  assert.equal(r.api.board.elements[0].anchors[0].reason, '重新核对的源码用途')
  assert.equal(r.api.board.elements[0].mathExpressions[1].value, 'y ≤ 20')
})

test('确认整页文字与多条公式形成一次全局撤销重做，取消不改变画板', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('合并确认的说明。'); r.api.paper.equation('primary', 'y = 4x'); r.api.paper.insert('z = y + 1')
  assert.equal(r.api.canvas.confirm(), true)
  const confirmed = snapshot(r.api.board)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
  r.api.redo(); assert.equal(snapshot(r.api.board), confirmed)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('取消的说明。'); r.api.paper.remove('bound'); r.api.canvas.cancel()
  assert.equal(snapshot(r.api.board), confirmed)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('纸页本地撤销重做跨文字和数学恢复草稿，新增编辑清除重做分支', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input')
  const start = snapshot(r.api.canvas.draft.value)
  r.api.paper.text('纸页第一步修改。')
  const prose = snapshot(r.api.canvas.draft.value)
  r.api.paper.equation('constraint', 'x > 2')
  const equation = snapshot(r.api.canvas.draft.value)
  r.api.paper.insert('z = x')
  const inserted = snapshot(r.api.canvas.draft.value)
  r.api.paper.undo(); assert.equal(snapshot(r.api.canvas.draft.value), equation)
  r.api.paper.undo(); assert.equal(snapshot(r.api.canvas.draft.value), prose)
  r.api.paper.undo(); assert.equal(snapshot(r.api.canvas.draft.value), start)
  r.api.paper.redo(); assert.equal(snapshot(r.api.canvas.draft.value), prose)
  r.api.paper.redo(); assert.equal(snapshot(r.api.canvas.draft.value), equation)
  r.api.paper.redo(); assert.equal(snapshot(r.api.canvas.draft.value), inserted)
  r.api.paper.undo(); r.api.paper.text('新的纸页分支。')
  const branched = snapshot(r.api.canvas.draft.value)
  r.api.paper.redo(); assert.equal(snapshot(r.api.canvas.draft.value), branched)
  assert.equal(snapshot(r.api.board), before)
})

test('未确认纸页在刷新后完整恢复，不会重置陈旧校验基线', () => {
  const board = fixture(), r = runtime(board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('刷新后保留的说明。'); r.api.paper.equation('constraint', 'x > 4'); r.api.paper.insert('z = y + 2')
  const draft = snapshot(r.api.canvas.draft), key = [...r.storage.keys()].find(key => key.endsWith(':canvas-editor'))
  assert.ok(key)
  const restored = runtime(board, { storage: r.storage }); restored.api.canvas.resume()
  assert.equal(snapshot(restored.api.canvas.draft.before), snapshot(r.api.canvas.draft.before))
  assert.equal(snapshot(restored.api.canvas.draft.value), snapshot(JSON.parse(draft).value))
  restored.api.change(() => { restored.api.board.elements[0].text = '刷新期间更新的说明。' })
  assert.equal(restored.api.canvas.confirm(), false)
  assert.equal(restored.api.canvas.draft.value.text, '刷新后保留的说明。')
  assert.equal(restored.api.board.elements[0].text, '刷新期间更新的说明。')
})

test('保存有效原位草稿时自动完整确认并保存人机映射', async () => {
  let posted = null
  const r = runtime(fixture(), { globals: { fetch: async (path, options = {}) => {
    if (path === '/api/versions' && options.method === 'POST') {
      posted = JSON.parse(options.body)
      return { ok: true, json: async () => ({ ok: true, selected: { id: 'saved', revision: 'saved-revision' }, versions: [] }) }
    }
    return { ok: true, json: async () => ({ ok: true, selected: null, versions: [] }) }
  } } })
  await r.api.versions.refresh()
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('待保存的自然语言。'); r.api.paper.equation('primary', 'y = 5x')
  assert.equal(await r.api.versions.save(), true)
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.node('inline-writing').hidden, true)
  assert.equal(posted.board.elements[0].text, '待保存的自然语言。')
  assert.equal(posted.board.elements[0].math, 'y = 5x')
  assert.equal(posted.board.elements[0].anchors[0].sha256, 'b'.repeat(64))
  assert.equal(posted.board.elements[0].implementation.extra.preserve, true)
  assert.deepEqual(boardDiagnostics(posted.board, [{ id: 'source' }]), [])
})

test('纸页中文手写只追加到当前草稿，完成编辑前不写画板并可本地撤销', () => {
  const r = runtime(fixture()), boardBefore = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('当前校对的说明。')
  const draftBefore = snapshot(r.api.canvas.draft.value)
  r.fire('paper-handwriting', 'click')
  assert.equal(r.node('ink-destination').value, 'paper')
  assert.equal(r.node('ink-destination').hidden, true)
  r.fire('ink-mode-text', 'click')
  r.node('ink-result').value = '新增的手写说明。'; r.fire('ink-result', 'input')
  r.fire('ink-apply', 'click')
  assert.equal(snapshot(r.api.board), boardBefore)
  assert.equal(r.api.canvas.draft.value.text, '当前校对的说明。\n新增的手写说明。')
  assert.equal(r.api.canvas.draft.value.handwriting.mode, 'text')
  assert.equal(r.api.canvas.draft.value.handwriting.reviewed, true)
  assert.deepEqual(plain(r.api.canvas.draft.value.mathHandwriting), fixture().elements[0].mathHandwriting)
  assert.deepEqual(plain(r.api.canvas.draft.value.mathExpressions), fixture().elements[0].mathExpressions)
  const updated = snapshot(r.api.canvas.draft.value)
  r.api.paper.undo(); assert.equal(snapshot(r.api.canvas.draft.value), draftBefore)
  r.api.paper.redo(); assert.equal(snapshot(r.api.canvas.draft.value), updated)
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].anchors[0].sha256, 'b'.repeat(64))
})

test('纸页手写编辑选定公式使用当前草稿，稳定标识与其他笔迹证据保留', () => {
  const r = runtime(fixture()), boardBefore = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.api.paper.equation('constraint', 'x > 10')
  const draftBefore = snapshot(r.api.canvas.draft.value)
  r.fire('paper-handwriting', 'click')
  assert.equal(r.api.math.mode, 'math')
  assert.equal(r.node('ink-result').value, 'x > 10')
  assert.deepEqual(plain(r.api.math.strokes), fixture().elements[0].mathExpressions[0].handwriting.strokes)
  r.node('ink-result').value = 'x > 11'; r.fire('ink-result', 'input'); r.fire('ink-apply', 'click')
  assert.equal(snapshot(r.api.board), boardBefore)
  const d = r.api.canvas.draft.value
  assert.equal(d.math, 'y = f(x)')
  assert.equal(d.mathExpressions[0].id, 'constraint')
  assert.equal(d.mathExpressions[0].value, 'x > 11')
  assert.deepEqual(plain(d.mathExpressions[0].evidence), fixture().elements[0].mathExpressions[0].evidence)
  assert.deepEqual(plain(d.mathExpressions[0].handwriting.strokes), fixture().elements[0].mathExpressions[0].handwriting.strokes)
  assert.deepEqual(plain(d.handwriting), fixture().elements[0].handwriting)
  assert.deepEqual(plain(d.mathHandwriting), fixture().elements[0].mathHandwriting)
  r.api.paper.undo(); assert.equal(snapshot(r.api.canvas.draft.value), draftBefore)
})

test('纸页手写新公式只新增草稿表达，原公式和程序映射均保留', () => {
  const r = runtime(fixture()), boardBefore = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.fire('paper-handwriting', 'click'); r.fire('ink-mode-math', 'click')
  r.node('ink-result').value = 'z = x + 2'; r.fire('ink-result', 'input'); r.fire('ink-apply', 'click')
  assert.equal(snapshot(r.api.board), boardBefore)
  const d = r.api.canvas.draft.value, added = d.mathExpressions.at(-1)
  assert.equal(d.math, 'y = f(x)')
  assert.equal(d.mathExpressions.length, 3)
  assert.equal(added.value, 'z = x + 2')
  assert.equal(added.handwriting.mode, 'math')
  assert.equal(added.handwriting.reviewed, true)
  assert.deepEqual(plain(d.mathExpressions.slice(0, 2)), fixture().elements[0].mathExpressions)
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].implementation.code, 'return process(input);')
})

test('识别期间纸页已变化则拒绝陈旧结果，仍保留识别结果和纸页草稿', () => {
  const r = runtime(fixture()), boardBefore = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
  r.node('ink-result').value = 'x > 12'; r.fire('ink-result', 'input')
  r.api.paper.text('识别期间继续修改了文稿。')
  const changed = snapshot(r.api.canvas.draft.value)
  r.fire('ink-apply', 'click')
  assert.equal(snapshot(r.api.canvas.draft.value), changed)
  assert.equal(snapshot(r.api.board), boardBefore)
  assert.equal(r.node('ink-dialog').open, true)
  assert.equal(r.node('ink-result').value, 'x > 12')
  assert.match(r.node('ink-feedback').textContent, /变化|重新/)
})

test('纸页粘贴只取纯文本，HTML和程序粘贴均不能执行或绕过确认校验', () => {
  const r = runtime(fixture()), formats = [], commands = []
  r.api.canvas.openPaperEditor('input')
  r.document.execCommand = (command, ui, text) => {
    commands.push(command)
    r.node('paper-prose').textContent = text; r.node('paper-prose').innerText = text
    r.fire('paper-prose', 'input')
    return true
  }
  let prevented = false
  const paste = text => r.fire('paper-prose', 'paste', { preventDefault() { prevented = true }, clipboardData: { getData(format) {
    formats.push(format)
    return format === 'text/plain' ? text : '<img src=x onerror=alert(1)><script>alert(1)</script>'
  } } })
  paste('粘贴后的自然语言说明。')
  assert.equal(prevented, true)
  assert.deepEqual(formats, ['text/plain'])
  assert.deepEqual(commands, ['insertText'])
  assert.ok(!r.node('paper-prose').innerHTML.includes('onerror'))
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].text, '粘贴后的自然语言说明。')
  assert.ok(!r.node('world').innerHTML.includes('onerror'))
  r.api.canvas.openPaperEditor('input'); const boardBefore = snapshot(r.api.board)
  paste('const input = 1;')
  assert.equal(r.api.canvas.confirm(), false)
  assert.equal(snapshot(r.api.board), boardBefore)
  assert.equal(r.api.canvas.draft.value.text, 'const input = 1;')
})

test('纸页新中文手写输入从空结果开始，不把原说明重复追加', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input'); r.fire('paper-handwriting', 'click')
  assert.equal(r.api.math.mode, 'text')
  assert.equal(r.node('ink-result').value, '')
  assert.equal(r.api.math.strokes.length, 0)
})

test('纸页历史缓存损坏时保留当前文稿而不让恢复或撤销崩溃', () => {
  const seed = runtime(fixture())
  seed.api.canvas.openPaperEditor('input'); seed.api.paper.text('有效但历史损坏的草稿。')
  const key = [...seed.storage.keys()].find(key => key.endsWith(':canvas-editor'))
  for (const history of [{ undo: null, redo: [] }, { undo: ['bad JSON'], redo: [] }, { undo: [], redo: {} }]) {
    const draft = plain(seed.api.canvas.draft); draft.history = history
    const r = runtime(fixture(), { storage: new Map([[key, JSON.stringify(draft)]]) })
    assert.doesNotThrow(() => r.api.canvas.resume())
    assert.equal(r.api.canvas.draft.value.text, '有效但历史损坏的草稿。')
    assert.doesNotThrow(() => { r.api.paper.undo(); r.api.paper.redo() })
    assert.equal(r.api.canvas.draft.value.text, '有效但历史损坏的草稿。')
  }
})

test('刷新后未确认手写公式恢复结果及原表达目标，不能静默改成追加或丢笔迹', () => {
  const board = fixture(), r = runtime(board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.api.paper.equation('constraint', 'x > 10')
  r.fire('paper-handwriting', 'click')
  r.node('ink-result').value = 'x > 15'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click'); r.fire('paper-close', 'click')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':handwriting')))
  const restored = runtime(board, { storage: r.storage }); restored.api.canvas.resume(); restored.fire('paper-handwriting', 'click')
  assert.equal(restored.api.math.mode, 'math')
  assert.equal(restored.node('ink-result').value, 'x > 15')
  assert.deepEqual(plain(restored.api.math.strokes), board.elements[0].mathExpressions[0].handwriting.strokes)
  restored.fire('ink-apply', 'click')
  assert.equal(restored.api.canvas.draft.value.mathExpressions.length, 2)
  assert.equal(restored.api.canvas.draft.value.mathExpressions[0].id, 'constraint')
  assert.equal(restored.api.canvas.draft.value.mathExpressions[0].value, 'x > 15')
  assert.equal(restored.api.canvas.draft.value.math, 'y = f(x)')
  assert.equal(restored.api.board.elements[0].mathExpressions[0].value, 'x ≥ 0')
})

test('恢复的纸页缓存混入跨域属性也只能修改人读字段，不能覆盖程序源码或身份', () => {
  const board = fixture(), seed = runtime(board)
  seed.api.canvas.openPaperEditor('input'); seed.api.paper.text('只应确认这段人读说明。')
  const key = [...seed.storage.keys()].find(key => key.endsWith(':canvas-editor')), draft = plain(seed.api.canvas.draft)
  Object.assign(draft.value, {
    id: 'another-id', type: 'math', x: 900,
    implementation: { language: 'JavaScript', code: 'return changedWithoutReview();' },
    anchors: [{ file: 'other.js', sha256: 'c'.repeat(64) }], targets: [], extension: { preserve: false }
  })
  const r = runtime(board, { storage: new Map([[key, JSON.stringify(draft)]]) })
  r.api.canvas.resume(); assert.equal(r.api.canvas.confirm(), true)
  const e = r.api.board.elements[0], before = board.elements[0]
  assert.equal(e.text, '只应确认这段人读说明。')
  for (const field of ['id', 'type', 'x']) assert.equal(e[field], before[field])
  for (const field of ['implementation', 'anchors', 'targets', 'extension']) assert.deepEqual(plain(e[field]), before[field])
})

test('纸页内容未改但有未确认手写候选，关闭刷新仍恢复纸页和准确公式目标', () => {
  const board = fixture(), r = runtime(board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
  r.node('ink-result').value = 'x > 18'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click'); r.fire('paper-close', 'click')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')))
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':handwriting')))
  const restored = runtime(board, { storage: r.storage })
  assert.equal(restored.api.canvas.draft.kind, 'paper')
  restored.api.canvas.resume(); restored.fire('paper-handwriting', 'click')
  assert.equal(restored.api.math.mode, 'math')
  assert.equal(restored.node('ink-result').value, 'x > 18')
  assert.deepEqual(plain(restored.api.math.strokes), board.elements[0].mathExpressions[0].handwriting.strokes)
  restored.fire('ink-apply', 'click')
  assert.equal(restored.api.canvas.draft.value.mathExpressions.length, 2)
  assert.equal(restored.api.canvas.draft.value.mathExpressions[0].id, 'constraint')
  assert.equal(restored.api.canvas.draft.value.mathExpressions[0].value, 'x > 18')
  assert.equal(restored.api.board.elements[0].mathExpressions[0].value, 'x ≥ 0')
})

test('未确认手写候选占有原纸页草稿，跨部位或独立编辑不能替换恢复上下文', () => {
  for (const openOther of [r => r.api.canvas.openPaperEditor('output'), r => r.api.canvas.openProgram('input'), r => r.fire('open-handwriting', 'click')]) {
    const board = fixture(), r = runtime(board)
    r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
    r.node('ink-result').value = 'x > 19'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click'); r.fire('paper-close', 'click')
    const draftBefore = snapshot(r.api.canvas.draft), inkKey = [...r.storage.keys()].find(key => key.endsWith(':handwriting'))
    const inkBefore = r.storage.get(inkKey)
    openOther(r)
    assert.equal(snapshot(r.api.canvas.draft), draftBefore)
    assert.equal(r.storage.get(inkKey), inkBefore)
    assert.equal(snapshot(r.api.board), snapshot(board))
    const restored = runtime(board, { storage: r.storage })
    restored.api.canvas.resume(); restored.fire('paper-handwriting', 'click')
    assert.equal(restored.node('ink-result').value, 'x > 19')
    restored.fire('ink-apply', 'click')
    assert.equal(restored.api.canvas.draft.value.mathExpressions[0].value, 'x > 19')
    assert.equal(restored.api.canvas.draft.value.mathExpressions.length, 2)
  }
})

test('只打开已有公式笔迹不产生未确认手写，正文编辑仍可完成', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
  assert.equal(r.api.canvas.draft.hasInkDraft, false)
  assert.equal(r.node('ink-result').value, 'x ≥ 0')
  r.fire('ink-close', 'click'); r.api.paper.text('只改正文，已有笔迹未修改。')
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(r.api.board.elements[0].text, '只改正文，已有笔迹未修改。')
  assert.deepEqual(plain(r.api.board.elements[0].mathExpressions), fixture().elements[0].mathExpressions)
})

test('未放入文稿的手写结果阻止纸页完成，明确取消才清除所属笔迹缓存', () => {
  const r = runtime(fixture()), boardBefore = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
  r.node('ink-result').value = 'x > 20'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click')
  assert.equal(r.api.canvas.draft.hasInkDraft, true)
  assert.equal(r.api.canvas.confirm(), false)
  assert.match(r.node('paper-error').textContent, /未确认.*手写/)
  assert.equal(snapshot(r.api.board), boardBefore)
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':handwriting')))
  r.api.canvas.cancel()
  assert.equal(r.api.canvas.draft, null)
  assert.equal([...r.storage.keys()].some(key => key.endsWith(':handwriting')), false)
  assert.equal([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')), false)
  assert.equal(snapshot(r.api.board), boardBefore)
})

const outsideEvent = (r, excluded = null) => ({
  target: { closest(selector) { return excluded && selector.includes(excluded) ? r.node(excluded.startsWith('#') ? excluded.slice(1) : excluded) : null } },
  prevented: false, stopped: false,
  preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }
})

test('点击画板外部自动完整确认原位文字和多条公式，只形成一步全局撤销', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input', 'constraint')
  r.api.paper.text('外部点击后确认这段自然语言。'); r.api.paper.equation('primary', 'y = 3x'); r.api.paper.equation('constraint', 'x > 3')
  const event = outsideEvent(r); r.fireDocument('pointerdown', event)
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.node('inline-writing').hidden, true)
  assert.equal(event.prevented, false)
  const confirmed = snapshot(r.api.board), e = r.api.board.elements[0]
  assert.equal(e.text, '外部点击后确认这段自然语言。')
  assert.equal(e.math, 'y = 3x')
  assert.equal(e.mathExpressions[0].value, 'x > 3')
  assert.equal(e.mathExpressions[0].id, 'constraint')
  assert.equal(e.anchors[0].sha256, 'b'.repeat(64))
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
  r.api.redo(); assert.equal(snapshot(r.api.board), confirmed)
})

test('外部点击遇到无效文字、公式或整板映射时保持原位并阻断后续点击动作', () => {
  for (const mutate of [
    r => r.api.paper.text('const hidden = 1;'),
    r => r.api.paper.equation('constraint', String.raw`\frac{x`),
    r => r.api.change(() => { r.api.board.elements[1].targets = [{ kind: 'organ', id: 'missing' }] })
  ]) {
    const r = runtime(fixture()); r.api.canvas.openPaperEditor('input'); r.api.paper.text('有效的人读修改。'); mutate(r)
    const before = snapshot(r.api.board), draft = snapshot(r.api.canvas.draft.value), event = outsideEvent(r)
    r.fireDocument('pointerdown', event)
    assert.equal(event.prevented, true)
    assert.equal(event.stopped, true)
    assert.equal(r.node('inline-writing').hidden, false)
    assert.equal(r.api.canvas.draft.target, 'input')
    assert.equal(snapshot(r.api.canvas.draft.value), draft)
    assert.equal(snapshot(r.api.board), before)
    assert.ok(r.node('paper-error').textContent)
  }
})

test('原位自身、操作条、独立对话和撤销按钮点击不误确认正在编辑的内容', () => {
  for (const excluded of ['#inline-writing', '#inline-actions', 'dialog', '#undo', '#redo']) {
    const r = runtime(fixture()), before = snapshot(r.api.board)
    r.api.canvas.openPaperEditor('input'); r.api.paper.text('继续在原位置写说明。')
    const event = outsideEvent(r, excluded); r.fireDocument('pointerdown', event)
    assert.equal(r.node('inline-writing').hidden, false, excluded)
    assert.equal(r.api.canvas.draft.target, 'input', excluded)
    assert.equal(snapshot(r.api.board), before, excluded)
    assert.equal(event.prevented, false, excluded)
  }
})

test('原位待确认笔迹仍阻断外部完成，保留识别结果和原表达目标', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input', 'constraint'); r.fire('paper-handwriting', 'click')
  r.node('ink-result').value = 'x > 30'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click')
  const event = outsideEvent(r); r.fireDocument('pointerdown', event)
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(r.node('inline-writing').hidden, false)
  assert.equal(r.api.canvas.draft.focusExpression, 'constraint')
  assert.equal(snapshot(r.api.board), before)
  r.fire('paper-handwriting', 'click')
  assert.equal(r.node('ink-result').value, 'x > 30')
})

test('无效可见原位草稿或有效但隐藏的草稿均不能通过保存绕过确认', async () => {
  for (const mutate of [
    r => r.api.paper.text('const hidden = 1;'),
    r => r.api.paper.equation('constraint', String.raw`\sqrt{`),
    r => r.fire('paper-close', 'click')
  ]) {
    let posted = false
    const r = runtime(fixture(), { globals: { fetch: async (path, options = {}) => {
      if (path === '/api/versions' && options.method === 'POST') posted = true
      return { ok: true, json: async () => ({ ok: true, selected: null, versions: [] }) }
    } } })
    await r.api.versions.refresh()
    r.api.canvas.openPaperEditor('input'); r.api.paper.text('等待完整确认的说明。'); mutate(r)
    const before = snapshot(r.api.board)
    assert.equal(await r.api.versions.save(), false)
    assert.equal(posted, false)
    assert.equal(snapshot(r.api.board), before)
    assert.equal(r.api.canvas.draft.target, 'input')
  }
})

const keyEvent = (r, key, options = {}) => ({
  key, target: r.node('paper-prose'), prevented: false, stopped: false,
  preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true }, ...options
})

test('公式Enter或Escape真实冒泡只收起数学输入，保留整份原位文字与数学草稿', () => {
  for (const key of ['Enter', 'Escape']) {
    const r = runtime(fixture()), before = snapshot(r.api.board)
    r.api.canvas.openPaperEditor('input', 'constraint'); r.api.paper.text('尚未完成的原位说明。'); r.api.paper.equation('constraint', 'x > 40')
    const draftBefore = snapshot(r.api.canvas.draft.value), event = keyEvent(r, key, { target: r.node('paper-equation-input') })
    r.fire('paper-equations', 'keydown', event)
    if (!event.stopped) r.fire('inline-writing', 'keydown', event)
    assert.ok(r.api.canvas.draft, key)
    assert.equal(snapshot(r.api.canvas.draft.value), draftBefore, key)
    assert.equal(r.api.canvas.draft.focusExpression, null, key)
    assert.equal(r.node('inline-writing').hidden, false, key)
    assert.equal(snapshot(r.api.board), before, key)
  }
})

test('中文组合输入期间外部确认和快捷键均不会截断或取消候选，结束后仍可确认', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.fire('paper-prose', 'compositionstart'); r.api.paper.text('正在输入中文候选。')
  const draftBefore = snapshot(r.api.canvas.draft.value), event = outsideEvent(r); r.fireDocument('pointerdown', event)
  assert.equal(event.prevented, true)
  assert.equal(r.node('inline-writing').hidden, false)
  for (const [key, options] of [['Escape', {}], ['Enter', { ctrlKey: true }], ['=', { altKey: true }]]) {
    r.fire('inline-writing', 'keydown', keyEvent(r, key, { isComposing: true, ...options }))
    assert.ok(r.api.canvas.draft)
    assert.equal(snapshot(r.api.canvas.draft.value), draftBefore)
    assert.equal(snapshot(r.api.board), before)
  }
  r.fire('paper-prose', 'compositionend'); r.fireDocument('pointerdown', outsideEvent(r))
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.api.board.elements[0].text, '正在输入中文候选。')
})

test('取消组合输入中的草稿后重新编辑，不残留阻止完成的中文输入锁', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input'); r.fire('paper-prose', 'compositionstart'); r.api.paper.text('取消这段候选内容。'); r.api.canvas.cancel()
  r.api.canvas.openPaperEditor('output'); r.api.paper.text('重新编辑后的有效说明。'); r.fireDocument('pointerdown', outsideEvent(r))
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.api.board.elements[1].text, '重新编辑后的有效说明。')
  assert.equal(r.api.board.elements[0].text, '接收输入。\n检查输入边界。')
})

test('原位Alt加等号新增稳定公式并参与本地撤销重做，Escape取消整份未确认草稿', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('在这个部位新增数学表达。')
  r.fire('inline-writing', 'keydown', keyEvent(r, '=', { altKey: true }))
  const added = r.api.canvas.draft.value.mathExpressions.at(-1)
  assert.ok(added.id && !['constraint', 'bound', 'primary'].includes(added.id))
  assert.equal(added.value, '')
  assert.equal(r.api.canvas.draft.focusExpression, added.id)
  r.fire('inline-writing', 'keydown', keyEvent(r, 'z', { ctrlKey: true }))
  assert.equal(r.api.canvas.draft.value.mathExpressions.length, 2)
  r.fire('inline-writing', 'keydown', keyEvent(r, 'z', { ctrlKey: true, shiftKey: true }))
  assert.equal(r.api.canvas.draft.value.mathExpressions.at(-1).id, added.id)
  r.fire('inline-writing', 'keydown', keyEvent(r, 'Escape'))
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.node('inline-writing').hidden, true)
  assert.equal(snapshot(r.api.board), before)
})

const imageFixture = () => {
  const board = fixture(), e = board.elements[0]
  e.type = 'image'
  e.image = {
    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC',
    alt: '输入数据的工程图示。', width: 3, height: 2, extension: { preserve: true }
  }
  return board
}

test('图片原位说明联动自然语言与替代文字，图像数据尺寸和人机映射保留并可整体撤销', () => {
  const board = imageFixture(), r = runtime(board), before = snapshot(r.api.board)
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('这张图描述输入与处理结果的关系。')
  r.fireDocument('pointerdown', outsideEvent(r))
  const e = r.api.board.elements[0]
  assert.equal(e.text, '这张图描述输入与处理结果的关系。')
  assert.equal(e.image.alt, e.text)
  for (const key of ['src', 'width', 'height', 'extension']) assert.deepEqual(plain(e.image[key]), board.elements[0].image[key], key)
  for (const key of ['implementation', 'anchors', 'targets', 'mathExpressions']) assert.deepEqual(plain(e[key]), board.elements[0][key], key)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('图片说明拒绝覆盖并发替代文字，未关联的图像扩展修改仍会保留', () => {
  const r = runtime(imageFixture())
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('等待核对的图片说明。')
  r.api.change(() => { r.api.board.elements[0].image.alt = '新版图片说明。' })
  const before = snapshot(r.api.board), event = outsideEvent(r); r.fireDocument('pointerdown', event)
  assert.equal(event.prevented, true)
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.api.canvas.draft.value.text, '等待核对的图片说明。')
  r.api.canvas.cancel(); r.api.canvas.openPaperEditor('input'); r.api.paper.text('校对后的图片说明。')
  r.api.change(() => { r.api.board.elements[0].image.extension.concurrent = '保留新证据' })
  r.fireDocument('pointerdown', outsideEvent(r))
  assert.equal(r.api.board.elements[0].image.alt, '校对后的图片说明。')
  assert.equal(r.api.board.elements[0].image.extension.concurrent, '保留新证据')
})

test('旋转图片说明与分区标题的原位编辑层绕同一图元中心转动，缩放后不偏移', () => {
  for (const type of ['image', 'frame']) {
    const board = type === 'image' ? imageFixture() : fixture(), e = board.elements[0]
    e.type = type; e.rotation = 90; e.height = 400
    const r = runtime(board), surface = r.node('surface')
    surface.getBoundingClientRect = () => ({ left: 75, top: 50, width: 1000, height: 700 })
    surface.parentElement = { getBoundingClientRect: () => ({ left: 25, top: 10, width: 1100, height: 750 }) }
    Object.assign(r.api.view, { x: 25, y: 40, scale: .75 })
    r.api.canvas.openPaperEditor('input')
    const panel = r.node('inline-writing'), origin = (panel.style.transformOrigin || '50% 50%').split(/\s+/)
    const local = (value, size) => parseFloat(value) * (value.endsWith('%') ? size / 100 : 1)
    const pivotX = parseFloat(panel.style.left) + local(origin[0], parseFloat(panel.style.width))
    const pivotY = parseFloat(panel.style.top) + local(origin[1], parseFloat(panel.style.height))
    const expectedX = 50 + r.api.view.x + (e.x + e.width / 2) * r.api.view.scale
    const expectedY = 40 + r.api.view.y + (e.y + e.height / 2) * r.api.view.scale
    assert.ok(Math.abs(pivotX - expectedX) < .01, type + ' 横向旋转中心')
    assert.ok(Math.abs(pivotY - expectedY) < .01, type + ' 纵向旋转中心')
    assert.equal(panel.style.transform, 'rotate(90deg)')
  }
})

test('图片客户端合法PNG新增图元保留原映射，默认避让并可一步撤销重做，显式位置不改写', () => {
  const board = fixture(); board.elements[0].width = 800; board.elements[0].height = 500; board.elements[1].x = 900
  const r = runtime(board), before = snapshot(r.api.board), image = imageFixture().elements[0].image
  assert.equal(r.api.images.insert([image]), true)
  assert.equal(r.api.board.elements.length, 3)
  const added = r.api.board.elements.at(-1)
  assert.equal(added.type, 'image')
  assert.deepEqual(plain(added.image), image)
  assert.deepEqual(plain(r.api.board.elements.slice(0, 2)), board.elements)
  for (const e of r.api.board.elements.slice(0, 2)) {
    const overlap = added.x < e.x + e.width && added.x + added.width > e.x && added.y < e.y + e.height && added.y + added.height > e.y
    assert.equal(overlap, false)
  }
  const confirmed = snapshot(r.api.board), view = r.api.view
  assert.ok(view.x + added.x * view.scale >= 0)
  assert.ok(view.y + added.y * view.scale >= 0)
  assert.ok(view.x + (added.x + added.width) * view.scale <= 1000)
  assert.ok(view.y + (added.y + added.height) * view.scale <= 700)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
  r.api.redo(); assert.equal(snapshot(r.api.board), confirmed)
  const explicit = { x: 19, y: 23 }
  assert.equal(r.api.images.insert([image], explicit), true)
  assert.equal(r.api.board.elements.at(-1).x, explicit.x)
  assert.equal(r.api.board.elements.at(-1).y, explicit.y)
})

function paddedImageSource(totalBytes) {
  const original = Buffer.from(imageFixture().elements[0].image.src.split(',')[1], 'base64'), padding = totalBytes - original.length - 12
  const chunk = Buffer.alloc(padding + 12); chunk.writeUInt32BE(padding, 0); chunk.write('tEXt', 4, 'ascii')
  return 'data:image/png;base64,' + Buffer.concat([original.subarray(0, -12), chunk, original.subarray(-12)]).toString('base64')
}

test('图片客户端对非法图片与超过总量的混合整批拒绝，没有部分图元或历史写入', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board), valid = imageFixture().elements[0].image
  const invalid = { ...valid, src: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
  assert.equal(r.api.images.insert([valid, invalid]), false)
  assert.equal(snapshot(r.api.board), before)
  const large = { ...valid, src: paddedImageSource(4.5 * 1024 * 1024) }
  assert.equal(r.api.images.insert([large, large]), false)
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.api.selected.length, 0)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('图片客户端拒绝无效原位草稿，有效草稿先完整确认再独立插入并分步撤销', () => {
  const r = runtime(fixture()), before = snapshot(r.api.board), image = imageFixture().elements[0].image
  r.api.canvas.openPaperEditor('input'); r.api.paper.text('const invalid = 1;')
  assert.equal(r.api.images.insert([image]), false)
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.node('inline-writing').hidden, false)
  assert.equal(r.api.canvas.draft.value.text, 'const invalid = 1;')
  r.api.paper.text('完成说明后插入工程图片。'); r.api.paper.equation('constraint', 'x > 50')
  assert.equal(r.api.images.insert([image]), true)
  assert.equal(r.api.canvas.draft, null)
  assert.equal(r.api.board.elements.length, 3)
  assert.equal(r.api.board.elements[0].text, '完成说明后插入工程图片。')
  assert.equal(r.api.board.elements[0].mathExpressions[0].value, 'x > 50')
  assert.deepEqual(plain(r.api.board.elements[0].implementation), fixture().elements[0].implementation)
  r.api.undo()
  assert.equal(r.api.board.elements.length, 2)
  assert.equal(r.api.board.elements[0].text, '完成说明后插入工程图片。')
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('图片FileReader异步读取期间选定版本revision变化，拒绝插入并保留当前画板', async () => {
  const readers = []; let revision = 'before-read'
  class DeferredFileReader {
    constructor() { readers.push(this) }
    readAsDataURL(file) { this.file = file }
  }
  const r = runtime(fixture(), { globals: {
    FileReader: DeferredFileReader,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, selected: { id: 'selected', revision }, versions: [] }) })
  } })
  await r.api.versions.refresh()
  const before = snapshot(r.api.board), image = imageFixture().elements[0].image
  const pending = r.api.images.importFiles([{ type: 'image/png', size: 84, name: '工程图.png' }])
  assert.equal(readers.length, 1)
  revision = 'after-read'; await r.api.versions.refresh()
  readers[0].result = image.src; readers[0].onload()
  assert.equal(await pending, false)
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.api.board.elements.some(e => e.type === 'image'), false)
  assert.match(r.node('toast').textContent, /版本.*变化/)
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})
