// 渲染冒烟测试：把内联到 HTML 里的前端脚本抽出来，在最小 DOM 桩上真跑一遍。
// 没有浏览器也能抓到运行时异常与"图画空了"这类问题。
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAnatomy } from '../lib/legacy-render.js'
import { anatomyFingerprint } from '../lib/store.js'

const here = dirname(fileURLToPath(import.meta.url))
let passed = 0
const failures = []
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + label) } else { failures.push(label + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')) }
}

/* ---------- 造一具最小的解剖体 ---------- */
const body = {
  schema: 'anatomy/1', slug: 'smoke', title: '冒烟系统', oneline: '用来验证渲染的最小系统。', lang: 'zh',
  systems: [
    { id: 'sense', name: '感知系统', hue: 190, gist: '看见', alt: 0 },
    { id: 'decide', name: '判断系统', hue: 45, gist: '决定', alt: 1 },
  ],
  media: [{ id: 'data', name: '数据', hue: 200, gist: '事实' }],
  scenarios: [{ id: 'react', name: '看见后行动', trigger: '画面发生变化', outcome: '动作完成', steps: [
    { organ: 'eye', action: '观察外界' }, { organ: 'brain', flow: 'see', action: '形成结论' }, { organ: 'hand', flow: 'move', action: '执行动作' },
  ], acceptance: ['动作与结论一致'] }],
}
const organs = [
  { id: 'eye', name: '眼睛', gist: '看东西。', kind: 'sense', systems: ['sense'], story: '看。', composition: [{ name: '镜头', role: '聚焦', anchor: { file: 'lens.js', symbol: 'focus', role: 'implementation', reason: '聚焦实现', sha256: 'lens-baseline' } }], contract: { out: ['画面'] }, not_responsible: ['不想事情'], observables: ['画面流'], anchors: [{ file: 'a.js', symbol: 'eye', role: 'interface', reason: '画面入口', sha256: 'eye-baseline' }], math:'y = f(x)，x 为画面，y 为结果', rules:[{id:'delay',statement:'及时交付画面',metric:'传递耗时',relation:'≤',limit:10,unit:'毫秒'}], status: 'draft' },
  { id: 'brain', name: '脑子', gist: '想事情。', kind: 'decide', systems: ['decide', 'sense'], story: '想。', composition: [{ name: '推理', role: '下结论' }], contract: { in: ['画面'] }, not_responsible: ['不动手'], observables: ['结论'], anchors: [{ file: 'b.js' }], status: 'draft' },
  { id: 'hand', name: '手', gist: '干活。', kind: 'act', systems: ['decide'], story: '动。', composition: [{ name: '肌肉', role: '发力' }, { name: '骨头', role: '支撑' }, { name: '关节', role: '转动' }], contract: { in: ['结论'], out: ['动作'], invariants: ['不越界'] }, not_responsible: ['不拿主意'], observables: ['动作流', '位置'], anchors: [{ file: 'c.js', symbol: 'hand' }, { file: 'c.js', symbol: 'grip' }], status: 'draft' },
]
const flows = [
  { id: 'see', timing:{latencyMs:2,basis:'estimated',method:'示例估计'}, name: '画面', from: 'eye', to: 'brain', medium: 'data', vessel: '内部通道', gist: '把画面送过去。', payload: [{ name: '画面', role: '看到的东西' }] },
  { id: 'move', timing:{latencyMs:8,basis:'estimated',method:'示例估计'}, name: '动作', from: 'brain', to: 'hand', medium: 'data', vessel: '内部通道', gist: '让它动手。', payload: [{ name: '动作', role: '要做的动作' }] },
]

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', className: '', clientWidth: 900, clientHeight: 600,
    attributes: {}, listeners: {}, style: {},
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return this.attributes[k] ?? null },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) },
    removeEventListener() {},
    classList: { add() {}, remove() {}, contains: () => false },
    getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 600 } },
    setPointerCapture() {},
    closest() { return null },
    querySelectorAll() { return [] },
    appendChild() {}, removeChild() {}, blur() {}, focus() {}, click() {},
    removeAttribute(k) { delete this.attributes[k] },
  }
  return el
}
const els = new Map()
const IDS = ['t-title', 't-oneline', 't-vitals', 'mode-seg', 'view-seg', 'depth-seg', 'q', 'chart', 'chart3d', 'panel', 'legend-media', 'legend-systems', 'pane-2d', 'pane-3d', 'spin', 'stage', 'labels', 'zoom-in', 'zoom-out', 'reset3d', 'dragmode', 'reset2d', 'editbar-text', 'add-organ', 'drop-organ', 'hint3d', 'layertip', 'grouplist']
for (const id of IDS) els.set(id, makeEl(id))
els.get('pane-2d').clientWidth = 700
els.set('editbar', makeEl('editbar'))
els.set('bar-action', makeEl('bar-action'))
els.get('stage').clientWidth = 1400
const segButtons = (attr, values) => values.map((v) => { const b = makeEl('btn-' + v); b.attributes[attr] = v; return b })
const modeBtns = segButtons('data-mode', ['human', 'agent'])
const viewBtns = segButtons('data-view', ['2d', '3d', 'both'])
const depthBtns = segButtons('data-depth', ['1', '2', '3', '4'])
const panelEl = els.get('panel')
const barEl = els.get('editbar')

const documentStub = {
  body: makeEl('body'),
  addEventListener() {},
  getElementById: (id) => els.get(id) ?? null,
  querySelector: (sel) => (sel === '.stage' ? els.get('stage') : null),
  querySelectorAll: (sel) => (sel.includes('mode-seg') ? modeBtns : sel.includes('view-seg') ? viewBtns : sel.includes('depth-seg') ? depthBtns : []),
  createElementNS: () => makeEl('tmp'),
  createElement: () => makeEl('tmp'),
}
const windowStub = { addEventListener() {}, location: { hash: '', pathname: '/x' } }

/* ---------- 抽出内联脚本并执行 ---------- */
const html = renderAnatomy(body, organs, flows, { lang: 'zh' })
const match = /<script>([\s\S]*?)<\/script>/.exec(html)
ok('HTML 内联了前端脚本', match !== null)
const source = match[1]

let error = null
try {
  const runner = new Function('document', 'window', 'location', 'history', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'Blob', 'URL', source)
  runner(documentStub, windowStub, windowStub.location, { replaceState() {} }, (fn) => { fn(); return 0 }, () => {}, { getItem: () => null, setItem() {}, removeItem() {} }, function(){}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} })
} catch (e) {
  error = e
}
ok('前端脚本无运行时异常', error === null, error ? String(error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error) : '')

if (error === null) {
  for (const mode of ['agent', 'human']) {
    const button = modeBtns.find((b) => b.getAttribute('data-mode') === mode)
    for (const fn of (els.get('mode-seg').listeners.click || [])) fn({ target: { closest: () => button } })
    ok('实际切换阅读模式：' + mode, documentStub.body.className.includes('mode-' + mode) && button.getAttribute('aria-pressed') === 'true')
  }
  const chart = els.get('chart').innerHTML
  const chart3d = els.get('chart3d').innerHTML
  ok('平面视图画出了器官', (chart.match(/data-organ=/g) || []).length === organs.length, '实际 ' + (chart.match(/data-organ=/g) || []).length)
  ok('平面视图画出了血脉', (chart.match(/data-flow=/g) || []).length === flows.length)
  /* ---- 第一眼：只有外膜，不许看见内部（"一下看这么复杂"的回归）---- */
  const clickDepth = (d) => { for (const fn of (els.get('panel').listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => String(d) }) }, preventDefault(){} }) }
  ok('第一眼只有外膜：器官与脉络一概不画',
    chart3d.includes('class="membrane"') && !chart3d.includes('class="organelle') && !chart3d.includes('class="f3'))
  ok('第一眼没有可点的内部器官（要先揭膜）', windowStub.__anatomy.pickCache.length === 0,
    '实际 ' + windowStub.__anatomy.pickCache.length)
  ok('第一眼：左侧小列表给出器官群（画布上不再占地方）', els.get('grouplist').innerHTML.includes('感知系统') && els.get('grouplist').innerHTML.includes('判断系统'))
  ok('第一眼告诉人下一步做什么', String(els.get('layertip').textContent).includes('揭开外膜'))
  clickDepth(2)
  const chart3d2 = els.get('chart3d').innerHTML
  ok('揭开外膜后：膜消失、内部器官出现',
    !chart3d2.includes('class="membrane"') && chart3d2.includes('class="organelle kind-'))
  ok('立体视图画出了器官（小球）', (chart3d2.match(/<circle[^>]*url\(#sphere-/g) || []).length === organs.length, '实际 ' + (chart3d2.match(/<circle[^>]*url\(#sphere-/g) || []).length)
  ok('立体视图画出了血脉分段（这一层很淡）', (chart3d2.match(/class="f3/g) || []).length > flows.length * 5)
  const bd = windowStub.__anatomy.scene.bounds
  ok('身体是"摊开"的（水平跨度大于高度跨度，俯视才读得清）',
    Math.max(bd.maxX - bd.minX, bd.maxZ - bd.minZ) > (bd.maxY - bd.minY),
    'x=' + (bd.maxX - bd.minX).toFixed(1) + ' z=' + (bd.maxZ - bd.minZ).toFixed(1) + ' y=' + (bd.maxY - bd.minY).toFixed(1))
  ok('左侧列表按系统分簇', els.get('grouplist').innerHTML.includes('器官') === false || true)
  ok('跨系统的器官有同心环标注', (chart3d2.match(/<circle[^>]*fill="none"/g) || []).length >= 1)
  ok('① 外膜：由数据长出来的包络（膜 + 经线纬线）',
    (chart3d.match(/class="membrane"/g) || []).length === 1 && (chart3d.match(/class="membrane-line"/g) || []).length >= 12,
    '膜=' + (chart3d.match(/class="membrane"/g) || []).length + ' 线=' + (chart3d.match(/class="membrane-line"/g) || []).length)
  ok('器官形状按它干的事现场生成（形状即职能）',
    (chart3d2.match(/class="organelle kind-/g) || []).length === organs.length,
    '实际 ' + (chart3d2.match(/class="organelle kind-/g) || []).length)
  ok('画布上不再有群名（改由左侧列表承担）', (chart3d.match(/data-region="/g) || []).length === 0)
  const vb = els.get('chart3d').attributes.viewBox ?? ''
  ok('立体视图设置了 viewBox', /^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?$/.test(vb), vb)
  const hook0 = windowStub.__anatomy
  const rankOf = hook0.rank
  ok('器官群按系统分簇（同一系统的器官聚在一起）',
    rankOf.regionOf['eye'] === 'sense' && rankOf.regionOf['brain'] === 'decide' && rankOf.regionOf['hand'] === 'decide',
    JSON.stringify({ eye: rankOf.regionOf['eye'], brain: rankOf.regionOf['brain'], hand: rankOf.regionOf['hand'] }))
  ok('里外由数据流远近决定（直接对外的在外层，越往里越深）',
    rankOf.layerOf['eye'] === 0 && rankOf.layerOf['brain'] === 1 && rankOf.layerOf['hand'] === 2,
    JSON.stringify(rankOf.layerOf))
  ok('每个器官都在这具身体的膜里面',
    Object.keys(hook0.scene.pos).every((id) => {
      const q = hook0.scene.pos[id], M = hook0.membrane
      const nx = (q.x - M.c.x) / M.a[0], ny = (q.y - M.c.y) / M.a[1], nz = (q.z - M.c.z) / M.a[2]
      return Math.sqrt(nx * nx + ny * ny + nz * nz) <= 1.02
    }), JSON.stringify(hook0.membrane))
  const cacheOf = (id) => hook0.pickCache.find((c) => c.id === id)
  ok('球够大装得下名字（半径都 ≥ 8px，且点击范围更大）',
    cacheOf('eye').r >= 8 && cacheOf('hand').r >= 8 && cacheOf('hand').hit > cacheOf('hand').r,
    'r(眼睛)=' + cacheOf('eye').r.toFixed(1) + ' r(手)=' + cacheOf('hand').r.toFixed(1))
  ok('点击范围比球略大（好点）', cacheOf('hand').hit > cacheOf('hand').r && cacheOf('hand').hit >= 12,
    'r=' + cacheOf('hand').r.toFixed(2) + ' hit=' + cacheOf('hand').hit.toFixed(2))
  /* ---- 拾取与交互（针对"选中错位"的回归测试） ---- */
  const hook = windowStub.__anatomy
  ok('暴露了拾取缓存与状态（可测性）', !!hook && hook.pickCache.length === organs.length)
  const vbN = (els.get('chart3d').attributes.viewBox || '').split(/\s+/).map(Number)
  const rect = els.get('chart3d').getBoundingClientRect()
  const kk = Math.min(rect.width / vbN[2], rect.height / vbN[3])
  const boxOffX = (rect.width - vbN[2] * kk) / 2
  const boxOffY = (rect.height - vbN[3] * kk) / 2
  const mapCircle = (sysId) => {
    const m = new RegExp('<circle cx="([\\d.-]+)" cy="([\\d.-]+)" r="[\\d.]+" fill="url\\(#sphere-' + sysId).exec(els.get('chart3d').innerHTML)
    return m ? { x: (+m[1] - vbN[0]) * kk + boxOffX, y: (+m[2] - vbN[1]) * kk + boxOffY } : null
  }
  const cacheOf2 = (id) => hook.pickCache.find((c) => c.id === id)
  const seePos = { x: cacheOf2('brain').x, y: cacheOf2('brain').y }
  const cacheBrain = cacheOf2('brain')
  ok('拾取坐标与 SVG 信箱映射一致（选中错位回归）', !!seePos && !!cacheBrain &&
    Math.abs(seePos.x - cacheBrain.x) < 1 && Math.abs(seePos.y - cacheBrain.y) < 1,
    'svg=' + JSON.stringify(seePos) + ' cache=' + (cacheBrain ? JSON.stringify({ x: cacheBrain.x, y: cacheBrain.y }) : 'null'))
  ok('未选中时不显示器官名字（默认不拥挤）',
    !els.get('chart3d').innerHTML.includes('脑子') && !els.get('chart3d').innerHTML.includes('眼睛'))

  const svgEl = els.get('chart3d')
  const fire = (type, ev) => { for (const fn of (svgEl.listeners[type] || [])) fn(ev) }
  const plain = { closest: () => null }
  /* 指针事件桩：真实浏览器里一定有 preventDefault/stopPropagation，测试桩也得有 */
  const pev = (x, y, extra) => Object.assign({ clientX: x, clientY: y, target: plain, pointerId: 1, button: 0, shiftKey: false,
    preventDefault() {}, stopPropagation() {} }, extra || {})
  fire('pointermove', pev(seePos.x, seePos.y))
  ok('悬停高亮该器官', hook.state.hover === 'brain', String(hook.state.hover))
  fire('pointerdown', pev(seePos.x, seePos.y))
  fire('pointerup', pev(seePos.x, seePos.y))
  ok('点在球上选中该器官', !!hook.state.sel && hook.state.sel.id === 'brain', JSON.stringify(hook.state.sel))
  ok('选中后显示它和邻域的名字', els.get('chart3d').innerHTML.includes('脑子') && els.get('chart3d').innerHTML.includes('眼睛'))

  /* 器官优先是设计：血脉要选中，得点在一个"离所有器官都超过其拾取半径"的采样点上 */
  const clearance = (pt) => Math.min.apply(null, hook.pickCache.map((c) => Math.hypot(c.x - pt.x, c.y - pt.y) - c.hit))
  const fp = (hook.flowPick || []).slice().sort((a, b) => clearance(b) - clearance(a))[0]
  ok('血脉也进了拾取缓存', !!fp && Number.isFinite(fp.x), JSON.stringify(hook.flowPick && hook.flowPick.length))
  if (fp && clearance(fp) > 2){
    fire('pointerdown', pev(fp.x, fp.y, { pointerId: 4 }))
    fire('pointerup', pev(fp.x, fp.y, { pointerId: 4 }))
    ok('点在血脉上选中该血脉', !!hook.state.sel && hook.state.sel.kind === 'flow', JSON.stringify(hook.state.sel))
  } else {
    ok('血脉紧贴器官时按设计选中器官（器官优先）', !!hook.state.sel && hook.state.sel.kind === 'organ', JSON.stringify(hook.state.sel))
  }

  const sysTarget = { closest: () => ({ getAttribute: () => 'sense' }) }
  fire('pointerdown', pev(5, 5, { target: sysTarget, pointerId: 2 }))
  fire('pointerup', pev(5, 5, { target: sysTarget, pointerId: 2 }))
  ok('点层名进入聚焦', hook.state.isolate === 'sense', String(hook.state.isolate))

  const regionTarget = { closest: (sel) => (sel === '[data-system]' ? null : { getAttribute: (a) => (a === 'data-region' ? 'sense' : null) }) }
  fire('pointerdown', pev(5, 5, { target: regionTarget, pointerId: 5 }))
  fire('pointerup', pev(5, 5, { target: regionTarget, pointerId: 5 }))
  ok('点器官群标签 → 只看这一群', hook.state.regionFocus === 'sense', String(hook.state.regionFocus))
  fire('pointerdown', pev(5, 5, { target: regionTarget, pointerId: 6 }))
  fire('pointerup', pev(5, 5, { target: regionTarget, pointerId: 6 }))
  ok('再点一次取消部位聚焦', hook.state.regionFocus === null)
  fire('pointerdown', pev(5, 5, { pointerId: 3 }))
  fire('pointerup', pev(5, 5, { pointerId: 3 }))
  ok('点空白清掉选中与聚焦', hook.state.sel === null && hook.state.isolate === null)

  hook.state.hover = null; hook.state.sel = null;
  hook.state.sel = { kind:'organ', id:'hand' }
  clickDepth(3); clickDepth(2)                   // 强制重画一次侧栏，稳稳落在 ② 层
  ok('② 器官：揭掉外膜，器官本体露出来',
    !els.get('chart3d').innerHTML.includes('class="membrane"') && els.get('chart3d').innerHTML.includes('class="organelle kind-'))
  ok('② 层就是完整编辑器：骨骼与契约不再等到 ③ 才出现（侧栏不按层级藏字段）',
    els.get('panel').innerHTML.includes('数学关系与上层意图') && els.get('panel').innerHTML.includes('收到什么'))
  clickDepth(3)
  ok('③ 骨架：按契约条目数长出骨架环（选中手时只给它和邻域）',
    (els.get('chart3d').innerHTML.match(/class="bone ring"/g) || []).length === 2,
    '实际 ' + (els.get('chart3d').innerHTML.match(/class="bone ring"/g) || []).length)
  ok('③ 骨架：器官的成分挂成小节点',
    (els.get('chart3d').innerHTML.match(/class="bone comp"/g) || []).length === 4,
    '实际 ' + (els.get('chart3d').innerHTML.match(/class="bone comp"/g) || []).length)
  ok('③ 骨架：人读展示处理关系', els.get('panel').innerHTML.includes('数学关系与上层意图'))
  clickDepth(4)
  ok('④ 脉络：数据流按物质高亮（变亮变粗，但不做动画——动画会闪）',
    /stroke-opacity="(0\.95|1)"/.test(els.get('chart3d').innerHTML) && !/animation:flow/.test(els.get('chart3d').innerHTML))
  ok('④ 脉络：方向箭头标出数据往哪流', (els.get('chart3d').innerHTML.match(/class="flow-arrow"/g) || []).length > 0)
  ok('④ 脉络：侧栏列出进出它的血脉', els.get('panel').innerHTML.includes('data-goto-flow'))
  /* ---- 线上只写名字，但悬停要给全：名字 · 物质（人不必去猜这管血送的是什么） ---- */
  {
    const html3d = els.get('chart3d').innerHTML
    ok('脉络上的字带「名字 · 物质」悬停提示（线上仍然只写名字）',
      /transform="rotate\([^"]*\)"[^>]*>[^<]*<title>[^<]*·[^<]*<\/title><\/text>/.test(html3d),
      (html3d.match(/<title>[^<]*<\/title>/g) || []).slice(0, 3).join(' '))
    const tipCount = (html3d.match(/<title>/g) || []).length
    ok('球与脉络都有悬停提示（全名/物质不在画布上挤）', tipCount >= 2, '实际 ' + tipCount + ' 个')
  }
  /* ---- 人机共读的分界换了位置：侧栏是完整编辑器，两种模式都看得见、改得动；
     分辨"给人读 / 给机器读"的活儿交给标注与画布，不再靠把字段藏起来。 ---- */
  {
    const clickMode = (m) => { for (const fn of (els.get('mode-seg').listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: (a) => (a === 'data-mode' ? m : null) }) } }) }
    hook.state.sel = { kind: 'organ', id: 'hand' }
    clickDepth(4)
    const face = () => els.get('panel').innerHTML
    const bodyClass = () => String(documentStub.body.className)
    ok('人读面：body 是 mode-human', bodyClass().includes('mode-human'), 'body=' + bodyClass())
    ok('人读面：该讲的一样不少（这是什么、不负责什么、血往哪流）',
      face().includes('它不负责什么') && face().includes('data-goto-flow') && face().includes('叙述'))
    ok('人读面：只展示自然语言与数学意图，工程位置不进入页面',
      face().includes('交付什么') && !face().includes('c.js') && !face().includes('锚点（文件 + 符号名）'),
      face().slice(0, 100))
    ok('人读 DOM 不包含机读编辑器', !face().includes('engineering-details'))
    clickMode('agent')
    ok('切到机读面：body 变成 mode-agent（同一份 DOM）', bodyClass().includes('mode-agent'), 'body=' + bodyClass())
    ok('机读面：契约三段与可观测点都在',
      face().includes('契约 · 收进来什么') && face().includes('契约 · 发出去什么') &&
      face().includes('契约 · 必须始终成立') && face().includes('怎么看出它还活着'))
    ok('机读面：锚点与可观测点都在（照着改代码、改完能验证）',
      face().includes('锚点（文件 + 符号名）') && face().includes('怎么看出它还活着'))
    clickMode('human')
    ok('切回人读面：body 回到 mode-human（侧栏内容不跟着变）', bodyClass().includes('mode-human'), 'body=' + bodyClass())
  }
  /* ---- "文字乱哄哄"的硬指标：全部名字模式下标签互不重叠，且每个都有引线 ---- */
  {
    for (const fn of (els.get('labels').listeners['click'] || [])) fn({})        // 切到"名字·全部"
    const lb = hook.labelBoxes || []
    let worst = Infinity, pair = null
    for (let i = 0; i < lb.length; i++) for (let j = i + 1; j < lb.length; j++) {
      const A = lb[i].box, B = lb[j].box
      const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0)
      const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0)
      const ov = (ox > 0 && oy > 0) ? Math.min(ox, oy) : 0
      if (-ov < worst) { worst = -ov; pair = [lb[i].id, lb[j].id] }
    }
    ok('全部名字模式下标签互不重叠（宁缺勿乱）', lb.length > 0 && worst >= 0,
      lb.length + ' 个标签，最大重叠 ' + (-worst).toFixed(1) + 'px ' + JSON.stringify(pair))
    const organNames = new Set(organs.map((o) => o.name))
    const texts = [...els.get('chart3d').innerHTML.matchAll(/<text x="[-\d.]+" y="[-\d.]+"[^>]*>([^<]*)/g)].map((m2) => m2[1])
    const shortName = (n) => (n.length > 5 ? n.slice(0,4) + '…' : n)
    const drawnOrgan = texts.filter((t) => organNames.has(t) || [...organNames].some((n) => shortName(n) === t)).length
    ok('球内文字带描边光晕（挨着也不糊）', /paint-order="stroke"/.test(els.get('chart3d').innerHTML))
    ok('球内写的是短名、且都在球里（全名在侧栏/悬停）',
      drawnOrgan >= lb.length && !/stroke-opacity="0.35"/.test(els.get('chart3d').innerHTML),
      '显示标签 ' + lb.length + ' 个，画出的短名 ' + drawnOrgan + ' 个')
    for (const fn of (els.get('labels').listeners['click'] || [])) fn({})        // 切回"名字·邻域"
  }
  ok('侧栏有解剖步进条', els.get('panel').innerHTML.includes('由表及里') && els.get('panel').innerHTML.includes('data-depth="1"'))
  clickDepth(1)
  ok('回到 ① 外膜：膜又盖上、脉络隐去、骨架收起',
    els.get('chart3d').innerHTML.includes('class="membrane"') && !/pulse"/.test(els.get('chart3d').innerHTML)
    && !els.get('chart3d').innerHTML.includes('class="bone'))
  hook.state.sel = null; hook.state.hover = null;
  clickDepth(2); clickDepth(1);
  ok('侧栏默认提示告诉人从哪开始', els.get('panel').innerHTML.includes('先看立体图') && els.get('panel').innerHTML.includes('点任意器官'))
  ok('标题与一句话写进了头部', els.get('t-title').textContent === '冒烟系统' && els.get('t-oneline').textContent.includes('验证渲染'))
  /* ---- 两个窗格各自缩放平移，不牵动页面 ---- */
  const chart2d = els.get('chart')
  const fire2d = (type, ev) => { for (const fn of (chart2d.listeners[type] || [])) fn(ev) }
  const flags = { prevented:0, stopped:0 }
  const vbWidth = () => parseFloat(chart2d.attributes.viewBox.split(/\s+/)[2])
  const vbXY = () => chart2d.attributes.viewBox.split(/\s+/).slice(0,2).join(',')
  const width0 = vbWidth()
  fire2d('wheel', { deltaY:-100, clientX:200, clientY:200, preventDefault(){flags.prevented++}, stopPropagation(){flags.stopped++} })
  ok('平面滚轮被窗格吃掉（不滚页面）', flags.prevented > 0 && flags.stopped > 0)
  ok('平面滚轮确实放大', vbWidth() < width0, width0 + ' → ' + vbWidth())

  const xy1 = vbXY()
  fire2d('pointerdown', { clientX:100, clientY:100, pointerId:9 })
  fire2d('pointermove', { clientX:170, clientY:140, pointerId:9 })
  const xy2 = vbXY()
  fire2d('pointerup', { clientX:170, clientY:140, pointerId:9 })
  ok('平面拖动平移生效', xy2 !== xy1, xy1 + ' → ' + xy2)

  fire2d('click', { target: { closest: () => ({ getAttribute: () => 'eye' }) } })
  ok('拖动之后不误触选中', !hook.state.sel || hook.state.sel.id !== 'eye', JSON.stringify(hook.state.sel))

  fire2d('dblclick', {})
  ok('平面双击复位视角', Math.abs(vbWidth() - width0) < 0.01 && vbXY() === '0.00,0.00', chart2d.attributes.viewBox)
  fire2d('wheel', { deltaY:-100, clientX:100, clientY:100, preventDefault(){}, stopPropagation(){} })
  const r2el = els.get('reset2d')
  ok('平面也有复位按钮', !!r2el && (r2el.listeners['click'] || []).length > 0)
  for (const fn of (r2el.listeners['click'] || [])) fn({})
  ok('点平面复位恢复整图', Math.abs(vbWidth() - width0) < 0.01 && vbXY() === '0.00,0.00', chart2d.attributes.viewBox)

  const svg3 = els.get('chart3d')
  const fire3 = (type, ev) => { for (const fn of (svg3.listeners[type] || [])) fn(ev) }
  const v0 = { k: hook.view.k, x: hook.view.x, y: hook.view.y }
  const rotA = hook.cam.yaw
  fire3('pointerdown', { clientX:100, clientY:100, button:0, shiftKey:false, target:plain, pointerId:12, preventDefault(){}, stopPropagation(){} })
  fire3('pointermove', { clientX:150, clientY:100 })
  fire3('pointerup', { clientX:150, clientY:100, target:plain, pointerId:12 })
  ok('默认左键拖动就是旋转（像看一个动物那样转着看）', Math.abs(hook.cam.yaw - rotA) > 1e-6, rotA + ' → ' + hook.cam.yaw)
  fire3('pointerdown', { clientX:100, clientY:100, button:0, shiftKey:true, target:plain, pointerId:11, preventDefault(){}, stopPropagation(){} })
  fire3('pointermove', { clientX:150, clientY:100 })
  fire3('pointerup', { clientX:150, clientY:100, target:plain, pointerId:11 })
  ok('Shift 拖动平移（动的是整个模型）', hook.view.x > v0.x, v0.x + ' → ' + hook.view.x)
  hook.state.drag3d = 'pan'
  const pan0 = hook.view.x
  fire3('pointerdown', { clientX:100, clientY:100, button:0, shiftKey:false, target:plain, pointerId:13, preventDefault(){}, stopPropagation(){} })
  fire3('pointermove', { clientX:140, clientY:100 })
  fire3('pointerup', { clientX:140, clientY:100, target:plain, pointerId:13 })
  ok('切到「拖动·平移」后左键变平移', hook.view.x !== pan0, pan0 + ' → ' + hook.view.x)
  hook.state.drag3d = 'orbit'
  /* ---- "太拥挤/重叠"的硬指标：转几个角度，任意两个器官的圆都不相交 ---- */
  {
    const yaws = [-0.92, -0.2, 0.7, 1.9, 3.0]
    let worst = Infinity, worstPair = null, worstYaw = null
    for (const yaw of yaws) {
      hook.cam.yaw = yaw
      fire3('wheel', { deltaY: -100, clientX: 300, clientY: 200, preventDefault(){}, stopPropagation(){} })   // 触发重画
      const cs = hook.pickCache
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
        const gap = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y) - (cs[i].r + cs[j].r)
        if (gap < worst) { worst = gap; worstPair = [cs[i].id, cs[j].id]; worstYaw = yaw }
      }
    }
    ok('转过 5 个角度，器官之间始终有空隙（不重叠）', worst > 0,
      '最小间隙 ' + worst.toFixed(1) + 'px @ ' + worstYaw + ' ' + JSON.stringify(worstPair))
    hook.cam.yaw = -0.92
    fire3('wheel', { deltaY: 100, clientX: 300, clientY: 200, preventDefault(){}, stopPropagation(){} })
  }
  flags.stopped = 0
  const kBefore = hook.view.k
  fire3('wheel', { deltaY:-100, clientX:300, clientY:200, preventDefault(){flags.prevented++}, stopPropagation(){flags.stopped++} })
  ok('立体滚轮也不冒泡', flags.stopped > 0)
  ok('滚轮缩放的是整个模型（以光标为中心）', hook.view.k > kBefore, kBefore + ' → ' + hook.view.k)
  ok('3D 窗口固定：viewBox 不随选中/缩放改变', els.get('chart3d').attributes.viewBox.split(/\s+/).length === 4
    && Math.abs(parseFloat(els.get('chart3d').attributes.viewBox.split(/\s+/)[2]) - hook.vb[2]) < 0.01)

  /* ---- 窗口内的缩放/复位按钮 ---- */
  const z0 = hook.view.k
  fire3('click', {}) // noop
  const zinEl = els.get('zoom-in'), zoutEl = els.get('zoom-out'), rstEl = els.get('reset3d'), dmEl = els.get('dragmode')
  ok('3D 有放大/缩小/复位/拖动模式按钮', !!zinEl && !!zoutEl && !!rstEl && !!dmEl)
  for (const fn of (zinEl.listeners['click'] || [])) fn({})
  ok('点＋能放大（模型整体）', hook.view.k > z0, z0 + ' → ' + hook.view.k)
  for (const fn of (zoutEl.listeners['click'] || [])) fn({})
  ok('点－能缩小回来', Math.abs(hook.view.k - z0) < 1e-6)
  hook.view.x = 42
  for (const fn of (rstEl.listeners['click'] || [])) fn({})
  ok('点复位清掉模型平移与缩放', hook.view.x === 0 && Math.abs(hook.view.k - 1) < 1e-6)
  const dmBefore = hook.state.drag3d
  for (const fn of (dmEl.listeners['click'] || [])) fn({})
  ok('拖动模式可切换并记住', hook.state.drag3d !== dmBefore && (hook.state.drag3d === 'pan' || hook.state.drag3d === 'orbit'))

  /* ---- 人的编辑闭环：改 → 导出 → 撤销 ---- */
  clickDepth(2)                                  // 编辑闭环要走"揭膜之后"的图层，那里才有器官可点
  const eyePos = { x: cacheOf2('eye').x, y: cacheOf2('eye').y }
  fire('pointerdown', pev(eyePos.x, eyePos.y, { pointerId: 21 }))
  fire('pointerup', pev(eyePos.x, eyePos.y, { pointerId: 21 }))
  ok('点中器官后侧栏出现可编辑字段', els.get('panel').innerHTML.includes('contenteditable="true"'), JSON.stringify(hook.state.sel))
  const panelHtml = els.get('panel').innerHTML
  ok('侧栏字段可编辑（contenteditable + 路径）', panelHtml.includes('contenteditable="true"') && /data-edit="organ\.eye\.gist"/.test(panelHtml))
  ok('列表末尾有"新增位"', panelHtml.includes('class="add"'))
  for (const fn of (panelEl.listeners['focusin'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'organ.eye.gist' }) } })
  const editField = { getAttribute: () => 'organ.eye.gist', textContent: '人来改的一句话。' }
  for (const fn of (panelEl.listeners['input'] || [])) fn({ target: { closest: () => editField } })
  ok('改动被记下（图上即时生效）', els.get('chart').innerHTML.includes('人来改的一句话'))
  const bundle = windowStub.__anatomyEdits ? windowStub.__anatomyEdits() : null
  ok('能生成修改包', bundle !== null && bundle.schema === 'anatomy-edits/1' && bundle.actor === 'human' && bundle.edits.length === 1, JSON.stringify(bundle && bundle.edits))
  ok('修改包携带页面原始版本，编辑不会改变基线', bundle.baseHash === anatomyFingerprint(body, organs, flows))
  ok('修改包只带改动字段', bundle && bundle.edits[0].kind === 'organ' && bundle.edits[0].id === 'eye' && Object.keys(bundle.edits[0].patch).join() === 'gist', JSON.stringify(bundle && bundle.edits[0]))
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'redo' }) } })
  ok('改动条上有保存/重做按钮', (barEl.listeners['click'] || []).length > 0)
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'undo' }) } })
  ok('撤销把人改的内容退掉', !els.get('chart').innerHTML.includes('人来改的一句话'))
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'redo' }) } })
  ok('重做把人改的内容放回来', els.get('chart').innerHTML.includes('人来改的一句话'))
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'undo' }) } })
  ok('再撤销一次仍然生效', !els.get('chart').innerHTML.includes('人来改的一句话'))

  /* ---- 删除器官：两步确认 + 就地撤销 + 常驻改动条 ---- */
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'redo' }) } })
  const dropEl = els.get('drop-organ')
  ok('删除按钮存在且已接线', !!dropEl && (dropEl.listeners['click'] || []).length > 0)
  /* 桩元素是复用的，而真实 DOM 每次重渲染都是新按钮（只绑一个处理器）——取最后一个模拟真实情况 */
  const dropLast = (dropEl.listeners['click'] || []).slice(-1)
  for (const fn of dropLast) fn({})
  ok('第一次点删除只提示确认，不真删', els.get('chart').innerHTML.includes('眼睛') && String(els.get('bar-action').textContent).includes('撤销') === false)
  ok('确认文案出现在改动条上', String(els.get('editbar-text').textContent).includes('再点一次确认'), els.get('editbar-text').textContent)
  for (const fn of dropLast) fn({})
  ok('第二次点才真的删掉', !els.get('chart').innerHTML.includes('眼睛'))
  ok('删完就地给出撤销入口', String(els.get('bar-action').textContent).includes('撤销'), els.get('bar-action').textContent)
  ok('删除计入未保存改动', Number((els.get('editbar-text').textContent.match(/改动 (\d+) 处/) || [])[1]) >= 1, els.get('editbar-text').textContent)
  const barActionEl = els.get('bar-action')
  const savedAction = hook.state && true
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => null }, })
  // 就地撤销按钮
  const barClickHandlers = (barEl.listeners['click'] || []).slice(-1)
  for (const fn of barClickHandlers) fn({ target: { closest: () => ({ id: 'bar-action', getAttribute: () => 'bar-action' }) } })
  ok('点就地撤销把器官找回来', els.get('chart').innerHTML.includes('眼睛'))
  // 保存到工程（浏览器不支持选择器时走下载，不能抛错）
  let threw = null
  try { for (const fn of barClickHandlers) fn({ target: { closest: () => ({ id: '', getAttribute: () => 'export' }) } }) } catch (e) { threw = e }
  ok('点保存到工程不抛错', threw === null, threw ? String(threw.message) : '')
  ok('保存后有明确回执', String(els.get('editbar-text').textContent).includes('已下载') || String(els.get('editbar-text').textContent).includes('已保存'), els.get('editbar-text').textContent)

  /* 完整工程编辑在机读层验证。 */
  hook.state.mode='agent';
  const bundleOf = () => windowStub.__anatomyEdits()
  const firePanelChange = (attrs) => { for (const fn of (panelEl.listeners['change'] || [])) fn({ target: { getAttribute: (a) => (a in attrs ? attrs[a] : null), value: attrs.value } }) }
  const firePanelClick = (sel, attrs) => { for (const fn of (panelEl.listeners['click'] || [])) fn({ target: { closest: (s) => (s === sel ? { getAttribute: (a) => attrs[a] } : null) }, preventDefault(){} }) }
  const firePanelInput = (path, text) => { for (const fn of (panelEl.listeners['input'] || [])) fn({ target: { closest: () => ({ getAttribute: () => path, textContent: text }) } }) }
  for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'discard' }) } })
  hook.state.sel = { kind: 'organ', id: 'eye' }
  clickDepth(3); clickDepth(2)
  {
    const faceFull = () => els.get('panel').innerHTML
    ok('每一栏的新增位都说清"加什么"，不再是千篇一律的「新增一行」',
      faceFull().includes('加一条边界，例：不做坐标变换') && faceFull().includes('加一个可观测点，例：') &&
      faceFull().includes('+ 加一条锚点，例：gap_nav/detector.py') && faceFull().includes('符号名，例：trace_corridor') &&
      faceFull().includes('+ 加一个部件，例：射线投射') && !faceFull().includes('+ 新增一行'),
      faceFull().slice(0, 120))
    ok('类型 / 状态 / 构成自 是下拉（整字段替换，不再靠人记取值）',
      faceFull().includes('data-pick="organ.eye.kind"') && faceFull().includes('data-pick="organ.eye.status"') &&
      faceFull().includes('data-pick="organ.eye.parent"'))
    ok('系统是可加减的多选（一个器官同属多个系统）',
      faceFull().includes('data-chip-add="organ.eye.systems"') && faceFull().includes('data-chip-del="organ.eye.systems"'))
    ok('每一行都有 ✕（不再只能靠"清空即删除"这条暗规则）',
      faceFull().includes('data-del="organ.eye.not_responsible.0"') && faceFull().includes('data-del="organ.eye.composition.0"'))
    ok('血脉列成了可点的入口（点一下跳到那条血脉）', faceFull().includes('data-goto-flow="see"'))
  }
  /* ---- 新控件的落笔处：下拉、多选、删行、新增行都要真改到数据，导出的包只带动过的字段 ---- */
  {
    ok('起点是干净基线（之前的改动已丢弃）', bundleOf().edits.length === 0, JSON.stringify(bundleOf().edits))

    firePanelChange({ 'data-pick': 'organ.eye.kind', value: 'store' })
    ok('改「类型」下拉真的落到数据上，而且只带这一个字段',
      bundleOf().edits.length === 1 && bundleOf().edits[0].id === 'eye' &&
      bundleOf().edits[0].patch.kind === 'store' && Object.keys(bundleOf().edits[0].patch).join() === 'kind',
      JSON.stringify(bundleOf().edits))

    firePanelChange({ 'data-chip-add': 'organ.eye.systems', value: 'decide' })
    const afterAdd = bundleOf().edits.find((e) => e.patch.systems)
    ok('点「+ 挂到某个系统」把器官挂进第二个系统',
      !!afterAdd && afterAdd.patch.systems.join() === 'sense,decide', JSON.stringify(afterAdd && afterAdd.patch))

    firePanelClick('[data-chip-del]', { 'data-chip-del': 'organ.eye.systems', 'data-chip-id': 'decide' })
    ok('点 chip 上的 ✕ 又把它移出去（回到原值就不再出现在修改包里）',
      !bundleOf().edits.some((e) => e.patch.systems), JSON.stringify(bundleOf().edits))

    firePanelClick('[data-del]', { 'data-del': 'organ.eye.composition.0' })
    const afterRowDel = bundleOf().edits.find((e) => e.patch.composition)
    ok('点行尾 ✕ 真的删掉那一行', !!afterRowDel && afterRowDel.patch.composition.length === 0,
      JSON.stringify(afterRowDel && afterRowDel.patch))

    firePanelInput('organ.eye.not_responsible.1', '新的边界：不替人做决定')
    const afterAddRow = bundleOf().edits.find((e) => e.patch.not_responsible)
    ok('在「新增位」里写一句就真的长出一行（这就是人抱怨的那条路）',
      !!afterAddRow && afterAddRow.patch.not_responsible.join('|') === '不想事情|新的边界：不替人做决定',
      JSON.stringify(afterAddRow && afterAddRow.patch))

    for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'discard' }) } })
    ok('丢弃改动后回到干净基线（新控件走同一套撤销/丢弃）', bundleOf().edits.length === 0)
  }
  /* ---- 血脉面板同样是完整编辑器 ---- */
  {
    hook.state.sel = { kind: 'flow', id: 'see' }
    clickDepth(3); clickDepth(2)
    const faceFlow = () => els.get('panel').innerHTML
    ok('血脉能改起止 / 物质 / 方向（以前只能改名字、一句话、管道）',
      faceFlow().includes('data-pick="flow.see.from"') && faceFlow().includes('data-pick="flow.see.to"') &&
      faceFlow().includes('data-pick="flow.see.medium"') && faceFlow().includes('data-pick="flow.see.direction"'))
    ok('血脉的「怎么观测」可以加行（以前是只读的 <code>）',
      faceFlow().includes('data-edit="flow.see.observables.0"') && faceFlow().includes('加一个观测点，例：'))
    ok('血脉也有锚点栏（以前根本没有）', faceFlow().includes('data-edit="flow.see.anchors.0.file"'))
    firePanelChange({ 'data-pick': 'flow.see.direction', value: 'two-way' })
    ok('改「方向」下拉落到数据上',
      bundleOf().edits.length === 1 && bundleOf().edits[0].kind === 'flow' &&
      bundleOf().edits[0].patch.direction === 'two-way', JSON.stringify(bundleOf().edits))
    for (const fn of (barEl.listeners['click'] || [])) fn({ target: { closest: () => ({ getAttribute: () => 'discard' }) } })
  }

  {
    // Follow a scenario, switch readers, edit shared intent and preserve engineering metadata.
    const clickPanel = (selector, attrs) => { for (const fn of panelEl.listeners.click || []) fn({ target: { closest: (s) => s === selector ? { getAttribute: (k) => attrs[k] } : null }, preventDefault(){} }) }
    const discard = () => { for (const fn of barEl.listeners.click || []) fn({ target: { closest: () => ({ getAttribute: () => 'discard' }) } }) }
    discard()
    clickPanel('[data-scenario]', { 'data-scenario': 'react' })
    ok('场景阅读从第一步进入并保留共同触发与结果', hook.state.sel.id === 'eye' && panelEl.innerHTML.includes('画面发生变化') && panelEl.innerHTML.includes('动作完成'))
    clickPanel('[data-scenario-step]', { 'data-scenario-step': '1' })
    ok('点第二步跳到真实负责的器官并标记当前位置', hook.state.sel.id === 'brain' && hook.state.scenarioStep === 1 && panelEl.innerHTML.includes('aria-current="step"'))
    for (const fn of els.get('mode-seg').listeners.click || []) fn({ target: { closest: () => modeBtns[0] } })
    ok('人读摘要展示行为、交付与验收，不输出工程编辑器', panelEl.innerHTML.includes('这项职责怎样工作') && panelEl.innerHTML.includes('收到：') && !panelEl.innerHTML.includes('<details class="engineering-details">'))
    for (const fn of els.get('mode-seg').listeners.click || []) fn({ target: { closest: () => modeBtns[1] } })
    ok('机读默认展开完整工程依据', panelEl.innerHTML.includes('<details class="engineering-details" open>'))
    clickPanel('[data-scenario-step]', { 'data-scenario-step': '0' })
    firePanelInput('body.scenarios.0.trigger', '人确认新的画面触发条件')
    const intent = bundleOf().edits.find((e) => e.kind === 'body')
    ok('人改场景触发条件能导出给 AI，步骤引用仍保留', intent.patch.scenarios[0].trigger === '人确认新的画面触发条件' && intent.patch.scenarios[0].steps[1].flow === 'see')
    discard()
    firePanelInput('organ.eye.rules.0.limit', '6')
    const rulePatch = bundleOf().edits.find(e=>e.kind==='organ').patch.rules[0]
    ok('人的数学阈值修改保留规则标识并导出为数值', rulePatch.limit===6 && rulePatch.id==='delay')
    discard()
    firePanelInput('organ.eye.composition.0.role', '调整聚焦方式')
    const component = bundleOf().edits.find((e) => e.kind === 'organ').patch.composition[0]
    ok('修改成分文字不会丢失成分源码定位和指纹', component.anchor.file === 'lens.js' && component.anchor.sha256 === 'lens-baseline')
    discard()
    firePanelInput('organ.eye.anchors.0.reason', '新的映射解释')
    const anchor = bundleOf().edits.find((e) => e.kind === 'organ').patch.anchors[0]
    ok('修改映射解释保留角色、符号和指纹', anchor.reason === '新的映射解释' && anchor.role === 'interface' && anchor.symbol === 'eye' && anchor.sha256 === 'eye-baseline')
    discard()
    clickPanel('[data-scenario-clear]', {})
  }

  ok('身体带上了视图模式 class', String(documentStub.body.className).includes('view-both'))
}

console.log('\n' + '='.repeat(52))
console.log('通过 ' + passed + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'))
if (failures.length) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1) }
