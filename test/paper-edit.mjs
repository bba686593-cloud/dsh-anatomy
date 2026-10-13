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
      hidden: false, open: false, selectionStart: 0, selectionEnd: 0,
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
    fire(id, type, event = {}) { for (const fn of node(id).listeners[type] || []) fn(event) }
  }
}

test('双击编辑纸页直接包含自然语言和全部数学表达，程序映射保持独立', () => {
  const r = runtime(fixture())
  r.api.canvas.openPaperEditor('input', 'constraint')
  const draft = r.api.canvas.draft
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

test('纸页未确认时项目保存阻止，确认后保存完整人机映射', async () => {
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
  assert.equal(await r.api.versions.save(), false)
  assert.equal(posted, null)
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(await r.api.versions.save(), true)
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
