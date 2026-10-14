// 端到端自测：用最小 cordis 上下文加载插件，跑完 init → scaffold → check → 漂移 → render → map/digest/brief → 引用保护。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tools = new Map()
let skill = null
let passed = 0
const failures = []

const ctx = {
  logger: { info: () => {}, warn: (m) => console.log('  [warn] ' + m), error: (m) => console.log('  [error] ' + m) },
  tools: {
    register(definition) {
      if (typeof definition.output?.render !== 'function') throw new TypeError('工具缺少 output.render：' + definition.name)
      tools.set(definition.name, definition)
      return () => {}
    },
  },
  skills: {
    register(registration) {
      skill = registration
      return () => {}
    },
  },
  effect: (fn) => fn(),
}

function ok(label, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  ✓ ' + label)
  } else {
    failures.push(label + (detail ? ' — ' + detail : ''))
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''))
  }
}

async function call(name, args = {}) {
  const tool = tools.get(name)
  if (tool === undefined) throw new Error('没有这个工具：' + name)
  return await tool.execute(args)
}

const work = mkdtempSync(join(tmpdir(), 'anatomy-e2e-'))
const repo = join(work, 'repo')
mkdirSync(join(repo, 'src'), { recursive: true })
const controllerFile = join(repo, 'src', 'controller.cpp')
writeFileSync(controllerFile, 'void Controller::detect() {}\nvoid Controller::steer() {}\nvoid Controller::finish() {}\n', 'utf8')

const mod = await import(pathToFileURL(join(here, '..', 'lib', 'index.js')).href)
mod.apply(ctx, { rootDir: work, autoServe: false, lang: 'zh' })

console.log('\n[1] 注册契约')
ok('插件名正确', mod.name === '@dsh-external/dsh-anatomy', mod.name)
ok('注入 tools 与 skills', JSON.stringify(mod.inject) === '["tools","skills"]', JSON.stringify(mod.inject))
ok('注册 24 个工具', tools.size === 24, '实际 ' + tools.size + '：' + [...tools.keys()].join(','))
ok('全部工具以 anatomy_ 开头', [...tools.keys()].every((n) => n.startsWith('anatomy_')))
ok('注册 anatomy-authoring 技能', skill?.name === 'anatomy-authoring', String(skill?.name))
ok('技能有 description 与正文', (skill?.description ?? '').length > 20 && (skill?.content ?? '').length > 500)

console.log('\n[2] 初始化')
const init = await call('anatomy_init', {
  body: 'demo-system',
  title: '示例系统',
  oneline: '一个用来验证共读解剖图的最小系统。',
  systems: [
    { id: 'sense', name: '感知系统', gist: '看见世界' },
    { id: 'act', name: '运动系统', gist: '改变世界' },
  ],
})
ok('init 成功', init.ok === true, JSON.stringify(init.error))
ok('body.json 落盘', existsSync(join(work, 'anatomy-demo-system', 'body.json')))
ok('默认物质已补', (init.body?.media ?? []).length >= 4)

console.log('\n[3] 批量铺写 + 预检')
const scaffold = await call('anatomy_scaffold', {
  body: 'demo-system',
  repoRoot: repo,
  organs: [
    {
      id: 'stall-judge',
      name: '堵转判定',
      gist: '判断车是不是被卡住了。',
      kind: 'sense',
      systems: ['sense'],
      story: '盯着目标转速推出来的应走路程和实际挪动的距离，两者对不上就认为被卡住。',
      composition: [{ name: '转速积分窗口', role: '算出本该走多远', anchor: { file: 'src/controller.cpp', symbol: 'Controller::detect' } }],
      contract: { in: ['目标转速', '定位'], out: ['是否卡住'], invariants: ['窗口不足时不作判断'] },
      not_responsible: ['不判断是不是有人接管', '不决定倒多久'],
      observables: ['~state 的 expected / observed_movement'],
      anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::detect' }],
    },
    {
      id: 'wheel-actuator',
      name: '轮角执行',
      gist: '把想要的转向变成轮子真的转过去。',
      kind: 'act',
      systems: ['act'],
      story: '按限幅后的目标角驱动，并且不让轮角一次跳太多。',
      composition: [{ name: '轮角驱动', role: '执行限幅后的目标角' }],
      contract: { in: ['目标角'], out: ['轮角'], invariants: ['不超过转角限制'] },
      not_responsible: ['不决定往哪转'],
      anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::steer' }],
    },
  ],
  flows: [
    {
      id: 'stall-to-actuator',
      name: '受阻结论',
      from: 'stall-judge',
      to: 'wheel-actuator',
      medium: 'event',
      vessel: '内部判定结果',
      gist: '判定被卡住之后，告诉执行部件该动手了。',
      payload: [{ name: '是否卡住', role: '触发绕行的开关' }],
    },
  ],
})
ok('scaffold 成功', scaffold.ok === true, JSON.stringify(scaffold.error))
ok('写入 2 个器官 1 条血脉', scaffold.written?.organs === 2 && scaffold.written?.flows === 1, JSON.stringify(scaffold.written))
ok('预检无 error', (scaffold.warnings ?? []).every((w) => w.level === 'warning'))

const bad = await call('anatomy_scaffold', {
  body: 'demo-system',
  organs: [{ id: 'ghost', name: '幽灵器官', gist: '指向不存在的东西。', systems: ['nope'] }],
})
ok('预检拦截未知系统', bad.ok === false && bad.error?.code === 'anatomy/precheck-failed', JSON.stringify(bad.error))
ok('拦截时整批不落盘', !existsSync(join(work, 'anatomy-demo-system', 'organs', 'ghost.json')))

console.log('\n[4] 体检：结构 + 共读质量 + 锚点')
const healthy = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('体检 0 error', healthy.ok === true, JSON.stringify(healthy.errors))
ok('统计正确', healthy.stats?.organs === 2 && healthy.stats?.flows === 1 && healthy.stats?.anchors === 3, JSON.stringify(healthy.stats))

const proseBlocked = await call('anatomy_organ_put', {
  body: 'demo-system', repoRoot: repo,
  organ: { id: 'wheel-actuator', name: '轮角执行', gist: '把目标角 setSteer() 写下去。', systems: ['act'] },
})
ok('strict 下叙述混进实现被拦', proseBlocked.ok === false && proseBlocked.errors.some((e) => e.code === 'organ/implementation-in-prose'), JSON.stringify(proseBlocked.error))
const prose = await call('anatomy_organ_put', {
  body: 'demo-system', strict: false, repoRoot: repo,
  organ: { id: 'wheel-actuator', name: '轮角执行', gist: '把目标角 setSteer() 写下去。', systems: ['act'] },
})
ok('放宽 strict 也不允许人读层出现程序表达', prose.ok === false && prose.errors.some((w) => w.code === 'human/program-language'))
await call('anatomy_organ_put', {
  body: 'demo-system', strict: false, repoRoot: repo,
  organ: { id: 'wheel-actuator', name: '轮角执行', gist: '把想要的转向变成轮子真的转过去。', systems: ['act'] },
})

const altBad = await call('anatomy_organ_put', { body: 'demo-system', organ: { id: 'wheel-actuator', name: '轮角执行', gist: '把想要的转向变成轮子真的转过去。', systems: ['act'], alt: 1.5 } })
ok('alt 超范围被抓到', altBad.warnings.some((w) => w.code === 'organ/alt-range'), JSON.stringify(altBad.warnings.map((w) => w.code)))

writeFileSync(controllerFile, 'void Controller::detectStall() {}\nvoid Controller::steer() {}\nvoid Controller::finish() {}\n', 'utf8')
const drifted = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('符号改名 → 报锚点漂移（strict 下属 error）',
  drifted.errors.some((e) => e.code === 'anchor/symbol-missing'),
  JSON.stringify([...drifted.errors, ...drifted.warnings].map((d) => d.code)))
writeFileSync(controllerFile, 'void Controller::detect() {}\nvoid Controller::steer() {}\nvoid Controller::finish() {}\n', 'utf8')

console.log('\n[4b] 锚点检查的仓库根：宁可说"没查"，不许编假错误')
/* 解剖体住在别的仓库里时，拿插件根目录当仓库根会把每条锚点都报成"文件不存在"——
   假错误会把人逼去 force=true，零容忍就废了。这条守住：没给 repoRoot 就不编。 */
const outside = mkdtempSync(join(tmpdir(), 'anatomy-e2e-outside-'))
const outsideBody = join(outside, 'anatomy-demo-system')
mkdirSync(outsideBody, { recursive: true })
cpSync(join(work, 'anatomy-demo-system'), outsideBody, { recursive: true })
const probe = {
  id: 'probe-organ', name: '探针器官', gist: '用来试锚点检查的临时器官。', kind: 'act', systems: ['act'],
  story: '写一句人话：它只负责让测试看得见。', not_responsible: ['不参与任何控制'],
  composition: [{ name: '标记输出', role: '产生测试标记' }], contract: { out: ['探针标记'] },
  observables: ['探针标记'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::steer' }],
}
const noRoot = await call('anatomy_organ_put', { dir: outsideBody, organ: { ...probe } })
ok('外仓、没给 repoRoot：写入照常通过', noRoot.ok === true, JSON.stringify(noRoot.error))
ok('外仓、没给 repoRoot：一条假锚点错误都不编',
  !(noRoot.errors ?? []).some((e) => e.code === 'anchor/file-missing'),
  JSON.stringify((noRoot.errors ?? []).map((e) => e.code)))
ok('外仓、没给 repoRoot：明写「本次未做锚点检查」（不查≠查过）',
  (noRoot.warnings ?? []).some((w) => w.code === 'anchor/not-checked'),
  JSON.stringify((noRoot.warnings ?? []).map((w) => w.code)))
const withRoot = await call('anatomy_organ_put', { dir: outsideBody, repoRoot: repo, organ: { ...probe, id: 'probe-organ-2' } })
ok('给了 repoRoot：锚点又真查了（且查得到）',
  withRoot.ok === true && !(withRoot.warnings ?? []).some((w) => w.code === 'anchor/not-checked'),
  JSON.stringify((withRoot.warnings ?? []).map((w) => w.code)))
const withBadRoot = await call('anatomy_organ_put', {
  dir: outsideBody, repoRoot: repo,
  organ: { ...probe, id: 'probe-organ-3', anchors: [{ file: 'src/no-such-file.cpp', symbol: 'X::y' }] },
})
ok('给了 repoRoot 但锚点真错：照样拦住（零容忍没有被这次修改放宽）',
  withBadRoot.ok === false && (withBadRoot.errors ?? []).some((e) => e.code === 'anchor/file-missing'),
  JSON.stringify((withBadRoot.errors ?? []).map((e) => e.code)))

console.log('\n[4c] 新工程约定：四件事自己开，不用人提醒')
/* ① 解剖体住在自己工程目录下：给工程目录就按约定建，slug 从工程目录名推，仓库根记进 body.json */
const npProj = join(work, 'widget-proj')
mkdirSync(join(npProj, 'src'), { recursive: true })
writeFileSync(join(npProj, 'src', 'widget.cpp'), 'void Widget::spin() {}\nvoid Widget::stop() {}\n', 'utf8')
const npInit = await call('anatomy_init', {
  repo: npProj, title: '小部件工程', oneline: '验证新工程约定。',
  systems: [{ id: 'sensing', name: '感知系统' }, { id: 'acting', name: '运动系统' }],
})
ok('给工程目录 → 解剖体建在工程里', npInit.ok === true && npInit.dir === join(npProj, 'anatomy-widget-proj'), npInit.dir)
ok('slug 从工程目录名推（不再是 body）', npInit.body.slug === 'widget-proj', String(npInit.body.slug))
ok('仓库根记进 body.json（后续锚点检查自动用）', npInit.body.repoRoot === npProj, String(npInit.body.repoRoot))
ok('建身体就自动装上起步规则（每个系统一条容量上限）',
  (npInit.policy?.rules ?? 0) === 2 && npInit.policy.ids.every((id) => id.startsWith('cap-')),
  JSON.stringify(npInit.policy))
/* ② 之后写入不用再传 repoRoot：锚点照样真查（对错都能判） */
const npWrite = await call('anatomy_organ_put', {
  body: 'widget-proj', organ: {
    id: 'eye', name: '眼睛', gist: '看外面有什么。', kind: 'sense', systems: ['sensing'], status: 'active',
    composition: [{ name: '画面采集', role: '采集外部画面' }], contract: { out: ['画面'] },
    story: '看。', not_responsible: ['不想事情'], observables: ['画面流'],
    anchors: [{ file: 'src/widget.cpp', symbol: 'Widget::spin' }],
  },
})
ok('不传 repoRoot 也能查锚点（用了 body.json 里记的仓库根）',
  npWrite.ok === true && !(npWrite.warnings ?? []).some((w) => w.code === 'anchor/not-checked'),
  JSON.stringify((npWrite.warnings ?? []).map((w) => w.code)))
const npWrong = await call('anatomy_organ_put', {
  body: 'widget-proj', organ: {
    id: 'eye', name: '眼睛', gist: '看外面有什么。', kind: 'sense', systems: ['sensing'], status: 'active',
    composition: [{ name: '画面采集', role: '采集外部画面' }], contract: { out: ['画面'] },
    story: '看。', not_responsible: ['不想事情'], observables: ['画面流'],
    anchors: [{ file: 'src/widget.cpp', symbol: 'Widget::noSuchThing' }],
  },
})
ok('锚点真错时照样拦住（自动用仓库根，不是不查）',
  npWrong.ok === false && (npWrong.errors ?? []).some((e) => e.code === 'anchor/symbol-missing'),
  JSON.stringify((npWrong.errors ?? []).map((e) => e.code)))
/* ③ 落地顺序陷阱：先点名要补成分的血脉，而不是甩一屏诊断 */
await call('anatomy_organ_put', {
  body: 'widget-proj', organ: {
    id: 'wheel', name: '转轮', gist: '让轮子转。', kind: 'act', systems: ['acting'], status: 'planned',
    composition: [{ name: '轮驱动', role: '控制轮子旋转' }], contract: { in: ['画面'], out: ['转速'] },
    story: '转。', not_responsible: ['不拿主意'], observables: ['转速'], anchors: [{ file: 'src/widget.cpp', symbol: 'Widget::stop' }],
  },
})
await call('anatomy_flow_put', {
  body: 'widget-proj', flow: { id: 'see-to-spin', name: '直连', from: 'eye', to: 'wheel', medium: 'data', gist: '把看到的东西直接给转轮。' },
})
const npNeedPayload = await call('anatomy_activate', { body: 'widget-proj', all: true })
ok('落地被"血脉缺成分"拦住时，直接点名是哪几条',
  npNeedPayload.ok === false && npNeedPayload.error?.code === 'anatomy/flows-need-payload' && (npNeedPayload.flows ?? []).includes('see-to-spin'),
  JSON.stringify(npNeedPayload.error))
ok('并给出下一步（先补 payload）', String(npNeedPayload.hint ?? '').includes('see-to-spin') && String(npNeedPayload.hint ?? '').includes('payload'))
await call('anatomy_flow_put', {
  body: 'widget-proj', flow: { id: 'see-to-spin', name: '直连', from: 'eye', to: 'wheel', medium: 'data', gist: '把看到的东西直接给转轮。', payload: [{ name: '画面', role: '看到的东西' }] },
})
const npActivated = await call('anatomy_activate', { body: 'widget-proj', all: true })
ok('补完成分后落地通过', npActivated.ok === true, JSON.stringify(npActivated.error))
/* ④ freeze：把现状固化成规则（连接 + 容量），且按定义 0 违规 */
const npFrozen = await call('anatomy_policy', { body: 'widget-proj', action: 'freeze' })
ok('freeze 按现状固化出连接与容量规则',
  npFrozen.ok === true && npFrozen.policy.rules.some((r) => r.type === 'require-link') && npFrozen.policy.rules.some((r) => r.type === 'max-organs'),
  JSON.stringify(npFrozen.policy.rules.map((r) => r.id)))
ok('freeze 之后 0 违规', (npFrozen.violations ?? []).length === 0, JSON.stringify(npFrozen.violations))
const npCut = await call('anatomy_remove', { body: 'widget-proj', kind: 'flow', id: 'see-to-spin', cascade: true })
const npAfterCut = await call('anatomy_check', { body: 'widget-proj' })
const npLocked = await call('anatomy_organ_put', {
  body: 'widget-proj',
  organ: { id: 'locked-probe', name: '锁探针', gist: '用来验证违规状态下写不进去。', kind: 'act', systems: ['acting'], status: 'planned' },
})
ok('删除被门禁阻止，原图仍有效且可继续写入',
  npCut.ok === false && npAfterCut.ok === true && npLocked.ok === true,
  JSON.stringify((npLocked.errors ?? []).map((e) => e.code)))
await call('anatomy_flow_put', {
  body: 'widget-proj',
  flow: { id: 'see-to-spin', name: '直连', from: 'eye', to: 'wheel', medium: 'data', gist: '把看到的东西直接给转轮。', payload: [{ name: '画面', role: '看到的东西' }] },
})
const npRestored = await call('anatomy_check', { body: 'widget-proj' })
ok('把连接补回来，身体又回到 0 error', npRestored.ok === true, JSON.stringify(npRestored.errors.map((e) => e.code)))
ok('固化之后连接被删会被规则抓住（require-link 生效）',
  npCut.ok === false || (npAfterCut.errors ?? []).concat(npAfterCut.warnings ?? []).some((d) => String(d.code).startsWith('policy/link-')),
  JSON.stringify([...(npAfterCut.errors ?? []), ...(npAfterCut.warnings ?? [])].map((d) => d.code)))

console.log('\n[4d] 读-改-写不许静默改状态')
await call('anatomy_scaffold', {
  body: 'widget-proj',
  organs: [{ id: 'spare', name: '备件轮', gist: '还没写代码的器官。', kind: 'act', systems: ['acting'], status: 'planned' }],
})
const humanRead = await call('anatomy_show', { body: 'widget-proj', organ: 'spare' })
if (humanRead.organ === undefined) console.log('   [调试] show 回执：', JSON.stringify(humanRead).slice(0, 300))
ok('人读面带状态角标（设计态/已落地是给人看的）', humanRead.organ.status === 'planned', String(humanRead.organ.status))
ok('人读面回执提醒：要写回请用 level=agent', String(humanRead.hint ?? '').includes('level=agent'))
const writeBack = await call('anatomy_organ_put', {
  body: 'widget-proj',
  organ: { ...humanRead.organ, composition: [{ name: '备件驱动', role: '执行备用转动' }], contract: { in: ['备用指令'] }, story: '补一句叙述。', anchors: [{ file: 'src/widget.cpp', symbol: 'Widget::stop' }] },
})
ok('把人读面写回去不会把设计态悄悄变成已落地',
  writeBack.ok === true && writeBack.organ.status === 'planned', String(writeBack.organ?.status))
const activateNoBoundary = await call('anatomy_activate', { body: 'widget-proj', ids: ['spare'] })
ok('落地门槛仍在：缺「不负责什么」照样被拒',
  activateNoBoundary.ok === false && (activateNoBoundary.errors ?? []).some((e) => e.code === 'organ/not-responsible-missing'),
  JSON.stringify((activateNoBoundary.errors ?? []).map((e) => e.code)))
const fixedOrgan = await call('anatomy_organ_put', {
  body: 'widget-proj',
  organ: {
    ...writeBack.organ, story: '补一句叙述。', not_responsible: ['不参与控制'], observables: ['占位标记'],
    anchors: [{ file: 'src/widget.cpp', symbol: 'Widget::stop' }],
  },
})
ok('补上边界后仍是设计态（写回没把状态改掉）', fixedOrgan.ok === true && fixedOrgan.organ.status === 'planned', String(fixedOrgan.organ?.status))
const explicitActivate = await call('anatomy_activate', { body: 'widget-proj', ids: ['spare'] })
ok('落地仍要显式做（activate）', explicitActivate.ok === true && (explicitActivate.activated ?? []).includes('spare'),
  JSON.stringify(explicitActivate.error))

console.log('\n[5] 两个读者：人读面 / 机读面')
const human = await call('anatomy_show', { body: 'demo-system', level: 'human' })
ok('人读面不含成分与锚点', human.organs.every((o) => o.composition === undefined && o.anchors === undefined))
ok('人读面保留边界', human.organs[0].not_responsible.length > 0)
const machine = await call('anatomy_show', { body: 'demo-system', level: 'agent' })
ok('机读面含成分与锚点', machine.organs.some((o) => (o.composition ?? []).length > 0) && machine.organs.some((o) => (o.anchors ?? []).length > 0))

const map = await call('anatomy_map', { body: 'demo-system', write: true, repoRoot: repo })
ok('人读地图生成', map.ok === true && map.text.includes('堵转判定'))
ok('人读地图不出现成分/锚点字样', !map.text.includes('锚点') && !map.text.includes('成分'))
ok('MAP.md 落盘', existsSync(join(work, 'anatomy-demo-system', 'MAP.md')))

const digest = await call('anatomy_digest', { body: 'demo-system', level: 'full', write: true, repoRoot: repo })
ok('AI 摘要含成分与锚点', digest.text.includes('成分：') && digest.text.includes('锚点：'))
ok('AI 摘要含边界', digest.text.includes('不负责：'))
ok('DIGEST.md 落盘', existsSync(join(work, 'anatomy-demo-system', 'DIGEST.md')))

const brief = await call('anatomy_brief', { repoRoot: repo, body: 'demo-system', organ: 'stall-judge' })
ok('术前须知含边界与上下游', brief.text.includes('它不负责什么') && brief.text.includes('上游'))

console.log('\n[6] 渲染解剖图')
const rendered = await call('anatomy_render', { body: 'demo-system', repoRoot: repo })
const html = readFileSync(rendered.file, 'utf8')
ok('渲染成功', rendered.ok === true && rendered.bytes > 8000, String(rendered.bytes))
ok('HTML 含标题与数据', html.includes('示例系统') && html.includes('stall-judge'))
ok('HTML 已注入数据（无残留占位符）', !html.includes('__PAYLOAD__') && html.includes('const A = {'))
ok('HTML 默认是自由画板，无 3D 主界面', html.includes('id="surface"') && !html.includes('id="chart3d"'))
ok('HTML 含双模式开关', html.includes('data-tab="program"') && html.includes('data-tab="human"'))
ok('HTML 每个部位可独立编辑并关联程序', html.includes('data-id=') && html.includes('implementation.code'))
ok('HTML 单文件无外链', !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html))

console.log('\n[7] 引用保护')
const blocked = await call('anatomy_remove', { body: 'demo-system', repoRoot: repo, kind: 'organ', id: 'stall-judge' })
ok('被血脉连着的器官不能直接删', blocked.ok === false && blocked.error?.code === 'anatomy/referenced')
ok('返回被牵连的血脉', (blocked.flows ?? []).length === 1)
const cascaded = await call('anatomy_remove', { body: 'demo-system', repoRoot: repo, kind: 'organ', id: 'stall-judge', cascade: true })
ok('cascade 删除成功', cascaded.ok === true && cascaded.removed_flows.length === 1)

console.log('\n[8] 零容忍门禁（写入与交付都拒绝带病通过）')
const badWrites = [
  ['器官引用未声明系统', 'anatomy_organ_put', { body: 'demo-system', organ: { id: 'bad1', name: '坏甲', gist: '一句话。', systems: ['nope'] } }],
  ['器官缺一句话', 'anatomy_organ_put', { body: 'demo-system', organ: { id: 'bad2', name: '坏乙', gist: '', systems: ['sense'] } }],
  ['血脉指向不存在器官', 'anatomy_flow_put', { body: 'demo-system', flow: { id: 'badf', name: '坏流', from: 'ghost', to: 'wheel-actuator', medium: 'data', gist: '送东西。' } }],
  ['血脉用未声明物质', 'anatomy_flow_put', { body: 'demo-system', flow: { id: 'badf2', name: '坏流', from: 'wheel-actuator', to: 'stall-judge', medium: 'unobtainium', gist: '送东西。' } }],
  ['血脉自环', 'anatomy_flow_put', { body: 'demo-system', flow: { id: 'badf3', name: '坏流', from: 'wheel-actuator', to: 'wheel-actuator', medium: 'data', gist: '送东西。' } }],
]
for (const [label, tool, args] of badWrites) {
  const r = await call(tool, args)
  ok('写入被拦：' + label, r.ok === false && r.error?.code === 'anatomy/precheck-failed', JSON.stringify(r.error))
}
ok('被拦的写入没有落盘', !existsSync(join(work, 'anatomy-demo-system', 'organs', 'bad1.json')))

const forced = await call('anatomy_organ_put', { body: 'demo-system', organ: { id: 'bad1', name: '坏甲', gist: '一句话。', systems: ['nope'] }, force: true })
ok('force 是唯一的带病入口', forced.ok === true)
const blockedRender = await call('anatomy_render', { body: 'demo-system', repoRoot: repo })
ok('有 error 时拒绝出图', blockedRender.ok === false && blockedRender.error?.code === 'anatomy/precheck-failed', JSON.stringify(blockedRender.error))
const blockedDigest = await call('anatomy_digest', { body: 'demo-system', repoRoot: repo })
ok('有 error 时拒绝出摘要', blockedDigest.ok === false)
const blockedMap = await call('anatomy_map', { body: 'demo-system', repoRoot: repo })
ok('有 error 时拒绝出人读地图', blockedMap.ok === false)
const forcedRender = await call('anatomy_render', { body: 'demo-system', repoRoot: repo, force: true })
ok('force 出图会打上红色横幅', forcedRender.ok === true && readFileSync(forcedRender.file, 'utf8').includes('体检未通过'))
await call('anatomy_remove', { body: 'demo-system', repoRoot: repo, kind: 'organ', id: 'bad1' })
const recovered = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('清掉坏数据后恢复 0 error', recovered.ok === true, JSON.stringify(recovered.errors))

console.log('\n[9] 强校验：架构规则 / 体检回执 / 原子性')
const sc9 = await call('anatomy_scaffold', { body: 'demo-system', repoRoot: repo, organs: [
  { id: 'sensor', name: '感知甲', gist: '看东西。', systems: ['sense'], story: '叙述。', composition: [{ name: '采集', role: '生成读数' }], contract: { out: ['读数'] }, not_responsible: ['不想事情'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::detect' }] },
] })
ok('准备一个跨系统器官', sc9.ok === true, JSON.stringify(sc9.error))

const setRule = await call('anatomy_policy', { body: 'demo-system', action: 'set', repoRoot: repo, rules: [
  { id: 'no-sense-to-act', type: 'forbid-flow', from: ['sense'], to: ['act'] },
] })
ok('架构规则写入成功', setRule.ok === true, JSON.stringify(setRule.error))
const badFlow = await call('anatomy_flow_put', { body: 'demo-system', repoRoot: repo, flow: { id: 'violate', name: '越界流', from: 'sensor', to: 'wheel-actuator', medium: 'data', gist: '直接把感知送进执行。', payload: [{ name: '读数', role: '用途' }] } })
ok('禁流规则拦住违规血流', badFlow.ok === false && badFlow.errors.some((e) => e.code === 'policy/no-sense-to-act'), JSON.stringify(badFlow.error))
const okFlow = await call('anatomy_flow_put', { body: 'demo-system', repoRoot: repo, flow: { id: 'allowed', name: '合规流', from: 'wheel-actuator', to: 'sensor', medium: 'data', gist: '把执行结果回送给感知。', payload: [{ name: '结果', role: '用途' }] } })
ok('反向（合规）血流放行', okFlow.ok === true, JSON.stringify(okFlow.error))

const layer = await call('anatomy_policy', { body: 'demo-system', action: 'set', repoRoot: repo, rules: [{ id: 'up-only', type: 'layer-direction', direction: 'up' }] })
ok('层级方向规则写入', layer.ok === true, JSON.stringify(layer.error))
const downFlow = await call('anatomy_flow_put', { body: 'demo-system', repoRoot: repo, flow: { id: 'allowed', name: '合规流', from: 'wheel-actuator', to: 'sensor', medium: 'data', gist: '把执行结果回送给感知。', payload: [{ name: '结果', role: '用途' }] } })
ok('层级方向规则拦住逆流', downFlow.ok === false && downFlow.errors.some((e) => e.code === 'policy/up-only'), JSON.stringify(downFlow.error))

const cycRule = await call('anatomy_policy', { body: 'demo-system', action: 'set', repoRoot: repo, rules: [{ id: 'no-cycle', type: 'no-cycle' }] })
ok('禁环规则写入', cycRule.ok === true, JSON.stringify(cycRule.error))
const mkCycle = await call('anatomy_flow_put', { body: 'demo-system', repoRoot: repo, flow: { id: 'back', name: '回流', from: 'sensor', to: 'wheel-actuator', medium: 'data', gist: '回流。', payload: [{ name: '东西', role: '用途' }] } })
ok('禁环规则拦住成环', mkCycle.ok === false && mkCycle.errors.some((e) => e.code === 'policy/no-cycle'), JSON.stringify(mkCycle.error))

const starter = await call('anatomy_policy', { body: 'demo-system', action: 'default', repoRoot: repo })
ok('action=default 回到起步规则（每个系统一条容量上限）',
  starter.ok === true && starter.policy.rules.length === 2 && starter.policy.rules.every((r) => r.type === 'max-organs'),
  JSON.stringify(starter.policy.rules.map((r) => r.id)))
const cleared = await call('anatomy_policy', { body: 'demo-system', action: 'clear', repoRoot: repo })
ok('action=clear 才清空所有规则', cleared.ok === true && cleared.policy.rules.length === 0)
const calm = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('清空规则后回到 0 error', calm.ok === true, JSON.stringify(calm.errors.map((e) => e.code)))

const first = await call('anatomy_render', { body: 'demo-system', repoRoot: repo })
const rec1 = JSON.parse(readFileSync(first.receipt, 'utf8'))
ok('渲染写出体检回执', rec1.schema === 'anatomy-receipt/1' && rec1.check.errors === 0 && typeof rec1.anatomyHash === 'string')
ok('回执含产物哈希与计分', typeof rec1.artifacts['anatomy.html'].sha256 === 'string' && rec1.artifacts['anatomy.html'].bytes > 5000 && rec1.counts.organs >= 2 && rec1.counts.flows >= 1)
ok('回执记录了 strict 与规则数', rec1.strict === true && rec1.policy.rules === 0)   // 上面刚 clear 过，这里应为 0
await call('anatomy_organ_put', { body: 'demo-system', repoRoot: repo, organ: { id: 'sensor', name: '感知甲', gist: '改过的看东西。', systems: ['sense'], story: '叙述。', composition: [{ name: '采集', role: '生成读数' }], contract: { out: ['读数'] }, not_responsible: ['不想事情'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::detect' }] } })
const second = await call('anatomy_render', { body: 'demo-system', repoRoot: repo })
const rec2 = JSON.parse(readFileSync(second.receipt, 'utf8'))
ok('数据一改，回执指纹就变', rec1.anatomyHash !== rec2.anatomyHash)
ok('产物哈希随内容变化', rec1.artifacts['anatomy.html'].sha256 !== rec2.artifacts['anatomy.html'].sha256)
ok('目录里没有 .tmp 残留', readdirSync(join(work, 'anatomy-demo-system')).every((n) => !n.endsWith('.tmp')))

console.log('\n[10] 新工程共读：设计态先行')
const fresh = await call('anatomy_init', {
  body: 'greenfield', title: '新工程', oneline: '还没写代码，先把身体画出来。',
  systems: [{ id: 'core', name: '核心', alt: 0 }, { id: 'edge', name: '外围', alt: 1 }],
})
ok('新工程初始化', fresh.ok === true, JSON.stringify(fresh.error))
const draft = await call('anatomy_scaffold', { body: 'greenfield', organs: [
  { id: 'p1', name: '计划甲', gist: '将来负责甲这件事。', status: 'planned', systems: ['core'] },
  { id: 'p2', name: '计划乙', gist: '将来负责乙这件事。', status: 'planned', systems: ['edge'] },
], flows: [
  { id: 'pf', name: '计划流', from: 'p1', to: 'p2', medium: 'data', gist: '甲把东西交给乙。' },
] })
ok('设计态器官没有锚点/叙述也放行', draft.ok === true, JSON.stringify(draft.errors))
const draftCheck = await call('anatomy_check', { body: 'greenfield', repoRoot: repo })
ok('设计态体检 0 error', draftCheck.ok === true, JSON.stringify(draftCheck.errors.map((e) => e.code)))
ok('统计里能看到设计态数量', draftCheck.stats.planned === 2, JSON.stringify(draftCheck.stats))
const draftRender = await call('anatomy_render', { body: 'greenfield', repoRoot: repo })
ok('新工程当场就能出图共读', draftRender.ok === true, JSON.stringify(draftRender.error))
const act = await call('anatomy_activate', { body: 'greenfield', all: true, repoRoot: repo })
ok('没写锚点不允许转已落地', act.ok === false && act.error.code === 'anatomy/anchors-missing', JSON.stringify(act.error))
await call('anatomy_organ_put', { body: 'greenfield', repoRoot: repo, organ: { id: 'p1', name: '计划甲', gist: '将来负责甲这件事。', status: 'planned', systems: ['core'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::detect' }] } })
const actAnchorOnly = await call('anatomy_activate', { body: 'greenfield', ids: ['p1'], repoRoot: repo })
ok('只有锚点、没有叙述与边界，落地仍被拦', actAnchorOnly.ok === false && actAnchorOnly.errors.some((e) => e.code === 'organ/story-missing'), JSON.stringify(actAnchorOnly.errors ?? actAnchorOnly.error))
await call('anatomy_organ_put', { body: 'greenfield', repoRoot: repo, organ: { id: 'p1', name: '计划甲', gist: '将来负责甲这件事。', status: 'planned', systems: ['core'], story: '落地后补的叙述。', composition: [{ name: '甲处理', role: '完成甲职责' }], contract: { out: ['甲结果'] }, not_responsible: ['不负责乙'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::detect' }] } })
const act2 = await call('anatomy_activate', { body: 'greenfield', ids: ['p1'], repoRoot: repo })
ok('补齐锚点+叙述+边界后落地成功', act2.ok === true, JSON.stringify(act2.error))
const act3 = await call('anatomy_activate', { body: 'greenfield', ids: ['p1'], repoRoot: repo, force: true })
ok('落地过的器官不在待落地清单里', act3.ok === false && act3.error.code === 'anatomy/nothing-to-activate')

console.log('\n[11] 人改 → AI 读 → 回退')
const bundlePath = join(work, 'anatomy-edits.json')
writeFileSync(bundlePath, JSON.stringify({
  schema: 'anatomy-edits/1', body: 'demo-system', actor: 'human',
  edits: [
    { repoRoot: repo, kind: 'organ', id: 'wheel-actuator', patch: { gist: '人来改的一句话：把方向变成轮子的动作。', not_responsible: ['不决定方向', '不管速度'] } },
    { kind: 'organ', create: { id: 'handoff', name: '交接记录', gist: '记下每一次交还上层的原因。', systems: ['act'], story: '叙述。', composition: [{ name: '交接存储', role: '保留交接原因' }], contract: { in: ['交接原因'] }, not_responsible: ['不做判断'], anchors: [{ file: 'src/controller.cpp', symbol: 'Controller::finish' }] } },
  ],
}), 'utf8')
const applied = await call('anatomy_apply_edits', { body: 'demo-system', file: bundlePath, repoRoot: repo, allowUnversioned: true })
ok('人的修改包被应用', applied.ok === true && applied.applied.length === 2, JSON.stringify(applied.errors ?? applied.failed ?? applied.error))
ok('人的修改以 human 身份记账', applied.actor === 'human')
const readBack = await call('anatomy_show', { body: 'demo-system', level: 'agent', organ: 'wheel-actuator' })
ok('AI 读到的是人改后的内容', readBack.organ.gist.includes('人来改的一句话'), readBack.organ.gist)
ok('AI 也读到了人新加的器官', existsSync(join(work, 'anatomy-demo-system', 'organs', 'handoff.json')))

const badBundle = join(work, 'bad-edits.json')
writeFileSync(badBundle, JSON.stringify({ edits: [{ repoRoot: repo, kind: 'organ', id: 'wheel-actuator', patch: { gist: '人写的带代码 return x;' } }] }), 'utf8')
const rejected = await call('anatomy_apply_edits', { body: 'demo-system', file: badBundle, repoRoot: repo, allowUnversioned: true })
ok('人改错了同样被体检挡住', rejected.ok === false && rejected.error.code === 'anatomy/precheck-failed', JSON.stringify(rejected.error))
ok('被挡时告诉人改了哪几处', Array.isArray(rejected.applied) && rejected.applied.length === 1)
const afterReject = await call('anatomy_show', { body: 'demo-system', level: 'agent', organ: 'wheel-actuator' })
ok('被挡的修改没有落盘', afterReject.organ.gist.includes('人来改的一句话'))

const hist = await call('anatomy_history', { body: 'demo-system', limit: 50 })
ok('历史列出多版修订', hist.ok === true && hist.revisions.length >= 8, '共 ' + hist.revisions.length + ' 版')
ok('历史单列出当前工作状态', hist.working.anatomyHash === hist.currentHash && hist.revisions.every((r) => !r.isCurrent))
const humanRev = hist.revisions.find((r) => r.actor === 'human' && r.action === 'apply_edits')
ok('历史里能看到是谁改的', humanRev !== undefined, JSON.stringify(hist.revisions.slice(0, 3).map((r) => [r.rev, r.actor, r.action])))
const targetRev = hist.revisions[hist.revisions.length - 1].rev
const reverted = await call('anatomy_revert', { body: 'demo-system', rev: targetRev, repoRoot: repo })
ok('回退到最早一版成功', reverted.ok === true, JSON.stringify(reverted.error))
const gone = await call('anatomy_show', { body: 'demo-system', level: 'agent' })
ok('回退后新加的器官不在了', !gone.organs.some((o) => o.id === 'handoff'))
const hist2 = await call('anatomy_history', { body: 'demo-system', limit: 50 })
ok('回退本身也记了一版（可再退回来）', hist2.revisions.some((r) => r.action === 'revert:from') && hist2.revisions.some((r) => r.action === 'revert:to'))
ok('回退后当前状态精确落在那一版上', hist2.revisions.find((r) => r.action === 'revert:to').isCurrent === true)
const backAgain = await call('anatomy_revert', { body: 'demo-system', rev: hist2.revisions.find((r) => r.action === 'revert:from').rev, repoRoot: repo })
ok('退回撤销回退（回到人改后的状态）', backAgain.ok === true && existsSync(join(work, 'anatomy-demo-system', 'organs', 'handoff.json')))

console.log('\n[12] 人在界面保存 → AI 读工程就能读到')
const editsDir = join(work, 'anatomy-demo-system', 'edits')
mkdirSync(editsDir, { recursive: true })
writeFileSync(join(editsDir, 'anatomy-edits-human.json'), JSON.stringify({
  schema: 'anatomy-edits/1', body: 'demo-system', actor: 'human', at: new Date().toISOString(),
  baseHash: (await call('anatomy_show', { body: 'demo-system' })).anatomyHash,
  edits: [{ repoRoot: repo, kind: 'organ', id: 'sensor', patch: { gist: '人在界面上改的一句话。' } }],
}), 'utf8')
const checkWithPending = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('体检就能看到未落地的人工修改', Array.isArray(checkWithPending.pendingEdits) && checkWithPending.pendingEdits.length === 1, JSON.stringify(checkWithPending.pendingEdits))
ok('并且给出明确提示', typeof checkWithPending.hint === 'string' && checkWithPending.hint.includes('还没落地'))
const digestBlocked = await call('anatomy_digest', { body: 'demo-system', repoRoot: repo })
ok('有未落地修改时拒绝出摘要（避免 AI 读到旧版本）', digestBlocked.ok === false && digestBlocked.error.code === 'anatomy/pending-edits', JSON.stringify(digestBlocked.error))
const listed = await call('anatomy_pending_edits', { body: 'demo-system' })
ok('待处理清单列出修改包', listed.ok === true && listed.pending.length === 1 && listed.pending[0].count === 1)
const appliedAll = await call('anatomy_pending_edits', { body: 'demo-system', apply: true, repoRoot: repo })
ok('一键落地人工修改', appliedAll.ok === true && appliedAll.applied[0].ok === true, JSON.stringify(appliedAll.applied))
ok('落地后归档到 edits/applied/', typeof appliedAll.applied[0].archived === 'string' && existsSync(appliedAll.applied[0].archived))
ok('原修改包已移走（不会重复应用）', !existsSync(join(editsDir, 'anatomy-edits-human.json')))
const afterApply = await call('anatomy_check', { body: 'demo-system', repoRoot: repo })
ok('落地后没有待处理修改了', afterApply.pendingEdits.length === 0)
const sensorNow = await call('anatomy_show', { body: 'demo-system', level: 'agent', organ: 'sensor' })
ok('AI 读到的是人改后的内容', sensorNow.organ.gist === '人在界面上改的一句话。', sensorNow.organ.gist)
const digestOk = await call('anatomy_digest', { body: 'demo-system', repoRoot: repo })
ok('摘要恢复正常', digestOk.ok === true)
const histAfter = await call('anatomy_history', { body: 'demo-system', limit: 5 })
ok('这次落地在历史里可回退', histAfter.revisions.some((r) => r.actor === 'human'))

console.log('\n' + '='.repeat(52))
console.log('通过 ' + passed + ' 项' + (failures.length ? '，失败 ' + failures.length + ' 项' : '，全部通过'))
if (failures.length) {
  for (const failure of failures) console.log('  ✗ ' + failure)
  process.exit(1)
}
console.log('工作目录：' + work)
