// Exercise the ordinary canvas entry points and preserve an authored visual
// composition through fonts, images and selected project versions.
import assert from 'node:assert/strict'
import { renderAnatomy } from '../lib/render.js'

const { chromium } = await import(process.env.ANATOMY_PLAYWRIGHT_MODULE || 'playwright')
const imageSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
let passed = 0
const check = (value, label) => { assert.ok(value, label); passed++; console.log('✓ ' + label) }
const mixed = {
  version: 1,
  elements: [
    { id: 'reference', type: 'image', x: 0, y: 0, width: 600, height: 450, image: { src: imageSource, width: 3, height: 2, alt: '界面参考截图' }, text: '' },
    { id: 'annotation', type: 'text', x: 80, y: 60, width: 220, height: 90, text: '这里需要能直接圈改。' },
    { id: 'sketch-line', type: 'line', x: 70, y: 170, width: 350, height: 80 },
    { id: 'second-topic', type: 'text', x: 920, y: 180, width: 240, height: 110, text: '另一处需要讨论的行为。' },
  ],
  reading: { summary: '围绕界面参考与局部问题共同推敲。', steps: [{ element: 'annotation', title: '局部问题', description: '在截图上直接表达修改意图。' }] },
}
const alternate = structuredClone(mixed)
alternate.elements[1].x = 140
alternate.elements[1].text = '历史版本中的局部问题。'
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ANATOMY_BROWSER_EXECUTABLE ? { executablePath: process.env.ANATOMY_BROWSER_EXECUTABLE } : {}),
  args: ['--no-sandbox'],
})
try {
  const errors = []
  const open = async (board, slug) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('pageerror', error => errors.push(error.message))
    const html = renderAnatomy({ slug, title: '人机共同画板', board }, [], [])
    let selected = null
    const versions = [{ id: 'initial', label: '原画面', createdAt: new Date().toISOString() }, { id: 'other', label: '另一画面', createdAt: new Date().toISOString() }]
    await page.route('http://authoring.test/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: html })
      let result = { ok: true }
      if (path === '/api/versions/select') selected = { id: JSON.parse(route.request().postData()).id, revision: 'chosen-version' }
      if (path.startsWith('/api/versions')) result = { ok: true, selected, versions, ...(path === '/api/versions/select' ? { board: alternate } : {}) }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) })
    })
    await page.goto('http://authoring.test/')
    await page.waitForFunction(() => !!window.__anatomyBoard && !!window.MathJax?.startup?.promise)
    await page.evaluate(async () => { await window.MathJax.startup.promise; if (document.fonts?.ready) await document.fonts.ready })
    return page
  }
  const blank = await open({ version: 1, elements: [] }, 'blank-authoring')
  check(await blank.locator('#empty').isVisible() && await blank.locator('#empty button').count() === 3, '空白画板提供写需求、画草图、放图片的真实入口')
  check(await blank.locator('#manual-layout').isChecked(), '未指定布局的空白画板默认保留自由位置')
  await blank.locator('[data-empty-action="text"]').click()
  check(await blank.locator('#empty').isHidden() && await blank.evaluate(() => tool === 'text'), '写需求入口切换到文字工具并让出画面')
  const area = await blank.locator('#surface').boundingBox()
  await blank.mouse.click(area.x + area.width * .35, area.y + area.height * .35)
  await blank.locator('#paper-prose').fill('我想直接在截图上圈出需要修改的地方。')
  await blank.locator('#paper-confirm').click()
  check(await blank.evaluate(() => board.elements.length === 1 && board.elements[0].type === 'text' && board.elements[0].text.includes('圈出')), '空白需求直接成为可修改的画面内容，不生成矩形或箭头')
  await blank.close()

  const sketch = await open({ version: 1, elements: [] }, 'blank-sketch')
  await sketch.locator('[data-empty-action="pen"]').click()
  const sketchArea = await sketch.locator('#surface').boundingBox()
  await sketch.mouse.move(sketchArea.x + 180, sketchArea.y + 200)
  await sketch.mouse.down()
  await sketch.mouse.move(sketchArea.x + 260, sketchArea.y + 230, { steps: 5 })
  await sketch.mouse.up()
  check(await sketch.evaluate(() => board.elements.length === 1 && board.elements[0].type === 'pen'), '画草图入口可直接保留自由笔迹')
  await sketch.close()

  const picture = await open({ version: 1, elements: [] }, 'blank-picture')
  const cancelPicking = picture.waitForEvent('filechooser')
  await picture.locator('[data-empty-action="image"]').click()
  await (await cancelPicking).setFiles([])
  check(await picture.locator('#empty').isVisible() && await picture.evaluate(() => board.elements.length === 0 && tool === 'select'), '取消插图保留空白画板，仍可选择写需求或画草图')
  const picking = picture.waitForEvent('filechooser')
  await picture.locator('[data-empty-action="image"]').click()
  await (await picking).setFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(imageSource.split(',')[1], 'base64') })
  await picture.waitForFunction(() => board.elements.length === 1)
  check(await picture.evaluate(() => board.elements[0].type === 'image'), '放图片入口复用现有本地图片导入')
  await picture.close()

  const page = await open(mixed, 'mixed-authoring')
  const snapshot = () => page.evaluate(() => JSON.stringify(board))
  check(await snapshot() === JSON.stringify(mixed), '截图、叠加注释与草线在首次打开及字体就绪后保持原坐标')
  check(await page.evaluate(() => readingIndex === -1 && selected.size === 0) && await page.locator('#reading-card').isHidden(), '初始展示全幅画面，导读由人主动进入')
  check(await page.evaluate(() => {
    const r = surface.getBoundingClientRect()
    return board.elements.every(e => e.x * view.scale + view.x >= 0 && e.y * view.scale + view.y >= 0 && (e.x + e.width) * view.scale + view.x <= r.width && (e.y + e.height) * view.scale + view.y <= r.height)
  }), '默认全图视野包含分开的讨论内容')
  await page.locator('#open-reading').click()
  check(!(await page.locator('#reading-content').innerText()).includes('关系待说明'), '自由草线不产生待补关系警告')
  await page.locator('[data-reading-step="0"]').click()
  check(await page.locator('#reading-card').isVisible() && await page.evaluate(() => selected.has('annotation')), '可主动沿导读定位截图上的局部内容')
  await page.locator('#reading-stop').click()
  const files = page.waitForEvent('filechooser')
  await page.locator('#insert-image').click()
  await (await files).setFiles({ name: 'another.png', mimeType: 'image/png', buffer: Buffer.from(imageSource.split(',')[1], 'base64') })
  await page.waitForFunction(() => board.elements.length === 5)
  check(await page.evaluate(original => JSON.stringify(board.elements.slice(0, 4)) === JSON.stringify(original), mixed.elements), '插图不会重新排布原截图、重叠注释与草线')
  await page.locator('#undo').click()
  check(await snapshot() === JSON.stringify(mixed), '插图可一步撤销恢复完整画面')
  await page.locator('#auto-layout').click()
  check(await page.evaluate(() => board.layout.mode === 'auto') && !(await page.locator('#manual-layout').isChecked()), '明确选择自动排布后仍可启用结构避让')
  await page.locator('#undo').click()
  check(await snapshot() === JSON.stringify(mixed), '显式自动排布可撤销回自由构图')
  await page.locator('#versions').click()
  await page.evaluate(() => refreshProjectVersions(true))
  await page.locator('#version-list').selectOption('other')
  await page.locator('#version-choice').click()
  await page.waitForFunction(() => versionSession.selected?.id === 'other').catch(async error => { console.log(await page.evaluate(() => ({ selected: versionSession.selected, error: versionSession.error, dirty: projectUnsaved(), toast: $('toast').textContent, value: $('version-list').value }))); throw error })
  check(await snapshot() === JSON.stringify(alternate) && await page.evaluate(() => readingIndex === -1 && selected.size === 0), '切换缺省布局版本保持原构图，展示全图而非自动进入第一步')
  check(await page.locator('#manual-layout').isChecked(), '历史画面缺省布局也保持自由布局')
  check(errors.length === 0, '完整人机画板入口无浏览器脚本异常：' + errors.join('; '))
  if (process.env.ANATOMY_SCREENSHOT) await page.screenshot({ path: process.env.ANATOMY_SCREENSHOT })
  console.log(passed + ' authoring browser checks passed')
} finally {
  await browser.close()
}
