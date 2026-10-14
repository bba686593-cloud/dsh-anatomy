import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createRecognitionRequest, pendingRecognitionRequests, readRecognitionRequest, recognitionJobDirectory, updateRecognitionRequest } from '../lib/recognition.js'
import { saveVersion, versionState } from '../lib/versions.js'
import { ensureBoardService, previewFiles } from '../lib/preview.js'

const execute = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC', 'base64')
const image = 'data:image/png;base64,' + png.toString('base64')
const moduleUrl = new URL('../lib/recognition.js', import.meta.url).href
const worker = fileURLToPath(new URL('../scripts/recognition-worker.mjs', import.meta.url))
function fixture(t) {
  const dir = mkdtempSync('/tmp/anatomy-recognition-'), body = { schema: 'anatomy/1', slug: 'recognition-test', title: '识别边界测试', board: { version: 1, elements: [] } }
  writeFileSync(join(dir, 'body.json'), JSON.stringify(body)); writeFileSync(join(dir, 'anatomy.html'), '<html>测试画板</html>')
  t.after(() => rmSync(dir, { recursive: true, force: true })); return { dir, body }
}
const args = extra => ({ mode: 'text', image, sourceRevision: 'visible-1', sourceElements: ['part'], ...extra })
const complete = request => ({ id: request.id, action: 'complete', imageHash: request.imageHash, text: '候选说明' })

test('识别队列保存真实图片与候选结果，确认前不改画板且不能重复执行或覆盖终态', t => {
  const { dir } = fixture(t), before = readFileSync(join(dir, 'body.json')), request = createRecognitionRequest(dir, args()).request
  assert.equal(readRecognitionRequest(dir, request.id).image, undefined)
  assert.equal(readRecognitionRequest(dir, request.id, { image: true }).image.src, image)
  assert.equal(updateRecognitionRequest(dir, { id: request.id, action: 'claim', imageHash: request.imageHash }).request.status, 'processing')
  assert.throws(() => updateRecognitionRequest(dir, { id: request.id, action: 'claim', imageHash: request.imageHash }), /重复/)
  const result = updateRecognitionRequest(dir, complete(request)); assert.equal(result.request.status, 'completed'); assert.equal(result.request.result.text, '候选说明')
  assert.throws(() => updateRecognitionRequest(dir, complete(request)), /已结束/)
  assert.deepEqual(readFileSync(join(dir, 'body.json')), before)
})

test('创建前取消留下终态墓碑，迟到创建和迟到候选不能产生孤立等待请求', t => {
  const { dir } = fixture(t), id = randomUUID()
  assert.equal(updateRecognitionRequest(dir, { id, action: 'cancel' }).request.status, 'cancelled')
  assert.throws(() => createRecognitionRequest(dir, args({ id })), /已取消/)
  assert.equal(readRecognitionRequest(dir, id).request.status, 'cancelled')
  assert.throws(() => readRecognitionRequest(dir, id, { image: true }), /取消或过期/)
  assert.throws(() => updateRecognitionRequest(dir, { id, action: 'complete', imageHash: '', text: '迟到' }), /已结束/)
  assert.deepEqual(pendingRecognitionRequests(dir).requests, [])
})

test('并发创建共用原子准入锁，32项活动请求上限不被跨进程越过', async t => {
  const { dir } = fixture(t)
  for (let i = 0; i < 29; i++) createRecognitionRequest(dir, args())
  const source = `import {createRecognitionRequest} from ${JSON.stringify(moduleUrl)};try{console.log(JSON.stringify(createRecognitionRequest(${JSON.stringify(dir)},${JSON.stringify(args())})))}catch(e){console.log(JSON.stringify({status:e.status,error:e.message}))}`
  const results = await Promise.all(Array.from({ length: 10 }, async () => JSON.parse((await execute(process.execPath, ['--input-type=module', '-e', source], { timeout: 10000 })).stdout)))
  assert.equal(results.filter(result => result.ok).length, 3); assert.ok(results.filter(result => !result.ok).every(result => result.status === 429))
  assert.equal(pendingRecognitionRequests(dir, { limit: 32 }).requests.length, 32)
  updateRecognitionRequest(dir, { id: pendingRecognitionRequests(dir).requests[0].id, action: 'cancel' }); assert.equal(createRecognitionRequest(dir, args()).request.status, 'pending')
})

test('创建与取消跨进程竞速后仅留下取消终态，不发布孤立等待请求', async t => {
  const { dir } = fixture(t), id = randomUUID(), start = Date.now() + 300
  const source = action => `import {createRecognitionRequest,updateRecognitionRequest} from ${JSON.stringify(moduleUrl)};while(Date.now()<${start})Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);try{console.log(JSON.stringify(${action === 'create' ? `createRecognitionRequest(${JSON.stringify(dir)},${JSON.stringify(args({ id }))})` : `updateRecognitionRequest(${JSON.stringify(dir)},${JSON.stringify({ id, action: 'cancel' })})`}))}catch(e){console.log(JSON.stringify({status:e.status,error:e.message}))}`
  await Promise.all(['create', 'cancel'].map(action => execute(process.execPath, ['--input-type=module', '-e', source(action)], { timeout: 10000 })))
  assert.equal(readRecognitionRequest(dir, id).request.status, 'cancelled'); assert.deepEqual(pendingRecognitionRequests(dir).requests, [])
})

test('过期、错误图片指纹与磁盘图片被改写都阻断迟到结果和旧图片读取', t => {
  const { dir } = fixture(t), request = createRecognitionRequest(dir, args(), 1000).request
  assert.equal(readRecognitionRequest(dir, request.id, { now: 601000 }).request.status, 'expired')
  assert.throws(() => updateRecognitionRequest(dir, complete(request), 601000), /已结束/)
  assert.throws(() => readRecognitionRequest(dir, request.id, { image: true, now: 601000 }), /取消或过期/)
  const current = createRecognitionRequest(dir, args()).request
  assert.throws(() => updateRecognitionRequest(dir, { ...complete(current), imageHash: 'wrong' }), /指纹不匹配/)
  updateRecognitionRequest(dir, complete(current)); writeFileSync(join(recognitionJobDirectory(dir, current.id), 'input.png'), Buffer.concat([png, Buffer.of(1)]))
  assert.throws(() => readRecognitionRequest(dir, current.id), /图片已变化/)
  assert.throws(() => readRecognitionRequest(dir, current.id, { image: true }), /图片已变化/)
})

test('选定版本改变后旧请求不再可读或回传，仍可以显式取消', t => {
  const { dir } = fixture(t), state = versionState(dir)
  const first = saveVersion(dir, { body: state.body.slug, board: state.board, baseHash: state.hash, expectedSelection: null })
  const request = createRecognitionRequest(dir, args({ selectionRevision: first.selected.revision })).request
  saveVersion(dir, { body: state.body.slug, board: state.board, baseHash: state.hash, expectedSelection: first.selected.revision })
  assert.throws(() => readRecognitionRequest(dir, request.id), /选定版本已变化/); assert.throws(() => updateRecognitionRequest(dir, complete(request)), /选定版本已变化/)
  assert.deepEqual(pendingRecognitionRequests(dir).requests, []); assert.equal(updateRecognitionRequest(dir, { id: request.id, action: 'cancel' }).request.status, 'cancelled')
})

test('请求标识与目录、图片符号链接不能跳出隔离识别目录', t => {
  const { dir } = fixture(t)
  assert.throws(() => createRecognitionRequest(dir, args({ id: '../outside' })), /标识/)
  const request = createRecognitionRequest(dir, args()).request, job = recognitionJobDirectory(dir, request.id), outside = join(dir, 'outside.png')
  writeFileSync(outside, png); rmSync(join(job, 'input.png')); symlinkSync(outside, join(job, 'input.png')); assert.throws(() => readRecognitionRequest(dir, request.id, { image: true }), /符号链接/)
  const metadata = JSON.parse(readFileSync(join(job, 'request.json'))); metadata.id = randomUUID(); writeFileSync(join(job, 'request.json'), JSON.stringify(metadata)); assert.throws(() => readRecognitionRequest(dir, request.id), /数据无效/)
  assert.deepEqual(readFileSync(outside), png)
  const second = fixture(t); mkdirSync(join(second.dir, '.anatomy-runtime')); symlinkSync(dir, join(second.dir, '.anatomy-runtime', 'recognition')); assert.throws(() => createRecognitionRequest(second.dir, args()), /符号链接/)
})

test('配置执行器的真实worker能回传候选，取消后晚到执行结果不覆盖终态', async t => {
  const { dir } = fixture(t), config = join(dir, 'executor.json')
  writeFileSync(config, JSON.stringify({ engine: 'dsh', command: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify({text:"自动候选"}))'] }))
  const request = createRecognitionRequest(dir, args()).request
  await execute(process.execPath, [worker, dir, request.id], { env: { ...process.env, ANATOMY_RECOGNITION_AGENT_CONFIG: config }, timeout: 5000 })
  assert.equal(readRecognitionRequest(dir, request.id).request.result.text, '自动候选')
  const later = createRecognitionRequest(dir, args()).request, marker = join(recognitionJobDirectory(dir, later.id), 'started')
  writeFileSync(config, JSON.stringify({ engine: 'dsh', command: process.execPath, args: ['-e', 'require("fs").writeFileSync("started","yes");setTimeout(()=>process.stdout.write(JSON.stringify({text:"迟到候选"})),200)'] }))
  const running = execute(process.execPath, [worker, dir, later.id], { env: { ...process.env, ANATOMY_RECOGNITION_AGENT_CONFIG: config }, timeout: 5000 })
  for (let i = 0; i < 200 && !existsSync(marker); i++) await pause(10)
  assert.ok(existsSync(marker)); updateRecognitionRequest(dir, { id: later.id, action: 'cancel' }); await running
  const cancelled = readRecognitionRequest(dir, later.id).request; assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined)
})

test('worker配置失败结束等待请求，重复worker不会把已接管请求误标失败或再执行', async t => {
  const { dir } = fixture(t), config = join(dir, 'executor.json'), bad = createRecognitionRequest(dir, args()).request
  writeFileSync(config, '{}'); await execute(process.execPath, [worker, dir, bad.id], { env: { ...process.env, ANATOMY_RECOGNITION_AGENT_CONFIG: config }, timeout: 5000 })
  assert.equal(readRecognitionRequest(dir, bad.id).request.status, 'failed')
  const request = createRecognitionRequest(dir, args()).request, marker = join(recognitionJobDirectory(dir, request.id), 'unexpected-run')
  updateRecognitionRequest(dir, { id: request.id, action: 'claim', imageHash: request.imageHash })
  writeFileSync(config, JSON.stringify({ engine: 'dsh', command: process.execPath, args: ['-e', 'require("fs").writeFileSync("unexpected-run","yes");process.stdout.write(JSON.stringify({text:"多余执行"}))'] }))
  await execute(process.execPath, [worker, dir, request.id], { env: { ...process.env, ANATOMY_RECOGNITION_AGENT_CONFIG: config }, timeout: 5000 })
  assert.equal(readRecognitionRequest(dir, request.id).request.status, 'processing'); assert.equal(existsSync(marker), false)
})

async function oldService(t, dir, owned) {
  const file = join(dir, 'anatomy.html'), paths = previewFiles(file), instanceId = randomUUID()
  const source = `import{createServer}from'node:http';const s=createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({service:'anatomy-handwriting',protocol:2,capabilities:['project-versions'],boardFile:${JSON.stringify(file)},instanceId:${JSON.stringify(instanceId)},pid:process.pid,ready:true,serviceHash:'old',pluginVersion:'old',providers:{agent:{mode:'handoff'}}}))});s.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,port:s.address().port})))`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] }); t.after(() => { try { child.kill() } catch {} })
  const info = await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', data => resolve(JSON.parse(data.toString()))) })
  mkdirSync(paths.dir, { recursive: true }); writeFileSync(paths.state, JSON.stringify({ ...info, pid: owned ? info.pid : -1, boardFile: file, instanceId }))
  return { child, info, file }
}

test('旧服务升级仅终止state和HTTP身份核验一致的进程，未核验进程与无效执行器配置保持存活', async t => {
  const { dir } = fixture(t), old = await oldService(t, dir, true)
  const upgraded = await ensureBoardService(old.file, { pythonPath: join(dir, 'missing-python'), port: old.info.port }); assert.equal(upgraded.status, 'unavailable'); assert.match(upgraded.error, /Python/)
  await assert.rejects(fetch('http://127.0.0.1:' + old.info.port + '/api/health'))
  const second = fixture(t), unowned = await oldService(t, second.dir, false)
  const blocked = await ensureBoardService(unowned.file, { pythonPath: join(second.dir, 'missing-python'), port: unowned.info.port }); assert.equal(blocked.status, 'unavailable'); assert.match(blocked.error, /核验进程身份/)
  assert.equal((await fetch('http://127.0.0.1:' + unowned.info.port + '/api/health')).status, 200)
  const third = fixture(t), validOwner = await oldService(t, third.dir, true)
  const invalid = await ensureBoardService(validOwner.file, { agentConfig: 'relative-config.json', port: validOwner.info.port }); assert.equal(invalid.status, 'unavailable'); assert.match(invalid.error, /绝对/)
  assert.equal((await fetch('http://127.0.0.1:' + validOwner.info.port + '/api/health')).status, 200)
})
