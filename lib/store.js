import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve, relative, isAbsolute, extname } from 'node:path'

/** 数据格式版本。结构变更时递增，读到不认识的版本直接报错而不是猜。 */
export const SCHEMA = 'anatomy/1'

/** 器官类型：解剖学意义上的「这是什么器官」。 */
export const ORGAN_KINDS = ['sense', 'decide', 'act', 'govern', 'route', 'store', 'report', 'adapt']

export const KIND_LABEL = {
  sense: '感知',
  decide: '决策',
  act: '执行',
  govern: '治理',
  route: '通路',
  store: '存储',
  report: '表达',
  adapt: '适配',
}

/* ------------------------------------------------------------------ 路径与读写 */

export function slugify(text) {
  const slug = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'body' : slug
}

export function anatomyDirName(slug) {
  return 'anatomy-' + slugify(slug)
}

export function listBodies(rootDir) {
  const root = resolve(rootDir)
  if (!existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('anatomy-')) continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'body.json'))) continue
    let body = null
    try {
      body = readJson(join(dir, 'body.json'), null)
    } catch {
      body = null
    }
    out.push({ slug: entry.name.slice('anatomy-'.length), dir, title: body?.title ?? null })
  }
  return out
}

/* 只报 slug 时向下找几层。工程目录常在工作区里的一两级之下，
   再深就不像"工程在附近"了，宁可报错让人显式给 dir，也不要挖遍整块盘。 */
const BODY_SEARCH_DEPTH = 3
const SKIP_SEARCH_DIRS = new Set(['node_modules', 'dist', 'build', 'target', 'out', '__pycache__', '.git', '.anatomy-runtime'])
/** 在 root 下有限深度地找 anatomy-<slug>；只认带 body.json 的目录，并给遍历设上限。 */
function findBodyDir(root, name, depth, budget = { left: 500 }) {
  if (depth <= 0 || budget.left <= 0 || !existsSync(root)) return null
  let entries = []
  try { entries = readdirSync(root, { withFileTypes: true }) } catch { return null }
  for (const entry of entries) {
    if (budget.left-- <= 0) return null
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_SEARCH_DIRS.has(entry.name)) continue
    const dir = join(root, entry.name)
    if (entry.name === name && existsSync(join(dir, 'body.json'))) return dir
    if (entry.name.startsWith('anatomy-')) continue // 别的解剖体，不必再往下钻
    const hit = findBodyDir(dir, name, depth - 1, budget)
    if (hit !== null) return hit
  }
  return null
}

/**
 * 找到一具解剖体。约定：解剖体住在**它自己工程的目录里**——<工程目录>/anatomy-<slug>/。
 *
 * 于是"给一个目录"有两种意思，按目录本身判断，不靠调用方说明：
 *  - 名字像 anatomy-* 或里面已有 body.json → 这是解剖体目录；
 *  - 其它（比如 /path/to/my_project） → 这是工程目录，解剖体在它下面的 anatomy-<slug>/。
 * 这样锚点检查要的"仓库根"也能顺手带出来（返回 repoRoot），不必每次都传。
 */
export function resolveBody(rootDir, ref = {}, options = {}) {
  const slugOf = (value) => (typeof value === 'string' && value.trim() !== '' ? slugify(value) : null)
  const requested = slugOf(ref.body)
  const project = typeof ref.repo === 'string' && ref.repo.trim() !== ''
    ? resolve(ref.repo)
    : typeof ref.project === 'string' && ref.project.trim() !== ''
      ? resolve(ref.project)
      : null
  const anatomyIn = (projectDir, slug) => join(projectDir, anatomyDirName(slug ?? basename(projectDir)))

  if (project !== null) {
    const dir = anatomyIn(project, requested)
    if (existsSync(join(dir, 'body.json')) || options.create === true) return { dir, repoRoot: project }
    return { error: '解剖体不存在：' + dir + '（先运行 anatomy_init）' }
  }

  const explicitDir = typeof ref.dir === 'string' && ref.dir.trim() !== '' ? resolve(ref.dir) : null
  if (explicitDir !== null) {
    if (existsSync(join(explicitDir, 'body.json'))) return { dir: explicitDir }
    if (!basename(explicitDir).startsWith('anatomy-')) {
      /* 给的是工程目录：解剖体放在它下面，并把它当仓库根。
         工程目录名不一定等于 slug（建解剖体时可以另起名字），所以先按名字猜，
         猜不中就把这一层里所有 anatomy- 开头的子目录列出来：唯一就用它，多个让人选。 */
      const preferred = anatomyIn(explicitDir, requested)
      if (existsSync(join(preferred, 'body.json')) || options.create === true) return { dir: preferred, repoRoot: explicitDir }
      const siblings = listBodies(explicitDir)
      if (siblings.length === 1) return { dir: siblings[0].dir, repoRoot: explicitDir }
      if (siblings.length > 1) return { error: '这个工程目录下有多具解剖体，请用 body 指定：' + siblings.map((b) => b.slug).join('、') }
      return { error: '解剖体不存在：' + preferred + '（先运行 anatomy_init）' }
    }
    if (options.create === true) return { dir: explicitDir }
    return { error: '解剖体不存在：' + explicitDir + '（先运行 anatomy_init）' }
  }

  const slug = requested
  if (slug !== null) {
    /* 先按老约定找 <rootDir>/anatomy-<slug>；
       再按新约定在 rootDir 下**有限深度**地找 <…>/anatomy-<slug>——解剖体住在自己工程里，
       而工程常常是工作区里的一级甚至两级目录。只扫一层会让"只报 slug"这种用法时灵时不灵，
       调用方被迫每次额外带 dir（插件文档和技能里都没这么要求）。 */
    const base = resolve(rootDir)
    const name = anatomyDirName(slug)
    const direct = join(base, name)
    if (existsSync(join(direct, 'body.json'))) return { dir: direct, repoRoot: dirname(direct) }
    const found = findBodyDir(base, name, BODY_SEARCH_DEPTH)
    if (found !== null) return { dir: found, repoRoot: dirname(found) }
    if (options.create === true) return { dir: direct }
    return { error: '解剖体不存在：' + slug + '（已在 ' + base + ' 内 ' + BODY_SEARCH_DEPTH + ' 层里找过 ' + name + '；先运行 anatomy_init，或直接用 dir 指定解剖体目录）' }
  }
  const bodies = listBodies(rootDir)
  if (options.create === true) {
    /* 建新的：绝不因为"刚好只有一具"就把它当成目标——
       那会让不传 body/dir/repo 的 anatomy_init 去覆盖别人的工程（force 时真会覆写）。 */
    return { dir: join(resolve(rootDir), anatomyDirName(null)) }
  }
  if (bodies.length === 1) return { dir: bodies[0].dir }
  if (bodies.length === 0) return { error: '还没有任何解剖体：先用 anatomy_init 建一具' }
  return { error: '存在多具解剖体，请用 body 或 dir 指定：' + bodies.map((b) => b.slug).join(', ') }
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function writeJson(file, value) {
  mkdirSync(join(file, '..'), { recursive: true })
  // 先写临时文件再改名：避免写到一半留下半截 JSON（同名改名在同一文件系统上是原子的）
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function loadBody(dir) {
  const body = readJson(join(dir, 'body.json'), null)
  if (body === null) throw new Error('缺少 body.json：' + dir)
  if (body.schema !== SCHEMA) throw new Error('body.json 的 schema 不是 ' + SCHEMA + '：' + String(body.schema))
  return body
}

export function saveBody(dir, body) {
  writeJson(join(dir, 'body.json'), { ...body, schema: SCHEMA })
}

export function organFile(dir, id) {
  return join(dir, 'organs', id + '.json')
}

export function loadOrgans(dir) {
  const organDir = join(dir, 'organs')
  if (!existsSync(organDir)) return []
  const organs = []
  for (const name of readdirSync(organDir).sort()) {
    if (!name.endsWith('.json')) continue
    const organ = readJson(join(organDir, name), null)
    if (organ !== null) organs.push(organ)
  }
  return organs
}

export function loadOrgan(dir, id) {
  return readJson(organFile(dir, id), null)
}

export function saveOrgan(dir, organ) {
  writeJson(organFile(dir, organ.id), organ)
}

export function deleteOrgan(dir, id) {
  const file = organFile(dir, id)
  if (existsSync(file)) rmSync(file)
}

export function policyFile(dir) {
  return join(dir, 'anatomy-policy.json')
}

/** 规则文件不存在时返回 null——由上层决定用默认规则还是报错。 */
export function loadPolicy(dir) {
  return readJson(policyFile(dir), null)
}

export function savePolicy(dir, doc) {
  writeJson(policyFile(dir), doc)
}

export function loadFlows(dir) {
  return readJson(join(dir, 'flows.json'), { schema: SCHEMA, flows: [] })
}

export function saveFlows(dir, flows) {
  writeJson(join(dir, 'flows.json'), { schema: SCHEMA, flows })
}

/* ------------------------------------------------------------------ 归一化 */

/** 补齐器官缺省字段，并按解剖学语义做最小清洗（不做业务校验，校验在 check.js）。 */
export function normalizeOrgan(input) {
  const organ = { ...input }
  // status：planned = 设计态（还没有代码，允许没有锚点与深度）/ active = 已落地 / stale = 代码变了待复核
  if (!['planned', 'active', 'stale'].includes(organ.status)) organ.status = organ.status === 'draft' || organ.status === undefined ? 'active' : organ.status
  organ.id = slugify(organ.id ?? organ.name)
  organ.systems = Array.isArray(organ.systems) ? [...new Set(organ.systems.filter((s) => typeof s === 'string'))] : []
  organ.gist = typeof organ.gist === 'string' ? organ.gist.trim() : ''
  if (typeof organ.story === 'string') organ.story = organ.story.trim()
  if (Array.isArray(organ.composition)) {
    organ.composition = organ.composition.map((part) =>
      typeof part === 'string' ? { name: part } : { ...part, name: String(part?.name ?? '').trim() },
    )
  }
  if (Array.isArray(organ.not_responsible)) organ.not_responsible = organ.not_responsible.map((s) => String(s).trim())
  if (Array.isArray(organ.observables)) organ.observables = organ.observables.map((s) => String(s).trim())
  if (Array.isArray(organ.anchors)) organ.anchors = organ.anchors.map(normalizeAnchor)
  organ.status = organ.status ?? 'draft'
  return organ
}

export function normalizeFlow(input) {
  const flow = { ...input }
  flow.id = slugify(flow.id ?? flow.name)
  flow.from = typeof flow.from === 'string' ? slugify(flow.from) : ''
  flow.to = typeof flow.to === 'string' ? slugify(flow.to) : ''
  flow.gist = typeof flow.gist === 'string' ? flow.gist.trim() : ''
  flow.direction = flow.direction === 'two-way' ? 'two-way' : 'one-way'
  if (Array.isArray(flow.payload)) {
    flow.payload = flow.payload.map((part) =>
      typeof part === 'string' ? { name: part } : { ...part, name: String(part?.name ?? '').trim() },
    )
  }
  if (Array.isArray(flow.observables)) flow.observables = flow.observables.map((s) => String(s).trim())
  if (Array.isArray(flow.anchors)) flow.anchors = flow.anchors.map(normalizeAnchor)
  return flow
}

export function normalizeAnchor(input) {
  const anchor = typeof input === 'string' ? { file: input } : { ...input }
  anchor.file = String(anchor.file ?? '').trim().replace(/^\.\//, '')
  if (anchor.symbol !== undefined) anchor.symbol = String(anchor.symbol).trim()
  if (anchor.kind === undefined) anchor.kind = anchor.symbol ? 'symbol' : 'file'
  return anchor
}

/* ------------------------------------------------------------------ 指纹与修订 */

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * 解剖体指纹：只跟数据有关，跟渲染方式、时间、路径无关。
 * 回答的问题是"你现在看的这张图，和当初通过体检的那份数据，是不是同一份"。
 */
export function anatomyFingerprint(body, organs, flows) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return sha256(JSON.stringify({
    body,
    organs: [...organs].sort(byId),
    flows: [...flows].sort(byId),
  }))
}

/* ------------------------------------------------------------------ 锚点扫描（语义漂移检测） */

/**
 * 锚点 = 「这段叙述对应代码里的哪个名字」；文件与符号名负责定位，sha256 负责记录源码基线。
 * 符号检查提供文本证据；sha256 记录复核时的文件内容，内容变化时要求重新复核。
 */
export function scanAnchors(repoRoot, anchors) {
  const root = resolve(repoRoot ?? '.')
  const cache = new Map()
  const inside = (base, file) => {
    const rel = relative(base, file)
    return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
  }
  return anchors.map((anchor) => {
    const file = anchor?.file
    const abs = typeof file === 'string' ? resolve(root, file) : root
    if (typeof file !== 'string' || file.trim() === '' || isAbsolute(file) || !inside(root, abs)) {
      return { anchor, status: 'path-invalid', note: '锚点必须是仓库内的相对文件路径' }
    }
    if (!cache.has(file)) {
      try {
        if (!inside(realpathSync(root), realpathSync(abs))) {
          cache.set(file, { status: 'path-invalid', note: '锚点符号链接指向仓库外部：' + file })
        } else if (!statSync(abs).isFile()) {
          cache.set(file, { status: 'file-unreadable', note: '锚点不是普通文件：' + file })
        } else {
          const raw = readFileSync(abs)
          /* 指纹算原始字节：非 UTF-8 文件（ELF/图片）解码后非法字节会统一变成 U+FFFD，
             两个不同的二进制会得到同一个摘要，源码漂移就永远测不出来。 */
          const text = raw.toString('utf8')
          cache.set(file, { text, tokens: null, sha256: sha256(raw) })
        }
      } catch (error) {
        cache.set(file, { status: error.code === 'ENOENT' ? 'file-missing' : 'file-unreadable', note: '无法读取锚点：' + file })
      }
    }
    const source = cache.get(file)
    if (source.status) return { anchor, ...source }
    const result = { anchor, sha256: source.sha256 }
    if (source.tokens === null || source.tokens === undefined) source.tokens = sourceTokens(source.text, extname(file).toLowerCase())
    const text = source.tokens
    if (anchor.symbol && !containsSymbol(text, anchor.symbol)) {
      const tail = anchor.symbol.split('::').pop()
      if (tail !== anchor.symbol && containsSymbol(text, tail)) {
        return { ...result, status: 'weak', note: '找不到限定名 ' + anchor.symbol + '，但存在短名 ' + tail }
      }
      return { ...result, status: 'symbol-missing', note: '源码（排除注释和字符串）中找不到：' + anchor.symbol }
    }
    if (anchor.sha256 && anchor.sha256 !== source.sha256) {
      return { ...result, status: 'source-changed', note: '源码内容已改变；符号仍在也需要复核' }
    }
    return { ...result, status: anchor.sha256 ? 'ok' : 'unreviewed', note: '文件/符号文本存在；这不是声明解析或语义正确性证明' }
  })
}

/** 轻量词法过滤，不冒充各语言的 AST 或调用关系分析。 */
function sourceTokens(text, extension) {
  // 二进制（可执行文件、镜像、图片…）不做词法过滤：符号表本身就是证据，
  // 而且二进制里随机的引号字节会把后面的符号整段当作「未闭合字符串」吞掉，
  // 造成同名符号时有时无的假漂移。
  if (text.includes('\u0000')) return text
  // 散文与配置/标记类文件里，引号里的内容往往正是要锚定的名字：
  // launch 的 name="image_topic"、JSON 的键、文档里写的接口名。
  // 只有真正的源码才把字符串字面量排除在证据之外。
  /* 反过来定规则：只有**确认是源码**的后缀才把字符串当"不算证据"。
     配置文件（yaml/toml/ini/cfg/env）、Makefile/Dockerfile 这类无后缀文件、以及任何不认识的
     后缀，都按"引号里的名字也是名字"处理——否则 key: "topic_name" 会被剥掉，锚点全成假漂移。 */
  const source = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.cs', '.java', '.go', '.rs', '.swift', '.kt', '.php', '.py', '.pyi', '.rb'].includes(extension)
  const markup = !source
  const hashComments = ['.py', '.pyi', '.sh', '.bash', '.rb', '.yml', '.yaml', '.toml'].includes(extension)
  const cComments = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.cs', '.java', '.go', '.rs', '.swift', '.kt', '.php'].includes(extension)
  let out = '', i = 0
  while (i < text.length) {
    if (markup && text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      i = end < 0 ? text.length : end + 3
      out += ' '
    } else if ((hashComments && text[i] === '#') || (cComments && text.startsWith('//', i))) {
      const end = text.indexOf('\n', i)
      i = end < 0 ? text.length : end
      out += ' '
    } else if (cComments && text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      out += ' '
    } else if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(extension) && text[i] === '/' &&
      (/[=(:,[!&|?{};]$/.test(out.trimEnd()) || /(?:^|\W)(?:return|throw|case|yield)$/.test(out.trimEnd()) || out.trim() === '')) {
      // Quotes and comment markers inside a regex literal are not strings/comments.
      i++
      let bracket = false
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue }
        if (text[i] === '[') bracket = true
        else if (text[i] === ']') bracket = false
        else if (text[i] === '/' && !bracket) { i++; break }
        if (text[i] === '\n') break
        i++
      }
      while (/[a-z]/i.test(text[i] || '') && i < text.length) i++
      out += ' '
    } else if (source && '"\'`'.includes(text[i])) {
      const quote = text[i]
      const delimiter = hashComments && text.startsWith(quote.repeat(3), i) ? quote.repeat(3) : quote
      i += delimiter.length
      while (i < text.length && !text.startsWith(delimiter, i)) {
        i += text[i] === '\\' ? 2 : 1
      }
      i += delimiter.length
      out += ' '
    } else {
      out += text[i++]
    }
  }
  return out
}

function containsSymbol(text, symbol) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?<![A-Za-z0-9_])' + escaped + '(?![A-Za-z0-9_])').test(text)
}

/** 新锚点记录源码基线；已有文件沿用旧基线，只有显式复核才更新。 */
export function prepareSourceEvidence(state, previous, repoRoot, reviewSources = false) {
  if (!repoRoot) return
  const old = new Map(collectAnchors(previous.organs ?? [], previous.flows ?? [], previous.body?.board)
    .filter(({ anchor }) => anchor.sha256).map(({ anchor }) => [anchor.file, anchor.sha256]))
  // Do not mutate previous state: history and rollback must retain the old fingerprints.
  for (const organ of state.organs) {
    if (organ.anchors) organ.anchors = structuredClone(organ.anchors)
    if (organ.composition) organ.composition = structuredClone(organ.composition)
  }
  for (const flow of state.flows) if (flow.anchors) flow.anchors = structuredClone(flow.anchors)
  if(state.body?.board) state.body.board=structuredClone(state.body.board)
  const owners = collectAnchors(state.organs, state.flows, state.body?.board)
  const scanned = scanAnchors(repoRoot, owners.map(({ anchor }) => anchor))
  owners.forEach(({ anchor }, index) => {
    if (!reviewSources && old.has(anchor.file)) anchor.sha256 = old.get(anchor.file)
    else if ((reviewSources || !anchor.sha256) && scanned[index].sha256) anchor.sha256 = scanned[index].sha256
  })
}

/** 收集一具解剖体里所有锚点，附带它属于谁，便于一次性体检。 */
export function collectAnchors(organs, flows, board) {
  const out = []
  for (const organ of organs) {
    for (const anchor of organ.anchors ?? []) out.push({ owner: '器官 ' + organ.id, ownerKind: 'organ', ownerId: organ.id, anchor })
    for (const part of organ.composition ?? []) {
      if (part?.anchor) out.push({ owner: '器官 ' + organ.id + ' 的成分「' + part.name + '」', ownerKind: 'organ', ownerId: organ.id, anchor: part.anchor })
    }
  }
  for (const flow of flows) {
    for (const anchor of flow.anchors ?? []) out.push({ owner: '血脉 ' + flow.id, ownerKind: 'flow', ownerId: flow.id, anchor })
  }
  for(const element of Array.isArray(board?.elements)?board.elements:[])for(const anchor of Array.isArray(element?.anchors)?element.anchors:[])if(anchor&&typeof anchor.file==='string')out.push({owner:'图元 '+element.id,ownerKind:'element',ownerId:element.id,anchor})
  return out
}
