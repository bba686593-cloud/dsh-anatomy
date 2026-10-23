// Real Chromium checks for one shared editable paper surface. Fixtures are
// synthetic; no saved user project or source mapping is read or changed.
import assert from 'node:assert/strict'
import { decodePng, encodePng } from '../lib/png-surface.js'
import { renderAnatomy } from '../lib/render.js'

const { chromium } = await import(process.env.ANATOMY_PLAYWRIGHT_MODULE || 'playwright')
let passed = 0
const check = (value, label) => { assert.ok(value, label); passed++; console.log('✓ ' + label) }

// Screenshot pixels test the actual foreignObject compositor, rather than a
// second SVG rasterizer that may handle masks differently from the browser.
function screenshotPixels(png) {
  const { width, height, data } = decodePng(png)
  return { width, height, at(x, y) { const at = (Math.floor(y) * width + Math.floor(x)) * 4; return [...data.subarray(at, at + 3)] } }
}
function imagePNG() {
  const data = Buffer.alloc(3 * 2 * 4)
  for (let at = 0; at < data.length; at += 4) data.set([220, 38, 38, 255], at)
  return 'data:image/png;base64,' + encodePng({ width: 3, height: 2, data }).toString('base64')
}

const front = { id: 'front', type: 'rect', x: 0, y: 0, width: 440, height: 240, text: 'MMMMMMMMMMMM\nMMMMMMMMMMMM', math: 'x^2+y^2=z^2', fontSize: 34, fill: '#dbeafe', stroke: '#2563eb', anchors: [{ file: 'synthetic.js' }], extension: { keep: true } }
const board = { version: 1, layout: { mode: 'manual' }, elements: [front] }
const html = renderAnatomy({ slug: 'surface-regression', title: '统一画面回归', board }, [], [])
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ANATOMY_BROWSER_EXECUTABLE ? { executablePath: process.env.ANATOMY_BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('http://surface.test/**', route => route.fulfill(route.request().url() === 'http://surface.test/' ? { contentType: 'text/html', body: html } : { contentType: 'application/json', body: JSON.stringify({ ok: false, error: { message: 'Synthetic offline fixture' } }) }))
  await page.goto('http://surface.test/')
  await page.waitForFunction(() => !!window.__anatomyBoard && !!window.MathJax?.startup?.promise)
  await page.evaluate(async () => { await window.MathJax.startup.promise; if (document.fonts?.ready) await document.fonts.ready })
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const load = async elements => { await page.evaluate(elements => { board = { version: 1, layout: { mode: 'manual' }, elements }; selected.clear(); undoStack = []; redoStack = []; view = { x: 80, y: 180, scale: 1 }; setTool('select'); render() }, structuredClone(elements)); await paint() }
  const screen = p => page.evaluate(p => { const rect = surface.getBoundingClientRect(); return { x: rect.left + view.x + p.x * view.scale, y: rect.top + view.y + p.y * view.scale } }, p)
  const snapshot = () => page.evaluate(() => JSON.stringify(board))
  const pixels = async () => screenshotPixels(await page.screenshot({ type: 'png' }))
  const erase = async p => { await page.locator('[data-tool="eraser"]').click(); await page.evaluate(() => { $('eraser-size').value = '44' }); await page.mouse.click(p.x, p.y); await page.evaluate(() => flushGraphicJobs()); await page.locator('[data-tool="select"]').click(); await paint() }
  await load([front])

  const copy = await page.locator('g.element[data-id="front"] .shape-prose').boundingBox(), before = await pixels(), ink = []
  for (let y = Math.ceil(copy.y + 3); y < copy.y + Math.min(copy.height - 3, 45); y++) for (let x = Math.ceil(copy.x + 8); x < copy.x + copy.width - 8; x++) if (before.at(x, y).every(value => value < 110)) ink.push({ x, y })
  const middle = { x: copy.x + copy.width / 2, y: copy.y + 24 }
  ink.sort((a, b) => Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y))
  check(ink.length > 150, '真实 foreignObject 中的正文已绘制，像素回归有有效前景')
  const hole = ink[0], intact = ink.find(p => Math.hypot(p.x - hole.x, p.y - hole.y) > 70), original = await snapshot()
  await erase(hole)
  const erased = await pixels(), erasedFront = await page.evaluate(() => structuredClone(get('front')))
  check(erased.at(hole.x, hole.y).every(value => value > 180) && erased.at(intact.x, intact.y).every(value => value < 110), '局部橡皮真实擦掉 foreignObject 字形，只保留路径外的正文')
  check(await page.evaluate(() => board.elements.length === 1 && get('front').type === 'rect' && get('front').text.includes('MMMM') && get('front').math === 'x^2+y^2=z^2' && get('front').anchors[0].file === 'synthetic.js' && get('front').erasures.length > 0), '局部擦除保留同一部位、原表达和源码映射')
  await page.keyboard.press('Control+z'); await paint()
  check(await snapshot() === original && (await pixels()).at(hole.x, hole.y).every(value => value < 110), '一次撤销恢复原字形与整个表面数据')
  await page.keyboard.press('Control+Shift+z'); await paint()
  check((await pixels()).at(hole.x, hole.y).every(value => value > 180), '重做恢复同一局部孔洞')

  const formula = await page.locator('g.element[data-id="front"] [data-expression="primary"]').boundingBox(), formulaPixels = await pixels(), mathInk = []
  for (let y = Math.ceil(formula.y + 3); y < formula.y + formula.height - 3; y++) for (let x = Math.ceil(formula.x + 10); x < formula.x + formula.width - 10; x++) if (formulaPixels.at(x, y).every(value => value < 110)) mathInk.push({ x, y })
  check(mathInk.length > 70, '打印公式的真实字形进入同一表面')
  await erase(mathInk[Math.floor(mathInk.length / 2)])
  const mathHole = mathInk[Math.floor(mathInk.length / 2)]
  check((await pixels()).at(mathHole.x, mathHole.y).every(value => value > 180) && await page.evaluate(() => board.elements.length === 1 && get('front').math === 'x^2+y^2=z^2'), '打印公式可局部擦除，保持同一对象而不另建公式图层')

  const back = { id: 'back', type: 'rect', x: 0, y: 0, width: 440, height: 240, text: '', fill: '#bef264', stroke: '#65a30d' }
  await load([back, erasedFront])
  await page.mouse.click(hole.x, hole.y)
  check(await page.evaluate(() => selected.size === 1 && selected.has('back')), '从擦掉的孔洞可真实点选下方对象')
  const overlap = await screen({ x: 380, y: 205 })
  await page.keyboard.down('Alt'); await page.mouse.click(overlap.x, overlap.y)
  check(await page.evaluate(() => selected.size === 1 && selected.has('front')), 'Alt 点击循环回到上方组件')
  await page.mouse.click(overlap.x, overlap.y); await page.keyboard.up('Alt')
  const overlapState = await page.evaluate(p => ({ selected: [...selected], editing: inlineWritingOpen(), hits: hitStackAt({ clientX: p.x, clientY: p.y, target: document.elementFromPoint(p.x,p.y) }), nodes: document.elementsFromPoint(p.x,p.y).map(node=>[node.tagName,node.closest?.('[data-id]')?.getAttribute('data-id')]) }), overlap)
  check(overlapState.selected.length === 1 && overlapState.selected[0] === 'back' && !overlapState.editing, '再次 Alt 点击进入下方对象且不误开文字编辑')

  await page.locator('[data-tool="pen"]').click()
  await page.evaluate(() => { $('draw-color').value = '#dc2626'; $('draw-color').dispatchEvent(new Event('input')) })
  await page.evaluate(() => { $('draw-width').value = '12' })
  const beforePen = await snapshot()
  await page.mouse.move(hole.x - 30, hole.y); await page.mouse.down(); await page.mouse.move(hole.x + 30, hole.y, { steps: 8 }); await page.mouse.up()
  await page.evaluate(() => flushGraphicJobs()); await page.locator('[data-tool="select"]').click(); await page.evaluate(() => { selected.clear(); renderScene() }); await page.mouse.move(overlap.x, overlap.y); await paint()
  const painted = await pixels(), color = painted.at(hole.x, hole.y)
  const penState = await page.evaluate(() => ({ ids: board.elements.map(e=>[e.id,e.type]), tool, pending: graphicBusy, last: board.elements.at(-1) }))
  const newPaintVisible = color[0] > 170 && color[1] < 90 && color[2] < 90 && penState.ids.at(-1)[1] === 'pen' && penState.ids.length === 3
  check(newPaintVisible, '旧孔洞上重新落笔真实显示新笔画，并保持最新笔顺' + (newPaintVisible ? '' : '：' + JSON.stringify({ color, penState })))
  check(await page.evaluate(prior => JSON.stringify(get('front')) === JSON.stringify(prior), erasedFront), '重新补画不移动、拆分或改写旧表面与擦痕')
  await page.keyboard.press('Control+z'); await paint()
  check(await snapshot() === beforePen, '新的一笔单独撤销，底下组件与原擦痕完整保留')

  const picture = { id: 'picture', type: 'image', x: 0, y: 0, width: 360, height: 280, text: '图片说明保留', image: { src: imagePNG(), width: 3, height: 2, alt: '原图片' } }
  await load([picture])
  await page.waitForFunction(() => [...document.querySelectorAll('#world image')].every(node => node.getAttribute('href')?.startsWith('data:image/png')))
  const imageCenter = await page.evaluate(() => { const box = lassoVisualImageBox(get('picture')), rect = surface.getBoundingClientRect(); return { x: rect.left + view.x + box.x + box.width / 2, y: rect.top + view.y + box.y + box.height / 2 } })
  check((await pixels()).at(imageCenter.x, imageCenter.y)[0] > 170 && (await pixels()).at(imageCenter.x, imageCenter.y)[1] < 90, '普通图片在真实SVG图像载体中显示')
  await erase(imageCenter)
  check((await pixels()).at(imageCenter.x, imageCenter.y).every(value => value > 180) && await page.evaluate(src => get('picture').image.src === src && get('picture').text === '图片说明保留', picture.image.src), '普通图片局部擦除真实生效，原PNG和说明保留')
  const imageSample = await page.evaluate(async () => { const canvas = await graphicCanvas(get('picture')), data = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data; return [...data] })
  check(imageSample[3] === 0, '圈内识别读取同一图片擦痕，原PNG不会让已擦内容重新出现' + (imageSample[3] === 0 ? '' : '：' + JSON.stringify(imageSample)))
  const directed = { id: 'directed', type: 'arrow', x: 0, y: 0, width: 300, height: 160, text: '', stroke: '#2563eb', strokeWidth: 12 }
  await load([directed])
  const priorHole = await screen({ x: 75, y: 40 })
  await erase(priorHole)
  await page.evaluate(() => { const e = get('directed'); e.x = 300; e.y = 160; e.width = -300; e.height = -160; renderScene() }); await paint()
  const movedHole = await screen({ x: 225, y: 120 }), flippedPixels = await pixels(), oldInk = flippedPixels.at(priorHole.x, priorHole.y)
  check(flippedPixels.at(movedHole.x, movedHole.y).every(value => value > 180) && oldInk[2] > 170 && oldInk[0] < 100, '箭头方向翻转后真实SVG擦痕随起点比例移动，原位置恢复线条')
  // Exercise the real controller, not just the renderer's sampling API.
  const spaceFront = { id: 'space-front', type: 'rect', x: 0, y: 0, z: 80, width: 300, height: 180, text: '', fill: '#2563eb', stroke: '#2563eb', anchors: [{ file: 'synthetic-front.js' }], extension: { keep: 'front' } }
  const spaceBack = { ...spaceFront, id: 'space-back', z: 0, fill: '#bef264', stroke: '#65a30d', anchors: [{ file: 'synthetic-back.js' }], extension: { keep: 'back' } }
  const spaceWords = { id: 'space-words', type: 'text', x: 400, y: 0, z: 30, width: 300, height: 130, text: 'MMMMMMMM\nMMMMMMMM', fontSize: 38, anchors: [{ file: 'synthetic-words.js' }] }
  const spacePicture = { ...picture, id: 'space-picture', x: 400, y: 210, z: 30, width: 300, height: 240, anchors: [{ file: 'synthetic-picture.js' }] }
  await load([spaceBack, spaceFront, spaceWords, spacePicture])
  await page.locator('#space-enter').click()
  const spaceReady = async () => { await page.waitForFunction(() => spaceMode && spaceState.engine?.info().pendingImages === 0 && !spaceState.gesture); await paint() }
  const spaceScreen = p => page.evaluate(p => { const q = spaceState.engine.project(p), rect = spaceHost().getBoundingClientRect(); return { x: rect.left + q.x, y: rect.top + q.y } }, p)
  await spaceReady(); await page.locator('#space-top').click(); await page.locator('[data-tool="select"]').click()
  // Locking affects object movement, while selection and erasing stay available.
  if (await page.locator('#space-edit-scene').getAttribute('aria-pressed') === 'true') await page.locator('#space-edit-scene').click()
  await spaceReady()
  const sharedPoint = await spaceScreen({ x: 96, y: 111.6, z: 80 })
  await page.keyboard.down('Alt'); await page.mouse.click(sharedPoint.x, sharedPoint.y)
  check(await page.evaluate(() => selected.size === 1 && selected.has('space-front')), '真实三维 Alt 点击选中重叠的前方组件')
  await page.mouse.click(sharedPoint.x, sharedPoint.y); await page.keyboard.up('Alt')
  check(await page.evaluate(() => selected.size === 1 && selected.has('space-back') && !inlineWritingOpen()), '真实三维再次 Alt 点击选到底下组件，不误开编辑')
  const eraseSpace = async (id, at) => {
    const original = await snapshot(), originalElements = JSON.parse(original).elements
    await page.locator('[data-tool="eraser"]').click(); await page.evaluate(() => { $('eraser-size').value = '48' })
    await page.mouse.click(at.x, at.y); await spaceReady()
    const edited = await snapshot(), current = JSON.parse(edited).elements.find(e => e.id === id)
    check(current?.erasures?.length > 0, '真实三维鼠标橡皮修改 ' + id + ' 的局部表面')
    check(await page.evaluate(elements => board.elements.length === elements.length && elements.every(before => { const after = structuredClone(get(before.id)); delete after.erasures; delete before.erasures; return JSON.stringify(after) === JSON.stringify(before) }), originalElements), '擦除 ' + id + ' 保留原对象、表达、源码和笔顺')
    await page.keyboard.press('Control+z'); await spaceReady()
    check(await snapshot() === original, '三维擦除 ' + id + ' 可一次撤销恢复完整数据')
    await page.keyboard.press('Control+Shift+z'); await spaceReady()
    check(await snapshot() === edited, '三维擦除 ' + id + ' 重做只恢复同一次擦痕')
  }
  await eraseSpace('space-front', sharedPoint)
  const wordHit = await page.evaluate(() => {
    const e = get('space-words'), rect = spaceHost().getBoundingClientRect()
    for (let v = .12; v < .88; v += .04) for (let u = .1; u < .9; u += .04) {
      const q = spaceState.engine.project({ x: e.x + e.width * u, y: e.y + e.height * v, z: e.z || 0 }), x = rect.left + q.x, y = rect.top + q.y
      if (spaceState.engine.pick(x, y) === e.id) return { x, y }
    }
    return null
  })
  check(!!wordHit, '三维文字的真实可见墨迹可以命中')
  await eraseSpace('space-words', wordHit)
  await eraseSpace('space-picture', await spaceScreen({ x: 550, y: 295, z: 30 }))
  const sharedData = await snapshot()
  await page.locator('#space-back').click(); await page.locator('[data-tool="select"]').click(); await paint()
  const paperHole = await screen({ x: 96, y: 111.6 }), paperColor = (await pixels()).at(paperHole.x, paperHole.y)
  check(await snapshot() === sharedData && await page.locator('g.element[data-id="space-front"] mask').count() > 0 && (paperColor[2] < 180 || paperColor.every(value => value > 180)), '真实三维擦痕返回二维后使用同一数据，并真实显示局部孔洞')
  await page.locator('#space-enter').click(); await spaceReady()
  check(await snapshot() === sharedData, '同一画面再次进入三维不重复新增遮罩或改变原内容')

  await page.locator('#space-back').click()
  const solid = { id: 'side-solid', type: 'rect', x: 0, y: 0, z: 0, width: 280, height: 180, extrusion: 160, text: '', fill: '#2563eb', stroke: '#2563eb', anchors: [{ file: 'synthetic-solid.js' }] }
  await load([solid]); await page.locator('#space-enter').click(); await spaceReady(); await page.locator('#space-angle').click(); await spaceReady()
  const side = await spaceScreen({ x: 0, y: 90, z: 80 }), solidBefore = await snapshot()
  await page.locator('[data-tool="eraser"]').click(); await page.evaluate(() => { $('eraser-size').value = '34' }); await page.mouse.click(side.x, side.y); await spaceReady()
  const solidState = await page.evaluate(side => ({ edits: structuredClone(get('side-solid').erasures || []), pick: spaceState.engine.pick(side.x,side.y), node: document.elementFromPoint(side.x,side.y)?.outerHTML.slice(0,250), direction: spaceState.engine.viewDirection(), tool, message:$('toast').textContent }), side)
  const solidEdits=solidState.edits, sideErased = solidEdits.some(stroke => stroke.points.some(p => p.length === 3 && p[2] > .1 && p[2] < .9) && stroke.radius.length === 3)
  if(!sideErased)await page.screenshot({path:'/tmp/anatomy-solid-controller-failure.png'})
  check(sideErased, '实体侧面经真实鼠标擦除生成三维体积路径，保留中间深度' + (sideErased?'':'：'+JSON.stringify({side,...solidState})))
  check(await page.evaluate(() => board.elements.length === 1 && get('side-solid').id === 'side-solid' && get('side-solid').extrusion === 160 && get('side-solid').anchors[0].file === 'synthetic-solid.js'), '任意实体面擦除保留原立体结构和源码映射')
  await page.keyboard.press('Control+z'); await spaceReady()
  check(await snapshot() === solidBefore, '实体侧面的三维局部擦除可一次完整撤销')
  check(errors.length === 0, '统一表面真实编辑无浏览器脚本异常：' + errors.join('; '))
  if (process.env.ANATOMY_SURFACE_SCREENSHOT) await page.screenshot({ path: process.env.ANATOMY_SURFACE_SCREENSHOT })
  console.log(passed + ' surface browser checks passed')
} finally {
  await browser.close()
}
