import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { temporalModel, programTrace, semanticDiagnostics } from '../lib/semantics.js'
import { evaluateVerification } from '../lib/verification.js'
import { humanMap } from '../lib/digest.js'
import { apply } from '../lib/index.js'
const organs = ['a','b','c','d'].map(id => ({id,name:'处理'+id,systems:['core'],status:'planned',gist:'处理输入'}))
const body = {title:'处理系统',oneline:'输入形成结果',systems:[{id:'core',name:'处理'}],media:[{id:'data',name:'数据'}]}
const timing = latencyMs => ({latencyMs,basis:'estimated',method:'设计阶段估计'})
const flows = [{id:'ab',from:'a',to:'b',medium:'data',name:'输入',gist:'交付输入',timing:timing(2)}, {id:'bc',from:'b',to:'c',medium:'data',name:'结果',gist:'交付结果',timing:timing(7)}, {id:'ac',from:'a',to:'c',medium:'data',name:'直达',gist:'直接交付',timing:timing(20)}, {id:'cd',from:'c',to:'d',medium:'data',gist:'交付未知'}]
test('有向耗时最短路径按权重累计，未知边不填成一个跳数',()=>{
  const result=temporalModel(body,organs,flows)
  assert.equal(result.nodes.find(x=>x.id==='c').ms,9)
  assert.deepEqual(result.nodes.find(x=>x.id==='c').path.map(x=>x.flow),['ab','bc'])
  assert.equal(result.nodes.find(x=>x.id==='d').ms,null)
  assert.deepEqual(result.unknown,['cd'])
})
test('双向传递分别计时；环没有入口时不虚构零距离',()=>{
  const root={...body,scenarios:[{steps:[{organ:'b'}]}]}
  const fs=[{...flows[0],direction:'two-way',timing:{...timing(2),reverseLatencyMs:11}}]
  assert.equal(temporalModel(root,organs,fs).nodes.find(x=>x.id==='a').ms,11)
  delete fs[0].timing.reverseLatencyMs
  assert.equal(temporalModel(root,organs,fs).nodes.find(x=>x.id==='a').ms,null)
  assert.ok(temporalModel(root,organs,fs).unknown.includes('ab:reverse'))
  const loop=[{...flows[0],timing:timing(0)},{...flows[0],id:'ba',from:'b',to:'a',timing:timing(0)}]
  assert.equal(temporalModel(body,organs.slice(0,2),loop).nodes[0].ms,null)
})
test('数学函数、集合、量词保留，程序定义、调用、命令和路径被识别',()=>{
  for(const text of ['输出 y = f(x)，其中 x 为输入','∀x∈{1,2,3}，延迟 ≤ 20 毫秒','集合 S = {x | x ≥ 0}']) assert.equal(programTrace(text),null,text)
  for(const text of ['const x = 1','调用 send()','node test.js','src/process.ts','Controller::run']) assert.ok(programTrace(text),text)
  assert.ok(semanticDiagnostics(body,[{...organs[0],contract:{out:['node test.js']}}],[]).some(x=>x.code==='human/program-language'))
  assert.ok(semanticDiagnostics(body,organs,[{...flows[0],timing:timing(-1)}]).some(x=>x.code==='flow/timing'))
})
test('人读地图保留数学与验收，不泄露测试命令和实现语言',()=>{
  const map=humanMap(body,[{...organs[0],math:'y = f(x)，x 为输入',acceptance:['结果非负'],observables:['node test.js'],implementation:{code:'return result;'}}],[])
  assert.ok(map.includes('y = f(x)'))
  assert.ok(map.includes('结果非负'))
  assert.ok(!map.includes('test.js')&&!map.includes('return result'))
})
const rule={key:'organ:a:delay',statement:'及时返回',metric:'响应耗时',relation:'≤',limit:10,unit:'毫秒',target:{kind:'organ',id:'a'},anchors:[{file:'a.js'},{file:'test.js',role:'test'}]}
const context={modelHash:'model',sourceHash:'source',sourceReady:true,files:[{file:'a.js'},{file:'test.js'}],rules:[rule]}
const report=value=>({modelHash:'model',sourceHash:'source',method:'运行关联测量测试',observedAt:new Date().toISOString(),measurements:[{rule:rule.key,value,unit:'毫秒'}]})
test('验证拒绝缺失、过期、单位不符、重复观测；数值边界确定',()=>{
  assert.equal(evaluateVerification(context,null).ok,false)
  assert.equal(evaluateVerification(context,report(10)).status,'pass')
  assert.equal(evaluateVerification(context,report(11)).status,'fail')
  assert.equal(evaluateVerification({...context,modelHash:'new'},report(1)).status,'stale')
  assert.equal(evaluateVerification({...context,sourceHash:'new'},report(1)).status,'stale')
  const bad=report(1);bad.measurements[0].unit='秒'
  assert.equal(evaluateVerification(context,bad).ok,false)
  const duplicate=report(1);duplicate.measurements.push({...duplicate.measurements[0]})
  assert.equal(evaluateVerification(context,duplicate).ok,false)
  assert.equal(evaluateVerification({...context,rules:[{...rule,anchors:[]}]},report(1)).ok,false)
  assert.equal(evaluateVerification({...context,rules:[]},report(1)).ok,false)
})
test('上层改意图使证据失效，强制交付不能绕过；源码改动也使证据失效',async t=>{
  const root=mkdtempSync('/tmp/anatomy-intent-');t.after(()=>rmSync(root,{recursive:true,force:true}))
  writeFileSync(join(root,'main.js'),'export const value = 1;\n');writeFileSync(join(root,'test.js'),'// measurement test\n')
  const tools=new Map();apply({tools:{register(def){tools.set(def.name,def);return()=>{}}}},{rootDir:root,autoServe:false})
  const dir=join(root,'anatomy-model'),call=(name,args={})=>tools.get('anatomy_'+name).execute({dir,repoRoot:root,...args})
  assert.equal((await call('init',{body:'model',title:body.title,oneline:body.oneline,systems:body.systems})).ok,true)
  const o={...organs[0],rules:[{id:'delay',statement:rule.statement,metric:rule.metric,relation:rule.relation,limit:10,unit:rule.unit}],anchors:[{file:'main.js',role:'implementation'},{file:'test.js',role:'test'}]}
  assert.equal((await call('scaffold',{organs:[o]})).ok,true)
  const forbidden=await call('organ_put',{organ:{...o,gist:'调用 process()'},force:true,strict:false});assert.equal(forbidden.ok,false)
  const start=await call('verify');assert.equal(start.status,'pending')
  const file=join(root,'report.json');writeFileSync(file,JSON.stringify({...report(9),modelHash:start.modelHash,sourceHash:start.sourceHash}))
  assert.equal((await call('verify',{file})).ok,true)
  assert.equal((await call('render',{requireVerified:true})).ok,true)
  const current=await call('show',{level:'agent'})
  const result=await call('apply_edits',{baseHash:current.anatomyHash,edits:[{kind:'organ',id:'a',patch:{rules:[{...o.rules[0],limit:5}]}}]})
  assert.equal(result.ok,true);assert.equal(result.implementation.status,'stale')
  assert.equal((await call('render',{requireVerified:true,force:true})).error.code,'intent/not-verified')
  const next=await call('verify');writeFileSync(file,JSON.stringify({...report(9),modelHash:next.modelHash,sourceHash:next.sourceHash}))
  assert.equal((await call('verify',{file})).status,'fail')
  writeFileSync(join(root,'main.js'),'export const value = 2;\n')
  assert.equal((await call('verify')).status,'stale')
  assert.equal(JSON.parse(readFileSync(join(dir,'organs/a.json'))).rules[0].limit,5)
})
