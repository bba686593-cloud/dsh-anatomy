import { humanText, temporalModel, timingText, intentRules } from './semantics.js'
import { readingRoutes, relationName } from './reading.js'
import { KIND_LABEL } from './store.js'
import { mappingIndex, impactOf } from './mapping.js'
import { elementMathEntries } from './board.js'

const MEDIUM_FALLBACK = { name: '未知物质' }

function mediumOf(body, id) {
  return (body.media ?? []).find((m) => m.id === id) ?? { ...MEDIUM_FALLBACK, id }
}

function systemOf(body, id) {
  return (body.systems ?? []).find((s) => s.id === id) ?? { id, name: id }
}

function bullets(lines) {
  return lines.length === 0 ? '' : lines.map((line) => '- ' + line).join('\n')
}

/**
 * 人读地图：只有器官名、一句话、血脉一句话。
 * 这里出现的每一行都必须是自然语言——没有成分、没有契约、没有锚点、没有代码。
 */
export function humanMap(body, organs, flows) {
  const out = []
  out.push('# ' + (body.title ?? body.slug))
  out.push('')
  if (body.oneline) out.push('> ' + body.oneline)
  out.push('')
  if(body.board){for(const route of readingRoutes(body.board,body,organs,flows)){out.push('## '+route.title,route.summary,route.basis);route.steps.forEach((step,i)=>out.push((i+1)+'. '+step.title+'：'+step.description))}}
  out.push(...scenarioText(body, organs))
  if(!body.board) out.push('## 数据传递与处理', temporalModel(body,organs,flows).formula, temporalModel(body,organs,flows).note)
  if(body.board?.elements.length){out.push('## 画板上的工程描述');for(const e of body.board.elements){if(['line','arrow'].includes(e.type))out.push('- '+relationName(e,flows));else{if(e.type==='image'&&e.image?.alt)out.push('- 图片：'+e.image.alt+(e.formulaGraphic?.semanticStatus==='needs-review'?'（待校对）':''));if(e.text&&e.text!==e.image?.alt)out.push('- '+e.text)}for(const expression of elementMathEntries(e))out.push('  数学关系：'+expression.value)}}
  if(organs.length)out.push('## 工程职责')
  for (const system of body.systems ?? []) {
    const members = organs.filter((o) => (o.systems ?? []).includes(system.id))
    if (members.length === 0) continue
    out.push('')
    out.push('### ' + system.name + (system.gist ? '（' + system.gist + '）' : ''))
    for (const organ of members) {
      const marks = [statusLabel(organ.status)]
      if (organ.kind) marks.push(KIND_LABEL[organ.kind] ?? organ.kind)
      if ((organ.systems ?? []).length > 1) {
        marks.push('同属 ' + organ.systems.filter((id) => id !== system.id).map((id) => systemOf(body, id).name).join('、'))
      }
      out.push('- **' + organ.name + '**' + (marks.length ? '（' + marks.join('，') + '）' : '') + '：' + (organ.gist ?? ''))
      if ((organ.contract?.in ?? []).length) out.push('  - 收到：' + organ.contract.in.join('；'))
      if ((organ.contract?.out ?? []).length) out.push('  - 交付：' + organ.contract.out.join('；'))
      if ((organ.not_responsible ?? []).length) out.push('  - 不负责：' + organ.not_responsible.join('；'))
      if ((organ.contract?.invariants ?? []).length) out.push('  - 必须保持：' + organ.contract.invariants.join('；'))
      if (organ.math) out.push('  - 数学关系：' + organ.math)
      if ((organ.acceptance ?? []).length) out.push('  - 验收条件：' + organ.acceptance.join('；'))
      for(const r of organ.rules ?? []) out.push('  - '+r.statement+'；'+r.metric+' '+r.relation+' '+r.limit+' '+r.unit)

    }
  }
  out.push('')
  if(flows.length)out.push('## 数据交接')
  for (const flow of flows) {
    const from = organs.find((o) => o.id === flow.from)
    const to = organs.find((o) => o.id === flow.to)
    const medium = mediumOf(body, flow.medium)
    const arrow = flow.direction === 'two-way' ? '⇄' : '→'
    out.push('- ' + (from?.name ?? flow.from) + ' ' + arrow + '【' + medium.name + '】' + arrow + ' ' + (to?.name ?? flow.to) + '：' + (flow.gist ?? '') + '；' + timingText(flow))
  }
  out.push('')
  out.push('（这份地图与 AI 摘要使用同一份事实；沿业务场景理解触发、交接、边界和验收，再到工程视图核对实现证据。）')
  return out.map(humanText).join('\n')
}

/**
 * AI 摘要：给 agent 直接吃的紧凑结构。
 * level=map 只看骨架（器官 + 血路）；level=full 追加成分、契约、边界、可观测点与锚点。
 */
export function agentDigest(body, organs, flows, options = {}) {
  const level = options.level === 'map' ? 'map' : 'full'
  const out = []
  out.push('# ANATOMY ' + (body.title ?? body.slug) + ' [' + level + ']')
  if (body.oneline) out.push('整体：' + body.oneline)
  out.push('系统：' + (body.systems ?? []).map((s) => s.id + '=' + s.name).join(' | '))
  out.push('物质：' + (body.media ?? []).map((m) => m.id + '=' + m.name).join(' | '))
  out.push('')
  out.push('## 器官 ' + organs.length + ' 个')
  for (const organ of organs) {
    const head = []
    head.push('[' + organ.id + '] ' + organ.name)
    if (organ.kind) head.push('(' + (KIND_LABEL[organ.kind] ?? organ.kind) + ')')
    head.push('systems=' + (organ.systems ?? []).join(','))
    if (organ.parent) head.push('organ_of=' + organ.parent)
    if (organ.status) head.push('status=' + organ.status)
    out.push(head.join(' '))
    if (organ.gist) out.push('  一句话：' + organ.gist)
    if (organ.story) out.push('  叙述：' + organ.story)
    if (level === 'full') {
      if ((organ.composition ?? []).length) {
        out.push('  成分：')
        for (const part of organ.composition) {
          const anchor = part.anchor ? ' @' + part.anchor.file + (part.anchor.symbol ? '#' + part.anchor.symbol : '') : ''
          out.push('    - ' + part.name + (part.role ? '：' + part.role : '') + anchor)
        }
      }
      const contract = organ.contract ?? {}
      if ((contract.in ?? []).length) out.push('  收：' + contract.in.join('；'))
      if ((contract.out ?? []).length) out.push('  发：' + contract.out.join('；'))
      if ((contract.invariants ?? []).length) out.push('  不变量：' + contract.invariants.join('；'))
    }
    if ((organ.not_responsible ?? []).length) out.push('  不负责：' + organ.not_responsible.join('；'))
    if ((organ.observables ?? []).length) out.push('  可观测：' + organ.observables.join('；'))
    if (level === 'full' && (organ.anchors ?? []).length) {
      out.push('  锚点：' + organ.anchors.map((a) => a.file + (a.symbol ? '#' + a.symbol : '')).join(' , '))
    }
  }
  out.push('')
  out.push('## 血脉 ' + flows.length + ' 条')
  for (const flow of flows) {
    const medium = mediumOf(body, flow.medium)
    out.push('[' + flow.id + '] ' + flow.from + ' ' + (flow.direction === 'two-way' ? '<->' : '->') + ' ' + flow.to + ' 物质=' + flow.medium + '(' + medium.name + ')')
    if (flow.gist) out.push('  送什么：' + flow.gist)
    if (flow.vessel) out.push('  走哪条管道：' + flow.vessel)
    if (level === 'full' && (flow.payload ?? []).length) {
      out.push('  成分：' + flow.payload.map((part) => part.name + (part.role ? '（' + part.role + '）' : '')).join('；'))
    }
    if ((flow.observables ?? []).length) out.push('  可观测：' + flow.observables.join('；'))
    if (level === 'full' && (flow.anchors ?? []).length) {
      out.push('  锚点：' + flow.anchors.map((a) => a.file + (a.symbol ? '#' + a.symbol : '')).join(' , '))
    }
  }
  out.push('', ...scenarioText(body, organs, true))
  if (level === 'full') {
    out.push('## 工程反查（文件 → 职责）')
    for (const file of mappingIndex(body, organs, flows).files) {
      out.push('- ' + file.file + '：' + file.refs.map((r) => '[' + r.kind + ':' + r.id + '] ' + roleLabel(r.role) + (r.symbol ? '#' + r.symbol : '') + (r.part ? ' / ' + r.part : '') + (r.reason ? ' — ' + r.reason : '（映射作用未说明）')).join('；'))
    }
    const gaps = mappingIndex(body, organs, flows).gaps
    if (gaps.unmappedOrgans.length) out.push('尚未定位实现：' + gaps.unmappedOrgans.join('、'))
    if (gaps.noTestEvidence.length) out.push('尚未关联测试证据：' + gaps.noTestEvidence.join('、') + '；可观测说明不等于测试已执行。')
  }
  if(body.board?.reading)out.push('', '## 工程导读（人的阅读意图）',JSON.stringify(body.board.reading))
  if(body.board?.elements.length){out.push('', '## 自由画板与程序映射');for(const e of body.board.elements)out.push('- 图元 '+e.id+'：'+JSON.stringify(e))}
  out.push('', '## 上层意图到下层实现的验证义务')
  for(const r of intentRules(organs,flows)) out.push('- '+r.key+'：'+r.statement+'；'+r.metric+' '+r.relation+' '+r.limit+' '+r.unit)
  out.push('模型更新不等于实现通过。读取 anatomy_verify 的版本，按映射运行测试，再提交该版本的测量报告；无证据、过期或不满足均不通过。')
  for(const e of body.board?.elements??[])if(e.formulaGraphic)out.push('- 数学图形 '+e.id+'：'+(e.formulaGraphic.semanticStatus==='needs-review'?'当前图形已擦改或补画，当前表达未知；originalMath 仅为原稿来源，禁止按原稿冒充当前意图实施。先看当前图片并结合用户意图校对，再绑定当前图片指纹。':'当前表达为 formulaGraphic.currentMath；原稿与编辑记录仅供追溯，校对声明仍不代表下层实现通过。'))
  for(const o of organs) if(o.math || o.implementation) out.push('- '+o.id+' 数学关系：'+(o.math||'未声明')+'；实现说明：'+JSON.stringify(o.implementation||{}))
  for(const f of flows) out.push('- '+f.id+' '+timingText(f)+(f.math?'；数学关系：'+f.math:'')+(f.implementation?'；实现说明：'+JSON.stringify(f.implementation):''))
  return out.join('\n')
}

/** 术前须知：改一个器官之前，AI 该先读什么。 */
export function briefOrgan(body, organs, flows, organId) {
  const organ = organs.find((o) => o.id === organId)
  if (organ === undefined) return null
  const incoming = flows.filter((f) => f.to === organ.id || (f.direction === 'two-way' && f.from === organ.id))
  const outgoing = flows.filter((f) => f.from === organ.id || (f.direction === 'two-way' && f.to === organ.id))
  const children = organs.filter((o) => o.parent === organ.id)
  const out = []
  out.push('# 术前须知：' + organ.name + '（' + organ.id + '）')
  out.push('')
  out.push('一句话：' + (organ.gist ?? '（未写）'))
  if (organ.story) {
    out.push('')
    out.push('叙述：' + organ.story)
  }
  const contract = organ.contract ?? {}
  out.push('')
  out.push('## 契约')
  out.push(bullets([...(contract.in ?? []).map((x) => '收：' + x), ...(contract.out ?? []).map((x) => '发：' + x), ...(contract.invariants ?? []).map((x) => '必须保持：' + x)]) || '- （未写）')
  out.push('')
  out.push('## 边界：它不负责什么')
  out.push(bullets(organ.not_responsible ?? []) || '- （未写：动手前请先补，避免越界修改）')
  if ((organ.composition ?? []).length) {
    out.push('')
    out.push('## 由什么构成')
    out.push(bullets(organ.composition.map((p) => p.name + (p.role ? '：' + p.role : ''))))
  }
  out.push('')
  out.push('## 上游（谁把东西送进来）')
  out.push(bullets(incoming.map((f) => '【' + mediumOf(body, f.medium).name + '】' + (f.from === organ.id ? f.to : f.from) + ' → 本器官：' + (f.gist ?? ''))) || '- 无')
  out.push('')
  out.push('## 下游（本器官把东西送去哪）')
  out.push(bullets(outgoing.map((f) => '【' + mediumOf(body, f.medium).name + '】本器官 → ' + (f.to === organ.id ? f.from : f.to) + '：' + (f.gist ?? ''))) || '- 无')
  if (children.length > 0) {
    out.push('')
    out.push('## 由这些器官构成')
    out.push(bullets(children.map((c) => c.name + '：' + (c.gist ?? ''))))
  }
  if ((organ.observables ?? []).length) {
    out.push('')
    out.push('## 改完怎么验证')
    out.push(bullets(organ.observables))
  }
  if ((organ.anchors ?? []).length) {
    out.push('')
    out.push('## 锚点（叙述对应的代码名字）')
    out.push(bullets(organ.anchors.map((a) => a.file + (a.symbol ? ' → ' + a.symbol : ''))))
  }
  out.push('', '## 必须落实的上层意图')
  if(organ.math) out.push('数学关系：'+organ.math)
  for(const r of intentRules([organ],flows.filter(f=>f.from===organId||f.to===organId))) out.push('- '+r.key+'：'+r.statement+'；'+r.metric+' '+r.relation+' '+r.limit+' '+r.unit)
  out.push('修改实现后运行关联测试，以 anatomy_verify 核验当前版本；模型更新本身不代表实现通过。')
  const impact = impactOf(body, organs, flows, { organs: [organId], depth: 2 })
  out.push('', '## 修改前的复核范围')
  out.push('状态：' + statusLabel(organ.status))
  out.push('这是按声明关系推导的候选，不代表每个部件一定需要修改。')
  for (const item of impact.affected.filter((x) => x.distance > 0)) {
    out.push('- ' + item.name + ' [' + item.id + ']：' + item.path.map((p) => p.kind === 'flow' ? '经血脉 ' + p.id : p.kind === 'shared-file' ? '共享 ' + p.file : '构成关系').join(' → '))
  }
  out.push('', '## 先读哪些工程文件')
  for (const file of impact.files) out.push('- ' + file.file + '：' + file.refs.map((r) => '[' + r.id + '] ' + roleLabel(r.role) + (r.reason ? ' — ' + r.reason : '')).join('；'))
  if (impact.noTestEvidence.length) out.push('未关联测试证据：' + impact.noTestEvidence.join('、') + '。先确定验证方法，不把没有测试当成已经通过。')
  if (impact.scenarios.length) out.push('', ...scenarioText({ ...body, scenarios: impact.scenarios }, organs, true))
  return out.join('\n')
}

function statusLabel(status) {
  return status === 'planned' ? '设计态，尚未落地' : status === 'stale' ? '待复核' : '已落地，仍需结合证据核对'
}
function roleLabel(role) {
  return ({ implementation: '实现', interface: '接口', test: '测试', config: '配置', docs: '说明' })[role] || role
}
function scenarioText(body, organs, technical = false) {
  const out = []
  if (!(body.scenarios ?? []).length) return out
  out.push('## 沿真实场景共读')
  for (const scenario of body.scenarios) {
    out.push('', '### ' + scenario.name + (technical ? ' [' + scenario.id + ']' : ''), '触发：' + scenario.trigger)
    scenario.steps.forEach((step, n) => {
      const organ = organs.find((o) => o.id === step.organ)
      out.push((n + 1) + '. ' + (organ?.name || step.organ) + '：' + step.action + (organ?.status === 'planned' ? '（设计态）' : '') + (technical && step.flow ? ' [flow:' + step.flow + ']' : ''))
    })
    out.push('结果：' + scenario.outcome)
    if ((scenario.acceptance ?? []).length) out.push('验收：' + scenario.acceptance.join('；'))
    else out.push('验收条件尚未声明，不能据此认定流程已验证。')
  }
  return out
}
