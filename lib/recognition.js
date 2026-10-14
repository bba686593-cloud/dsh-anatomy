// Recognition requests are candidates, never edits to the engineering board.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseImageSource } from './images.js'
import { selectedVersion } from './versions.js'

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired'])
const fail = (message, status = 409) => { throw Object.assign(Error(message), { status }) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function paths(dir, id) {
  if (id !== undefined && !ID.test(id)) fail('无效的识别请求标识。', 400)
  const base = resolve(dir)
  if (!existsSync(join(base, 'body.json'))) fail('工程画板数据不存在。', 404)
  let parent = base
  for (const segment of ['.anatomy-runtime', 'recognition', 'requests']) {
    parent = join(parent, segment)
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) fail('识别目录不能是符号链接。', 400)
    mkdirSync(parent, { recursive: true, mode: 0o700 })
  }
  return { root: parent, job: id ? join(parent, id) : null }
}
function noLink(file) { try { if (lstatSync(file).isSymbolicLink()) fail('识别文件不能是符号链接。', 400) } catch (error) { if (error.code !== 'ENOENT') throw error } }
function atomic(file, value) {
  noLink(file)
  const temp = file + '.' + randomUUID() + '.tmp'
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  try { renameSync(temp, file) } finally { if (existsSync(temp)) unlinkSync(temp) }
}
function locked(job, fn) {
  noLink(job)
  const lock = join(job, 'lock'), deadline = Date.now() + 3000, token = randomUUID()
  for (;;) {
    try { mkdirSync(lock); break } catch (error) {
      if (error.code !== 'EEXIST') throw error
      noLink(lock)
      try {
        const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'))
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) { try { process.kill(owner.pid, 0) } catch (error) { if (error.code === 'ESRCH') { rmSync(lock, { recursive: true }); continue } } }
      } catch {}
      if (Date.now() >= deadline) fail('识别请求正在更新，请重试。')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
    }
  }
  const ownerFile = join(lock, 'owner.json')
  try { writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' }); return fn() }
  finally { if (existsSync(ownerFile) && JSON.parse(readFileSync(ownerFile, 'utf8')).token === token) { unlinkSync(ownerFile); rmdirSync(lock) } }
}
function load(job) {
  noLink(job)
  const file = join(job, 'request.json'); noLink(file)
  if (!existsSync(file)) fail('识别请求不存在。', 404)
  const request = JSON.parse(readFileSync(file, 'utf8'))
  if (request.schema !== 'anatomy-recognition/1' || !ID.test(request.id) || request.id !== basename(job) || !['pending', 'processing', ...TERMINAL].includes(request.status) || !Number.isFinite(Date.parse(request.expiresAt))) fail('识别请求数据无效。', 400)
  return request
}
function currentRevision(dir) { return selectedVersion(dir)?.selected?.revision ?? null }
function checkCurrent(dir, request) {
  if (request.selectionRevision !== currentRevision(dir)) fail('画板选定版本已变化，请重新圈选识别。')
}
function fresh(request, now) {
  if (!TERMINAL.has(request.status) && now >= Date.parse(request.expiresAt)) return { ...request, status: 'expired', error: '识别请求已过期，请重新识别。' }
  return request
}
function publish(root, job, request, bytes) {
  const temporary = join(root, '.creating-' + randomUUID())
  mkdirSync(temporary, { mode: 0o700 })
  try {
    if (bytes) writeFileSync(join(temporary, 'input.png'), bytes, { mode: 0o600, flag: 'wx' })
    atomic(join(temporary, 'request.json'), request)
    renameSync(temporary, job)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
}
function verifiedImage(job, request) {
  const file = join(job, 'input.png'); noLink(file)
  const bytes = readFileSync(file)
  if (hash(bytes) !== request.imageHash) fail('识别图片已变化，不能使用旧候选结果。')
  return bytes
}
export function createRecognitionRequest(dir, args, now = Date.now()) {
  if (!['text', 'math'].includes(args.mode)) fail('请选择中文说明或数学公式。', 400)
  const parsed = parseImageSource(args.image)
  if (parsed.mime !== 'image/png' || parsed.bytes > 4 * 1024 * 1024 || parsed.width * parsed.height > 4_000_000) fail('识别图片必须是 4 MiB、400 万像素以内的 PNG。', 400)
  const revision = args.selectionRevision ?? null
  if (revision !== currentRevision(dir)) fail('画板选定版本已变化，请重新圈选识别。')
  if (!Array.isArray(args.sourceElements ?? []) || (args.sourceElements?.length ?? 0) > 500 || args.sourceElements?.some(v => typeof v !== 'string' || v.length > 200)) fail('识别来源无效。', 400)
  const id = args.id ?? randomUUID(), { root, job } = paths(dir, id)
  const bytes = Buffer.from(args.image.slice(args.image.indexOf(',') + 1), 'base64')
  const request = { schema: 'anatomy-recognition/1', id, status: 'pending', mode: args.mode, imageHash: hash(bytes), width: parsed.width, height: parsed.height,
    selectionRevision: revision, sourceRevision: String(args.sourceRevision ?? '').slice(0, 200), sourceElements: args.sourceElements ?? [],
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() }
  return locked(root, () => {
    if (existsSync(job)) fail('识别请求标识已使用或已取消。')
    checkCurrent(dir, request)
    if (readdirSync(root).filter(v => ID.test(v)).map(v => fresh(load(join(root, v)), now)).filter(v => !TERMINAL.has(v.status)).length >= 32) fail('等待中的识别请求太多，请先完成或取消。', 429)
    publish(root, job, request, bytes)
    return { ok: true, request, hint: '等待 DSH 或 Codex 智能体通过 anatomy_recognition 读取图片并回传候选结果。' }
  })
}
export function readRecognitionRequest(dir, id, { image = false, now = Date.now() } = {}) {
  const { job } = paths(dir, id), request = fresh(load(job), now)
  checkCurrent(dir, request)
  const response = { ok: true, request }
  if (image && ['cancelled', 'expired'].includes(request.status)) fail('识别请求已取消或过期，不能读取旧图片。')
  if (!['cancelled', 'expired'].includes(request.status)) {
    const bytes = verifiedImage(job, request)
    if (image)
    response.image = { src: 'data:image/png;base64,' + bytes.toString('base64'), sha256: request.imageHash, width: request.width, height: request.height }
  }
  return response
}
export function pendingRecognitionRequests(dir, { limit = 10, now = Date.now() } = {}) {
  const { root } = paths(dir), revision = currentRevision(dir)
  return locked(root, () => ({ ok: true, requests: readdirSync(root).filter(v => ID.test(v)).map(v => fresh(load(join(root, v)), now))
    .filter(v => !TERMINAL.has(v.status) && v.selectionRevision === revision).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, Math.max(1, Math.min(32, Number(limit) || 10))) }))
}
export function updateRecognitionRequest(dir, args, now = Date.now()) {
  const { root, job } = paths(dir, args.id)
  if (args.action === 'cancel') return locked(root, () => {
    if (!existsSync(job)) {
      const request = { schema: 'anatomy-recognition/1', id: args.id, status: 'cancelled', mode: null, selectionRevision: currentRevision(dir), sourceElements: [], sourceRevision: '', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString() }
      publish(root, job, request)
      return { ok: true, request }
    }
    return locked(job, () => {
      const request = fresh(load(job), now)
      if (!TERMINAL.has(request.status)) { request.status = 'cancelled'; request.updatedAt = new Date(now).toISOString(); atomic(join(job, 'request.json'), request) }
      return { ok: true, request }
    })
  })
  return locked(job, () => {
    const request = fresh(load(job), now)
    checkCurrent(dir, request)
    if (TERMINAL.has(request.status)) fail('识别请求已结束，不能回传或覆盖结果。')
    if (args.expectedStatus !== undefined && request.status !== args.expectedStatus) fail('识别请求状态已变化，不能覆盖另一份执行。')
    if (args.imageHash !== request.imageHash) fail('图片指纹不匹配，请重新读取当前请求。')
    readRecognitionRequest(dir, args.id, { image: true, now })
    if (args.action === 'complete') {
      if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 20_000) fail('候选结果必须是非空文字或公式，最多 20000 字符。', 400)
      request.result = { text: args.text.trim(), engine: String(args.engine || 'host-agent').slice(0, 100), mode: request.mode }
      request.status = 'completed'
    } else if (args.action === 'fail') { request.status = 'failed'; request.error = String(args.error || '智能体识别未完成。').slice(0, 1000) }
    else if (args.action === 'claim') { if (request.status !== 'pending') fail('识别请求已被接管，不能重复执行。'); request.status = 'processing' }
    else fail('未知的识别操作。', 400)
    request.updatedAt = new Date(now).toISOString()
    atomic(join(job, 'request.json'), request)
    return { ok: true, request, hint: '结果已回传网页，需用户校对确认后才会放入画板。' }
  })
}
export function recognitionJobDirectory(dir, id) { return paths(dir, id).job }
