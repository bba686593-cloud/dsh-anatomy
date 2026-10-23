import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { apply } from '../lib/index.js'
import { maskedImageSource } from '../lib/png-surface.js'
import { mcpToolResult } from '../scripts/mcp-image-content.mjs'
import { mappingIndex, impactOf, scenarioDiagnostics } from '../lib/mapping.js'
import { sourceInventory } from '../lib/inventory.js'
import { humanMap, agentDigest, briefOrgan } from '../lib/digest.js'
import { saveVersion, selectedVersion, versionState, readVersion, listVersions } from '../lib/versions.js'

const scenario = { id: 'request', name: '处理一条请求', trigger: '用户提交请求', outcome: '用户得到结果', steps: [
  { organ: 'entry', action: '接收请求' }, { organ: 'work', flow: 'request', action: '形成结果' }, { organ: 'reply', flow: 'result', action: '返回结果' },
], acceptance: ['请求与结果可以对应'] }
const body = { title: '示例服务', oneline: '处理请求并返回结果', systems: [{ id: 'core', name: '处理' }], media: [{ id: 'data', name: '数据' }], scenarios: [scenario] }
const organs = [
  { id: 'entry', name: '请求入口', systems: ['core'], status: 'active', gist: '接收请求', story: '接收用户提交的内容', contract: { in: ['用户请求'], out: ['待处理请求'] }, not_responsible: ['不计算结果'], observables: ['请求能被接收'],
    anchors: [{ file: 'src/entry.js', symbol: 'entry', role: 'interface', reason: '接收用户请求', sha256: 'abc' }, { file: 'test/entry.js', role: 'test', reason: '验证入口边界' }],
    composition: [{ name: '请求转换', role: '转换输入', anchor: { file: 'src/shared.js', symbol: 'parse', reason: '解析输入' } }] },
  { id: 'work', name: '结果处理', systems: ['core'], status: 'planned', gist: '形成结果', contract: { in: ['待处理请求'], out: ['结果'], invariants: ['同一请求只处理一次'] }, not_responsible: ['不发送结果'], anchors: [{ file: 'src/work.js' }] },
  { id: 'reply', name: '结果返回', systems: ['core'], status: 'active', gist: '返回结果', not_responsible: ['不修改结果'], anchors: [{ file: 'src/reply.js' }] },
  { id: 'aux', name: '辅助处理', systems: ['core'], status: 'planned', gist: '共享转换能力', anchors: [{ file: 'src/shared.js', symbol: 'other', reason: '共用转换模块' }] },
]
const flows = [
  { id: 'request', name: '请求', from: 'entry', to: 'work', medium: 'data', gist: '交付待处理请求', anchors: [{ file: 'src/channel.js', role: 'interface', reason: '传输请求' }] },
  { id: 'result', name: '结果', from: 'work', to: 'reply', medium: 'data', gist: '交付结果' },
]

test('多对多反查包含部件、流、用途、说明和测试，缺口不伪装覆盖', () => {
  const index = mappingIndex(body, organs, flows)
  const shared = index.files.find((x) => x.file === 'src/shared.js')
  assert.equal(shared.refs.length, 2)
  assert.equal(shared.refs[0].part, '请求转换')
  assert.equal(index.files.find((x) => x.file === 'src/channel.js').refs[0].kind, 'flow')
  assert.deepEqual(index.gaps.noTestEvidence, ['reply'])
  assert.ok(index.gaps.unexplainedLinks.some((x) => x.file === 'src/work.js'))
})

test('影响按流向、有界深度、共享实现关系推导并给出路径', () => {
  const result = impactOf(body, organs, flows, { files: ['src/entry.js'], depth: 1 })
  assert.deepEqual(new Set(result.affected.map((x) => x.id)), new Set(['entry', 'work', 'aux']))
  assert.equal(result.affected.find((x) => x.id === 'work').path[0].kind, 'flow')
  assert.equal(result.affected.find((x) => x.id === 'aux').path[0].kind, 'shared-file')
  assert.equal(result.scenarios[0].id, 'request')
  const deep = impactOf(body, organs, flows, { organs: ['entry'], depth: 2 })
  assert.equal(deep.affected.find((x) => x.id === 'reply').distance, 2)
  assert.equal(impactOf(body, organs, flows, { organs: ['reply'] }).affected.length, 1)
  assert.deepEqual(impactOf(body, organs, flows, { files: ['unknown.js'] }).unknownFiles, ['unknown.js'])
  assert.deepEqual(new Set(impactOf(body, organs, flows, { files: ['src/channel.js'], depth: 0 }).roots), new Set(['entry', 'work']))
})

test('双向、构成和回路不丢关系也不无限扩张，共用测试不算实现依赖', () => {
  const list = structuredClone(organs)
  list[1].parent = 'entry'
  list[2].anchors.push({ file: 'test/entry.js', role: 'test' })
  const edges = [...flows.map((f) => ({ ...f, direction: 'two-way' })), { id: 'loop', from: 'reply', to: 'entry' }]
  const result = impactOf(body, list, edges, { organs: ['reply'], depth: 5 })
  assert.equal(new Set(result.affected.map((x) => x.id)).size, result.affected.length)
  assert.ok(result.affected.some((x) => x.id === 'entry'))
  assert.equal(impactOf(body, list, [], { organs: ['reply'] }).affected.length, 1)
})

test('业务场景校验真实顺序与方向，拒绝悬空、倒流和无动作步骤', () => {
  assert.deepEqual(scenarioDiagnostics(body, organs, flows), [])
  const reversed = { ...body, scenarios: [{ ...scenario, steps: [{ organ: 'reply', action: '开始' }, { organ: 'work', flow: 'result', action: '继续' }] }] }
  assert.ok(scenarioDiagnostics(reversed, organs, flows).some((x) => x.code === 'scenario/disconnected'))
  assert.deepEqual(scenarioDiagnostics(reversed, organs, flows.map((f) => ({ ...f, direction: 'two-way' }))), [])
  assert.ok(scenarioDiagnostics(body, organs.filter((o) => o.id !== 'work'), flows).some((x) => x.code === 'scenario/step'))
  assert.ok(scenarioDiagnostics({ ...body, scenarios: [scenario, scenario] }, organs, flows).some((x) => x.code === 'scenario/id'))
  assert.ok(scenarioDiagnostics({ ...body, scenarios: 'bad' }, organs, flows).some((x) => x.code === 'scenario/shape'))
})

test('人读和机读共用场景、边界与验收，术前摘要列文件和缺测试证据', () => {
  const human = humanMap(body, organs, flows), machine = agentDigest(body, organs, flows)
  for (const text of [human, machine]) {
    assert.ok(text.includes('处理一条请求'))
    assert.ok(text.includes('请求与结果可以对应'))
    assert.ok(text.includes('不计算结果'))
  }
  assert.ok(human.includes('设计态'))
  assert.ok(!human.includes('src/entry.js'))
  assert.ok(machine.includes('src/entry.js') && machine.includes('接收用户请求'))
  const brief = briefOrgan(body, organs, flows, 'entry')
  assert.ok(brief.includes('共享 src/shared.js'))
  assert.ok(brief.includes('test/entry.js'))
  assert.ok(brief.includes('未关联测试证据：reply'))
  assert.ok(brief.includes('请求与结果可以对应'))
})

test('扫描仅在显式范围内，排除依赖和软链接，部分扫描不报完整覆盖率', (t) => {
  const repo = mkdtempSync('/tmp/anatomy-inventory-'); t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'src', 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'src', 'entry.js'), '')
  writeFileSync(join(repo, 'src', 'missing.py'), '')
  writeFileSync(join(repo, 'src', 'node_modules', 'skip.js'), '')
  symlinkSync('/tmp', join(repo, 'src', 'outside'))
  const index = mappingIndex(body, organs, flows)
  const result = sourceInventory(repo, ['src'], index)
  assert.equal(result.scanned, 2)
  assert.equal(result.coverage, 0.5)
  assert.deepEqual(result.unmapped, ['src/missing.py'])
  assert.ok(result.skipped.includes('src/outside'))
  assert.throws(() => sourceInventory(repo, ['../'], index))
  assert.throws(() => sourceInventory(repo, [], index))
  assert.equal(sourceInventory(repo, ['src'], index, 1).coverage, null)
  assert.equal(sourceInventory(repo, ['nonexistent'], index).coverage, null)
})

test('工具场景写入、批量场景校验、反查和删除引用门禁形成闭环', async (t) => {
  const root = mkdtempSync('/tmp/anatomy-coread-'); t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'a.js'), 'export function start() {}')
  const tools = new Map(); apply({ tools: { register(d) { tools.set(d.name, d); return () => {} } } }, { rootDir: root, autoServe: false })
  const dir = join(root, 'anatomy-demo'), call = (name, args = {}) => tools.get('anatomy_' + name).execute({ dir, ...args })
  assert.equal((await call('init', { repo: root, body: 'demo', title: '演示', oneline: '处理请求', systems: body.systems })).ok, true)
  const units = organs.slice(0, 3).map((o) => ({ ...o, status: 'planned', composition: [], anchors: [{ file: 'src/a.js', symbol: 'start', reason: '演示入口' }] }))
  const links = flows.map((f) => ({ ...f, anchors: [] }))
  assert.equal((await call('scaffold', { organs: units, flows: links, scenarios: [scenario] })).ok, true)
  assert.equal((await call('show')).body.scenarios.length, 1)
  assert.equal((await call('mapping', { files: ['src/a.js'], scope: ['src'] })).inventory.coverage, 1)
  const impact = await call('impact', { files: ['src/a.js'] })
  assert.equal(impact.roots.length, 3)
  assert.equal(impact.scenarios[0].id, 'request')
  const before = readFileSync(join(dir, 'body.json'), 'utf8')
  const bad = await call('scenario_put', { scenario: { ...scenario, steps: [{ organ: 'missing', action: '错误' }] } })
  assert.equal(bad.ok, false)
  assert.equal(readFileSync(join(dir, 'body.json'), 'utf8'), before)
  assert.equal((await call('remove', { kind: 'flow', id: 'request' })).ok, false)
  assert.equal((await call('scenario_put', { remove: 'request' })).ok, true)
  assert.equal((await call('remove', { kind: 'flow', id: 'request' })).ok, true)
  assert.equal((await call('scaffold', { scenarios: [scenario] })).ok, false)
})

const formulaSource='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const formulaHash=createHash('sha256').update(Buffer.from(formulaSource.split(',')[1],'base64')).digest('hex')
const formulaElement=(id='formula')=>({id,type:'image',x:0,y:0,width:300,height:200,math:'',image:{src:formulaSource,alt:'数学图形',width:3,height:2},formulaGraphic:{version:1,originalMath:String.raw`y = \frac{x}{2}`,originalImage:{src:formulaSource,width:3,height:2},currentMath:String.raw`y = \frac{x}{2}`,semanticStatus:'source-aligned',renderer:{name:'MathJax SVG',version:'3.2.2'},edits:[],extension:{keep:true}},implementation:{code:'return input / 2;'},extension:{keep:true}})
async function formulaFixture(t){
  const root=mkdtempSync('/tmp/anatomy-formula-review-');t.after(()=>rmSync(root,{recursive:true,force:true}))
  const tools=new Map();apply({tools:{register:d=>tools.set(d.name,d)}},{rootDir:root,autoServe:false})
  const dir=join(root,'anatomy-formulas'),call=(name,args={})=>tools.get('anatomy_'+name).execute({dir,repoRoot:root,...args})
  assert.equal((await call('init',{body:'formulas',title:'数学图形工程',oneline:'用数学图形描述输入与结果。'})).ok,true)
  return {root,dir,call}
}
function markFormulaPending(element){element.formulaGraphic.semanticStatus='needs-review';element.formulaGraphic.currentMath=null;element.formulaGraphic.edits=[{kind:'erase',points:[[1,1],[2,1]],radius:1,extension:{keep:true}}]}

test('待校对公式可以保存读取与普通渲染，但严格选定应用和已实现交付不可force绕过',async t=>{
  const {dir,call}=await formulaFixture(t),initial={version:1,elements:[formulaElement()]}
  assert.equal((await call('board',{board:initial})).ok,true)
  const state=versionState(dir),draft=structuredClone(state.board);markFormulaPending(draft.elements[0])
  const saved=saveVersion(dir,{body:'formulas',board:draft,baseHash:state.hash,expectedSelection:null,label:'擦改原公式'}),read=await call('selected_version')
  assert.equal(read.ok,true);assert.equal(read.formulaSemantics[0].visualHash,formulaHash);assert.equal(read.formulaSemantics[0].currentMath,null);assert.equal(read.formulaSemantics[0].requiresReview,true);assert.deepEqual(read.version.board,draft)
  const disk=readFileSync(join(dir,'body.json'),'utf8'),blocked=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,force:true,strict:false})
  assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'formula/needs-review');assert.match(blocked.hint,/formulaReviews/);assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk);assert.equal(listVersions(dir).versions.length,1)
  assert.equal((await call('selected_version',{formulaReviews:[{element:'formula',currentMath:'y = x',visualHash:formulaHash}]})).error.code,'formula/review-action');assert.equal(selectedVersion(dir).selected.id,saved.saved)
  // Clear the pending selection by using a fresh isolated project. Ordinary
  // drawing persistence is allowed; semantic gates apply only to implementation.
  const other=await formulaFixture(t);assert.equal((await other.call('board',{board:draft})).ok,true)
  assert.equal((await other.call('render',{serve:false,open:false})).ok,true)
  const delivery=await other.call('render',{serve:false,open:false,requireVerified:true,force:true});assert.equal(delivery.ok,false);assert.equal(delivery.error.code,'formula/needs-review')
})

test('本次图片SHA校对另存不可变新版后严格应用，原数学图形历史和未知映射完整保留',async t=>{
  const {dir,call}=await formulaFixture(t),initial={version:1,elements:[formulaElement()]};assert.equal((await call('board',{board:initial})).ok,true)
  const state=versionState(dir),draft=structuredClone(state.board);markFormulaPending(draft.elements[0])
  const saved=saveVersion(dir,{body:'formulas',board:draft,baseHash:state.hash,expectedSelection:null,label:'擦改公式'}),read=await call('selected_version'),originalFile=readFileSync(read.version.file,'utf8')
  for(const args of [{selectionRevision:'stale',formulaReviews:[{element:'formula',currentMath:'y = x',visualHash:formulaHash}]},{selectionRevision:read.selectionRevision,formulaReviews:[{element:'formula',currentMath:'y = x',visualHash:'0'.repeat(64)}]},{selectionRevision:read.selectionRevision,formulaReviews:[{element:'formula',currentMath:'',visualHash:formulaHash}]},{selectionRevision:read.selectionRevision,formulaReviews:[{element:'gone',currentMath:'y = x',visualHash:formulaHash}]}]){
    const result=await call('selected_version',{apply:true,...args});assert.equal(result.ok,false);assert.equal(listVersions(dir).versions.length,1);assert.equal(selectedVersion(dir).selected.id,saved.saved)
  }
  const result=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:[{element:'formula',currentMath:'y = x',visualHash:formulaHash}]})
  assert.equal(result.ok,true);assert.notEqual(result.selectionRevision,read.selectionRevision);assert.notEqual(result.version.id,saved.saved);assert.equal(result.formulaReview.sourceVersion,saved.saved);assert.equal(result.formulaReview.version,result.version.id)
  assert.equal(listVersions(dir).versions.length,2);assert.equal(selectedVersion(dir).pending,false)
  const actual=versionState(dir).board.elements[0];assert.equal(actual.formulaGraphic.currentMath,'y = x');assert.equal(actual.formulaGraphic.semanticStatus,'reviewed');assert.equal(actual.formulaGraphic.review.visualHash,formulaHash);assert.equal(actual.formulaGraphic.review.sourceVersion,saved.saved);assert.equal(actual.formulaGraphic.extension.keep,true);assert.equal(actual.extension.keep,true);assert.equal(actual.implementation.code,'return input / 2;');assert.deepEqual(actual.formulaGraphic.edits,draft.elements[0].formulaGraphic.edits)
  assert.equal(readFileSync(read.version.file,'utf8'),originalFile);assert.deepEqual(readVersion(dir,saved.saved).board,draft);assert.equal(readVersion(dir,result.version.id).parent,saved.saved)
  const element=await call('board',{element:'formula'});assert.equal(element.program.currentMath,'y = x');assert.equal(element.program.formulaPending,false)
  const delivery=await call('render',{serve:false,open:false,requireVerified:true});assert.equal(delivery.ok,false);assert.equal(delivery.error.code,'intent/not-verified','图形语义校对不声称源码业务实现已证明')
})

test('校对后当前PNG变化会使旧hash失效，即使所选保存版已应用也拒绝严格使用',async t=>{
  const {dir,call}=await formulaFixture(t),e=formulaElement();e.formulaGraphic.semanticStatus='reviewed';e.formulaGraphic.currentMath='y = x';e.formulaGraphic.review={visualHash:formulaHash}
  assert.equal((await call('board',{board:{version:1,elements:[e]}})).ok,true)
  e.image={...e.image,src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',width:1,height:1}
  assert.equal((await call('board',{board:{version:1,elements:[e]}})).ok,true)
  const state=versionState(dir);saveVersion(dir,{body:'formulas',board:state.board,baseHash:state.hash,expectedSelection:null,label:'过期校对'})
  const read=await call('selected_version');assert.equal(read.pending,false);assert.equal(read.formulaSemantics[0].requiresReview,true)
  assert.equal((await call('selected_version',{apply:true,selectionRevision:read.selectionRevision})).error.code,'formula/review-stale')
  assert.equal((await call('render',{requireVerified:true,serve:false,open:false})).error.code,'formula/review-stale')
  assert.equal((await call('render',{serve:false,open:false})).ok,true)
})

test('已应用选定版之后工程再次变化，校对旧快照必须重新选定基线且不会覆盖新修改',async t=>{
  const {dir,call}=await formulaFixture(t),e=formulaElement();markFormulaPending(e)
  assert.equal((await call('board',{board:{version:1,elements:[e]}})).ok,true)
  const state=versionState(dir);saveVersion(dir,{body:'formulas',board:state.board,baseHash:state.hash,expectedSelection:null,label:'待校对图形'})
  const changed=structuredClone(state.board);changed.elements.push({id:'new-note',type:'text',x:400,y:0,width:200,height:100,text:'之后新增的工程说明'})
  assert.equal((await call('board',{board:changed})).ok,true)
  const read=await call('selected_version'),disk=readFileSync(join(dir,'body.json'),'utf8');assert.equal(read.pending,false)
  const result=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:[{element:'formula',currentMath:'y = x',visualHash:formulaHash}]})
  assert.equal(result.ok,false);assert.equal(result.error.code,'version/engine-changed');assert.equal(listVersions(dir).versions.length,1);assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk);assert.equal(versionState(dir).board.elements[1].id,'new-note')
})

test('有多张待校对公式时部分校对不会写出新历史或落地未校对表达',async t=>{
  const {dir,call}=await formulaFixture(t),b={version:1,elements:[formulaElement('one'),formulaElement('two')]};assert.equal((await call('board',{board:b})).ok,true)
  const state=versionState(dir),draft=structuredClone(state.board);draft.elements.forEach(markFormulaPending)
  saveVersion(dir,{body:'formulas',board:draft,baseHash:state.hash,expectedSelection:null,label:'两张擦改公式'})
  const read=await call('selected_version'),disk=readFileSync(join(dir,'body.json'),'utf8'),partial=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:[{element:'one',currentMath:'y = x',visualHash:formulaHash}]})
  assert.equal(partial.ok,false);assert.ok(partial.errors.some(error=>error.code==='formula/needs-review'&&error.subject.element==='two'));assert.equal(listVersions(dir).versions.length,1);assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk)
  const complete=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:draft.elements.map(e=>({element:e.id,currentMath:'y = x',visualHash:formulaHash}))});assert.equal(complete.ok,true);assert.equal(listVersions(dir).versions.length,2)
})

test('同一原PNG的不同擦痕分别计算实际视觉指纹，旧原图指纹不能校对新画面',async t=>{
  const {dir,call}=await formulaFixture(t),initial={version:1,elements:[formulaElement('masked-one'),formulaElement('masked-two')]};assert.equal((await call('board',{board:initial})).ok,true);
  const state=versionState(dir),draft=structuredClone(state.board);draft.elements.forEach(markFormulaPending);draft.elements[0].erasures=[{surface:'body',points:[[1/6,.25]],radius:[.1,.1]}];draft.elements[1].erasures=[{surface:'body',points:[[5/6,.75]],radius:[.1,.1]}];
  saveVersion(dir,{body:'formulas',board:draft,baseHash:state.hash,expectedSelection:null,label:'同图不同擦痕'});const read=await call('selected_version'),disk=readFileSync(join(dir,'body.json'),'utf8'),visuals=mcpToolResult('anatomy_selected_version',read).content.filter(b=>b.type==='image');assert.equal(visuals.length,2);
  const expected=draft.elements.map(e=>createHash('sha256').update(Buffer.from(maskedImageSource(e).split(',')[1],'base64')).digest('hex'));assert.notEqual(expected[0],expected[1]);
  for(let index=0;index<2;index++){assert.equal(read.formulaSemantics[index].visualHash,expected[index]);assert.notEqual(expected[index],formulaHash);assert.equal(createHash('sha256').update(Buffer.from(visuals[index].data,'base64')).digest('hex'),expected[index])}
  const stale=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:draft.elements.map(e=>({element:e.id,currentMath:'y = x',visualHash:formulaHash}))});assert.equal(stale.ok,false);assert.equal(stale.error.code,'formula/review-stale');assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk);
  const reviewed=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision,formulaReviews:draft.elements.map((e,index)=>({element:e.id,currentMath:'y = x',visualHash:expected[index]}))});assert.equal(reviewed.ok,true);assert.deepEqual(versionState(dir).board.elements.map(e=>e.erasures),draft.elements.map(e=>e.erasures));assert.equal(versionState(dir).board.elements[0].image.src,formulaSource);
  const changedState=versionState(dir),changed=structuredClone(changedState.board);changed.elements[0].erasures.push({surface:'body',points:[[.5,.25]],radius:[.1,.1]});saveVersion(dir,{body:'formulas',board:changed,baseHash:changedState.hash,expectedSelection:reviewed.selectionRevision,label:'校对后再次擦除'});const changedRead=await call('selected_version');assert.equal(changedRead.formulaSemantics[0].requiresReview,true);assert.equal(changedRead.formulaSemantics[1].requiresReview,false);assert.equal((await call('selected_version',{apply:true,selectionRevision:changedRead.selectionRevision})).error.code,'formula/review-stale');
});
