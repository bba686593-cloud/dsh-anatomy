// Shared by the tools and the standalone chart. No filesystem or browser dependencies.
export function mappingIndex(body, organs, flows) {
  const files = new Map()
  const add = (owner, anchor, part) => {
    if (!anchor || typeof anchor.file !== 'string' || !anchor.file.trim()) return
    const file = anchor.file.replace(/^\.\//, '')
    if (!files.has(file)) files.set(file, { file, refs: [] })
    files.get(file).refs.push({ ...owner, ...(part ? { part } : {}), symbol: anchor.symbol ?? null,
      role: anchor.role || 'implementation', reason: anchor.reason || '', fingerprinted: !!anchor.sha256 })
  }
  for (const organ of organs) {
    const owner = { kind: 'organ', id: organ.id, name: organ.name }
    for (const anchor of organ.anchors ?? []) add(owner, anchor)
    for (const part of organ.composition ?? []) if (part.anchor) add(owner, part.anchor, part.name)
  }
  for (const flow of flows) for (const anchor of flow.anchors ?? []) add({ kind: 'flow', id: flow.id, name: flow.name || flow.id }, anchor)
  for(const e of Array.isArray(body.board?.elements)?body.board.elements:[])for(const a of Array.isArray(e?.anchors)?e.anchors:[])add({kind:'element',id:e.id,name:e.text||e.math||e.id},a)
  const list = [...files.values()].sort((a, b) => a.file.localeCompare(b.file))
  const has = (id, role) => list.some((f) => f.refs.some((r) => r.kind === 'organ' && r.id === id && (!role || r.role === role)))
  return {
    files: list,
    gaps: {
      unmappedOrgans: organs.filter((o) => !has(o.id)).map((o) => o.id),
      noTestEvidence: organs.filter((o) => o.status !== 'planned' && !has(o.id, 'test')).map((o) => o.id),
      unexplainedLinks: list.flatMap((f) => f.refs.filter((r) => !r.reason).map((r) => ({ file: f.file, kind: r.kind, id: r.id }))),
      unanchoredFlows: flows.filter((f) => !(f.anchors ?? []).length).map((f) => f.id),
    },
    scenarios: body.scenarios ?? [],
    note: '这是已声明的工程映射；文件被引用不代表全部职责或业务语义已覆盖。',
  }
}

export function impactOf(body, organs, flows, query = {}) {
  const index = mappingIndex(body, organs, flows)
  const byId = new Map(organs.map((o) => [o.id, o]))
  const requestedFiles = [...new Set((query.files ?? []).map((p) => p.replace(/^\.\//, '')))]
  const roots = new Set((query.organs ?? []).filter((id) => byId.has(id)))
  for (const file of index.files.filter((f) => requestedFiles.includes(f.file))) {
    for (const ref of file.refs) {
      if (ref.kind === 'organ') roots.add(ref.id)
      else if(ref.kind==='element'){for(const target of body.board?.elements.find(e=>e.id===ref.id)?.targets ?? []){if(target.kind==='organ'&&byId.has(target.id))roots.add(target.id);else if(target.kind==='flow'){const f=flows.find(f=>f.id===target.id);if(f){roots.add(f.from);roots.add(f.to)}}}}
      else { const flow = flows.find((f) => f.id === ref.id); if (flow) { roots.add(flow.from); roots.add(flow.to) } }
    }
  }
  const edges = new Map(organs.map((o) => [o.id, []]))
  const edge = (from, to, via) => { if (edges.has(from) && edges.has(to) && from !== to) edges.get(from).push({ to, via }) }
  for (const flow of flows) {
    edge(flow.from, flow.to, { kind: 'flow', id: flow.id, name: flow.name || flow.id })
    if (flow.direction === 'two-way') edge(flow.to, flow.from, { kind: 'flow', id: flow.id, name: flow.name || flow.id })
  }
  for (const organ of organs) if (organ.parent) {
    edge(organ.id, organ.parent, { kind: 'composition' }); edge(organ.parent, organ.id, { kind: 'composition' })
  }
  for (const file of index.files) {
    const ids = [...new Set(file.refs.filter((r) => r.kind === 'organ' && ['implementation', 'interface', 'config'].includes(r.role)).map((r) => r.id))]
    for (const from of ids) for (const to of ids) edge(from, to, { kind: 'shared-file', file: file.file })
  }
  const depth = Number.isInteger(query.depth) ? Math.max(0, Math.min(5, query.depth)) : 2
  const found = new Map([...roots].map((id) => [id, { id, name: byId.get(id)?.name || id, distance: 0, path: [] }]))
  const queue = [...roots]
  for (let n = 0; n < queue.length; n++) {
    const current = found.get(queue[n])
    if (current.distance >= depth) continue
    for (const next of edges.get(current.id) ?? []) {
      if (found.has(next.to)) continue
      found.set(next.to, { id: next.to, name: byId.get(next.to).name, distance: current.distance + 1, path: [...current.path, { from: current.id, to: next.to, ...next.via }] })
      queue.push(next.to)
    }
  }
  const ids = new Set(found.keys())
  const elements=(body.board?.elements??[]).filter(e=>(e.anchors??[]).some(a=>requestedFiles.includes(a.file))||(e.targets??[]).some(t=>t.kind==='organ'&&ids.has(t.id)))
  const elementIds=new Set(elements.map(e=>e.id))
  return {
    elements, roots: [...roots], depth, affected: [...found.values()],
    unknownFiles: requestedFiles.filter((file) => !index.files.some((f) => f.file === file)),
    unknownOrgans: (query.organs ?? []).filter((id) => !byId.has(id)),
    files: index.files.filter((f) => f.refs.some((r) => r.kind === 'element' ? elementIds.has(r.id) : r.kind === 'organ' ? ids.has(r.id) : flows.some((flow) => flow.id === r.id && (ids.has(flow.from) || ids.has(flow.to))))),
    scenarios: (body.scenarios ?? []).filter((s) => (s.steps ?? []).some((step) => ids.has(step.organ))),
    checks: organs.filter((o) => ids.has(o.id)).map((o) => ({ organ: o.id, status: o.status || 'active', boundaries: o.not_responsible ?? [], invariants: o.contract?.invariants ?? [], observables: o.observables ?? [] })),
    noTestEvidence: index.gaps.noTestEvidence.filter((id) => ids.has(id)),
    note: '影响范围按已声明的流向、构成关系和共享实现/接口/配置文件推导；它是复核候选，不是已证实的代码调用图。',
  }
}

export function scenarioDiagnostics(body, organs, flows) {
  const out = [], ids = new Set(), known = new Set(organs.map((o) => o.id))
  const fail = (id, code, message) => out.push({ code: 'scenario/' + code, message, subject: { scenario: id } })
  if (body.scenarios !== undefined && !Array.isArray(body.scenarios)) return [{ code: 'scenario/shape', message: 'scenarios 必须是数组', subject: { body: body.slug } }]
  for (const scenario of body.scenarios ?? []) {
    if (!scenario || typeof scenario !== 'object') { fail(null, 'shape', '场景必须是对象'); continue }
    const id = scenario.id
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) || ids.has(id)) fail(id, 'id', '场景 id 必须是唯一的小写 kebab-case')
    ids.add(id)
    for (const key of ['name', 'trigger', 'outcome']) if (typeof scenario[key] !== 'string' || !scenario[key].trim()) fail(id, 'text', '场景缺少 ' + key)
    if (!Array.isArray(scenario.steps) || !scenario.steps.length) { fail(id, 'steps', '场景至少需要一个步骤'); continue }
    scenario.steps.forEach((step, n) => {
      if (!step || !known.has(step.organ) || typeof step.action !== 'string' || !step.action.trim()) { fail(id, 'step', '第 ' + (n + 1) + ' 步需要有效器官与动作说明'); return }
      if (n === 0) { if (step.flow) fail(id, 'first-flow', '第一步是入口，不应指定来自上一步的 flow'); return }
      const previous = scenario.steps[n - 1]?.organ
      const flow = flows.find((f) => f.id === step.flow)
      if (!flow || !((flow.from === previous && flow.to === step.organ) || (flow.direction === 'two-way' && flow.to === previous && flow.from === step.organ))) fail(id, 'disconnected', '第 ' + (n + 1) + ' 步必须通过真实且方向一致的 flow 连接上一步')
    })
    if (scenario.acceptance !== undefined && (!Array.isArray(scenario.acceptance) || scenario.acceptance.some((v) => typeof v !== 'string' || !v.trim()))) fail(id, 'acceptance', 'acceptance 必须是非空文字条目的数组')
  }
  return out
}
