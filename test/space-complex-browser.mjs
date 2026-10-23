// Real GPU checks for readable engineering diagrams. Fixtures are synthetic;
// no generated user board, source mapping, screenshot, or project is imported.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.ANATOMY_PLAYWRIGHT_MODULE || 'playwright')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function complexBoard() {
  const elements = [
    { id: 'whole', type: 'frame', x: -80, y: -70, width: 1980, height: 1090, text: '工程全貌：输入、转换、核对与输出应能在同一张图上阅读', fontSize: 21 },
    { id: 'input-zone', type: 'frame', x: -40, y: 0, width: 940, height: 950, text: '输入与转换分区：保留原始事实并形成候选', fontSize: 19 },
    { id: 'output-zone', type: 'frame', x: 940, y: 0, width: 920, height: 950, text: '核对与输出分区：确认后保存完整结果', fontSize: 19 },
  ]
  for (let i = 0; i < 8; i++) elements.push({
    id: 'stage-' + i, type: 'rect', x: (i % 4) * 490, y: 100 + Math.floor(i / 4) * 570,
    width: 350, height: 180, fill: '#eef2ff', stroke: '#6366f1', fontSize: 18,
    text: '阶段' + i + '：读取已有事实，保留作者写下的边界与说明。确认输入后形成候选，记录尚不明确的条件，再交给下一阶段核对。',
  })
  elements.push({
    id: 'long-card', type: 'rect', x: 450, y: 360, width: 330, height: 115,
    fill: '#ecfdf5', stroke: '#059669', fontSize: 21,
    text: '首段：所有原始说明都应完整显示。\n第二段：长中文需要按可用空间排版，不能悄悄丢掉最后几行，也不能让公式把说明挤出边界。\n末段：最后这一句仍然属于用户内容，需要在聚焦后清楚可见。',
    math: String.raw`\frac{a_1+a_2+a_3}{b_1+b_2+b_3}=\sqrt{c_1^2+c_2^2}`,
    mathExpressions: [{ id: 'sum', value: String.raw`S=\sum_{i=1}^{n}x_i^2` }],
  })
  const pairs = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [0, 7]]
  pairs.forEach(([from, to], i) => elements.push({
    id: 'relation-' + i, type: 'arrow', from: 'stage-' + from, to: 'stage-' + to,
    x: 0, y: 0, width: 1, height: 1, stroke: '#64748b', fontSize: 18,
    text: '关系' + i + '：传递已经核对的完整结果，并保留输入条件、来源说明与仍需确认的边界',
  }))
  return { version: 1, layout: { mode: 'manual' }, elements }
}

function largeBoard() {
  const elements = []
  for (let group = 0; group < 14; group++) {
    const x = (group % 4) * 1700, y = Math.floor(group / 4) * 1450
    elements.push({ id: 'group-' + group, type: 'frame', x, y, width: 1350, height: 1120, text: '工程分区' + group + '：输入条件、处理结果与核对依据', fontSize: 22 })
    for (let node = 0; node < 5; node++) elements.push({
      id: 'large-' + group + '-' + node, type: 'rect', x: x + 80 + (node % 2) * 630, y: y + 120 + Math.floor(node / 2) * 310,
      width: 510, height: 170, fontSize: 19, fill: '#f0fdf4', stroke: '#059669',
      text: '部位' + group + '之' + node + '：读取完整说明并保留作者的原始位置。聚焦这一部位后，文字应重新清晰，其他分区的大小不应决定当前文字的像素质量。',
    })
  }
  for (let i = 0; i < 55; i++) {
    const a = i % 70, b = (i + 1) % 70
    elements.push({ id: 'large-edge-' + i, type: 'arrow', from: 'large-' + Math.floor(a / 5) + '-' + a % 5, to: 'large-' + Math.floor(b / 5) + '-' + b % 5, x: 0, y: 0, width: 1, height: 1, text: '结果交接' + i, stroke: '#64748b' })
  }
  elements.push({ id: 'large-note', type: 'text', x: 100, y: -160, width: 1200, height: 100, fontSize: 24, text: '大工程总览之后仍然可以聚焦任意部位，阅读完整的中文说明。' })
  assert.equal(elements.length, 140)
  return { version: 1, layout: { mode: 'manual' }, elements }
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.ANATOMY_BROWSER_EXECUTABLE ? { executablePath: process.env.ANATOMY_BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  if (process.env.ANATOMY_COMPLEX_SCREENSHOT) await page.exposeFunction('complexScreenshot', phase => page.screenshot({ path: process.env.ANATOMY_COMPLEX_SCREENSHOT.replace(/\.png$/i, '') + '-' + phase + '.png' }))
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setContent('<style>body{margin:0}#h{position:absolute;left:20px;top:20px;width:1400px;height:960px}</style><div id="h"></div>')
  await page.addScriptTag({ path: root + '/lib/vendor/three-space.js' })
  await page.addScriptTag({ content: (await readFile(root + '/lib/board-space.js', 'utf8')).replace(/^export /gm, '') })
  await page.addScriptTag({ path: root + '/lib/vendor/katex.cjs' })
  await page.addScriptTag({ content: (await readFile(root + '/lib/math.js', 'utf8')).replace(/^export /gm, '') })
  await page.evaluate(() => { window.MathJax = { startup: { typeset: false }, svg: { fontCache: 'local' }, options: { enableMenu: false } } })
  await page.addScriptTag({ path: root + '/lib/vendor/mathjax-tex-svg.js' })
  const graphics = await readFile(root + '/lib/board-graphics-client.js', 'utf8')
  await page.addScriptTag({ content: graphics.slice(0, graphics.indexOf('\nfunction formulaImageElement')) })
  await page.addScriptTag({ path: root + '/lib/board-space-renderer.js' })

  const result = await page.evaluate(async ({ diagram, large }) => {
    await document.fonts.ready
    const checks = {}, metrics = {}, host = document.getElementById('h')
    let renderedScene = null
    const normalized = value => String(value || '').replace(/\s/g, '')
    const nativeText = CanvasRenderingContext2D.prototype.fillText
    const nativeImage = CanvasRenderingContext2D.prototype.drawImage
    const nativeClear = CanvasRenderingContext2D.prototype.clearRect
    const nativeAdd = AnatomyThree.Group.prototype.add
    const attached = []
    const boxOf = points => {
      const xs = points.map(p => p.x), ys = points.map(p => p.y)
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    }
    const corners = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
    function rasterBox(context, x, y, w, h) {
      const transform = context.getTransform()
      return boxOf(corners(x, y, w, h).map(p => transform.transformPoint(p)))
    }
    // Observe actual native drawing calls. No wrapping, font fitting, or label
    // placement algorithm is duplicated in this test.
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      this.canvas.__readability = { text: [], images: [] }
      return nativeClear.apply(this, args)
    }
    CanvasRenderingContext2D.prototype.fillText = function (value, x, y, maxWidth) {
      const measured = this.measureText(value), horizontal = maxWidth > 0 ? Math.min(1, maxWidth / Math.max(1, measured.width)) : 1
      const left = x - measured.actualBoundingBoxLeft * horizontal, top = y - measured.actualBoundingBoxAscent
      const bounds = rasterBox(this, left, top, (measured.actualBoundingBoxLeft + measured.actualBoundingBoxRight) * horizontal, measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent)
      ;(this.canvas.__readability ||= { text: [], images: [] }).text.push({ value: String(value), bounds })
      return nativeText.apply(this, arguments)
    }
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
      let destination
      if (args.length === 2) destination = [...args, source.naturalWidth || source.width, source.naturalHeight || source.height]
      else if (args.length === 4) destination = args
      else if (args.length === 8) destination = args.slice(4)
      if (destination) (this.canvas.__readability ||= { text: [], images: [] }).images.push(rasterBox(this, ...destination))
      return nativeImage.apply(this, arguments)
    }
    AnatomyThree.Group.prototype.add = function (...objects) { attached.push(...objects); return nativeAdd.apply(this, objects) }
    const engine = window.complexEngine = createSpaceRenderer(host)
    const settle = async () => {
      engine.draw()
      const until = performance.now() + 15000
      while (engine.info().pendingImages && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 20))
      engine.draw()
      if (engine.info().pendingImages) throw Error('formula textures did not finish loading')
    }
    const scene = () => renderedScene ||= attached.find(node => node.userData.spaceId)?.parent?.parent?.parent
    const textMeshes = () => {
      const meshes = []
      scene()?.traverse(node => { if (node.userData.spaceId && node.material?.map?.image?.getContext) meshes.push(node) })
      return meshes
    }
    const meshFor = id => textMeshes().find(mesh => mesh.userData.spaceId === id)
    const visible = mesh => {
      if (!mesh) return false
      for (let part = mesh; part; part = part.parent) if (!part.visible) return false
      return true
    }
    const projected = mesh => {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const bounds = mesh.geometry.boundingBox
      return boxOf(corners(bounds.min.x, bounds.min.y, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y).map(p => {
        const world = new AnatomyThree.Vector3(p.x, p.y, bounds.min.z).applyMatrix4(mesh.matrixWorld)
        return engine.project({ x: world.x, y: -world.y, z: world.z })
      }))
    }
    const intersection = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
    const fitsRaster = (bounds, canvas) => bounds.x >= -2 && bounds.y >= -2 && bounds.x + bounds.width <= canvas.width + 2 && bounds.y + bounds.height <= canvas.height + 2
    const sourceComplete = element => {
      const raster = meshFor(element.id)?.material.map.image
      return !!raster && normalized(raster.__readability?.text.map(call => call.value).join('')) === normalized(element.text) && raster.__readability.text.every(call => fitsRaster(call.bounds, raster))
    }
    const gpuPixels = () => {
      engine.draw()
      const copy = document.createElement('canvas'); copy.width = engine.canvas.width; copy.height = engine.canvas.height
      const context = copy.getContext('2d'); context.drawImage(engine.canvas, 0, 0)
      return { width: copy.width, height: copy.height, data: context.getImageData(0, 0, copy.width, copy.height).data }
    }
    const pixel = (capture, x, y) => {
      x = Math.max(0, Math.min(capture.width - 1, Math.round(x))); y = Math.max(0, Math.min(capture.height - 1, Math.round(y)))
      return Array.from(capture.data.slice((y * capture.width + x) * 4, (y * capture.width + x) * 4 + 4))
    }
    const dark = color => color[0] < 120 && color[1] < 140 && color[2] < 170 && color[3] > 0
    const visibleInk = (capture, rect) => {
      let count = 0
      for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(capture.height, rect.y + rect.height); y++) for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(capture.width, rect.x + rect.width); x++) if (dark(pixel(capture, x, y))) count++
      return count
    }
    function rasterInkVisible(mesh, bounds, capture) {
      const canvas = mesh.material.map.image, context = canvas.getContext('2d')
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const geometry = mesh.geometry.boundingBox
      let sampled = 0, shown = 0
      const ink = []
      // Select from actual opaque glyph pixels. A regular grid can miss a
      // thin formula entirely even while the formula is visibly complete.
      for (let y = Math.max(0, Math.floor(bounds.y)); y < Math.min(canvas.height, bounds.y + bounds.height); y++) for (let x = Math.max(0, Math.floor(bounds.x)); x < Math.min(canvas.width, bounds.x + bounds.width); x++) {
        const offset = (y * canvas.width + x) * 4
        if (data[offset + 3] < 180 || !dark(Array.from(data.slice(offset, offset + 4)))) continue
        ink.push({ x, y })
      }
      const stride = Math.max(1, Math.ceil(ink.length / 100))
      for (let index = 0; index < ink.length; index += stride) {
        const { x, y } = ink[index]
        const u = (x + .5) / canvas.width, v = 1 - (y + .5) / canvas.height
        const world = new AnatomyThree.Vector3(geometry.min.x + u * (geometry.max.x - geometry.min.x), geometry.min.y + v * (geometry.max.y - geometry.min.y), geometry.min.z).applyMatrix4(mesh.matrixWorld)
        const at = engine.project({ x: world.x, y: -world.y, z: world.z })
        if (at.x < 0 || at.y < 0 || at.x >= capture.width || at.y >= capture.height) continue
        sampled++
        if ([-1, 0, 1].some(dx => [-1, 0, 1].some(dy => dark(pixel(capture, at.x + dx, at.y + dy))))) shown++
      }
      return { rasterInkPixels: ink.length, sampled, shown, visible: sampled >= 2 && shown >= Math.max(2, sampled * .15) }
    }
    const rig = { visible: false, drawing: false, tip: { x: 400, y: 400, z: 100 }, anchors: [{ x: -300, y: -300, z: 0 }, { x: 2400, y: -300, z: 0 }, { x: 2400, y: 1800, z: 300 }, { x: -300, y: 1800, z: 300 }] }
    engine.setPenRig(rig)
    const rigState = () => JSON.stringify({ tip: engine.info().penRig.tip, anchors: engine.info().penRig.anchors })
    const originalRig = rigState(), originalDiagram = JSON.stringify(diagram)
    engine.sync(diagram, []); engine.fit(true); await settle()

    checks.completeLongChinese = diagram.elements.every(sourceComplete)
    const longMesh = meshFor('long-card'), longRaster = longMesh?.material.map.image
    checks.completeFormulaImages = !!longRaster && longRaster.__readability.images.length === 2 && longRaster.__readability.images.every(bounds => bounds.width > 2 && bounds.height > 2 && fitsRaster(bounds, longRaster))
    function layoutReport(board) {
      const labels = board.elements.filter(e => e.type === 'arrow').map(e => ({ id: e.id, visible: visible(meshFor(e.id)), bounds: meshFor(e.id) ? projected(meshFor(e.id)) : null }))
      const nodes = board.elements.filter(e => e.type === 'rect').map(e => ({ id: e.id, bounds: boxOf(corners(e.x, e.y, e.width, e.height).map(p => engine.project({ ...p, z: e.z || 0 }))) }))
      for (const element of board.elements.filter(e => e.type === 'frame')) if (meshFor(element.id)) nodes.push({ id: element.id, bounds: projected(meshFor(element.id)) })
      const conflicts = []
      for (const label of labels) {
        if (!label.bounds || !label.visible) { conflicts.push([label.id, 'missing-visible-label']); continue }
        for (const node of nodes) if (intersection(label.bounds, node.bounds) > 1) conflicts.push([label.id, node.id])
        for (const other of labels) if (other.bounds && other.id > label.id && intersection(label.bounds, other.bounds) > 1) conflicts.push([label.id, other.id])
      }
      return { labels: labels.length, visible: labels.filter(label => label.visible).length, conflicts, inside: labels.every(({ bounds: b }) => b && b.x >= -1 && b.y >= -1 && b.x + b.width <= host.clientWidth + 1 && b.y + b.height <= host.clientHeight + 1) }
    }
    const topLayout = layoutReport(diagram), overviewPixels = gpuPixels()
    checks.denseLabelsAvoidNodesAndEachOther = !topLayout.conflicts.length && topLayout.inside
    checks.denseLabelsActuallyVisible = diagram.elements.filter(e => e.type === 'arrow').every(e => visibleInk(overviewPixels, projected(meshFor(e.id))) > 5)
    metrics.topLayout = topLayout
    if (window.complexScreenshot) await window.complexScreenshot('labels')
    engine.orbit(18, -25); await settle()
    const tiltedLayout = layoutReport(diagram)
    checks.labelsReflowAfterOrbit = !tiltedLayout.conflicts.length && tiltedLayout.inside
    metrics.tiltedLayout = tiltedLayout
    engine.fit(true, 'long-card'); await settle()
    checks.longCardStillCompleteAfterFocus = sourceComplete(diagram.elements.find(e => e.id === 'long-card')) && visibleInk(gpuPixels(), projected(meshFor('long-card'))) > 100
    const focusedLong = meshFor('long-card'), focusedLongRaster = focusedLong.material.map.image, focusedLongPixels = gpuPixels()
    metrics.lastParagraph = rasterInkVisible(focusedLong, focusedLongRaster.__readability.text.at(-1).bounds, focusedLongPixels)
    metrics.lastFormula = focusedLongRaster.__readability.images.length === 2 ? rasterInkVisible(focusedLong, focusedLongRaster.__readability.images.at(-1), focusedLongPixels) : null
    checks.lastParagraphActuallyVisibleOnGPU = metrics.lastParagraph.visible
    checks.lastFormulaActuallyVisibleOnGPU = !!metrics.lastFormula?.visible
    if (window.complexScreenshot) await window.complexScreenshot('long-focus')
    checks.diagramAndRigUnchanged = JSON.stringify(diagram) === originalDiagram && rigState() === originalRig

    const originalLarge = JSON.stringify(large)
    engine.sync(large, []); engine.fit(true); await settle()
    const overview = meshFor('large-7-2'), overviewRaster = overview.material.map.image
    const overviewSize = [overviewRaster.width, overviewRaster.height]
    const overviewSampling = Math.min(overviewRaster.width / projected(overview).width, overviewRaster.height / projected(overview).height)
    const frameMeshes = textMeshes().filter(mesh => large.elements.find(e => e.id === mesh.userData.spaceId)?.type === 'frame')
    checks.frameTitlesDoNotAllocateFullContainerTextures = frameMeshes.length === 14 && frameMeshes.every(mesh => mesh.material.map.image.width / mesh.material.map.image.height > 5)
    engine.fit(true, 'large-7-2'); await settle()
    const focused = meshFor('large-7-2'), focusedRaster = focused.material.map.image, focusedBounds = projected(focused)
    const focusedSampling = Math.min(focusedRaster.width / focusedBounds.width, focusedRaster.height / focusedBounds.height)
    checks.focusRestoresScreenResolution = focusedSampling >= .95 && focusedRaster.width > overviewSize[0]
    checks.focusedLongTextRemainsComplete = sourceComplete(large.elements.find(e => e.id === 'large-7-2')) && visibleInk(gpuPixels(), focusedBounds) > 300
    metrics.focus = { overviewPixels: overviewSize, focusedPixels: [focusedRaster.width, focusedRaster.height], overviewSampling, focusedSampling }
    if (window.complexScreenshot) await window.complexScreenshot('large-focus')
    for (const id of ['large-0-0', 'large-13-4', 'large-3-2', 'large-7-2']) { engine.fit(false, id); await settle() }
    const largeInfo = engine.info()
    checks.textureRefreshStaysWithinBudget = Number.isFinite(largeInfo.textureBudget) && largeInfo.textureBytes <= largeInfo.textureBudget
    checks.largeBoardAndRigUnchanged = JSON.stringify(large) === originalLarge && rigState() === originalRig
    metrics.memory = { textureBytes: largeInfo.textureBytes, textureBudget: largeInfo.textureBudget, textures: largeInfo.textures }

    const red = { id: 'front-depth', type: 'rect', x: -10000, y: -10000, z: 1, width: 20000, height: 20000, fill: '#ef4444', stroke: '#ef4444' }
    const blue = { ...red, id: 'back-depth', z: 0, fill: '#3b82f6', stroke: '#3b82f6' }
    const depthSamples = []
    for (const elements of [[red, blue], [blue, red]]) {
      const depthBoard = { version: 1, elements }, before = JSON.stringify(depthBoard)
      engine.sync(depthBoard, []); engine.fit(true); engine.zoom(1 / 8); await settle()
      const capture = gpuPixels(), hostBox = host.getBoundingClientRect()
      for (const [x, y] of [[0, 0], [-3000, -3000], [3000, -3000], [-3000, 3000], [3000, 3000]]) {
        const at = engine.project({ x, y, z: 1 }), color = pixel(capture, at.x, at.y), picked = engine.pick(at.x + hostBox.left, at.y + hostBox.top)
        depthSamples.push({ color, picked, distance: engine.info().distance })
      }
      checks.depthNavigationDoesNotMutateSources = checks.depthNavigationDoesNotMutateSources !== false && JSON.stringify(depthBoard) === before && rigState() === originalRig
    }
    checks.distantOneUnitDepthMatchesVisibleAndPicked = depthSamples.every(({ color, picked }) => color[0] > 200 && color[1] < 100 && color[2] < 100 && picked === 'front-depth')
    metrics.depth = depthSamples

    // A valid wide diagram can fit farther away than an ordinary camera's
    // zoom limit. Its first wheel step must remain continuous and reversible.
    const wide = { elements: [
      { id: 'wide-a', type: 'rect', x: -900000, y: -900000, z: 0, width: 80000, height: 80000, fill: '#dbeafe' },
      { id: 'wide-b', type: 'rect', x: 900000, y: 900000, z: 0, width: 80000, height: 80000, fill: '#dcfce7' },
    ] }
    const wideSource = JSON.stringify(wide)
    engine.sync(wide, []); engine.fit(true); await settle()
    const wideBefore = engine.info(), wideTarget = JSON.stringify(wideBefore.target)
    engine.zoom(1.05); await settle()
    const wideZoomed = engine.info()
    engine.zoom(1 / 1.05); await settle()
    const wideRestored = engine.info(), closeDistance = (a, b) => Math.abs(a - b) <= wideBefore.distance * 1e-10
    checks.wideDiagramZoomContinuity = wideBefore.distance > 1e6 && closeDistance(wideZoomed.distance, wideBefore.distance / 1.05) && closeDistance(wideRestored.distance, wideBefore.distance) && JSON.stringify(wideZoomed.target) === wideTarget && JSON.stringify(wideRestored.target) === wideTarget
    checks.wideDiagramViewDoesNotMutateSources = JSON.stringify(wide) === wideSource && rigState() === originalRig
    metrics.wideZoom = { before: wideBefore.distance, zoomed: wideZoomed.distance, restored: wideRestored.distance }
    CanvasRenderingContext2D.prototype.fillText = nativeText
    CanvasRenderingContext2D.prototype.drawImage = nativeImage
    CanvasRenderingContext2D.prototype.clearRect = nativeClear
    AnatomyThree.Group.prototype.add = nativeAdd
    return { checks, metrics }
  }, { diagram: complexBoard(), large: largeBoard() })

  if (process.env.ANATOMY_COMPLEX_SCREENSHOT) await page.screenshot({ path: process.env.ANATOMY_COMPLEX_SCREENSHOT })
  console.log(JSON.stringify({ result, errors }, null, 2))
  if (errors.length || Object.values(result.checks).some(value => !value)) process.exitCode = 1
} finally {
  await browser.close()
}
