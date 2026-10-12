// Shared mathematical model; no program evaluation and no invented measurements.
export function programTrace(text) {
  if (typeof text !== 'string') return null
  const patterns = [
    [/```(?!math\b|latex\b)/, '程序代码块'],
    [/#include\s*[<"]|\b(?:const|let|var)\s+\w+\s*=|\b(?:def|function)\s+\w+\s*\(/, '程序定义'],
    [/\breturn\s+[^;\n]+;|\b(?:nullptr|console\.log)\b|\b\w+::\w+/, '程序语句'],
    [/\b(?:npm|npx|python3?|node|bash|rostopic)\s+(?:run\b|test\b|echo\b|[./\w-]+\.(?:js|py|sh)\b)/, '执行命令'],
    /* 路径只认"已知源码后缀"或 ./ 开头：否则 ROS 话题 /camera/image_raw 会被当成工程路径，
       而人读层写话题名是正常需要（这条以前把人逼去改词或 force）。 */
    [/(?:\.\/|\.\.\/)[\w./-]+|\b[\w./-]+\.(?:js|mjs|ts|tsx|py|cpp|hpp|rs|java)\b/, '工程路径'],
    [/\b[A-Za-z_]\w*\(\s*\)|\b\w+\.\w+\(/, '程序调用'],
  ]
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null
}
export function humanText(text) {
  return programTrace(text) ? '此处需补充自然语言或数学说明' : String(text ?? '')
}
export function timingText(flow) {
  const timing = flow.timing
  if (!timing || !Number.isFinite(timing.latencyMs) || timing.latencyMs < 0) return '传递耗时未知'
  return '传递耗时 ' + timing.latencyMs + ' 毫秒（' + (timing.basis === 'measured' ? '测量' : '估计') + '）'
}
export function temporalModel(body, organs, flows) {
  const ids = new Set(organs.map(o => o.id)), edges = [], unknown = []
  const incoming = new Set()
  for (const f of flows) {
    incoming.add(f.to)
    if (f.direction === 'two-way') incoming.add(f.from)
    const t = f.timing
    if (!t || !Number.isFinite(t.latencyMs) || t.latencyMs < 0) { unknown.push(f.id); continue }
    edges.push({ from: f.from, to: f.to, flow: f.id, ms: t.latencyMs, basis: t.basis })
    if (f.direction === 'two-way') {
      if (Number.isFinite(t.reverseLatencyMs) && t.reverseLatencyMs >= 0) edges.push({ from: f.to, to: f.from, flow: f.id, ms: t.reverseLatencyMs, basis: t.basis })
      else unknown.push(f.id + ':reverse')
    }
  }
  let roots = [...new Set((Array.isArray(body.scenarios)?body.scenarios:[]).map(s => s?.steps?.[0]?.organ).filter(id => ids.has(id)))]
  if (!roots.length) roots = organs.filter(o => !incoming.has(o.id)).map(o => o.id)
  const distances = Object.fromEntries(organs.map(o => [o.id, Infinity])), paths = {}, pending = new Set(ids)
  for (const id of roots) { distances[id] = 0; paths[id] = [] }
  while (pending.size) {
    let at = null
    for (const id of pending) if (at === null || distances[id] < distances[at]) at = id
    if (!Number.isFinite(distances[at])) break
    pending.delete(at)
    for (const edge of edges.filter(e => e.from === at && pending.has(e.to))) {
      const distance = distances[at] + edge.ms
      if (distance < distances[edge.to]) { distances[edge.to] = distance; paths[edge.to] = [...paths[at], edge] }
    }
  }
  return { roots, edges, unknown, nodes: organs.map(o => ({ id: o.id, ms: Number.isFinite(distances[o.id]) ? distances[o.id] : null, path: paths[o.id] ?? [] })),
    formula: '路程＝沿数据流方向累计的传递耗时；最短路程＝各可达路径耗时之和的最小值。',
    note: '未知耗时不补值；双向传递分别计时。横轴表示从入口出发的最短已知路程，侧向分开只为阅读；边长和投影不代表精确耗时，处理耗时未计入传递路程。' }
}
export function semanticDiagnostics(body, organs, flows) {
  const errors = [], fail = (code, message, subject) => errors.push({ code, message, subject })
  const prose = (values, subject) => {
    for (const value of values.flat(Infinity)) if (programTrace(value)) fail('human/program-language', '人读层只能使用自然语言与数学语言；请把实现表达移到机读层', subject)
  }
  prose([body.title, body.oneline, ...(body.systems ?? []).flatMap(s => [s.name,s.gist]), ...(body.media ?? []).flatMap(m => [m.name,m.gist])], {body: body.slug})
  for (const s of Array.isArray(body.scenarios)?body.scenarios:[]) prose([s?.name,s?.trigger,s?.outcome,s?.acceptance ?? [],...(Array.isArray(s?.steps)?s.steps:[]).map(p => p?.action)], {scenario:s.id})
  for (const [kind, list] of [['organ',organs],['flow',flows]]) for (const item of list) {
    const at = {[kind]:item.id}
    prose([item.name,item.gist,item.story,item.math,item.not_responsible ?? [],item.acceptance ?? [],...Object.values(item.contract ?? {})], at)
    const ids = new Set()
    if (item.rules !== undefined && !Array.isArray(item.rules)) { fail('intent/rules-shape','意图规则必须是数组',at); continue }
    for (const rule of item.rules ?? []) {
      if (!rule || !/^[a-z][a-z0-9-]*$/.test(rule.id) || ids.has(rule.id)) { fail('intent/rule-id','意图规则需要唯一标识',at); continue }
      ids.add(rule.id)
      if (typeof rule.statement !== 'string' || !rule.statement.trim() || typeof rule.metric !== 'string' || !rule.metric.trim() || typeof rule.unit !== 'string' || !rule.unit.trim() || !['≤','≥','='].includes(rule.relation) || !Number.isFinite(rule.limit)) fail('intent/rule-shape','规则需要自然语言意图、量名、单位、比较关系与有限数值',at)
      prose([rule.statement,rule.metric,rule.unit],at)
    }
    if (kind === 'flow' && item.timing !== undefined) {
      const t = item.timing
      if (!t || !Number.isFinite(t.latencyMs) || t.latencyMs < 0 || !['measured','estimated'].includes(t.basis) || typeof t.method !== 'string' || !t.method.trim() || (t.reverseLatencyMs !== undefined && (!Number.isFinite(t.reverseLatencyMs) || t.reverseLatencyMs < 0))) fail('flow/timing','传递耗时必须为非负毫秒数，并声明测量或估计及其依据',at)
      if (t) prose([t.method],at)
    }
  }
  return errors
}
export function intentRules(organs, flows) {
  return [['organ',organs],['flow',flows]].flatMap(([kind,list]) => list.flatMap(item => (item.rules ?? []).map(rule => ({...rule, key:kind+':'+item.id+':'+rule.id, target:{kind,id:item.id,name:item.name}, anchors:item.anchors ?? []}))))
}
export function compareMeasurement(rule, value) {
  if (!Number.isFinite(value)) return false
  return rule.relation === '≤' ? value <= rule.limit : rule.relation === '≥' ? value >= rule.limit : value === rule.limit
}
