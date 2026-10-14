#!/usr/bin/env node
// Only the user's isolated environment and public model cache are managed here.
// Python dependencies and model weights are downloaded on an explicit install
// or warmup, and are never copied into the published plugin package.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA = 1
const hash = value => createHash('sha256').update(value).digest('hex')
const exists = async file => { try { await access(file); return true } catch { return false } }

export function recognitionHome({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (env.ANATOMY_RECOGNITION_HOME) return path.resolve(env.ANATOMY_RECOGNITION_HOME)
  const cache = platform === 'win32' ? (env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'))
    : platform === 'darwin' ? path.join(home, 'Library', 'Caches')
      : (env.XDG_CACHE_HOME || path.join(home, '.cache'))
  return path.resolve(cache, 'dsh-anatomy', 'recognition')
}

export async function getRecognitionRuntime(options = {}) {
  const rootDir = path.resolve(options.rootDir || PLUGIN_ROOT)
  const platform = options.platform || process.platform
  const inherited = options.env || process.env
  const homeDir = path.resolve(options.homeDir || recognitionHome({ platform, env: inherited }))
  const venvDir = path.join(homeDir, 'venv')
  const pythonPath = path.join(venvDir, platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python')
  const env = { ...inherited }
  // An inherited PYTHONPATH/PYTHONHOME must not escape the managed venv.
  for (const key of Object.keys(env)) {
    if (['PYTHONPATH', 'PYTHONHOME'].includes(key.toUpperCase())) delete env[key]
  }
  Object.assign(env, {
    PYTHONNOUSERSITE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PADDLE_PDX_CACHE_HOME: path.join(homeDir, 'models', 'paddlex'),
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
    PADDLE_PDX_MODEL_SOURCE: 'BOS',
    ANATOMY_MANAGED_OCR_ENV: '1',
    ANATOMY_NODE: process.execPath
  })
  return {
    homeDir, venvDir, pythonPath, env,
    installed: await exists(pythonPath),
    servicePath: path.join(rootDir, 'scripts', 'serve_board.py'),
    manifestPath: path.join(homeDir, 'installed.json'),
    requirementsPath: path.join(rootDir, 'scripts', 'requirements-ocr.txt')
  }
}

export function executeProcess({ command, args, cwd, env, inherit = false }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    // Retain enough diagnostics without exposing the caller's environment.
    child.stdout?.on('data', data => { stdout = (stdout + data).slice(-100_000) })
    child.stderr?.on('data', data => { stderr = (stderr + data).slice(-100_000) })
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code: code ?? 1, signal, stdout, stderr }))
  })
}

const PROBE = `import json, sys\nprint(json.dumps({"version": list(sys.version_info[:3]), "tag": sys.implementation.cache_tag, "prefix": sys.prefix, "basePrefix": sys.base_prefix, "executable": sys.executable}))`
const IMPORT_CHECK = `import json\ntry:\n from paddleocr import TextRecognition, FormulaRecognition\n import numpy, PIL\n print(json.dumps({"ok": True}))\nexcept Exception as error:\n print(json.dumps({"ok": False, "error": str(error)}))`
const WARMUP = `import importlib.util, json, sys\nspec = importlib.util.spec_from_file_location("anatomy_recognition_service", sys.argv[1])\nservice = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(service)\nengine = service.RecognitionEngine()\nengine.warmup()\nif engine.error:\n print(engine.error, file=sys.stderr)\n sys.exit(1)\nprint(json.dumps({"ok": True, "modes": list(engine.models)}))`

function parseJsonResult(result, label) {
  if (result.code !== 0) throw new Error(`${label}失败：${result.stderr?.trim() || result.stdout?.trim() || `退出码 ${result.code}`}`)
  try { return JSON.parse(result.stdout.trim().split('\n').at(-1)) } catch { throw new Error(`${label}未返回有效的检查结果。`) }
}

export function createRecognitionSetup(options = {}) {
  const rootDir = path.resolve(options.rootDir || PLUGIN_ROOT)
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const execute = options.execute || executeProcess
  const log = options.log || (() => {})
  const invoke = async (command, args, runtime, inherit = false) => execute({ command, args, cwd: rootDir, env: runtime.env, inherit })

  async function sourceInfo(runtime) {
    const [requirements, service, packageText] = await Promise.all([
      readFile(runtime.requirementsPath), readFile(runtime.servicePath), readFile(path.join(rootDir, 'package.json'), 'utf8')
    ])
    const pluginVersion = JSON.parse(packageText).version
    return { requirementsHash: hash(requirements), serviceHash: hash(service), pluginVersion }
  }

  async function readManifest(runtime) {
    try { return JSON.parse(await readFile(runtime.manifestPath, 'utf8')) } catch { return null }
  }

  async function probe(command, args, runtime) {
    const info = parseJsonResult(await invoke(command, [...args, '-c', PROBE], runtime), 'Python 检查')
    if (!Array.isArray(info.version) || info.version[0] !== 3 || info.version[1] < 8) throw new Error('需要 Python 3.8 或更高版本。请通过 --python 指定已安装的 Python。')
    return info
  }

  async function choosePython(runtime, pythonPath) {
    const explicit = pythonPath || options.pythonPath || runtime.env.ANATOMY_PYTHON
    const candidates = explicit ? [[explicit, []]] : platform === 'win32'
      ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]]
    for (const [command, args] of candidates) {
      try { return { command, args, info: await probe(command, args, runtime) } } catch (error) {
        if (explicit) throw new Error(`无法使用指定 Python：${error.message}`)
      }
    }
    throw new Error('未找到可用的 Python 3.8+。请先安装 Python，然后用 --python 指定其可执行文件；安装器不会修改全局 Python。')
  }

  function isolated(info, runtime) {
    const normalize = value => platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
    return typeof info.prefix === 'string' && typeof info.basePrefix === 'string'
      && normalize(info.prefix) !== normalize(info.basePrefix) && normalize(info.prefix) === normalize(runtime.venvDir)
  }

  function fingerprint(source, info) {
    return hash(JSON.stringify({ requirements: source.requirementsHash, python: info.tag || info.version.slice(0, 2).join('.'), platform, arch }))
  }

  async function check() {
    const runtime = await getRecognitionRuntime({ ...options, rootDir, platform })
    const source = await sourceInfo(runtime)
    const manifest = await readManifest(runtime)
    const base = { ...source, pythonPath: runtime.pythonPath, homeDir: runtime.homeDir, servicePath: runtime.servicePath }
    if (!runtime.installed) return { ...base, ready: false, status: 'missing-environment', message: '本地 OCR 尚未安装，请运行 recognition:install。' }
    let info
    try { info = await probe(runtime.pythonPath, [], runtime) } catch (error) {
      return { ...base, ready: false, status: 'invalid-environment', message: error.message }
    }
    if (!isolated(info, runtime)) return { ...base, ready: false, status: 'unmanaged-environment', message: 'OCR Python 不是安装器创建的独立 venv，已停止安装。' }
    const dependencyFingerprint = fingerprint(source, info)
    if (!manifest || manifest.schema !== SCHEMA || manifest.dependencyFingerprint !== dependencyFingerprint) {
      return { ...base, ready: false, status: 'outdated-dependencies', dependencyFingerprint, message: '本地 OCR 依赖缺失或版本已更新，请运行 recognition:update。' }
    }
    try {
      const imports = parseJsonResult(await invoke(runtime.pythonPath, ['-c', IMPORT_CHECK], runtime), 'OCR 依赖检查')
      if (!imports.ok) return { ...base, ready: false, status: 'missing-dependencies', dependencyFingerprint, message: imports.error || 'OCR 依赖无法加载，请运行 recognition:update。' }
    } catch (error) {
      return { ...base, ready: false, status: 'missing-dependencies', dependencyFingerprint, message: error.message }
    }
    return { ...base, ready: true, status: 'ready', dependencyFingerprint,
      serviceUpdated: manifest.serviceHash !== source.serviceHash || manifest.pluginVersion !== source.pluginVersion,
      message: '本地 OCR 环境已就绪；服务使用当前插件代码。' }
  }

  async function saveManifest(runtime, manifest) {
    const temporary = `${runtime.manifestPath}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    try { await rename(temporary, runtime.manifestPath) } finally { await rm(temporary, { force: true }) }
  }

  async function install({ pythonPath } = {}) {
    const runtime = await getRecognitionRuntime({ ...options, rootDir, platform })
    await mkdir(runtime.homeDir, { recursive: true })
    const lockPath = path.join(runtime.homeDir, 'setup.lock')
    let lock
    try { lock = await open(lockPath, 'wx', 0o600) } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`另一项 OCR 安装正在运行。若之前安装意外中断，请确认安装进程已退出，再移除 ${lockPath}。`)
      throw error
    }
    try {
      let info
      if (!runtime.installed) {
        const python = await choosePython(runtime, pythonPath)
        log('创建独立 Python 环境…')
        const created = await invoke(python.command, [...python.args, '-m', 'venv', runtime.venvDir], runtime)
        if (created.code !== 0) throw new Error(`创建 venv 失败：${created.stderr?.trim() || '请检查 Python 是否包含 venv/ensurepip 支持。'}`)
      }
      info = await probe(runtime.pythonPath, [], runtime)
      if (!isolated(info, runtime)) throw new Error('安装目标不是独立 venv，已停止；不会向全局 Python 安装依赖。')
      const source = await sourceInfo(runtime)
      const dependencyFingerprint = fingerprint(source, info)
      const previous = await readManifest(runtime)
      let imports = { ok: false }
      if (previous?.schema === SCHEMA && previous.dependencyFingerprint === dependencyFingerprint) {
        try { imports = parseJsonResult(await invoke(runtime.pythonPath, ['-c', IMPORT_CHECK], runtime), 'OCR 依赖检查') } catch {}
      }
      const dependenciesInstalled = !imports.ok
      if (dependenciesInstalled) {
        // A failed pip invocation must never leave a success stamp behind.
        await rm(runtime.manifestPath, { force: true })
        log('安装/更新本地 OCR 依赖（只写入独立 venv）…')
        const result = await invoke(runtime.pythonPath, ['-m', 'pip', '--require-virtualenv', 'install', '--disable-pip-version-check', '--upgrade', '-r', runtime.requirementsPath], runtime)
        if (result.code !== 0) throw new Error(`OCR 依赖安装失败。请检查网络及此 Python/系统是否有 requirements-ocr.txt 对应的安装包；不会回退到全局 Python。\n${result.stderr?.trim() || result.stdout?.trim() || `退出码 ${result.code}`}`)
        imports = parseJsonResult(await invoke(runtime.pythonPath, ['-c', IMPORT_CHECK], runtime), 'OCR 依赖检查')
        if (!imports.ok) throw new Error(`安装后 OCR 依赖仍无法加载：${imports.error || '未知错误'}`)
      } else log('依赖版本未变化，复用已安装的独立环境。')
      const timestamp = new Date().toISOString()
      await saveManifest(runtime, { schema: SCHEMA, ...source, dependencyFingerprint, platform, arch,
        python: { version: info.version, tag: info.tag }, installedAt: previous?.installedAt || timestamp, updatedAt: timestamp })
      return { ...(await check()), dependenciesInstalled }
    } finally {
      await lock.close()
      await rm(lockPath, { force: true })
    }
  }

  async function warmup() {
    const status = await check()
    if (!status.ready) throw new Error(status.message)
    const runtime = await getRecognitionRuntime({ ...options, rootDir, platform })
    log('准备中文和公式模型；首次运行会下载公开模型权重…')
    const result = await invoke(runtime.pythonPath, ['-c', WARMUP, runtime.servicePath], runtime)
    const warmed = parseJsonResult(result, '识别模型预加载')
    if (!warmed.ok || !['text', 'math'].every(mode => warmed.modes?.includes(mode))) throw new Error('预加载未确认中文和公式模型均已就绪。')
    return { ...status, modelsReady: true, modes: warmed.modes, modelCache: runtime.env.PADDLE_PDX_CACHE_HOME }
  }

  async function serve(args = [], { pythonPath } = {}) {
    const runtime = await getRecognitionRuntime({ ...options, rootDir, platform })
    let command = runtime.pythonPath, prefix = []
    if (runtime.installed) {
      const info = await probe(command, [], runtime)
      if (!isolated(info, runtime)) throw new Error('识别环境不是独立 venv，请运行 recognition:update。')
    } else {
      const python = await choosePython(runtime, pythonPath)
      command = python.command
      prefix = python.args
      log('本地 OCR 尚未安装，画板可以打开；识别前运行 recognition:install。')
    }
    return invoke(command, [...prefix, runtime.servicePath, ...args], runtime, true)
  }

  return { check, install, update: install, warmup, serve }
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv.shift() || 'check'
  if (!['check', 'install', 'update', 'warmup', 'serve'].includes(command)) throw new Error('用法：node scripts/setup-recognition.mjs check|install|update|warmup|serve [--python 路径] [--home 目录] [--json]')
  let pythonPath, homeDir, json = false
  const forwarded = []
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    if (argument === '--') { forwarded.push(...argv.slice(i + 1)); break }
    if (argument === '--json') { json = true; continue }
    const name = argument.split('=')[0]
    if (name === '--python' || name === '--home') {
      const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`${name} 需要一个路径。`)
      if (name === '--python') pythonPath = value
      else homeDir = value
    } else if (command === 'serve') forwarded.push(argument)
    else throw new Error(`无法识别的参数：${argument}`)
  }
  const setup = createRecognitionSetup({ pythonPath, homeDir, log: message => { if (!json) process.stderr.write(message + '\n') } })
  const result = command === 'serve' ? await setup.serve(forwarded) : await setup[command]()
  if (command === 'serve') return result.code
  process.stdout.write(json ? JSON.stringify(result) + '\n' : `${result.message}\nPython: ${result.pythonPath}\n服务: ${result.servicePath}\n${result.modelsReady ? '中文和公式模型均已就绪。\n' : ''}`)
  return result.ready ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code }, error => { process.stderr.write(error.message + '\n'); process.exitCode = 1 })
}
