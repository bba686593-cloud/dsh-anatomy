import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'
import { boardDiagnostics } from '../lib/board.js'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const raster = () => ({ src: png, width: 3, height: 2, displayWidth: 30, displayHeight: 20 })
const snapshot = value => JSON.stringify(value)
const plain = value => JSON.parse(snapshot(value))
const fixture = () => ({ version: 1, layout: { mode: 'manual' }, elements: [
  { id: 'stroke', type: 'pen', x: 0, y: 0, width: 100, height: 1, points: [[0, .5], [1, .5]], text: '', math: '', stroke: '#18233b', strokeWidth: 2,
    implementation: { language: 'JavaScript', code: 'return input;', extension: { keep: true } }, anchors: [{ file: 'src/input.js', sha256: 'a'.repeat(64) }], extension: { keep: true } },
  { id: 'existing', type: 'rect', x: 220, y: 80, width: 280, height: 160, text: '已有说明', math: 'y = f(x)', mathExpressions: [{ id: 'existing-extra', value: 'x ≥ 0' }] }
] })
const region = [{ x: 30, y: -30 }, { x: 70, y: -30 }, { x: 70, y: 30 }, { x: 30, y: 30 }]

function runtime(options = {}) {
  const nodes = new Map(), callbacks = new Map(), storage = new Map(), clipboard = []
  const node = id => {
    if (nodes.has(id)) return nodes.get(id)
    const listeners = {}, element = {
      id, value: '', innerHTML: '', textContent: '', innerText: '', style: {}, dataset: {}, attributes: {}, listeners, hidden: id === 'inline-writing', open: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
      setAttribute(key, value) { this.attributes[key] = value }, getAttribute(key) { return this.attributes[key] },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn) }, closest() { return null }, querySelector() { return null }, querySelectorAll() { return [] },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 } },
      showModal() { this.open = true }, close() { this.open = false }, setPointerCapture() {}, focus() {}, select() {}, setSelectionRange() {}, click() {}, appendChild() {}, remove() {}, contains() { return false },
      getContext() { return { fillRect() {}, scale() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {} } },
      toDataURL() { return png }
    }
    nodes.set(id, element); return element
  }
  node('ink-result').parentElement = { tagName: 'LABEL', hidden: false }
  const fetch = options.fetch || (async () => ({ ok: true, json: async () => ({ ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true }) }))
  const context = {
    document: { compatMode: 'CSS1Compat', getElementById: node, querySelectorAll: () => [], querySelector: () => null, body: node('body'),
      addEventListener(type, fn) { (callbacks.get(type) || callbacks.set(type, []).get(type)).push(fn) }, createElement: type => node('created-' + type), getSelection: () => null },
    window: { addEventListener() {} }, navigator: { clipboard: { async writeText(value) { clipboard.push(value) } } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    structuredClone, Blob, URL, AbortController, console, fetch, setTimeout: () => 0, clearTimeout() {}
  }
  const html = renderAnatomy({ slug: 'math-client', title: '图形公式回归', board: options.board || fixture() }, [], [])
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context)
  // These older model-boundary tests explicitly exercise the legacy local API.
  vm.runInNewContext("inkProvider='local';$('ink-provider').value='local';inkLocalConnection={origin:'',legacy:true,connected:true};updateInkProviderControls()", context)
  // Only replace the external SVG-to-pixels boundary; board validation, source
  // comparison, lasso clipping, history and recognition routing remain real.
  context.rasterFormula = options.raster || (async () => raster())
  context.captureLassoRaster = options.capture || (async () => ({ src: png, bounds: { x: 30, y: -30, width: 40, height: 60 } }))
  return { api: context.window.__anatomyBoard, context, node, storage, clipboard, html,
    fire(id, type, event = {}) { const result = []; for (const fn of node(id).listeners[type] || []) result.push(fn(event)); return result },
    open(mode = 'math') { context.window.__anatomyBoard.graphics.lasso(region); return context.window.__anatomyBoard.math.openHandwriting({ mode }) }
  }
}

test('公式库只显示图形模板并在指定纸张位置异步新增PNG，已有表达和映射不被替换', async () => {
  const r = runtime(), before = snapshot(r.api.board)
  r.api.select('existing'); r.api.math.openFormulaLibrary({ mode: 'edit', expression: 'primary', at: { x: 450, y: 300 } })
  assert.equal(r.node('formula-input').hidden, true)
  assert.equal(r.node('formula-operation').hidden, true)
  assert.equal(r.node('formula-expression').hidden, true)
  r.api.math.selectTemplate(String.raw`\frac{a}{b}`)
  assert.match(r.node('formula-preview').innerHTML, /<mfrac>/)
  const e = await r.api.math.applyFormula()
  assert.equal(e.type, 'image'); assert.equal(e.x, 450); assert.equal(e.y, 300)
  assert.equal(e.formulaGraphic.originalMath, String.raw`\frac{a}{b}`)
  assert.equal(e.image.src, png)
  assert.deepEqual(plain(r.api.board.elements.slice(0, 2)), JSON.parse(before).elements)
  assert.deepEqual(boardDiagnostics(r.api.board), [])
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('公式模板复制带图形来源的兼容载荷，复制不改画板而粘贴生成独立图形', async () => {
  const r = runtime(), before = snapshot(r.api.board)
  r.api.math.openFormulaLibrary(); r.api.math.selectTemplate('y = 2x')
  await r.api.math.copyFormula()
  assert.equal(snapshot(r.api.board), before)
  const payload = JSON.parse(r.clipboard[0])
  assert.equal(payload.elements[0].type, 'image')
  assert.equal(payload.elements[0].formulaGraphic.originalMath, 'y = 2x')
  assert.equal(r.api.graphics.paste(payload), true)
  assert.equal(r.api.board.elements.length, 3)
  assert.equal(r.api.board.elements[2].formulaGraphic.originalMath, 'y = 2x')
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('公式图形等待像素转换时关闭、重开或改选模板均取消旧插入', async () => {
  for (const action of ['close', 'reopen', 'change']) {
    let complete
    const r = runtime({ raster: () => new Promise(resolve => { complete = resolve }) }), before = snapshot(r.api.board)
    r.api.math.openFormulaLibrary({ value: 'y = x', at: { x: 10, y: 20 } })
    const pending = r.api.math.applyFormula()
    if (action === 'close') r.fire('formula-close', 'click')
    if (action === 'reopen') { r.fire('formula-close', 'click'); r.api.math.openFormulaLibrary({ value: 'y = 2x', at: { x: 40, y: 60 } }) }
    if (action === 'change') r.api.math.selectTemplate('y = 3x')
    const feedback = r.node('formula-feedback').textContent
    complete(raster())
    assert.equal(await pending, false)
    assert.equal(snapshot(r.api.board), before)
    assert.equal(r.node('formula-feedback').textContent, feedback)
    assert.equal(r.node('formula-dialog').open, action !== 'close')
  }
})

test('无效数学模板只给自然语言反馈，不在可见预览回退显示排版源码', async () => {
  const r = runtime(), before = snapshot(r.api.board), source = String.raw`\frac{a`
  r.api.math.openFormulaLibrary(); assert.equal(r.api.math.selectTemplate(source), false)
  assert.equal(r.node('formula-input').hidden, true)
  assert.ok(!r.node('formula-preview').innerHTML.includes(source))
  assert.match(r.node('formula-feedback').textContent, /不能生成/)
  assert.equal(r.node('formula-apply').disabled, true)
  await r.api.math.applyFormula(); assert.equal(snapshot(r.api.board), before)
})

test('识别入口无套索时要求在画板圈选，有现成套索时直接复用且预览禁止补画清除', async () => {
  const r = runtime(), before = snapshot(r.api.board)
  r.fire('open-handwriting', 'click')
  assert.equal(r.node('ink-dialog').open, false)
  assert.match(r.node('toast').textContent, /套索|圈/)
  await r.open()
  assert.equal(r.node('ink-dialog').open, true)
  assert.deepEqual(plain(r.api.graphics.region), region)
  assert.equal(r.node('ink-pad').attributes['aria-readonly'], 'true')
  const strokes = snapshot(r.api.math.strokes)
  r.fire('ink-pad', 'pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} })
  r.fire('ink-pad', 'pointermove', { pointerId: 1, clientX: 200, clientY: 150 })
  r.fire('ink-undo', 'click'); r.fire('ink-clear', 'click')
  assert.equal(snapshot(r.api.math.strokes), strokes)
  assert.equal(snapshot(r.api.board), before)
  r.fire('ink-keep', 'click'); assert.equal(r.node('ink-dialog').open, false)
  assert.equal(snapshot(r.api.board), before)
})

test('数学识别候选只显示排版预览，确认前无改动，确认后圈外片段与映射原样保存', async () => {
  let complete
  const r = runtime({ fetch: async path => path === '/api/recognize' ? new Promise(resolve => { complete = resolve }) : { ok: true, json: async () => ({ ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true }) } })
  const before = snapshot(r.api.board); await r.open()
  const session = plain(r.api.math.lassoSession), outside = session.slices.flatMap(s => s.outside)
  const pending = r.api.math.recognizeInk()
  assert.equal(snapshot(r.api.board), before)
  complete({ ok: true, json: async () => ({ ok: true, text: String.raw`\frac{a}{b}`, engine: 'test-boundary' }) })
  assert.equal(await pending, true)
  assert.equal(r.node('ink-result').value, String.raw`\frac{a}{b}`)
  assert.equal(r.node('ink-result').hidden, true)
  assert.equal(r.node('ink-result').parentElement.hidden, true)
  assert.match(r.node('ink-result-preview').innerHTML, /<mfrac>/)
  assert.equal(snapshot(r.api.board), before)
  await r.api.math.applyInkResult()
  assert.equal(r.node('ink-dialog').open, false)
  for (const e of outside) assert.deepEqual(plain(r.api.board.elements.find(p => p.id === e.id)), e)
  const graphic = r.api.board.elements.find(e => e.formulaGraphic)
  assert.equal(graphic.formulaGraphic.originalMath, String.raw`\frac{a}{b}`)
  assert.deepEqual(plain(graphic.recognition.rawElements), [fixture().elements[0]])
  assert.deepEqual(plain(graphic.anchors), fixture().elements[0].anchors)
  assert.deepEqual(boardDiagnostics(r.api.board), [])
  r.api.undo(); assert.equal(snapshot(r.api.board), before)
})

test('中文套索识别允许自然语言校对，确认只替换圈内笔迹而不回退程序输入', async () => {
  const r = runtime({ fetch: async path => ({ ok: true, json: async () => path === '/api/recognize' ? { ok: true, text: '处理输入', engine: 'text-boundary' } : { ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true } }) })
  await r.open('text'); const outside = plain(r.api.math.lassoSession.slices.flatMap(s => s.outside))
  await r.api.math.recognizeInk()
  assert.equal(r.node('ink-result').hidden, false); assert.equal(r.node('ink-result').parentElement.hidden, false)
  r.node('ink-result').value = '校对后的中文说明'; r.fire('ink-result', 'input')
  await r.api.math.applyInkResult()
  assert.ok(r.api.board.elements.some(e => e.type === 'text' && e.text === '校对后的中文说明'))
  for (const e of outside) assert.deepEqual(plain(r.api.board.elements.find(p => p.id === e.id)), e)
  assert.deepEqual(boardDiagnostics(r.api.board), [])
})

test('识别返回前切换模式或关闭窗口，晚到的数学候选不能改新预览或画板', async () => {
  for (const change of [r => r.fire('ink-mode-text', 'click'), r => r.fire('ink-close', 'click')]) {
    let complete
    const r = runtime({ fetch: async path => path === '/api/recognize' ? new Promise(resolve => { complete = resolve }) : { ok: true, json: async () => ({ ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true }) } })
    await r.open(); const before = snapshot(r.api.board), pending = r.api.math.recognizeInk()
    change(r); complete({ ok: true, json: async () => ({ ok: true, text: 'y = 2x' }) })
    assert.equal(await pending, false)
    assert.equal(r.node('ink-result').value, '')
    assert.equal(snapshot(r.api.board), before)
  }
})

test('识别期间源笔迹或选定版本变化，候选拒绝进入确认流程，当前画板和原始数据保留', async () => {
  for (const change of [async r => r.api.change(() => { r.api.board.elements[0].points[1][0] = .9 }), async r => { r.revision = 'version-2'; await r.api.versions.refresh() }]) {
    let complete; const state = { revision: 'version-1' }
    const r = runtime({ fetch: async path => path === '/api/recognize' ? new Promise(resolve => { complete = resolve }) : { ok: true, json: async () => ({ ok: true, versions: [], selected: { id: 'saved', revision: state.revision }, service: 'anatomy-handwriting', ready: true }) } })
    Object.defineProperty(r, 'revision', { set(value) { state.revision = value } })
    await r.api.versions.refresh(); await r.open()
    const pending = r.api.math.recognizeInk(); await change(r); const current = snapshot(r.api.board)
    complete({ ok: true, json: async () => ({ ok: true, text: 'y = 2x' }) })
    assert.equal(await pending, false)
    assert.equal(r.node('ink-result').value, '')
    assert.match(r.node('ink-feedback').textContent, /变化|重新圈/)
    assert.equal(snapshot(r.api.board), current)
  }
})

test('同一区域未确认候选关闭后可恢复，模式切换仍只读且不覆盖原笔迹', async () => {
  const r = runtime(), before = snapshot(r.api.board); await r.open()
  r.node('ink-result').value = 'y = 3x'; r.fire('ink-result', 'input'); r.fire('ink-close', 'click')
  await r.api.math.openHandwriting({ mode: 'math' })
  assert.equal(r.node('ink-result').value, 'y = 3x')
  assert.match(r.node('ink-feedback').textContent, /恢复/)
  assert.equal(r.node('ink-result').hidden, true)
  r.fire('ink-mode-text', 'click')
  assert.equal(r.node('ink-result').hidden, false)
  assert.equal(r.node('ink-pad').attributes['aria-readonly'], 'true')
  assert.equal(snapshot(r.api.board), before)
})

test('套索仅含已补画公式PNG也可识别，发送真实捕获图片而不是空笔迹数组', async () => {
  let requestImage
  const r = runtime({ board: { version: 1, layout: { mode: 'manual' }, elements: [] }, fetch: async (path, options = {}) => {
    if (path === '/api/recognize') { requestImage = JSON.parse(options.body).image; return { ok: true, json: async () => ({ ok: true, text: 'y = 2x', engine: 'graphic-boundary' }) } }
    return { ok: true, json: async () => ({ ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true }) }
  } })
  r.api.math.openFormulaLibrary({ value: 'y = x', at: { x: 40, y: -10 } }); await r.api.math.applyFormula()
  const before = snapshot(r.api.board)
  await r.open()
  assert.equal(r.api.math.strokes.length, 0)
  assert.equal(r.api.math.lassoSession.slices[0].graphic, true)
  assert.equal(r.api.math.lassoSession.image, png)
  assert.match(r.node('ink-paths').innerHTML, /<image /)
  assert.equal(r.node('ink-empty').style.display, 'none')
  assert.equal(await r.api.math.recognizeInk(), true)
  assert.equal(requestImage, png)
  assert.equal(r.node('ink-result').hidden, true)
  assert.match(r.node('ink-result-preview').innerHTML, /<math/)
  assert.equal(snapshot(r.api.board), before)
  r.fire('ink-keep', 'click'); assert.equal(snapshot(r.api.board), before)
})

test('圈内图片捕获尚未完成禁止识别，关闭或源变化后晚到捕获不能写入新预览', async () => {
  for (const change of [r => r.fire('ink-close', 'click'), r => r.api.change(() => { r.api.board.elements[0].x = 1 })]) {
    let complete
    const r = runtime({ capture: () => new Promise(resolve => { complete = resolve }) }), pending = r.open()
    assert.equal(r.node('ink-recognize').disabled, true)
    assert.equal(r.node('ink-mode-text').disabled, true)
    assert.equal(await r.api.math.recognizeInk(), false)
    change(r); const current = snapshot(r.api.board)
    complete({ src: png, bounds: { x: 30, y: -30, width: 40, height: 60 } })
    assert.equal(await pending, false)
    assert.ok(!r.node('ink-paths').innerHTML.includes('<image '))
    assert.equal(snapshot(r.api.board), current)
  }
})

test('中文校对输入中断在途识别，晚到的候选不会覆盖新输入', async () => {
  let complete
  const r = runtime({ fetch: async path => path === '/api/recognize' ? new Promise(resolve => { complete = resolve }) : { ok: true, json: async () => ({ ok: true, versions: [], selected: null, service: 'anatomy-handwriting', ready: true }) } })
  await r.open('text'); const before = snapshot(r.api.board), pending = r.api.math.recognizeInk()
  r.node('ink-result').value = '用户正在校对的说明'; r.fire('ink-result', 'input')
  complete({ ok: true, json: async () => ({ ok: true, text: '旧识别结果' }) })
  assert.equal(await pending, false)
  assert.equal(r.node('ink-result').value, '用户正在校对的说明')
  assert.equal(snapshot(r.api.board), before)
})

test('中文确认等待圈外PNG裁切时再次改输入，旧确认必须拒绝而保留当前草稿', async () => {
  let complete
  const r = runtime({ board: { version: 1, layout: { mode: 'manual' }, elements: [] } })
  r.api.math.openFormulaLibrary({ value: 'y = x', at: { x: 40, y: -10 } }); await r.api.math.applyFormula()
  await r.open('text'); const before = snapshot(r.api.board)
  r.context.clipFormulaOutside = () => new Promise(resolve => { complete = resolve })
  r.node('ink-result').value = '第一次确认的说明'; r.fire('ink-result', 'input')
  const pending = r.api.math.applyInkResult()
  r.node('ink-result').value = '继续修改后的说明'; r.fire('ink-result', 'input')
  complete([structuredClone(r.api.board.elements[0])]); await pending
  assert.equal(snapshot(r.api.board), before)
  assert.equal(r.node('ink-result').value, '继续修改后的说明')
  assert.equal(r.node('ink-dialog').open, true)
  assert.match(r.node('ink-feedback').textContent, /取消|变化/)
})
