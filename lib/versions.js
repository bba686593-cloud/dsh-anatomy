import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { anatomyFingerprint, loadBody, loadOrgans, loadFlows } from './store.js'
import { boardFor, boardDiagnostics } from './board.js'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const idPattern = /^v-[0-9T-]+-[a-f0-9-]{36}$/
const fail = (code, message, status = 409) => { throw Object.assign(Error(message), { code, status }) }
export const versionPaths = dir => ({ directory: join(dir, 'edits', 'versions'), selection: join(dir, 'edits', 'selected.json'), lock: join(dir, 'edits', '.version-lock') })
const json = file => JSON.parse(readFileSync(file, 'utf8'))
function atomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp'
  try { writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); renameSync(temp, file) }
  finally { rmSync(temp, { force: true }) }
}
export function versionState(dir) {
  const body = loadBody(dir), organs = loadOrgans(dir), flows = loadFlows(dir).flows ?? []
  if (!body?.slug) fail('version/project-missing', '此画板旁缺少有效的 body.json，请用插件重新生成画板。', 400)
  return { body, organs, flows, board: boardFor(body, organs, flows), hash: anatomyFingerprint(body, organs, flows) }
}
export function withVersionLock(dir, fn) {
  const p = versionPaths(dir); mkdirSync(p.directory, { recursive: true })
  try { mkdirSync(p.lock) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let owner
    try { owner = json(join(p.lock, 'owner.json')); process.kill(owner.pid, 0) }
    catch (e) { if (e.code === 'ESRCH') { rmSync(p.lock, { recursive: true }); return withVersionLock(dir, fn) } }
    fail('version/busy', '另一份保存或应用正在进行，请稍后重试。')
  }
  try { writeFileSync(join(p.lock, 'owner.json'), JSON.stringify({ pid: process.pid })); return fn() }
  finally { rmSync(p.lock, { recursive: true, force: true }) }
}
function pointer(dir) { const file = versionPaths(dir).selection; return existsSync(file) ? json(file) : null }
export function readVersion(dir, id) {
  if (typeof id !== 'string' || !idPattern.test(id)) fail('version/id', '保存版本标识无效。', 400)
  const file = join(versionPaths(dir).directory, id + '.json')
  if (!existsSync(file)) fail('version/missing', '找不到所选保存版本。', 404)
  const version = json(file)
  if (version.schema !== 'anatomy-version/1' || version.id !== id || digest(version.board) !== version.boardHash) fail('version/corrupt', '保存版本内容已损坏，不能应用。', 400)
  return { ...version, file }
}
function validate(board, state) {
  const errors = boardDiagnostics(board, state.organs, state.flows)
  if (errors.length) throw Object.assign(Error(errors[0].message), { code: 'version/invalid-board', status: 400, errors })
}
function expect(state, selected, args) {
  if (args.baseHash !== state.hash) fail('version/engine-changed', '工程版本已变化，请刷新后核对修改；当前草稿仍保留。')
  if (args.expectedSelection !== (selected?.revision ?? null)) fail('version/selection-changed', '选定版本已被其他页面或 AI 切换，请刷新版本列表后重试。')
}
export function selectedVersion(dir, state = versionState(dir)) {
  const selected = pointer(dir)
  if (!selected) return null
  const version = readVersion(dir, selected.id)
  if (version.body !== state.body.slug) fail('version/project-mismatch', '保存版本属于其他工程。', 400)
  const pending = !selected.appliedAt && version.boardHash !== digest(state.board)
  return { selected, version, pending, currentHash: state.hash, conflict: pending && selected.baseHash !== state.hash,
    bundle: { schema: 'anatomy-edits/1', body: state.body.slug, baseHash: selected.baseHash, edits: pending ? [{ kind: 'body', patch: { board: version.board } }] : [] } }
}
export function listVersions(dir) {
  const state = versionState(dir), p = versionPaths(dir), chosen = selectedVersion(dir, state)
  const versions = existsSync(p.directory) ? readdirSync(p.directory).filter(n => idPattern.test(n.replace(/\.json$/, '')) && n.endsWith('.json')).map(n => readVersion(dir, n.slice(0, -5))).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) : []
  return { ok: true, directory: p.directory, currentHash: state.hash, selected: chosen?.selected ?? null, pending: chosen?.pending ?? false, conflict: chosen?.conflict ?? false,
    versions: versions.map(v => ({ id: v.id, label: v.label, createdAt: v.createdAt, elements: v.board.elements.length, boardHash: v.boardHash, selected: v.id === chosen?.selected.id })) }
}
export function saveVersion(dir, args) {
  return withVersionLock(dir, () => {
    const state = versionState(dir), selected = pointer(dir); expect(state, selected, args)
    if (args.body !== state.body.slug) fail('version/project-mismatch', '页面属于其他工程。', 400)
    validate(args.board, state)
    const createdAt = new Date().toISOString(), id = 'v-' + createdAt.replace(/[:.Z]/g, '-') + randomUUID()
    const version = { schema: 'anatomy-version/1', id, body: state.body.slug, label: String(args.label || '保存修改').slice(0, 100), createdAt,
      baseHash: state.hash, parent: selected?.id ?? null, boardHash: digest(args.board), board: structuredClone(args.board) }
    atomic(join(versionPaths(dir).directory, id + '.json'), version)
    atomic(versionPaths(dir).selection, { schema: 'anatomy-selection/1', id, revision: randomUUID(), baseHash: state.hash, selectedAt: createdAt, ...(version.boardHash===digest(state.board)?{appliedAt:createdAt,appliedHash:state.hash}:{}) })
    return { ...listVersions(dir), board: version.board, saved: id }
  })
}
export function selectVersion(dir, args) {
  return withVersionLock(dir, () => {
    const state = versionState(dir); expect(state, pointer(dir), args)
    const version = readVersion(dir, args.id)
    if (version.body !== state.body.slug) fail('version/project-mismatch', '保存版本属于其他工程。', 400)
    validate(version.board, state)
    // Selecting history explicitly creates restoration intent against today's
    // engineering baseline; immutable historical snapshots remain unchanged.
    const now=new Date().toISOString()
    atomic(versionPaths(dir).selection, { schema: 'anatomy-selection/1', id: version.id, revision: randomUUID(), baseHash: state.hash, selectedAt: now, ...(version.boardHash===digest(state.board)?{appliedAt:now,appliedHash:state.hash}:{}) })
    return { ...listVersions(dir), board: version.board }
  })
}
export function markVersionApplied(dir, revision, hash) {
  const selected = pointer(dir)
  if (selected?.revision !== revision) fail('version/selection-changed', '应用过程中选定版本发生变化。')
  atomic(versionPaths(dir).selection, { ...selected, baseHash: hash, appliedHash: hash, appliedAt: new Date().toISOString() })
}
