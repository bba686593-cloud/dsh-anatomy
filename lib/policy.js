// 架构规则：把「这具身体该长成什么样」写成可执行的门禁。
//
// 与结构数据分开存放（anatomy-policy.json，纯 JSON，零运行时依赖），随解剖体一起提交。
// 规则在每次 anatomy_check / 写入门禁 / 交付门禁里都会跑一遍——
// 违规不是"建议"，而是和结构错误同一条门禁；severity 设 warning 才会降级为提醒。

export const POLICY_SCHEMA = 'anatomy-policy/1'

/** 支持的规则类型与字段说明（给人和 AI 读的速查）。 */
export const RULE_REFERENCE = [
  'forbid-flow     { from:[系统id|"*"], to:[系统id|"*"], message? }  禁止从某些系统流向某些系统的血脉',
  'layer-direction { direction:"up"|"down", axis:"alt" }            血脉只能沿抽象层级向上或向下流；同层放行',
  'max-organs      { system:"系统id", max:数字 }                     一个系统最多容纳几个器官（防止上帝系统）',
  'require-link    { from:[系统id], to:[系统id] }                    这两组系统之间必须至少有一条血脉',
  'no-cycle        { }                                              血脉不得成环（双向血脉视为回路，不计入）',
]

const SEVERITIES = ['error', 'warning']

function asArray(value) {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function matches(pattern, systemId) {
  return pattern === '*' || pattern === systemId
}

function hitsAny(patterns, systemIds) {
  return patterns.some((pattern) => systemIds.some((id) => matches(pattern, id)))
}

/** 规则文件形状校验；返回 { errors, warnings, rules }。 */
export function l1ValidatePolicy(doc) {
  const errors = []
  const warnings = []
  const rules = []
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    errors.push({ code: 'policy/shape', message: 'anatomy-policy.json 必须是对象' })
    return { errors, warnings, rules }
  }
  if (doc.schema !== undefined && doc.schema !== POLICY_SCHEMA) {
    errors.push({ code: 'policy/schema', message: 'schema 必须是 ' + POLICY_SCHEMA })
  }
  if (!Array.isArray(doc.rules)) {
    errors.push({ code: 'policy/rules', message: 'rules 必须是数组' })
    return { errors, warnings, rules }
  }
  const seen = new Set()
  doc.rules.forEach((rule, index) => {
    const at = { rule: `rules[${index}]` }
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push({ code: 'policy/rule-shape', message: '规则必须是对象', subject: at })
      return
    }
    if (typeof rule.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(rule.id)) {
      errors.push({ code: 'policy/rule-id', message: '规则 id 必须是小写 kebab-case：' + String(rule.id), subject: at })
      return
    }
    if (seen.has(rule.id)) {
      errors.push({ code: 'policy/rule-id-duplicate', message: '规则 id 重复：' + rule.id, subject: at })
      return
    }
    seen.add(rule.id)
    const type = rule.type
    const known = ['forbid-flow', 'layer-direction', 'max-organs', 'require-link', 'no-cycle']
    if (!known.includes(type)) {
      errors.push({ code: 'policy/rule-type', message: '规则 ' + rule.id + ' 的类型未知：' + String(type), subject: at, hint: RULE_REFERENCE.join(' / ') })
      return
    }
    if (rule.severity !== undefined && !SEVERITIES.includes(rule.severity)) {
      errors.push({ code: 'policy/rule-severity', message: '规则 ' + rule.id + ' 的 severity 必须是 error 或 warning', subject: at })
      return
    }
    if (type === 'forbid-flow' && (asArray(rule.from).length === 0 || asArray(rule.to).length === 0)) {
      errors.push({ code: 'policy/rule-fields', message: 'forbid-flow 需要 from 与 to', subject: at })
      return
    }
    if (type === 'layer-direction' && !['up', 'down'].includes(rule.direction)) {
      errors.push({ code: 'policy/rule-fields', message: 'layer-direction 的 direction 必须是 up 或 down', subject: at })
      return
    }
    if (type === 'max-organs' && (typeof rule.system !== 'string' || typeof rule.max !== 'number' || rule.max <= 0)) {
      errors.push({ code: 'policy/rule-fields', message: 'max-organs 需要 system 与正数 max', subject: at })
      return
    }
    if (type === 'require-link' && (asArray(rule.from).length === 0 || asArray(rule.to).length === 0)) {
      errors.push({ code: 'policy/rule-fields', message: 'require-link 需要 from 与 to', subject: at })
      return
    }
    if (rule.enabled === false) warnings.push({ code: 'policy/rule-disabled', message: '规则 ' + rule.id + ' 已停用', subject: at })
    rules.push(rule)
  })
  return { errors, warnings, rules }
}

/** 器官的抽象层级：取所属系统里最高的一层（与立体视图同一套算法）。 */
export function organLevel(body, organ) {
  const list = body.systems ?? []
  const altOf = (id) => {
    const sys = list.find((s) => s.id === id)
    if (sys === undefined) return null
    if (typeof sys.alt === 'number') return sys.alt
    const index = list.indexOf(sys)
    return list.length <= 1 ? 0 : index / (list.length - 1)
  }
  let best = null
  for (const id of organ.systems ?? []) {
    const alt = altOf(id)
    if (alt === null) continue
    best = best === null ? alt : Math.max(best, alt)
  }
  return best
}

/**
 * 跑一遍规则。返回违规清单（每条带 severity）。
 * ctx: { body, organs, flows }
 */
export function evaluatePolicy(policy, ctx) {
  const out = []
  const rules = (policy?.rules ?? []).filter((rule) => rule.enabled !== false)
  const { body, organs, flows } = ctx
  const byId = new Map(organs.map((o) => [o.id, o]))
  const systemsOf = (organId) => byId.get(organId)?.systems ?? []
  const levelOf = (organId) => {
    const organ = byId.get(organId)
    return organ === undefined ? null : organLevel(body, organ)
  }
  const push = (rule, message, subject, hint) => {
    out.push({ level: rule.severity ?? 'error', code: 'policy/' + rule.id, message, subject, ...(hint ? { hint } : {}) })
  }

  for (const rule of rules) {
    if (rule.type === 'forbid-flow') {
      const from = asArray(rule.from)
      const to = asArray(rule.to)
      for (const flow of flows) {
        const a = systemsOf(flow.from)
        const b = systemsOf(flow.to)
        const forward = hitsAny(from, a) && hitsAny(to, b)
        const backward = flow.direction === 'two-way' && hitsAny(to, a) && hitsAny(from, b)
        if (forward || backward) {
          push(rule, rule.message ?? `禁止的血流：${flow.id} 从 ${a.join('/')} 流向 ${b.join('/')}`, { flow: flow.id },
            '改流向、改归属，或与维护者确认后调整规则')
        }
      }
    } else if (rule.type === 'layer-direction') {
      const wantUp = (rule.direction ?? 'up') === 'up'
      for (const flow of flows) {
        const la = levelOf(flow.from)
        const lb = levelOf(flow.to)
        if (la === null || lb === null) continue
        if (Math.abs(la - lb) < 1e-9) continue                    // 同层放行
        const ok = flow.direction !== 'two-way' && (wantUp ? la < lb : la > lb)
        if (!ok) {
          push(rule, `层级方向违规：${flow.id} 从 ${la.toFixed(2)} 流向 ${lb.toFixed(2)}（要求只能向${wantUp ? '上' : '下'}）`, { flow: flow.id },
            '调 system.alt，或改这条血脉的流向')
        }
      }
    } else if (rule.type === 'max-organs') {
      const members = organs.filter((o) => (o.systems ?? []).includes(rule.system))
      if (members.length > rule.max) {
        push(rule, `系统 ${rule.system} 有 ${members.length} 个器官，超过上限 ${rule.max}`, { system: rule.system },
          '拆成更细的系统，或把器官归到更贴切的系统里')
      }
    } else if (rule.type === 'require-link') {
      const from = asArray(rule.from)
      const to = asArray(rule.to)
      const found = flows.some((flow) => {
        const a = systemsOf(flow.from)
        const b = systemsOf(flow.to)
        return (hitsAny(from, a) && hitsAny(to, b)) || (hitsAny(from, b) && hitsAny(to, a))
      })
      if (!found) {
        push(rule, `要求 ${from.join('/')} 与 ${to.join('/')} 之间有血脉，但一条都没有`, { systems: from.concat(to) },
          '补一条血脉，或删掉这条规则')
      }
    } else if (rule.type === 'no-cycle') {
      for (const cycle of findCycles(flows)) {
        push(rule, '血脉成环：' + cycle.join(' → '), { flow: cycle[0] }, '环意味着某样东西绕回了自己的来源；确认这是有意的就调整规则')
      }
    }
  }
  return out
}

/**
 * 有向环检测：只把单向血脉当作有向边。
 * 双向血脉本身就是一条回路，把它算进去会把「A ⇄ B」误报成环，所以排除。
 */
export function findCycles(flows) {
  const adjacency = new Map()
  for (const flow of flows) {
    if (flow.direction === 'two-way') continue
    if (!adjacency.has(flow.from)) adjacency.set(flow.from, [])
    adjacency.get(flow.from).push(flow.id + '|' + flow.to)
  }
  const color = new Map()
  const stack = []
  const cycles = []
  const seen = new Set()
  const visit = (node) => {
    color.set(node, 1)
    stack.push(node)
    for (const edge of adjacency.get(node) ?? []) {
      const next = edge.split('|')[1]
      const state = color.get(next) ?? 0
      if (state === 1) {
        const start = stack.indexOf(next)
        const cycle = stack.slice(start).concat(next)
        const key = [...cycle].sort().join('|')
        if (!seen.has(key)) { seen.add(key); cycles.push(cycle) }
      } else if (state === 0) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, 2)
  }
  for (const node of adjacency.keys()) if ((color.get(node) ?? 0) === 0) visit(node)
  return cycles
}

/**
 * 默认不给任何规则——这一点是刻意的。
 * 这具身体的隐喻是解剖学：血液本来就会回流，层级也未必单向（判断系统既收感知也发指令）。
 * 一上来就强加"禁环""只能向上"会把正常系统判成违规，规则必须由建模的人按自己的语义声明。
 * 需要严格分层时，写一条 no-cycle 或 layer-direction 即可（见 RULE_REFERENCE）。
 */
export function defaultPolicy() {
  return { schema: POLICY_SCHEMA, rules: [] }
}

/** 每个系统的器官数上限：防"上帝系统"，又不至于刚开始就把人拦住。 */
export const SYSTEM_CAP = 12

/**
 * 起步规则：新工程 init 时自动装上的那一套。
 * 只装"永远不会冤枉人"的那类——容量上限。它今天一定 0 违规（器官还没长出来），
 * 长到上限才会响，而且响得有理：一个系统塞十几个器官，图就没法读了。
 * 禁流/必须相连/禁环这些要等架构意图明确，用 freeze 或手写。
 */
export function starterPolicy(body) {
  const systems = (body?.systems ?? []).map((s) => s.id)
  return {
    schema: POLICY_SCHEMA,
    rules: systems.map((id) => ({
      id: 'cap-' + id,
      type: 'max-organs',
      system: id,
      max: SYSTEM_CAP,
      message: '系统 ' + id + ' 的器官超过 ' + SYSTEM_CAP + ' 个：该拆成更细的系统了',
    })),
  }
}

/**
 * 把"现状"固化成规则：容量 = 现在 + 余量，连接 = 现在已有的跨系统血流。
 * 用途是给已经长起来的身体补上第四道门禁——它按定义 0 违规，
 * 但从今往后"把某个连接删掉""某个系统膨胀"都会当场被拦住。
 */
export function freezePolicy(body, organs, flows, options = {}) {
  const slack = typeof options.slack === 'number' ? options.slack : 4
  const count = (id) => organs.filter((o) => (o.systems ?? []).includes(id)).length
  const rules = []
  for (const system of body?.systems ?? []) {
    rules.push({
      id: 'cap-' + system.id,
      type: 'max-organs',
      system: system.id,
      max: count(system.id) + slack,
      message: '系统 ' + system.id + ' 的器官超过 ' + (count(system.id) + slack) + ' 个：该拆成更细的系统了',
    })
  }
  const byId = new Map(organs.map((o) => [o.id, o]))
  const pairs = new Map()
  for (const flow of flows ?? []) {
    const a = byId.get(flow.from)?.systems ?? []
    const b = byId.get(flow.to)?.systems ?? []
    const linked = new Set()
    for (const x of a) for (const y of b) if (x !== y) linked.add([x, y].sort().join('|'))
    /* 同一个器官同属两个系统时，会连出 A→B 这种自环，跳过 */
    for (const key of linked) {
      const [x, y] = key.split('|')
      if (x !== y && !pairs.has(key)) pairs.set(key, { from: x, to: y, sample: flow.id })
    }
  }
  for (const [key, pair] of pairs) {
    rules.push({
      id: 'link-' + pair.from + '-' + pair.to,
      type: 'require-link',
      from: [pair.from],
      to: [pair.to],
      message: '要求 ' + pair.from + ' 与 ' + pair.to + ' 之间保持有血脉（固化自 ' + pair.sample + '）',
    })
  }
  return { schema: POLICY_SCHEMA, rules, frozenFrom: { pairs: pairs.size, slack } }
}
