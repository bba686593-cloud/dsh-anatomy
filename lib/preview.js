// Local preview lifecycle. Only the generated HTML is served; no repository listing.
import { spawn, execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { getRecognitionRuntime } from '../scripts/setup-recognition.mjs'
import { loadAgentRecognitionConfig } from '../scripts/recognition-agent.mjs'
const execute = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/serve_board.py', import.meta.url))
const inFlight = new Map()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const alive = pid => { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
export function previewFiles(file) {
  const boardFile = realpathSync(file)
  const id = createHash('sha256').update(boardFile).digest('hex').slice(0, 16)
  const dir = join(dirname(boardFile), '.anatomy-runtime')
  return { boardFile, dir, state: join(dir, id + '.json'), log: join(dir, id + '.log'), lock: join(dir, id + '.lock') }
}
/** Resolve the board actually open in the conversation; never guess a project
 * from the last saved global version or scan arbitrary remote URLs. */
export async function boardDirectoryFromUrl(value) {
  const url=new URL(value)
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!['/','/anatomy.html'].includes(url.pathname))throw Error('url 必须是当前画板的本地服务地址。')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1500)
  try{
    const response=await fetch(url.origin+'/api/health',{signal:controller.signal,redirect:'error'}),h=await response.json()
    if(!response.ok||h.service!=='anatomy-handwriting'||h.protocol!==2||!h.capabilities?.includes('project-versions')||typeof h.boardFile!=='string')throw Error('此地址不是支持项目保存的 Anatomy 服务。')
    const paths=previewFiles(h.boardFile)
    if(paths.boardFile!==h.boardFile||!existsSync(join(dirname(h.boardFile),'body.json')))throw Error('服务对应的工程画板数据不存在。')
    return dirname(h.boardFile)
  }finally{clearTimeout(timer)}
}
async function health(port, boardFile, instanceId) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 800)
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/api/health', { signal: controller.signal, redirect: 'error' })
    if (!r.ok) return null
    const h = await r.json()
    return h.service === 'anatomy-handwriting' && h.protocol === 2 && h.capabilities?.includes('project-versions') && h.boardFile === boardFile && (!instanceId || h.instanceId === instanceId) ? { ...h, port } : null
  } catch { return null } finally { clearTimeout(timer) }
}
async function existing(paths, preferredPort) {
  const state = readJson(paths.state)
  if (state?.boardFile === paths.boardFile && typeof state.instanceId === 'string') {
    const h = await health(state.port, paths.boardFile, state.instanceId)
    if (h) return h
  }
  return health(preferredPort, paths.boardFile)
}
function summary(h, paths, reused) {
  // This health response already verified the HTTP board service. An optional
  // local OCR failure must not block editing, project saves, or agent OCR.
  const result = { status: h.ready || h.error ? 'ready' : 'starting', url: 'http://127.0.0.1:' + h.port + '/anatomy.html', pid: h.pid, reused, logFile: paths.log, error: null, ...(h.error ? { recognitionError: h.error } : {}) }
  rememberBoard(result.url, paths.boardFile)
  return result
}
function releaseLock(paths, token) {
  const ownerFile = join(paths.lock, 'owner.json')
  if (readJson(ownerFile)?.token !== token) return
  try { unlinkSync(ownerFile); rmdirSync(paths.lock) } catch {}
}
async function launch(file, options, runtime) {
  const paths = previewFiles(file)
  let preferredPort = options.port ?? 8767
  const serviceHash = createHash('sha256').update(readFileSync(runtime.script || script)).digest('hex')
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  const agentConfig = options.agentConfig ?? process.env.ANATOMY_RECOGNITION_AGENT_CONFIG
  let agentConfigurationHash = null
  if (agentConfig !== undefined && agentConfig !== null) {
    await loadAgentRecognitionConfig(agentConfig)
    agentConfigurationHash = createHash('sha256').update(readFileSync(agentConfig)).digest('hex')
  }
  const agentMode = agentConfig ? 'executor' : 'handoff'
  const compatible = h => runtime.script || h?.serviceHash === serviceHash && h?.pluginVersion === packageVersion && h?.providers?.agent?.mode === agentMode && (h?.agentConfigurationHash ?? null) === agentConfigurationHash
  mkdirSync(paths.dir, { recursive: true })
  let found = await existing(paths, preferredPort)
  if (found && compatible(found)) return summary(found, paths, true)
  const token = randomUUID(), deadline = Date.now() + 12000
  for (;;) {
    try {
      mkdirSync(paths.lock)
      writeFileSync(join(paths.lock, 'owner.json'), JSON.stringify({ token, pid: process.pid }))
      break
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      found = await existing(paths, preferredPort)
      if (found && compatible(found)) return summary(found, paths, true)
      if (Date.now() >= deadline) throw Error('另一进程正在启动此画板，请稍后重新生成。')
      const owner = readJson(join(paths.lock, 'owner.json'))
      // Reclaim only abandoned leases; never terminate a process from a PID file.
      if (!alive(owner?.pid) && existsSync(paths.lock) && Date.now() - statSync(paths.lock).mtimeMs > 2000) {
        try { if (existsSync(join(paths.lock, 'owner.json'))) unlinkSync(join(paths.lock, 'owner.json')); rmdirSync(paths.lock); continue } catch {}
      }
      await sleep(150)
    }
  }
  try {
    found = await existing(paths, preferredPort)
    if (found && compatible(found)) return summary(found, paths, true)
    if(found){
      const state=readJson(paths.state)
      // Stop only a live service whose PID and random instance identity were
      // both verified through its loopback endpoint and this board's receipt.
      if(state?.pid===found.pid&&state.instanceId===found.instanceId&&state.boardFile===paths.boardFile&&alive(found.pid)){
        preferredPort=found.port;process.kill(found.pid,'SIGTERM')
        for(let attempt=0;attempt<30&&await health(found.port,paths.boardFile,found.instanceId);attempt++)await sleep(100)
        if(await health(found.port,paths.boardFile,found.instanceId))throw Error('旧画板服务仍在运行，请关闭后重新生成。')
      }else throw Error('此地址运行的是旧版服务，无法核验进程身份；请关闭原服务后重新生成。')
    }
    const instanceId = randomUUID(), log = openSync(paths.log, 'a')
    const recognition = await getRecognitionRuntime()
    const pythonPath = options.pythonPath || (recognition.installed ? recognition.pythonPath : process.platform === 'win32' ? 'python' : 'python3')
    const env = recognition.installed && !options.pythonPath ? { ...recognition.env } : { ...process.env, ANATOMY_NODE: process.execPath }
    if (agentConfig) env.ANATOMY_RECOGNITION_AGENT_CONFIG = agentConfig
    else delete env.ANATOMY_RECOGNITION_AGENT_CONFIG
    let child, failure = null, exited = false
    try {
      child = spawn(pythonPath, [runtime.script || script, '--file', paths.boardFile, '--port', String(preferredPort), '--fallback-port', '--state-file', paths.state, '--instance-id', instanceId, '--warmup'], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env })
      child.once('error', error => { failure = error })
      child.once('exit', code => { exited = true; failure ||= Error('识别服务退出（' + code + '），请查看日志。') })
      child.unref()
    } finally { closeSync(log) }
    const until = Date.now() + 10000
    while (Date.now() < until) {
      if (failure || exited) throw failure
      const state = readJson(paths.state)
      if (state?.instanceId === instanceId) {
        const h = await health(state.port, paths.boardFile, instanceId)
        if (h) return summary(h, paths, false)
      }
      await sleep(100)
    }
    throw Error('服务仍在启动，请稍后重试。日志：' + paths.log)
  } finally { releaseLock(paths, token) }
}
/**
 * 画板登记表：端口 → 画板文件。
 *
 * 为什么需要：网页不能启动本机 Python。用户从页面发起流程（圈选识别、应用选定版本）时，
 * 服务可能因为宿主重启、崩溃或没登录而不在；只要记得住"这个端口是哪个画板"，
 * 拿到 url 的工具就能就地把它拉起来——不需要外部定时器，也不需要用户跑脚本。
 */
function registryFile() {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
  return join(base, 'dsh-anatomy', 'boards.json')
}
function readBoardRegistry() {
  const data = readJson(registryFile())
  return data && typeof data === 'object' ? data : {}
}
function rememberBoard(url, file) {
  try {
    const port = new URL(url).port
    if (!port) return
    const registry = readBoardRegistry()
    if (registry[port] === file) return
    registry[port] = file
    mkdirSync(dirname(registryFile()), { recursive: true })
    writeFileSync(registryFile(), JSON.stringify(registry, null, 2) + '\n')
  } catch {}
}
/** 这个画板现在有没有在跑的服务（只探，不启动）。 */
export async function boardServiceStatus(file) {
  const paths = previewFiles(file)
  const state = readJson(paths.state)
  if (state && Number.isInteger(state.port)) {
    const found = await health(state.port, paths.boardFile, state.instanceId)
    if (found) return summary(found, paths, true)
  }
  const fallback = await health(8767, paths.boardFile)
  return fallback ? summary(fallback, paths, true) : null
}
/**
 * url → 画板目录；服务没在跑时，先用登记表回查是哪个画板，就地拉起服务再解析。
 * 这是"网页驱动"的入口：页面点识别/应用版本 → 工具拿到 url → 服务不在也能自愈。
 */
export async function ensureBoardForUrl(value, options = {}) {
  try { return await boardDirectoryFromUrl(value) } catch (error) {
    let file = null
    try { file = readBoardRegistry()[new URL(value).port] || null } catch {}
    if (!file || !existsSync(file)) throw error
    const service = await ensureBoardService(file, options)
    if (!service || !service.url) throw error
    return await boardDirectoryFromUrl(value)
  }
}
/** dir → 确保这个工程的画板服务在跑（没有画板文件就返回 null，不报错）。 */
export async function ensureBoardForDir(dir, options = {}) {
  const file = join(dir, 'anatomy.html')
  if (!existsSync(file)) return null
  return await ensureBoardService(file, options)
}
export async function ensureBoardService(file, options = {}, runtime = {}) {
  const key = realpathSync(file)
  if (inFlight.has(key)) return inFlight.get(key)
  const task = launch(key, options, runtime).catch(error => ({ status: 'unavailable', url: null, reused: false, error: error.code === 'ENOENT' ? '找不到 Python，请安装 Python 或设置插件的 pythonPath。' : error.message, logFile: previewFiles(key).log }))
  inFlight.set(key, task)
  try { return await task } finally { inFlight.delete(key) }
}
export async function openBoardBrowser(url) {
  // URL originates from a verified loopback service, never a shell fragment.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/anatomy\.html$/.test(url)) return { status: 'failed', error: '无效的本地画板地址。' }
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return { status: 'skipped', reason: '没有桌面环境，请打开返回的 url。' }
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]
  try { await execute(command, args, { timeout: 5000, windowsHide: true }); return { status: 'requested' } }
  catch (e) { return { status: 'failed', error: '自动打开浏览器未完成，请打开返回的 url。', detail: e.code || e.message } }
}
