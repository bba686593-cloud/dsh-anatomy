import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ensureBoardService, previewFiles, openBoardBrowser } from '../lib/preview.js'
import { apply, normalizeConfig } from '../lib/index.js'
const runtime = {script:fileURLToPath(new URL('./fixtures/preview-service.mjs', import.meta.url))}
const options = {pythonPath:process.execPath,port:0}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'anatomy preview 中文 ')), file = join(root, '自定义 画板.html')
  writeFileSync(file, '<html>本工程</html>')
  t.after(() => { const path=previewFiles(file).state; if(existsSync(path)) { const {pid}=JSON.parse(readFileSync(path)); try {process.kill(pid)} catch {} }; rmSync(root,{recursive:true,force:true}) })
  return {root,file}
}
test('starts custom HTML, keeps detached service after launcher exits, and reuses it', async t => {
  const {file} = fixture(t)
  const moduleUrl = new URL('../lib/preview.js', import.meta.url).href
  const source = `import {ensureBoardService} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await ensureBoardService(${JSON.stringify(file)},${JSON.stringify(options)},${JSON.stringify(runtime)})))`
  const {stdout} = await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{timeout:15000})
  const first = JSON.parse(stdout)
  assert.equal(first.status,'ready'); assert.equal(first.reused,false)
  assert.equal(await (await fetch(first.url)).text(),'<html>本工程</html>')
  const second = await ensureBoardService(file,options,runtime)
  assert.equal(second.reused,true); assert.equal(second.pid,first.pid); assert.equal(second.url,first.url)
})
test('concurrent callers share one service', async t => {
  const {file}=fixture(t)
  const results=await Promise.all([ensureBoardService(file,options,runtime),ensureBoardService(file,options,runtime)])
  assert.equal(results[0].status,'ready'); assert.equal(results[0].pid,results[1].pid)
})
test('occupied port belonging to another board is preserved and a new port is chosen', async t => {
  const {file}=fixture(t)
  const other=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'anatomy-handwriting',protocol:1,boardFile:'/another/board.html',instanceId:'other',ready:true}))})
  await new Promise(resolve=>other.listen(0,'127.0.0.1',resolve));t.after(()=>{other.closeAllConnections();other.close()})
  const port=other.address().port
  const result=await ensureBoardService(file,{...options,port},runtime)
  assert.equal(result.status,'ready');assert.equal(result.reused,false);assert.notEqual(new URL(result.url).port,String(port))
  assert.equal((await (await fetch('http://127.0.0.1:'+port+'/api/health')).json()).instanceId,'other')
})
test('stale metadata does not suppress startup; missing Python is actionable', async t => {
  const {file}=fixture(t),paths=previewFiles(file)
  mkdirSync(paths.dir);writeFileSync(paths.state,JSON.stringify({boardFile:file,instanceId:'stale',port:-1}))
  const result=await ensureBoardService(file,{pythonPath:join(paths.dir,'missing-python'),port:0})
  assert.equal(result.status,'unavailable');assert.equal(result.url,null);assert.match(result.error,/Python/);assert.equal(existsSync(paths.lock),false)
  // No child was launched; fixture cleanup must not interpret stale metadata as a PID.
  rmSync(paths.state)
})
test('render defaults to service; failures preserve HTML and explicit serve:false overrides', async t => {
  const {root}=fixture(t),registry=new Map()
  apply({tools:{register(d){registry.set(d.name,d);return()=>{}}}},{rootDir:root,autoOpen:false,pythonPath:join(root,'missing-python')})
  const call=(name,args)=>registry.get('anatomy_'+name).execute(args)
  assert.equal((await call('init',{body:'demo',title:'示例',oneline:'描述本工程。'})).ok,true)
  const result=await call('render',{body:'demo'})
  assert.equal(result.ok,true);assert.ok(existsSync(result.file));assert.equal(result.service.status,'unavailable');assert.equal(result.browser.status,'skipped')
  const disabled=await call('render',{body:'demo',serve:false})
  assert.equal(disabled.service.status,'disabled');assert.equal(disabled.url,null)
})
test('configuration defaults and browser URL boundary',async()=>{
  const config=normalizeConfig({});assert.equal(config.autoServe,true);assert.equal(config.autoOpen,true)
  assert.equal(normalizeConfig({autoServe:false}).autoServe,false)
  assert.equal(normalizeConfig({autoOpen:false}).autoOpen,false)
  assert.equal((await openBoardBrowser('https://outside.example')).status,'failed')
})
