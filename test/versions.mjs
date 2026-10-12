import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { apply } from '../lib/index.js'
import { versionState, saveVersion, selectVersion, listVersions, selectedVersion, readVersion } from '../lib/versions.js'
async function fixture(t,config={}){const root=mkdtempSync('/tmp/anatomy-version-');t.after(()=>rmSync(root,{recursive:true,force:true}));const tools=new Map();apply({tools:{register:d=>tools.set(d.name,d)}},{rootDir:root,autoServe:false,...config});const dir=join(root,'anatomy-project'),call=(name,args={})=>tools.get('anatomy_'+name).execute({dir,repoRoot:root,...args});assert.equal((await call('init',{body:'project',title:'版本测试',oneline:'处理输入并返回结果。'})).ok,true);const board={version:1,elements:[{id:'step',type:'rect',x:10,y:10,width:200,height:100,text:'检查输入',implementation:{language:'JS',code:'return input;',extra:{keep:true}}}]};assert.equal((await call('board',{board})).ok,true);return{root,dir,call,board}}
function save(dir,board,label){const state=versionState(dir),sel=listVersions(dir).selected;return saveVersion(dir,{body:state.body.slug,board,baseHash:state.hash,expectedSelection:sel?.revision??null,label})}
test('项目保存不可变完整版本，AI 只应用选定版本且保留历史',async t=>{const {dir,call,board}=await fixture(t),first=save(dir,board,'原始版本'),changed=structuredClone(board);changed.elements[0].text='先核对输入边界';const second=save(dir,changed,'修改边界');assert.equal(listVersions(dir).versions.length,2);assert.equal(selectedVersion(dir).selected.id,second.saved);const read=await call('selected_version');assert.equal(read.version.board.elements[0].implementation.extra.keep,true);assert.equal((await call('digest')).ok,false);const applied=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision});assert.equal(applied.ok,true,JSON.stringify(applied));assert.equal(versionState(dir).board.elements[0].text,'先核对输入边界');assert.equal(selectedVersion(dir).pending,false);assert.ok(existsSync(read.version.file));assert.equal(readVersion(dir,first.saved).board.elements[0].text,'检查输入');assert.equal((await call('digest')).ok,true)})
test('读后切换拒绝旧选择；历史选择产生当前基线上的恢复意图',async t=>{const {dir,call,board}=await fixture(t),a=save(dir,board,'旧版本'),changed=structuredClone(board);changed.elements[0].text='改进处理';const b=save(dir,changed,'新版本'),read=await call('selected_version');selectVersion(dir,{id:a.saved,baseHash:versionState(dir).hash,expectedSelection:b.selected.revision});assert.equal((await call('selected_version',{apply:true,selectionRevision:read.selectionRevision})).ok,false);const target=await call('selected_version');assert.equal(target.pending,false);const picked=selectVersion(dir,{id:b.saved,baseHash:versionState(dir).hash,expectedSelection:target.selectionRevision});assert.equal((await call('selected_version',{apply:true,selectionRevision:picked.selected.revision})).ok,true);const restore=selectVersion(dir,{id:a.saved,baseHash:versionState(dir).hash,expectedSelection:listVersions(dir).selected.revision});assert.equal((await call('selected_version',{apply:true,selectionRevision:restore.selected.revision})).ok,true);assert.equal(versionState(dir).board.elements[0].text,'检查输入')})
test('并行页面旧选择、过期工程和无效内容均拒绝写入',async t=>{const {dir,board}=await fixture(t),base=versionState(dir),a=save(dir,board,'第一版');assert.throws(()=>saveVersion(dir,{body:'project',board,baseHash:base.hash,expectedSelection:null}),/切换/);assert.throws(()=>saveVersion(dir,{body:'project',board,baseHash:'old',expectedSelection:a.selected.revision}),/变化/);const bad=structuredClone(board);bad.elements[0].text='const x = 1;';assert.throws(()=>save(dir,bad),/自然语言|程序/);assert.throws(()=>readVersion(dir,'../../body'),/标识/);assert.equal(listVersions(dir).versions.length,1)})
test('选定后工程变化不能用 force 覆盖，损坏历史被检测',async t=>{const {dir,call,board}=await fixture(t),changed=structuredClone(board);changed.elements[0].text='新的边界';save(dir,changed);const read=await call('selected_version'),file=join(dir,'body.json'),body=JSON.parse(readFileSync(file));body.title='其他更新';writeFileSync(file,JSON.stringify(body));const result=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,force:true});assert.equal(result.ok,false);assert.equal(result.error.code,'anatomy/edit-conflict');const snapshot=JSON.parse(readFileSync(read.version.file));snapshot.board.elements[0].text='损坏';writeFileSync(read.version.file,JSON.stringify(snapshot));assert.throws(()=>selectedVersion(dir),/损坏/)})
test('选定版本固定严格校验，宽松配置与隐藏参数不能消费源码已变的版本',async t=>{
  const {root,dir,call,board}=await fixture(t,{strict:false}),source=join(root,'source.js')
  writeFileSync(source,'export function checkInput(input) { return input; }\n')
  board.elements[0].anchors=[{file:'source.js',symbol:'checkInput',role:'implementation',reason:'检查输入'}]
  assert.equal((await call('board',{board})).ok,true)
  const baseline=versionState(dir),changed=structuredClone(baseline.board)
  changed.elements[0].text='先核对输入范围'
  save(dir,changed,'待核对源码的修改')
  const read=await call('selected_version')
  writeFileSync(source,'export function checkInput(input) { return input + 1; }\n')
  for(const override of [{},{force:true,strict:false}]){
    const result=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,...override})
    assert.equal(result.ok,false,JSON.stringify(result))
    assert.equal(result.error.code,'anatomy/precheck-failed')
    assert.ok(result.errors.some(e=>e.code==='anchor/source-changed'))
    assert.equal(versionState(dir).hash,baseline.hash)
    assert.equal(selectedVersion(dir).pending,true)
    assert.equal(selectedVersion(dir).selected.appliedAt,undefined)
  }
  const reviewed=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,reviewSources:true})
  assert.equal(reviewed.ok,true,JSON.stringify(reviewed))
  assert.equal(selectedVersion(dir).pending,false)
  assert.equal(versionState(dir).board.elements[0].text,'先核对输入范围')
})
test('当前画板 URL 自动定位真实工程，远程地址与不匹配目录拒绝',async t=>{const {dir,call,board}=await fixture(t);save(dir,board,'网页选定版本');writeFileSync(join(dir,'anatomy.html'),'<html>画板</html>');const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'anatomy-handwriting',protocol:2,capabilities:['project-versions'],boardFile:join(dir,'anatomy.html')}))});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});const url='http://127.0.0.1:'+server.address().port+'/anatomy.html';const read=await call('selected_version',{dir:undefined,url});assert.equal(read.ok,true);assert.equal(read.dir,dir);assert.equal(read.version.label,'网页选定版本');assert.equal((await call('selected_version',{dir:'/tmp/other-project',url})).ok,false);assert.equal((await call('selected_version',{dir:undefined,url:'https://external.example/anatomy.html'})).ok,false)})
