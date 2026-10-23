// Verify erasures against actual GPU pixels as well as ray and area selection.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.ANATOMY_PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../', import.meta.url))
const browser = await chromium.launch({ headless: true, ...(process.env.ANATOMY_BROWSER_EXECUTABLE ? { executablePath: process.env.ANATOMY_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } }), errors = []
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.setContent('<style>body{margin:0}#h{width:1000px;height:720px}</style><div id="h"></div>')
  await page.addScriptTag({ path: root + 'lib/vendor/three-space.js' })
  for (const name of ['surface.js', 'board-space.js']) await page.addScriptTag({ content: (await readFile(root + 'lib/' + name, 'utf8')).replace(/^export /gm, '') })
  await page.addScriptTag({ path: root + 'lib/board-space-renderer.js' })
  const result = await page.evaluate(async () => {
    const engine = createSpaceRenderer(document.getElementById('h')), checks = {}
    const back = { id: 'back', type: 'rect', x: 0, y: 0, z: -20, width: 240, height: 180, fill: '#ef4444', stroke: '#ef4444' }
    const front = { ...back, id: 'front', z: 20, fill: '#2563eb', stroke: '#2563eb' }
    const at = p => engine.project(p)
    const pick = p => { const q = at(p); return engine.pick(q.x, q.y) }
    const pixel = p => {
      engine.orbit(0, 0); engine.draw()
      const q = at(p), c = document.createElement('canvas'); c.width = 1000; c.height = 720
      c.getContext('2d').drawImage(engine.canvas, 0, 0, 1000, 720)
      return [...c.getContext('2d').getImageData(Math.round(q.x), Math.round(q.y), 1, 1).data]
    }
    engine.sync({ elements: [back, front] }, []); engine.fit(true); engine.draw()
    const middle = { x: 120, y: 90, z: 20 }, q = at(middle)
    checks.overlapStack = JSON.stringify(engine.pickAll(q.x, q.y)) === JSON.stringify(['front', 'back'])
    checks.frontBlue = pixel(middle)[2] > 200
    appendSurfaceErasure(front, { surface: 'body', points: [[.5, .5]], radius: [.16, .2] })
    engine.sync({ elements: [back, front] }, [])
    checks.holeSelectsBack = pick(middle) === 'back'
    const red = pixel(middle); checks.holeReallyRendersBack = red[0] > 200 && red[2] < 100
    checks.remainingPaint = pick({ x: 40, y: 90, z: 20 }) === 'front'
    checks.regionInsideHole = !engine.pickRegion([{ x: q.x - 3, y: q.y - 3 }, { x: q.x + 3, y: q.y - 3 }, { x: q.x + 3, y: q.y + 3 }, { x: q.x - 3, y: q.y + 3 }]).includes('front')
    front.x += 20; front.width *= 1.4; front.rotation = 27
    engine.sync({ elements: [back, front] }, [])
    const movedHole = spacePosePoint(front, { x: front.x + front.width / 2, y: front.y + front.height / 2, z: front.z })
    checks.holeFollowsTransform = pick(movedHole) !== 'front'
    const solid = { id: 'solid', type: 'rect', x: 0, y: 0, z: 0, width: 240, height: 180, extrusion: 100, fill: '#2563eb', stroke: '#2563eb', rotationX: 15, rotationY: 20 }
    const inner = { id: 'inner', type: 'rect', x: 0, y: 0, z: 85, width: 240, height: 180, fill: '#22c55e', stroke: '#22c55e', rotationX: 15, rotationY: 20 }
    // Keep the green surface parallel, exactly 15 units inside the solid.
    const shift = spaceRotateVector({ x: 0, y: 0, z: 85 }, solid)
    inner.x = shift.x; inner.y = shift.y; inner.z = shift.z
    engine.sync({ elements: [inner, solid] }, []); engine.fit(true)
    const cap = spacePosePoint(solid, { x: 120, y: 90, z: 100 }), capPoint = at(cap)
    checks.solidCapBefore = pixel(cap)[2] > 200
    const sample = engine.eraseSamples(capPoint.x, capPoint.y, 24).find(s => s.id === 'solid')
    checks.volumetricSample = sample?.points[0].length === 3 && sample.radius.length === 3 && sample.points[0][2] > .95
    if (sample) appendSurfaceErasure(solid, sample)
    engine.sync({ elements: [inner, solid] }, [])
    const green = pixel(cap); checks.volumeHoleRevealsInterior = green[1] > 160 && green[2] < 150
    checks.volumeHolePick = pick(cap) === 'inner'
    checks.solidRemains = pick(spacePosePoint(solid, { x: 35, y: 40, z: 100 })) === 'solid'
    const imageCanvas = document.createElement('canvas'); imageCanvas.width = imageCanvas.height = 64; imageCanvas.getContext('2d').fillRect(0, 0, 64, 64)
    const image = { ...back, id: 'image', type: 'image', z: 50, image: { src: imageCanvas.toDataURL(), width: 64, height: 64, alt: '图片' }, formulaGraphic: {} }
    engine.sync({ elements: [back, image] }, []); engine.fit(true); await new Promise(r => setTimeout(r, 80))
    appendSurfaceErasure(image, { surface: 'body', points: [[.5, .5]], radius: [.12, .15] }); engine.sync({ elements: [back, image] }, [])
    checks.imageHole = pick({ x: 120, y: 90, z: 50 }) === 'back' && pixel({ x: 120, y: 90, z: 50 })[0] > 200
    checks.imagePaintRemains = pick({ x: 40, y: 90, z: 50 }) === 'image'
    const relation = { id: 'scaled-label', type: 'arrow', x: 0, y: 0, width: 1000, height: 0, text: '关系说明', fontSize: 16 }
    engine.sync({ elements: [relation] }, []); engine.fit(true)
    for (const [index, factor] of [1, .3, 3].entries()) {
      engine.zoom(factor); engine.draw()
      const geometry = engine.labelGeometry(relation.id), bounds = geometry.bounds, sample = engine.eraseSamples(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, 10).find(s => s.id === relation.id && s.surface === 'label')
      checks['labelBrushFollowsZoom' + index] = !!sample && Math.abs(sample.radius[0] * bounds.width - 10) < 1e-5 && Math.abs(sample.radius[1] * bounds.height - 10) < 1e-5
    }
    const freeLink = { id: 'rotating-mask-link', type: 'line', x: 0, y: 0, z: 0, width: 400, height: 0, strokeWidth: 4, erasures: [{ surface: 'body', points: [[.25, 0]], radius: [.04, 10] }] }
    for (const rotation of [0, 180]) {
      freeLink.rotation = rotation; engine.sync({ elements: [freeLink] }, []); engine.fit(true); engine.draw()
      checks['linkHoleFollowsRotation' + rotation] = pick(spacePosePoint(freeLink, { x: 100, y: 0, z: 0 })) === null && pick(spacePosePoint(freeLink, { x: 300, y: 0, z: 0 })) === freeLink.id
    }
    const brushBase = { id: 'brush-base', type: 'rect', x: 0, y: 0, z: 0, width: 500, height: 500, fill: '#2563eb' }
    engine.sync({ elements: [brushBase] }, []); engine.fit(true); engine.draw()
    const brushRadius = 100, brushCenter = at({ x: 250, y: 250, z: 0 }), smallCenter = engine.unprojectView(brushCenter.x + brushRadius * .4, brushCenter.y + brushRadius * .4, { x: 250, y: 250, z: 0 }), smallWidth = 40 / at(smallCenter).scale
    const sparseCanvas = document.createElement('canvas'); sparseCanvas.width = sparseCanvas.height = 64; sparseCanvas.getContext('2d').fillRect(49, 14, 4, 4)
    const tiny = { id: 'tiny-brush-image', type: 'image', x: smallCenter.x - smallWidth / 2, y: smallCenter.y - smallWidth / 2, z: 1, width: smallWidth, height: smallWidth, image: { src: sparseCanvas.toDataURL(), width: 64, height: 64, alt: '小图片' }, formulaGraphic: {} }
    engine.sync({ elements: [brushBase, tiny] }, []); await new Promise(resolve => setTimeout(resolve, 80)); engine.draw()
    const tinyInk = { x: tiny.x + tiny.width * 51 / 64, y: tiny.y + tiny.height * 16 / 64, z: tiny.z }, tinyScreen = at(tinyInk)
    checks.tinyImageVisibleInsideBrush = pick(tinyInk) === tiny.id && Math.hypot(tinyScreen.x - brushCenter.x, tinyScreen.y - brushCenter.y) < brushRadius
    const tinySample = engine.eraseSamples(brushCenter.x, brushCenter.y, brushRadius).find(sample => sample.id === tiny.id)
    checks.brushFindsSparseImageBetweenProbeRays = !!tinySample
    if (tinySample) appendSurfaceErasure(tiny, tinySample)
    engine.sync({ elements: [brushBase, tiny] }, [])
    const tinyAfter = pixel(tinyInk); checks.sparseImageReallyErased = pick(tinyInk) === brushBase.id && tinyAfter[2] > 180 && tinyAfter[0] < 100
    const beforeDispose = engine.info(); engine.dispose()
    return { checks, beforeDispose }
  })
  for (const [name, passed] of Object.entries(result.checks)) assert.equal(passed, true, name)
  assert.deepEqual(errors, [])
  console.log(Object.keys(result.checks).length + ' surface GPU checks passed; no browser errors')
} finally { await browser.close() }
