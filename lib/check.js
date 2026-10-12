import { boardDiagnostics } from './board.js'
import { collectAnchors, ORGAN_KINDS, scanAnchors } from './store.js'
import { evaluatePolicy, POLICY_SCHEMA, l1ValidatePolicy } from './policy.js'
import { semanticDiagnostics, programTrace, temporalModel } from './semantics.js'
import { scenarioDiagnostics, mappingIndex } from './mapping.js'

/**
 * 体检：把「解剖体是否还能被人和 AI 正确共读」变成可执行规则。
 *
 * 两类规则的分工很明确：
 *  - error   结构性错误：指到不存在的器官/血脉/系统，读的人会被误导；
 *  - warning 共读质量问题：一句话太长、叙述里混进实现、器官和任何血脉都不相连、锚点漂移。
 */
/**
 * 共读质量类规则：在 strict（默认开）下与结构错误同级，一样挡住写入与交付。
 * 理由很简单——这份数据的读者是人（不看代码，只能信叙述）和 AI（照着它改代码），
 * "缺一句人话""没说边界""锚点漂了"不是风格问题，是会让读者判断错的问题。
 * 想放宽：插件配置 strict:false，或单次调用传 strict:false。
 */
const STRICT_PROMOTED = new Set([
  'organ/story-missing', 'organ/not-responsible-missing',
  'organ/composition-missing', 'organ/contract-missing',
  'organ/implementation-in-prose', 'organ/anchor-missing', 'organ/kind-unknown',
  'flow/implementation-in-prose', 'flow/payload-missing',
  'anchor/symbol-missing', 'anchor/symbol-weak',
  'anchor/source-changed',
  'policy/invalid-rule',
])
/* 刻意不提升：organ/isolated 与 system/disconnected 是"图还没长全"的提示，
   不是错误——增量写作时先加器官、后接血脉是正常节奏，硬拦会让人没法一步步来。 */

export function checkBody(body, organs, flowDoc, options = {}) {
  const strict = options.strict !== false
  const errors = []
  const warnings = []
  const err = (code, message, subject, hint) => errors.push({ level: 'error', code, message, subject, ...(hint ? { hint } : {}) })
  const warn = (code, message, subject, hint) => {
    const bucket = strict && STRICT_PROMOTED.has(code) ? errors : warnings
    bucket.push({ level: strict && STRICT_PROMOTED.has(code) ? 'error' : 'warning', code, message, subject, ...(hint ? { hint } : {}), ...(strict && STRICT_PROMOTED.has(code) ? { promoted: true } : {}) })
  }

  /* 磁盘上的架构规则也要过 L1：type 拼错（例如写成 no-cycles）会让那条规则静默失效，
     等于门禁被悄悄关掉。strict 下按 error 挡，宽松模式至少给出警告。 */
  if (options.policy !== null && options.policy !== undefined) {
    const policyDoc = { schema: POLICY_SCHEMA, rules: Array.isArray(options.policy.rules) ? options.policy.rules : [] }
    for (const problem of l1ValidatePolicy(policyDoc).errors) {
      warn('policy/invalid-rule', '架构规则无效：' + (problem.message ?? problem.code ?? '未知问题'), { policy: problem.id ?? null }, '改 anatomy-policy.json，或让 anatomy_policy 重新固化规则')
    }
  }
  const systems = new Set((body.systems ?? []).map((s) => s.id))
  const media = new Set((body.media ?? []).map((m) => m.id))
  const flows = flowDoc.flows ?? []
  const byId = new Map(organs.map((o) => [o.id, o]))

  /* ---- 解剖体本身 ---- */
  if (typeof body.title !== 'string' || body.title.trim() === '') err('body/title-missing', '解剖体没有标题', { body: body.slug })
  if (typeof body.oneline !== 'string' || body.oneline.trim() === '') {
    err('body/oneline-missing', '解剖体缺少「一句话」，人类读者没有入口', { body: body.slug }, '补 oneline：这个系统整体在干什么')
  } else if (body.oneline.length > 80) {
    warn('body/oneline-long', '整体一句话 ' + body.oneline.length + ' 字，超过 80 字', { body: body.slug }, '人类阅读面只留一句；细节写进器官')
  }
  if ((body.systems ?? []).length === 0 && !(body.board && organs.length===0)) err('system/none', '没有声明任何系统', { body: body.slug })

  /* ---- 器官 ---- */
  const organUse = new Map()
  for (const organ of organs) {
    const at = { organ: organ.id }
    const planned = organ.status === 'planned'   // 设计态：先画图、后落地
    if (!/^[a-z][a-z0-9-]*$/.test(organ.id)) {
      err('organ/id-format', '器官 id 必须是 kebab-case 小写短名：' + organ.id, at)
    }
    if (typeof organ.name !== 'string' || organ.name.trim() === '') err('organ/name-missing', '器官缺少名字：' + organ.id, at)
    if (organ.gist === undefined || organ.gist === '') {
      err('organ/gist-missing', '器官缺少「一句话」：' + organ.id, at, '人类只读这一句：这是什么器官')
    } else if (organ.gist.length > 60) {
      warn('organ/gist-long', '器官「' + organ.id + '」的一句话 ' + organ.gist.length + ' 字，超过 60 字', at, '压到一句能读完；细节移到 story')
    }
    if ((organ.systems ?? []).length === 0) {
      err('organ/no-system', '器官不属于任何系统，图上无处安放：' + organ.id, at)
    }
    for (const system of organ.systems ?? []) {
      if (!systems.has(system)) err('organ/unknown-system', '器官 ' + organ.id + ' 引用了未声明系统：' + system, at, '先在 body.systems 里声明该系统')
      organUse.set(system, (organUse.get(system) ?? 0) + 1)
    }
    if (organ.parent !== undefined && organ.parent !== null && !byId.has(organ.parent)) {
      err('organ/parent-missing', '器官 ' + organ.id + ' 的父器官不存在：' + organ.parent, at)
    }
    if (organ.alt !== undefined && (typeof organ.alt !== 'number' || organ.alt < 0 || organ.alt > 1)) {
      warn('organ/alt-range', '器官 ' + organ.id + ' 的 alt 必须在 0..1：' + String(organ.alt), at, 'alt 覆盖立体视图里的高度')
    }
    if (organ.kind !== undefined && !ORGAN_KINDS.includes(organ.kind)) {
      warn('organ/kind-unknown', '器官 ' + organ.id + ' 的类型不在约定集合内：' + organ.kind, at, '可用：' + ORGAN_KINDS.join(' / '))
    }
    if (!planned) {
      if (!(organ.composition ?? []).some((p) => typeof p.name === 'string' && p.name.trim() && typeof p.role === 'string' && p.role.trim())) {
        warn('organ/composition-missing', '器官 ' + organ.id + ' 缺少有效成分（名字和作用）', at)
      }
      if (!['in', 'out', 'invariants'].some((key) => Array.isArray(organ.contract?.[key]) && organ.contract[key].some((v) => typeof v === 'string' && v.trim()))) {
        warn('organ/contract-missing', '器官 ' + organ.id + ' 缺少契约：至少写一条输入、输出或不变量', at)
      }
      if (typeof organ.story !== 'string' || organ.story.trim() === '') {
        warn('organ/story-missing', '器官 ' + organ.id + ' 只有一句话，AI 无法据此工作', at, '补 story：它怎么做、什么时候退让（自然语言，不写实现）')
      }
      if ((organ.anchors ?? []).length === 0) {
        warn('organ/anchor-missing', '器官 ' + organ.id + ' 没有锚点，无法判断是否已与代码脱节', at)
      }
      if ((organ.not_responsible ?? []).length === 0) {
        warn('organ/not-responsible-missing', '器官 ' + organ.id + ' 没有写「不负责什么」', at, '边界是防止 AI 误判最值钱的一行')
      }
    }
    for (const [field, value] of [['gist', organ.gist], ['story', organ.story ?? '']]) {
      const trace = implementationTrace(value)
      if (trace !== null) {
        warn('organ/implementation-in-prose', '器官 ' + organ.id + ' 的 ' + field + ' 里出现实现痕迹「' + trace + '」', at, '共读层省略实现：写成自然语言，把代码交给锚点')
      }
    }
  }
  for (let i = 0; i < organs.length; i++) {
    for (let j = i + 1; j < organs.length; j++) {
      if (organs[i].id === organs[j].id) err('organ/duplicate', '器官 id 重复：' + organs[i].id, { organ: organs[i].id })
    }
  }
  // 父器官成环
  for (const organ of organs) {
    const seen = new Set([organ.id])
    let cursor = organ.parent
    while (cursor !== undefined && cursor !== null) {
      if (seen.has(cursor)) {
        err('organ/parent-cycle', '构成关系成环：' + [...seen, cursor].join(' → '), { organ: organ.id })
        break
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parent
    }
  }
  for (const system of body.systems ?? []) {
    if ((organUse.get(system.id) ?? 0) === 0) warn('system/empty', '系统「' + system.name + '」里没有任何器官', { system: system.id }, '要么补器官，要么删掉这个系统')
    if (system.alt !== undefined && (typeof system.alt !== 'number' || system.alt < 0 || system.alt > 1)) {
      warn('system/alt-range', '系统「' + system.name + '」的 alt 必须在 0..1：' + String(system.alt), { system: system.id }, 'alt 是立体视图里的层级，0 贴地、1 最高')
    }
    if (system.alt !== undefined && centerlineClash(body, system)) {
      warn('system/alt-tie', '系统「' + system.name + '」与另一个系统的 alt 完全相同', { system: system.id }, '两层同高在立体视图里会叠在一起')
    }
  }

  /* ---- 血脉 ---- */
  const flowIds = new Set()
  const connected = new Set()
  const edgeSeen = new Map()
  for (const flow of flows) {
    const at = { flow: flow.id }
    if (!/^[a-z][a-z0-9-]*$/.test(flow.id)) err('flow/id-format', '血脉 id 必须是 kebab-case 小写短名：' + flow.id, at)
    if (flowIds.has(flow.id)) err('flow/duplicate', '血脉 id 重复：' + flow.id, at)
    flowIds.add(flow.id)
    if (!byId.has(flow.from)) err('flow/from-missing', '血脉 ' + flow.id + ' 的起点器官不存在：' + flow.from, at)
    if (!byId.has(flow.to)) err('flow/to-missing', '血脉 ' + flow.id + ' 的终点器官不存在：' + flow.to, at)
    if (flow.from === flow.to && flow.from !== '') err('flow/self-loop', '血脉 ' + flow.id + ' 首尾是同一个器官', at)
    if (!media.has(flow.medium)) {
      err('flow/medium-unknown', '血脉 ' + flow.id + ' 使用了未声明的物质：' + String(flow.medium), at, '先在 body.media 里声明这种「血」')
    }
    if (flow.gist === undefined || flow.gist === '') {
      err('flow/gist-missing', '血脉 ' + flow.id + ' 缺少一句话：人只想知道这管血送什么', at)
    }
    const flowPlanned = byId.get(flow.from)?.status === 'planned' || byId.get(flow.to)?.status === 'planned'
    if ((flow.payload ?? []).length === 0 && !flowPlanned) {
      warn('flow/payload-missing', '血脉 ' + flow.id + ' 没有写成分，AI 无法判断里面流的是什么', at, '补 payload：成分名 + 作用')
    }
    const trace = implementationTrace(flow.gist ?? '')
    if (trace !== null) warn('flow/implementation-in-prose', '血脉 ' + flow.id + ' 的一句话里出现实现痕迹「' + trace + '」', at)
    connected.add(flow.from)
    connected.add(flow.to)
    const edge = flow.from + '→' + flow.to + '|' + String(flow.medium)
    if (edgeSeen.has(edge)) {
      warn('flow/duplicate-edge', '血脉 ' + flow.id + ' 与 ' + edgeSeen.get(edge) + ' 是同一条通路（同起止、同物质）', at, '合并成一条，成分写进 payload')
    } else {
      edgeSeen.set(edge, flow.id)
    }
  }
  for (const organ of organs) {
    if (!connected.has(organ.id) && flows.length > 0) {
      warn('organ/isolated', '器官 ' + organ.id + ' 与任何血脉都不相连，在解剖图上是一座孤岛', { organ: organ.id })
    }
  }

  /* 血流成环不做内置判断：控制系统里血液本来就会回流（指令→状态→日志→人→复位→指令）。
     要"严禁成环"的人用 policy 里的 no-cycle 规则显式声明，那是他的建模选择，不是通用真理。 */

  /* ---- 系统级孤岛：整个系统与其它系统没有任何血流 ---- */
  const systemIds = (body.systems ?? []).map((s) => s.id)
  if (systemIds.length > 1 && flows.length > 0) {
    const linked = new Set()
    for (const flow of flows) {
      const a = byId.get(flow.from)?.systems ?? []
      const b = byId.get(flow.to)?.systems ?? []
      if (a.length === 0 || b.length === 0) continue
      if (a.some((x) => !b.includes(x)) || b.some((x) => !a.includes(x))) {
        for (const id of a) linked.add(id)
        for (const id of b) linked.add(id)
      }
    }
    for (const id of systemIds) {
      if (!linked.has(id)) warn('system/disconnected', '系统「' + systemId(body, id) + '」与其它系统之间没有任何血流', { system: id }, '补一条跨系统的血脉，或确认它本来就自成一体')
    }
  }

  /* ---- 架构规则（policy）：违规与结构错误走同一道门禁 ---- */
  if (options.policy) {
    for (const violation of evaluatePolicy(options.policy, { body, organs, flows })) {
      const bucket = violation.level === 'error' ? errors : warnings
      bucket.push(violation)
    }
  }

  if(body.board!==undefined) for(const problem of boardDiagnostics(body.board,organs,flows)) err(problem.code,problem.message,problem.subject)
  for (const problem of semanticDiagnostics(body, organs, flows)) err(problem.code, problem.message, problem.subject)
  for (const problem of scenarioDiagnostics(body, organs, flows)) err(problem.code, problem.message, problem.subject)
  for (const entry of collectAnchors(organs, flows, body.board)) {
    if (entry.anchor.role && !['implementation', 'interface', 'test', 'config', 'docs'].includes(entry.anchor.role)) err('anchor/role', '未知工程映射角色：' + entry.anchor.role, { owner: entry.owner })
    if (entry.anchor.reason !== undefined && typeof entry.anchor.reason !== 'string') err('anchor/reason', '映射说明 reason 必须是文字', { owner: entry.owner })
  }

  /* ---- 锚点：文本证据与源码变化，不等于语义正确性证明 ---- */
  let sourceEvidence = []
  if (options.repoRoot !== undefined && options.repoRoot !== null) {
    const scanned = scanAnchors(options.repoRoot, collectAnchors(organs, flows, body.board).map((entry) => entry.anchor))
    const owners = collectAnchors(organs, flows, body.board)
    sourceEvidence = scanned.map((result, index) => ({ owner: owners[index].owner, ...result }))
    scanned.forEach((result, index) => {
      const owner = owners[index]
      const at = { owner: owner.owner }
      if (result.status === 'source-changed') {
        warn('anchor/source-changed', owner.owner + ' 的源码已变化，需复核叙述与契约：' + result.anchor.file, at, '核对代码并更新图后，在写入工具显式传 reviewSources=true 确认新的源码基线')
      } else if (result.status === 'path-invalid' || result.status === 'file-unreadable') {
        err('anchor/' + result.status, result.note, at)
      } else if (result.status === 'file-missing') {
        err('anchor/file-missing', owner.owner + ' 的锚点文件不存在：' + result.anchor.file, at,
          '锚点是仓库内相对路径：确认 repoRoot 指向仓库根目录，或更新这条锚点')
      } else if (result.status === 'symbol-missing') {
        warn('anchor/symbol-missing', owner.owner + ' 的锚点已漂移：' + result.note, at, '符号改名或被删除：同步解剖体的叙述')
      } else if (result.status === 'unreviewed') {
        warn('anchor/unreviewed', owner.owner + ' 尚无源码指纹基线；不能判断代码是否改过', at, '复核后通过写入工具记录锚点基线')
      } else if (result.status === 'weak') {
        warn('anchor/symbol-weak', owner.owner + ' 的锚点不够精确：' + result.note, at, '写成完整限定名，例如 Controller::detect')
      }
    })
  } else if (typeof options.anchorNote === 'string' && options.anchorNote !== '') {
    /* 没查锚点这件事本身要让人看见：锚点是「叙述有没有和代码脱节」的唯一证据。
       刻意只是 warning——不查不等于数据错，不能因此挡住写入。 */
    warn('anchor/not-checked', options.anchorNote, { body: body.slug },
      '锚点能查就查：传 repoRoot=<仓库根目录> 即可恢复这项检查')
  }

  const stats = {
    strict,
    planned: organs.filter((o) => o.status === 'planned').length,
    organs: organs.length,
    flows: flows.length,
    systems: (body.systems ?? []).length,
    media: (body.media ?? []).length,
    anchors: collectAnchors(organs, flows, body.board).length,
    composition: organs.reduce((sum, organ) => sum + (organ.composition ?? []).length, 0),
    boundaries: organs.reduce((sum, organ) => sum + (organ.not_responsible ?? []).length, 0),
  }
  return { ok: errors.length === 0, errors, warnings, stats, sourceEvidence, mapping: mappingIndex(body, organs, flows).gaps, temporal: temporalModel(body, organs, flows) }
}

function systemId(body, id) {
  const hit = (body.systems ?? []).find((s) => s.id === id)
  return hit === undefined ? id : hit.name
}

/** 两个系统的层级是否完全相同（立体视图里会叠在一起）。 */
function centerlineClash(body, system) {
  return (body.systems ?? []).some((other) => other.id !== system.id && other.alt !== undefined && other.alt === system.alt)
}

/** 找出叙述里的实现痕迹；返回命中的片段或 null。 */
export function implementationTrace(text) {
  return programTrace(text)
}
