import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {apply} from '../lib/index.js'
import {boardDiagnostics,elementMathEntries,elementProgram,lineEnds,MAX_MATH_CONTENT_LENGTH,MAX_MATH_EXPRESSIONS} from '../lib/board.js'
import {autoLayout,layoutBox,boxesOverlap} from '../lib/layout.js'
import {humanMap,agentDigest} from '../lib/digest.js'
import {partTitle,readingRoutes,relationLabelLayout} from '../lib/reading.js'
import {versionState,saveVersion,listVersions,readVersion} from '../lib/versions.js'

const element=()=>({id:'step',type:'rect',x:0,y:0,width:220,height:90,text:'检查输入',math:'y = f(x)',implementation:{language:'JavaScript',code:'return input;',extra:{keep:true}}})
const board=()=>({version:1,elements:[element()]})

test('新增表达保留主表达式身份与原始数据，空内容不参与读出',()=>{
  const e=element();e.mathExpressions=[{id:'condition',value:'x ≥ 0',extra:{reviewed:true}},{id:'empty',value:' '}]
  const original=structuredClone(e),entries=[{id:'primary',value:'y = f(x)'},{id:'condition',value:'x ≥ 0'}]
  assert.deepEqual(elementMathEntries(e),entries)
  assert.deepEqual(elementProgram(e).mathExpressions,entries)
  assert.deepEqual(e,original)
  assert.deepEqual(boardDiagnostics({version:1,elements:[e]}),[])
  assert.deepEqual(elementMathEntries({...e,math:''}),entries.slice(1))
})

test('严格检查追加列表的格式、保留标识、重复标识和人读语言',()=>{
  const invalid=[null,{},[null],[[]],[{id:'primary',value:'x'}],[{id:'same',value:'x'},{id:'same',value:'y'}],[{id:'bad id',value:'x'}],[{id:'one',value:2}],[{id:'one',value:'const secret = 1;'}],[{id:'one',value:'return secret;'}]]
  for(const mathExpressions of invalid){
    const b=board();b.elements[0].mathExpressions=mathExpressions
    const errors=boardDiagnostics(b)
    assert.ok(errors.length,JSON.stringify(mathExpressions))
    if(Array.isArray(mathExpressions)&&mathExpressions.some(e=>typeof e?.value==='string'&&e.value.includes('secret')))assert.ok(errors.some(e=>e.code==='human/program-language'))
  }
})

test('数量与总长度限制沿用数学输入边界，不能拆成多条绕过限制',()=>{
  const b=board();b.elements[0].math='';b.elements[0].mathExpressions=Array.from({length:MAX_MATH_EXPRESSIONS},(_,i)=>({id:'m'+i,value:''}))
  assert.deepEqual(boardDiagnostics(b),[])
  b.elements[0].mathExpressions.push({id:'overflow',value:''})
  assert.ok(boardDiagnostics(b).some(e=>e.code==='board/math-limit'))
  b.elements[0].mathExpressions=[{id:'limit',value:'x'.repeat(MAX_MATH_CONTENT_LENGTH)}]
  assert.deepEqual(boardDiagnostics(b),[])
  b.elements[0].math='y'
  assert.ok(boardDiagnostics(b).some(e=>e.code==='board/math-limit'))
  b.elements[0].math='';b.elements[0].mathExpressions[0].value+='x'
  assert.ok(boardDiagnostics(b).some(e=>e.code==='board/math-limit'))
})

test('项目保存和选定版本严格应用保留数学身份、源码映射与额外元数据',async t=>{
  const root=mkdtempSync('/tmp/anatomy-math-');t.after(()=>rmSync(root,{recursive:true,force:true}))
  writeFileSync(join(root,'source.js'),'export function checkInput(input) { return input; }\n')
  const tools=new Map();apply({tools:{register:d=>tools.set(d.name,d)}},{rootDir:root,autoServe:false})
  const dir=join(root,'anatomy-math'),call=(name,args={})=>tools.get('anatomy_'+name).execute({dir,repoRoot:root,...args})
  assert.equal((await call('init',{body:'math',title:'数学表达',oneline:'检查输入并交付结果。'})).ok,true)
  const initial=board();initial.elements[0].anchors=[{file:'source.js',symbol:'checkInput',role:'implementation',reason:'检查输入'}]
  assert.equal((await call('board',{board:initial})).ok,true)
  const baseline=versionState(dir),next=structuredClone(baseline.board)
  next.elements[0].mathExpressions=[{id:'domain',value:'x ≥ 0',review:{accepted:true}},{id:'bound',value:'y ≤ 10'}]
  next.elements[0].handwriting={mode:'math',strokes:[[[10,20],[30,40]]],reviewed:true}
  const saved=saveVersion(dir,{body:'math',board:next,baseHash:baseline.hash,expectedSelection:null,label:'补充数学约束'})
  assert.deepEqual(readVersion(dir,saved.saved).board,next)
  const read=await call('selected_version');assert.equal(read.ok,true)
  assert.deepEqual(read.version.board,next)
  const applied=await call('selected_version',{apply:true,selectionRevision:read.selectionRevision})
  assert.equal(applied.ok,true,JSON.stringify(applied))
  const current=await call('board',{element:'step'})
  assert.equal(current.element.math,'y = f(x)')
  assert.deepEqual(current.element.mathExpressions,next.elements[0].mathExpressions)
  assert.deepEqual(current.element.implementation,next.elements[0].implementation)
  assert.deepEqual(current.element.anchors,next.elements[0].anchors)
  assert.deepEqual(current.element.handwriting,next.elements[0].handwriting)
  assert.deepEqual(current.program.mathExpressions,elementMathEntries(next.elements[0]))
  const before=readFileSync(join(dir,'body.json'),'utf8'),bad=structuredClone(current.board)
  bad.elements[0].mathExpressions[0].value='const secret = 1;'
  assert.equal((await call('board',{board:bad,force:true,strict:false})).ok,false)
  assert.equal(readFileSync(join(dir,'body.json'),'utf8'),before)
  const state=versionState(dir)
  assert.throws(()=>saveVersion(dir,{body:'math',board:bad,baseHash:state.hash,expectedSelection:listVersions(dir).selected.revision}),/自然语言|数学语言/)
  assert.equal(listVersions(dir).versions.length,1)
})

test('人机摘要和关系读出包含全部数学表达，人读不泄露程序内容',()=>{
  const b=board();b.elements[0].mathExpressions=[{id:'domain',value:'x ≥ 0'}]
  b.elements.push({id:'edge',type:'arrow',x:0,y:200,width:200,height:0,text:'通过检查的数据',math:'耗时 ≤ 20 毫秒',mathExpressions:[{id:'order',value:'先接收再交付'}]})
  const human=humanMap({title:'工程',board:b},[],[]),machine=agentDigest({board:b},[],[])
  for(const value of ['y = f(x)','x ≥ 0','耗时 ≤ 20 毫秒','先接收再交付']){assert.ok(human.includes(value));assert.ok(machine.includes(value))}
  assert.ok(!human.includes('return input;'));assert.ok(machine.includes('return input;'))
  assert.ok(machine.includes('"id":"domain"'))
  const labels=relationLabelLayout(b,[],lineEnds),plain=relationLabelLayout({...b,elements:b.elements.map(e=>e.id==='edge'?{...e,mathExpressions:[]}:e)},[],lineEnds)
  assert.deepEqual(labels[0].mathExpressions,elementMathEntries(b.elements[1]))
  assert.equal(labels[0].h,plain[0].h+52)
})

test('追加数学内容撑开图元和分区标题，避让时仅修改几何',()=>{
  const initial=board(),expanded=board();expanded.elements[0].mathExpressions=[{id:'one',value:'x ≥ 0'},{id:'two',value:'y ≤ 10'}]
  expanded.elements.push({...element(),id:'near',y:100})
  const next=autoLayout(expanded)
  assert.ok(next.elements[0].height>autoLayout(initial).elements[0].height)
  assert.equal(boxesOverlap(layoutBox(next.elements[0]),layoutBox(next.elements[1])),false)
  assert.deepEqual(next.elements[0].mathExpressions,expanded.elements[0].mathExpressions)
  assert.deepEqual(next.elements[0].implementation,expanded.elements[0].implementation)
  assert.deepEqual(autoLayout(next),next)
  assert.equal(expanded.elements[0].height,90)
  const framed={version:1,elements:[{...element(),id:'frame',type:'frame',width:600,height:500,mathExpressions:expanded.elements[0].mathExpressions},{...element(),id:'child',x:30,y:100}]}
  const arranged=autoLayout(framed)
  assert.ok(arranged.elements[1].y>framed.elements[1].y)
  assert.deepEqual(arranged.elements[0].mathExpressions,framed.elements[0].mathExpressions)
  assert.deepEqual(autoLayout(arranged),arranged)
})

test('只有追加表达式的部位仍出现在导读索引中',()=>{
  const b=board();b.elements[0].text='';b.elements[0].math='';delete b.elements[0].implementation
  b.elements[0].mathExpressions=[{id:'constraint',value:'x ≥ 0'}]
  assert.equal(partTitle(b.elements[0]),'数学关系')
  assert.equal(readingRoutes(b)[0].steps[0].element,'step')
})
