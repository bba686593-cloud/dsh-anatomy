import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRecognitionSetup, getRecognitionRuntime, recognitionHome } from '../scripts/setup-recognition.mjs'

async function fixture(t, { platform = 'linux', arch = 'x64', pythonPath, failPip = false, failWarmup = false } = {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'anatomy-recognition-setup-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const rootDir = path.join(temporary, 'plugin')
  const homeDir = path.join(temporary, 'user cache')
  await mkdir(path.join(rootDir, 'scripts'), { recursive: true })
  await writeFile(path.join(rootDir, 'package.json'), '{"version":"1.0.0"}')
  await writeFile(path.join(rootDir, 'scripts', 'serve_board.py'), '# service version one\n')
  await writeFile(path.join(rootDir, 'scripts', 'requirements-ocr.txt'), 'paddleocr==3.1.0\n')
  const calls = []
  const state = { importsReady: false, pipFailures: failPip ? 1 : 0, failWarmup, globalPython: false }
  const runtime = await getRecognitionRuntime({ rootDir, homeDir, platform, env: { PATH: '/safe', PYTHONPATH: '/bad', PYTHONHOME: '/bad' } })
  const execute = async call => {
    calls.push(call)
    const { command, args } = call
    if (args.includes('venv')) {
      await mkdir(path.dirname(runtime.pythonPath), { recursive: true })
      await writeFile(runtime.pythonPath, 'stub executable')
      return { code: 0, stdout: '', stderr: '' }
    }
    if (args.includes('pip')) {
      assert.equal(command, runtime.pythonPath)
      assert.ok(args.includes('--require-virtualenv'))
      assert.ok(args.includes('-r'))
      assert.equal(call.env.PYTHONNOUSERSITE, '1')
      if (state.pipFailures > 0) {
        state.pipFailures--
        return { code: 1, stdout: '', stderr: 'simulated package unavailable' }
      }
      state.importsReady = true
      return { code: 0, stdout: 'installed', stderr: '' }
    }
    if (args[0] === '-c' || args.includes('-c')) {
      const script = args[args.indexOf('-c') + 1]
      if (script.includes('spec_from_file_location')) return state.failWarmup
        ? { code: 1, stdout: '', stderr: 'simulated model unavailable' }
        : { code: 0, stdout: 'models loaded\n{"ok":true,"modes":["text","math"]}\n', stderr: '' }
      if (script.includes('from paddleocr')) return { code: 0, stdout: JSON.stringify({ ok: state.importsReady, error: 'simulated missing imports' }), stderr: '' }
      const managed = command === runtime.pythonPath && !state.globalPython
      return { code: 0, stdout: JSON.stringify({ version: [3, 10, 12], tag: 'cpython-310', prefix: managed ? runtime.venvDir : '/base-python', basePrefix: '/base-python', executable: command }), stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  const setup = createRecognitionSetup({ rootDir, homeDir, platform, arch, pythonPath, execute, env: { PATH: '/safe', PYTHONPATH: '/bad', PYTHONHOME: '/bad' } })
  return { setup, runtime, state, calls, rootDir, homeDir }
}

test('check is read-only when the isolated environment is missing', async t => {
  const { setup, calls, homeDir } = await fixture(t)
  const result = await setup.check()
  assert.equal(result.ready, false)
  assert.equal(result.status, 'missing-environment')
  assert.equal(calls.length, 0)
  await assert.rejects(readFile(path.join(homeDir, 'installed.json')), { code: 'ENOENT' })
})

for (const platform of ['linux', 'darwin', 'win32']) test(`install creates an isolated ${platform} environment and skips unchanged dependencies`, async t => {
  const { setup, calls, runtime } = await fixture(t, { platform })
  const result = await setup.install()
  assert.equal(result.ready, true)
  assert.equal(result.dependenciesInstalled, true)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 1)
  const creation = calls.find(call => call.args.includes('venv'))
  assert.equal(creation.command, platform === 'win32' ? 'py' : 'python3')
  assert.equal(creation.args.at(-1), runtime.venvDir)
  assert.ok(runtime.pythonPath.endsWith(platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')))
  assert.equal((await setup.update()).dependenciesInstalled, false)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 1)
  assert.equal((await setup.check()).ready, true)
  assert.equal(calls.every(call => !('PYTHONPATH' in call.env) && !('PYTHONHOME' in call.env)), true)
  assert.equal(calls.every(call => call.env.ANATOMY_MANAGED_OCR_ENV === '1'), true)
})

test('changing requirements updates dependencies once; changing only the plugin uses current service code', async t => {
  const { setup, rootDir, calls, runtime } = await fixture(t)
  await setup.install()
  await writeFile(path.join(rootDir, 'scripts', 'requirements-ocr.txt'), 'paddleocr==3.2.0\n')
  assert.equal((await setup.check()).status, 'outdated-dependencies')
  assert.equal((await setup.update()).dependenciesInstalled, true)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 2)
  await writeFile(path.join(rootDir, 'package.json'), '{"version":"1.0.1"}')
  await writeFile(runtime.servicePath, '# updated service\n')
  const updated = await setup.check()
  assert.equal(updated.ready, true)
  assert.equal(updated.serviceUpdated, true)
  assert.equal((await setup.update()).dependenciesInstalled, false)
  assert.equal((await setup.check()).serviceUpdated, false)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 2)
  await setup.warmup()
  assert.equal(calls.find(call => call.args.includes('-c') && call.args[1].includes('spec_from_file_location')).args.at(-1), runtime.servicePath)
})

test('failed install leaves no success stamp or lock and can be retried', async t => {
  const { setup, runtime } = await fixture(t, { failPip: true })
  await assert.rejects(setup.install(), /simulated package unavailable/)
  await assert.rejects(readFile(runtime.manifestPath), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(runtime.homeDir, 'setup.lock')), { code: 'ENOENT' })
  assert.equal((await setup.check()).ready, false)
  assert.equal((await setup.install()).ready, true)
})

test('broken imports repair the existing environment even when its fingerprint matches', async t => {
  const { setup, calls, state } = await fixture(t)
  await setup.install()
  state.importsReady = false
  assert.equal((await setup.check()).status, 'missing-dependencies')
  assert.equal((await setup.update()).dependenciesInstalled, true)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 2)
})

test('refuses a global interpreter at the managed path before invoking pip', async t => {
  const { setup, state, runtime, calls } = await fixture(t)
  await mkdir(path.dirname(runtime.pythonPath), { recursive: true })
  await writeFile(runtime.pythonPath, 'stub symlink-like interpreter')
  state.globalPython = true
  assert.equal((await setup.check()).status, 'unmanaged-environment')
  await assert.rejects(setup.install(), /不会向全局 Python/)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 0)
})

test('warmup is explicit and detects model loading failures', async t => {
  const { setup, state, calls } = await fixture(t)
  await assert.rejects(setup.warmup(), /recognition:install/)
  await setup.install()
  assert.equal(calls.some(call => call.args.some(argument => argument.includes('spec_from_file_location'))), false)
  const warmed = await setup.warmup()
  assert.equal(warmed.modelsReady, true)
  assert.deepEqual(warmed.modes, ['text', 'math'])
  state.failWarmup = true
  await assert.rejects(setup.warmup(), /simulated model unavailable/)
})

test('serve forwards file and port arguments using the current package service with no pip install', async t => {
  const { setup, calls, runtime } = await fixture(t, { platform: 'win32' })
  await setup.serve(['--file', 'a board.html', '--port', '8767'])
  const service = calls.at(-1)
  assert.equal(service.command, 'py')
  assert.deepEqual(service.args, ['-3', runtime.servicePath, '--file', 'a board.html', '--port', '8767'])
  assert.equal(service.inherit, true)
  assert.equal(calls.some(call => call.args.includes('pip')), false)
  await setup.install()
  await setup.serve(['--dir', 'board'])
  assert.equal(calls.at(-1).command, runtime.pythonPath)
})

test('cache locations honor each OS and an explicit override', () => {
  assert.equal(recognitionHome({ platform: 'linux', env: { XDG_CACHE_HOME: '/cache' }, home: '/user' }), path.resolve('/cache/dsh-anatomy/recognition'))
  assert.equal(recognitionHome({ platform: 'darwin', env: {}, home: '/user' }), path.resolve('/user/Library/Caches/dsh-anatomy/recognition'))
  assert.equal(recognitionHome({ platform: 'win32', env: { LOCALAPPDATA: '/local' }, home: '/user' }), path.resolve('/local/dsh-anatomy/recognition'))
  assert.equal(recognitionHome({ env: { ANATOMY_RECOGNITION_HOME: '/custom' } }), path.resolve('/custom'))
})

test('installation lock prevents concurrent modifications', async t => {
  const { setup, runtime, calls } = await fixture(t)
  await mkdir(runtime.homeDir, { recursive: true })
  await writeFile(path.join(runtime.homeDir, 'setup.lock'), 'another process')
  await assert.rejects(setup.install(), /另一项 OCR 安装正在运行/)
  assert.equal(calls.length, 0)
})

test('explicit Python paths are passed as an executable argument without shell interpretation', async t => {
  const pythonPath = path.join(os.tmpdir(), 'Python install', 'python3')
  const { setup, calls } = await fixture(t, { pythonPath })
  await setup.install()
  const creation = calls.find(call => call.args.includes('venv'))
  assert.equal(creation.command, pythonPath)
  assert.deepEqual(creation.args.slice(0, 2), ['-m', 'venv'])
})

test('corrupt installation metadata is repaired instead of trusted', async t => {
  const { setup, calls, runtime } = await fixture(t)
  await setup.install()
  await writeFile(runtime.manifestPath, '{broken json')
  assert.equal((await setup.check()).status, 'outdated-dependencies')
  assert.equal((await setup.update()).dependenciesInstalled, true)
  assert.equal(calls.filter(call => call.args.includes('pip')).length, 2)
})

test('runtime strips case variants of Python environment pollution and keeps model cache outside plugin', async t => {
  const { rootDir, homeDir } = await fixture(t)
  const runtime = await getRecognitionRuntime({ rootDir, homeDir, env: { PythonPath: '/bad', PythonHome: '/bad', PATH: '/safe' } })
  assert.equal('PythonPath' in runtime.env, false)
  assert.equal('PythonHome' in runtime.env, false)
  assert.ok(runtime.env.PADDLE_PDX_CACHE_HOME.startsWith(homeDir + path.sep))
  assert.equal(runtime.env.PADDLE_PDX_CACHE_HOME.startsWith(rootDir + path.sep), false)
})
