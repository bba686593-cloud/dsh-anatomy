import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {apply} from '../lib/index.js'
import {boardDiagnostics,boardFor,boardBundle,lineEnds,deleteElements,moveElements,BOARD_TYPES,elementProgram,validMathInk} from '../lib/board.js'
import {mappingIndex,impactOf} from '../lib/mapping.js'
import {renderAnatomy} from '../lib/render.js'
import { FORMULA_GROUPS, MATH_SYMBOL_GROUPS, formulaMarkup } from '../lib/math.js'
import { createRequire } from 'node:module'
const katex = createRequire(import.meta.url)('../lib/vendor/katex.cjs')
import {humanMap,agentDigest} from '../lib/digest.js'
import vm from 'node:vm'
const rect=(id,x=0)=>({id,type:'rect',x,y:0,width:100,height:80,text:'处理输入',math:'y = f(x)',implementation:{language:'JavaScript',code:'return input;',extra:{preserve:true}}})
const board=()=>({version:1,elements:[rect('a'),rect('b',300),{id:'link',type:'arrow',x:50,y:40,width:300,height:0,from:'a',to:'b'}]})
async function fixture(t){const root=mkdtempSync('/tmp/anatomy-board-');t.after(()=>rmSync(root,{recursive:true,force:true}));const ts=new Map();apply({tools:{register(d){ts.set(d.name,d);return()=>{}}}},{rootDir:root,autoServe:false});const dir=join(root,'anatomy-model');const call=(n,args={})=>ts.get('anatomy_'+n).execute({dir,repoRoot:root,...args});assert.equal((await call('init',{body:'model',title:'工程画板',oneline:'用图形描述工程。'})).ok,true);return {root,dir,call}}
test('无系统、无器官也可创建、渲染和反查自由画板',async t=>{const {call,root}=await fixture(t);writeFileSync(join(root,'part.js'),'export function processInput(input) { return input; }');const b=board();b.elements[0].anchors=[{file:'part.js',symbol:'processInput',role:'implementation',reason:'处理输入'}];assert.equal((await call('board',{board:b})).ok,true);const r=await call('board',{element:'a'});assert.equal(r.program.implementation.code,'return input;');assert.match(r.element.anchors[0].sha256,/^[a-f0-9]{64}$/);assert.equal((await call('render')).ok,true);const body={title:'工程画板',board:r.board};assert.equal(mappingIndex(body,[],[]).files[0].refs[0].kind,'element');assert.equal(impactOf(body,[],[],{files:['part.js']}).elements[0].id,'a');assert.ok(humanMap(body,[],[]).includes('y = f(x)'));assert.ok(!humanMap(body,[],[]).includes('return input'));assert.ok(agentDigest(body,[],[]).includes('return input;'))})
test('图形种类完整，未知字段在修改包内原样保留',()=>{const b={version:1,elements:BOARD_TYPES.map((type,i)=>({...rect('e'+i),type,...(['pen','polygon'].includes(type)?{points:[[0,0],[1,0],[.5,1]]}:{}),...(type==='image'?{image:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC',alt:'工程示意图',width:3,height:2}}:{})}))};assert.deepEqual(boardDiagnostics(b),[]);const c=structuredClone(b);c.elements[0].text='新的人的意图';const pack=boardBundle(b,c,'model','baseline');assert.equal(pack.baseHash,'baseline');assert.deepEqual(pack.edits[0].patch.board,c);assert.deepEqual(boardBundle(c,c,'model','baseline').edits,[])})
test('缺引用、重复标识、非法几何、代码混入人读均阻断整包写入',async t=>{const {call,dir}=await fixture(t);await call('board',{board:board()});const baseline=readFileSync(join(dir,'body.json'),'utf8');for(const mutate of [b=>b.elements.push({...rect('a')}),b=>b.elements[0].width=-1,b=>b.elements[0].text='const x = 1',b=>b.elements[0].targets=[{kind:'organ',id:'missing'}],b=>b.elements[2].to='gone',b=>b.elements[0].anchors=['bad'],b=>b.elements[0].fill='#abcde',b=>b.elements.push(null)]){const b=board();mutate(b);assert.equal((await call('board',{board:b,force:true,strict:false})).ok,false);assert.equal(readFileSync(join(dir,'body.json'),'utf8'),baseline)}})
test('画板修改带基线落地，陈旧版本拒绝且完整程序元数据保留',async t=>{const {call}=await fixture(t);const first=await call('board',{board:board()});const next=structuredClone(first.board);next.elements[0].text='新的工程意图';const pack=boardBundle(first.board,next,'model',first.anatomyHash);assert.equal((await call('apply_edits',pack)).ok,true);assert.equal((await call('board',{element:'a'})).element.implementation.extra.preserve,true);assert.equal((await call('apply_edits',pack)).ok,false)})

const mathInk=()=>({mode:'math',strokes:[[[20,30],[80,100]]],reviewed:false,candidate:{text:'x ≥ 0',engine:'local-test',extension:{keep:true}},extension:{keep:true}})
const formulaPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGN0S1nAwMDAwMDAxAADABcWAU7Ylb4oAAAAAElFTkSuQmCC'
const formulaImage=()=>({id:'formula',type:'image',x:0,y:0,width:300,height:200,math:'',image:{src:formulaPng,alt:'数学图形',width:3,height:2},formulaGraphic:{version:1,originalMath:String.raw`y = \frac{x}{2}`,originalImage:{src:formulaPng,width:3,height:2},currentMath:String.raw`y = \frac{x}{2}`,semanticStatus:'source-aligned',renderer:{name:'MathJax SVG',version:'3.2.2'},edits:[],extension:{keep:true}},implementation:{code:'return input / 2;'},extension:{keep:true}})
test('公式图形机读分离原稿和当前表达，擦改待校对仍允许保存结构',()=>{
  const e=formulaImage(),b={version:1,elements:[e]};assert.deepEqual(boardDiagnostics(b),[])
  let program=elementProgram(e);assert.deepEqual(program.formulaGraphic,e.formulaGraphic);assert.equal(program.currentMath,e.formulaGraphic.currentMath);assert.equal(program.formulaPending,false);assert.deepEqual(program.mathExpressions,[])
  e.formulaGraphic.currentMath=null;e.formulaGraphic.semanticStatus='needs-review';e.formulaGraphic.edits=[{kind:'erase',points:[[0,0],[2,1]],radius:.5,extension:{keep:true}},{kind:'ink',strokes:[[[1,1],[2,1]]],strokeWidth:1},{kind:'crop',x:0,y:0,width:2,height:1}]
  assert.deepEqual(boardDiagnostics(b),[]);program=elementProgram(e);assert.equal(program.currentMath,null);assert.equal(program.formulaPending,true);assert.deepEqual(program.formulaGraphic.edits,e.formulaGraphic.edits)
  program.formulaGraphic.edits[0].points[0][0]=99;assert.equal(e.formulaGraphic.edits[0].points[0][0],0)
  const bundle=boardBundle({version:1,elements:[]},b,'model','baseline');assert.deepEqual(bundle.edits[0].patch.board,b)
})
test('公式图形校验来源、PNG、当前语义和编辑几何，不能伪称擦改后仍等同原稿',()=>{
  const invalid=[e=>e.type='math',e=>e.math=e.formulaGraphic.originalMath,e=>e.mathExpressions=[{id:'extra',value:'x > 0'}],e=>e.formulaGraphic.version=2,e=>e.formulaGraphic.originalMath='',e=>e.formulaGraphic.originalImage.src='https://outside.example/a.png',e=>e.formulaGraphic.originalImage.width=99,e=>e.formulaGraphic.renderer.version='unknown',e=>e.formulaGraphic.semanticStatus='approved',e=>e.formulaGraphic.currentMath='y = x',e=>e.formulaGraphic.edits=[{kind:'erase',radius:1}],e=>{e.formulaGraphic.semanticStatus='needs-review'},e=>{e.formulaGraphic.semanticStatus='reviewed';e.formulaGraphic.currentMath='y = x'},e=>{e.formulaGraphic.semanticStatus='reviewed';e.formulaGraphic.review={visualHash:'bad'}},e=>{e.formulaGraphic.semanticStatus='needs-review';e.formulaGraphic.currentMath=null;e.formulaGraphic.edits=[{kind:'erase',points:[[NaN,0]]}]},e=>{e.formulaGraphic.semanticStatus='needs-review';e.formulaGraphic.currentMath=null;e.formulaGraphic.edits=[{kind:'ink',strokeWidth:-1}]},e=>{e.formulaGraphic.semanticStatus='needs-review';e.formulaGraphic.currentMath=null;e.formulaGraphic.edits=[{kind:'run'}]}]
  for(const mutate of invalid){const e=formulaImage();mutate(e);assert.ok(boardDiagnostics({version:1,elements:[e]}).some(error=>error.code.startsWith('board/formula-')),mutate.toString())}
  const reviewed=formulaImage();reviewed.formulaGraphic.semanticStatus='reviewed';reviewed.formulaGraphic.currentMath='y = x';reviewed.formulaGraphic.review={visualHash:'a'.repeat(64),extension:{keep:true}}
  assert.deepEqual(boardDiagnostics({version:1,elements:[reviewed]}),[],'浏览器只校验指纹格式，真实图片指纹由严格工具门禁核对')
})
test('公式图形人读无原始排版源码和图片数据，机读保留原图及待校对义务',()=>{
  const e=formulaImage();e.formulaGraphic.semanticStatus='needs-review';e.formulaGraphic.currentMath=null;e.formulaGraphic.edits=[{kind:'erase',points:[[0,0]],radius:1}]
  const body={title:'数学工程',board:{version:1,elements:[e]}},human=humanMap(body,[],[]),machine=agentDigest(body,[],[])
  assert.match(human,/数学图形（待校对）/);assert.ok(!human.includes('\\frac'));assert.ok(!human.includes('data:image/'));assert.ok(!human.includes('return input'))
  assert.ok(machine.includes(JSON.stringify(e.formulaGraphic)));assert.ok(machine.includes('禁止按原稿冒充当前意图实施'));assert.ok(machine.includes('return input / 2;'))
})
test('主公式和附加公式可选择原笔迹或排版，旧字段不被强制迁移',()=>{
  const b=board(),e=b.elements[0];e.mathHandwriting=mathInk();e.mathDisplay='ink';e.mathExpressions=[{id:'constraint',value:'x ≥ 0',display:'ink',handwriting:mathInk(),extension:{keep:true}}]
  assert.deepEqual(boardDiagnostics(b),[])
  e.mathDisplay='typeset';e.mathExpressions[0].display='typeset';assert.deepEqual(boardDiagnostics(b),[])
  e.mathDisplay='ink';delete e.mathHandwriting;e.handwriting=mathInk();assert.deepEqual(boardDiagnostics(b),[])
  delete e.mathDisplay;delete e.mathExpressions[0].display;delete e.handwriting;e.mathExpressions[0].handwriting={strokes:[[[1,2],[3,4]]],extension:{legacy:true}}
  assert.deepEqual(boardDiagnostics(b),[])
})
test('原笔迹模式要求真实有效数学笔迹，候选文字、空笔画和越界坐标不能冒充',()=>{
  const invalid=[undefined,{mode:'math',candidate:{text:'x ≥ 0'}},{mode:'math',strokes:[]},{mode:'text',strokes:[[[10,10],[20,20]]]},{mode:'math',strokes:[[]]},{mode:'math',strokes:[[[NaN,10]]]},{mode:'math',strokes:[[[1001,10]]]},{mode:'math',strokes:[[[10,421]]]},{mode:'math',strokes:[Array.from({length:1501},()=>[10,10])]}]
  for(const handwriting of invalid){
    assert.equal(validMathInk(handwriting),false)
    const primary=board();primary.elements[0].mathDisplay='ink';primary.elements[0].mathHandwriting=handwriting
    assert.ok(boardDiagnostics(primary).some(error=>error.code==='board/math-ink'))
    const extra=board();extra.elements[0].mathHandwriting=mathInk();extra.elements[0].mathExpressions=[{id:'constraint',value:'x ≥ 0',display:'ink',handwriting}]
    assert.ok(boardDiagnostics(extra).some(error=>error.code==='board/math-ink'))
  }
  for(const display of ['raw',null,{},true]){const b=board();b.elements[0].mathDisplay=display;b.elements[0].mathExpressions=[{id:'constraint',value:'x ≥ 0',display}];assert.equal(boardDiagnostics(b).filter(error=>error.code==='board/math-display').length,2)}
})
test('原笔迹已有校对表达基线时拒绝显示陈旧公式，旧笔迹未记基线继续兼容',()=>{
  const b=board(),e=b.elements[0];e.mathDisplay='ink';e.mathHandwriting={...mathInk(),reviewedValue:e.math};e.mathExpressions=[{id:'constraint',value:'x ≥ 0',display:'ink',handwriting:{...mathInk(),reviewedValue:'x ≥ 0'}}]
  assert.deepEqual(boardDiagnostics(b),[])
  e.math='y = 2x';e.mathExpressions[0].value='x > 0';assert.equal(boardDiagnostics(b).filter(error=>error.code==='board/math-ink-stale').length,2)
  e.mathDisplay='typeset';e.mathExpressions[0].display='typeset';assert.deepEqual(boardDiagnostics(b),[])
  e.mathDisplay='ink';e.mathExpressions[0].display='ink';delete e.mathHandwriting.reviewedValue;delete e.mathExpressions[0].handwriting.reviewedValue;assert.deepEqual(boardDiagnostics(b),[])
  e.mathHandwriting.reviewedValue=123;assert.ok(boardDiagnostics(b).some(error=>error.code==='board/math-ink-stale'))
})
test('绘图机读保留原始点、手写候选、显示选择及完整公式元数据，不改写原数据',()=>{
  const e={...rect('stroke'),type:'pen',points:[[0,0],[.5,1],[1,0]],rotation:45,handwriting:{mode:'text',strokes:[[[1,2],[3,4]]]},mathHandwriting:mathInk(),mathDisplay:'ink',recognition:{mode:'text',text:'等待校对',reviewed:false,rawElements:[{id:'source-stroke',type:'pen',points:[[0,0],[1,1]],anchors:[{file:'source.js',sha256:'a'.repeat(64)}]}],extension:{keep:true}},mathExpressions:[{id:'constraint',value:'x ≥ 0',display:'ink',handwriting:mathInk(),extension:{keep:true}}]}
  const before=structuredClone(e),program=elementProgram(e)
  assert.equal(program.type,'pen');assert.equal(program.geometry.rotation,45)
  for(const key of ['points','handwriting','mathHandwriting','mathDisplay','recognition'])assert.deepEqual(program[key],e[key])
  assert.deepEqual(program.mathExpressions,[{id:'primary',value:e.math},{id:'constraint',value:'x ≥ 0'}])
  assert.deepEqual(program.mathExpressionsRaw,e.mathExpressions)
  program.points[0][0]=999;program.mathHandwriting.strokes[0][0][0]=999;program.mathExpressionsRaw[0].handwriting.candidate.extension.keep=false;program.recognition.rawElements[0].points[0][0]=999
  assert.deepEqual(e,before)
})
test('新显示字段的保存与应用过严格门禁，真实笔迹和源码映射完整往返',async t=>{
  const {call,dir}=await fixture(t),b=board();b.elements[0].mathDisplay='ink';b.elements[0].mathHandwriting=mathInk();b.elements[0].recognition={mode:'math',text:'y = f(x)',reviewed:false}
  b.elements[0].mathExpressions=[{id:'constraint',value:'x ≥ 0',display:'ink',handwriting:mathInk(),extension:{keep:true}}]
  assert.equal((await call('board',{board:b})).ok,true)
  const read=await call('board',{element:'a'});assert.deepEqual(read.program.mathHandwriting,b.elements[0].mathHandwriting);assert.deepEqual(read.program.mathExpressionsRaw,b.elements[0].mathExpressions)
  const changed=structuredClone(read.board);changed.elements[0].mathDisplay='typeset';changed.elements[0].mathExpressions[0].display='typeset'
  assert.equal((await call('apply_edits',boardBundle(read.board,changed,'model',read.anatomyHash))).ok,true)
  const final=await call('board',{element:'a'});assert.deepEqual(final.program.mathHandwriting,b.elements[0].mathHandwriting);assert.equal(final.program.mathDisplay,'typeset')
  const disk=readFileSync(join(dir,'body.json'),'utf8'),bad=structuredClone(changed);bad.elements[0].mathDisplay='ink';delete bad.elements[0].mathHandwriting
  assert.equal((await call('apply_edits',{...boardBundle(changed,bad,'model',final.anatomyHash),force:true,strict:false})).ok,false)
  assert.equal(readFileSync(join(dir,'body.json'),'utf8'),disk)
})
test('源码变化必须复核，普通画板编辑不能重置源码基线',async t=>{const {call,root}=await fixture(t);writeFileSync(join(root,'part.js'),'export const value = 1;');const b=board();b.elements[0].anchors=[{file:'part.js'}];const first=await call('board',{board:b});assert.equal(first.ok,true);writeFileSync(join(root,'part.js'),'export const value = 2;');const next=structuredClone(first.board);next.elements[0].text='修改说明';const failed=await call('board',{board:next});assert.equal(failed.ok,false);assert.ok(failed.errors.some(e=>e.code==='anchor/source-changed'));assert.equal((await call('board')).board.elements[0].anchors[0].sha256,first.board.elements[0].anchors[0].sha256);const reviewed=await call('board',{board:next,reviewSources:true});assert.equal(reviewed.ok,true);assert.notEqual(reviewed.board.elements[0].anchors[0].sha256,first.board.elements[0].anchors[0].sha256)})
test('连线停在形状边界，移动和删除端点后位置连续',()=>{const b=board(),line=b.elements[2];assert.deepEqual(lineEnds(line,b.elements),{a:{x:100,y:40},b:{x:300,y:40}});moveElements(b,['a'],20,0);assert.equal(lineEnds(line,b.elements).a.x,120);const ends=lineEnds(line,b.elements);deleteElements(b,['a']);assert.deepEqual(lineEnds(line,b.elements),ends);assert.equal(line.from,undefined);assert.equal(line.to,'b');assert.deepEqual(boardDiagnostics(b),[])})
test('连续拖动连线采用原始坐标，移动组合不二次偏移',()=>{const b=board(),original=structuredClone(b);moveElements(b,['link'],10,20,original);moveElements(b,['link'],30,40,original);assert.deepEqual(lineEnds(b.elements[2],b.elements),{a:{x:130,y:80},b:{x:330,y:80}});assert.equal(b.elements[2].from,undefined);const all=board();moveElements(all,['a','b','link'],30,40);assert.deepEqual(lineEnds(all.elements[2],all.elements),{a:{x:130,y:80},b:{x:330,y:80}});assert.equal(all.elements[2].from,'a')})
test('已有器官可作为图元映射，但不强制引入三维',()=>{const b=boardFor({},[{id:'a',name:'处理',gist:'处理输入'}],[]);assert.deepEqual(b.elements[0].targets,[{kind:'organ',id:'a'}]);const html=renderAnatomy({title:'工程',board:board()},[],[]);assert.ok(!html.includes('chart3d'));assert.ok(html.includes('data-tool="polygon"'));assert.ok(html.includes('data-tab="program"'))})
// Run the real inline client through DOM events; geometry and persistence are checked separately above.
function runtime(b,options={}){const elements=new Map(),callbacks=new Map(),storage=options.storage||new Map();const node=id=>{if(elements.has(id))return elements.get(id);const listeners={};const n={id,value:'',innerHTML:'',textContent:'',style:{},dataset:{},listeners,attributes:{},classList:{add(){},remove(){},toggle(){return true}},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},addEventListener(k,f){(listeners[k]??=[]).push(f)},querySelector(){return null},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700}},setPointerCapture(){},showModal(){this.open=true},close(){this.open=false},focus(){},click(){},appendChild(){},remove(){}};elements.set(id,n);return n};const document={compatMode:'CSS1Compat',getElementById:node,querySelectorAll:()=>[],body:node('body'),addEventListener(k,f){callbacks.set(k,f)},createElement:()=>node('download')};const context={document,window:{addEventListener(){}},localStorage:{setItem(k,v){storage.set(k,v)},getItem(k){return storage.get(k)},removeItem(k){storage.delete(k)}},structuredClone,console,Blob,URL,AbortController,setTimeout:()=>0,clearTimeout(){},...options.globals};if(options.recognitionProvider)storage.set('anatomy-recognition:preferences',JSON.stringify({provider:options.recognitionProvider,endpoint:''}));const html=renderAnatomy({slug:'model',title:'工程',board:b},[],[]);vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);return {context,api:context.window.__anatomyBoard,node,callbacks,storage,fire(id,type,ev={}){for(const f of node(id).listeners[type]||[])f(ev)}}}
const ev=(x,y,id)=>({button:0,clientX:x,clientY:y,pointerId:1,preventDefault(){},target:{closest(q){return q==='[data-id]'&&id?{getAttribute:()=>id}:null}}})
test('真实前端事件完成绘制、撤销重做、机读编辑和自然语言隔离',()=>{const r=runtime(board());r.api.select('a');assert.ok(!r.node('inspector').innerHTML.includes('return input;'));r.api.setTool('rect');r.fire('surface','pointerdown',ev(150,150));r.fire('surface','pointermove',ev(360,260));r.fire('surface','pointerup',ev(360,260));assert.equal(r.api.board.elements.length,4);const id=r.api.selected[0];assert.equal(r.api.board.elements[3].type,'rect');r.api.undo();assert.equal(r.api.board.elements.length,3);r.api.redo();assert.equal(r.api.board.elements.length,4);r.api.select(id);r.api.canvas.openProgram(id);r.fire('inspector','input',{target:{dataset:{field:'implementation.code'},value:'const answer = 42;',type:'textarea'}});r.api.canvas.confirm();assert.equal(r.api.bundle().edits[0].patch.board.elements[3].implementation.code,'const answer = 42;');assert.ok(!r.node('world').innerHTML.includes('const answer'));assert.ok(r.storage.size>0);r.api.undo();assert.equal(r.api.board.elements[3].implementation,undefined)})
test('自由笔迹和逐点多边形经实际事件形成有效可映射图元',()=>{const r=runtime({version:1,elements:[]});r.api.setTool('pen');r.fire('surface','pointerdown',ev(100,100));r.fire('surface','pointermove',ev(120,130));r.fire('surface','pointermove',ev(180,110));r.fire('surface','pointerup',ev(180,110));assert.equal(r.api.board.elements[0].type,'pen');r.api.setTool('polygon');for(const p of [[200,100],[300,100],[260,200]])r.fire('surface','pointerdown',ev(...p));r.callbacks.get('keydown')({key:'Enter',target:{},preventDefault(){}});assert.equal(r.api.board.elements[1].type,'polygon');assert.deepEqual(boardDiagnostics(r.api.board),[]);r.api.duplicate();assert.equal(r.api.board.elements.length,3);r.api.remove();assert.equal(r.api.board.elements.length,2)})
test('恶意程序内容只存数据，不关闭内联脚本或进入画板人读',()=>{const b=board();b.elements[0].implementation.code='</script><img src=x onerror=alert(1)>';const html=renderAnatomy({title:'工程',board:b},[],[]);assert.equal((html.match(/<\/script>/g)||[]).length,1);const r=runtime(b);assert.ok(!r.node('world').innerHTML.includes('onerror'));assert.equal(r.api.board.elements[0].implementation.code,b.elements[0].implementation.code)})
test('scaffold 的 force 也不能保存坏图元，磁盘损坏检查给出诊断而非崩溃',async t=>{const {call,dir}=await fixture(t);const before=readFileSync(join(dir,'body.json'),'utf8');for(const b of [{version:1,elements:[null]},{version:1,elements:'bad'},{version:1,elements:[{...rect('a'),anchors:[null]}]}]){const r=await call('scaffold',{board:b,force:true});assert.equal(r.ok,false);assert.equal(readFileSync(join(dir,'body.json'),'utf8'),before);const raw=JSON.parse(before);raw.board=b;writeFileSync(join(dir,'body.json'),JSON.stringify(raw));const checked=await call('check');assert.equal(checked.ok,false);assert.ok(checked.errors?.some(e=>e.code.startsWith('board/')),JSON.stringify(checked));writeFileSync(join(dir,'body.json'),before)}})
test('直接在 init 附带的画板也核对源码，缺文件不落盘',async t=>{const {call,root}=await fixture(t);const b=board();b.elements[0].anchors=[{file:'missing.js'}];const result=await call('init',{dir:join(root,'anatomy-invalid'),body:'invalid',title:'待核对画板',oneline:'需要真实的源码依据。',board:b});assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.code.startsWith('anchor/')))})

test('页面保存直接提交项目服务，失败保留草稿且不会弹下载',async()=>{let connected=true,payload=null;const r=runtime(board(),{globals:{fetch:async(path,options)=>{if(!connected)throw Error('断线');if(path==='/api/versions'&&options.method==='POST'){payload=JSON.parse(options.body);return{ok:true,json:async()=>({ok:true,selected:{id:'saved',revision:'new'},versions:[{id:'saved',label:'边界',createdAt:new Date().toISOString()}],board:payload.board})}}return{ok:true,json:async()=>({ok:true,versions:[],selected:null,service:'anatomy-handwriting'})}}}});await r.api.versions.refresh();r.api.change(()=>r.api.board.elements[0].text='新的意图');assert.equal(await r.api.versions.save(),true);assert.equal(payload.board.elements[0].text,'新的意图');assert.equal(payload.board.elements[0].implementation.code,'return input;');assert.ok(payload.baseHash);assert.equal(r.node('export-dialog').open,undefined);connected=false;r.api.change(()=>r.api.board.elements[0].text='继续修改');assert.equal(await r.api.versions.save(),false);assert.match(r.node('save-status').textContent,/草稿已保留/);assert.equal(r.api.board.elements[0].text,'继续修改');r.fire('export','click');assert.equal(JSON.parse(r.node('export-content').value).schema,'anatomy-board/1')})

test('连线上的数学表达在画布可见',()=>{const b=board();b.elements[2].math='传递耗时 ≤ 20 毫秒';const r=runtime(b);assert.ok(r.node('world').innerHTML.includes('传递耗时 ≤ 20 毫秒'))})

test('公式库覆盖分式微积分矩阵概率逻辑工程关系，全部真实排版',()=>{let count=0;for(const [category,entries] of FORMULA_GROUPS){assert.ok(entries.length>=6);for(const [name,source] of entries){const result=formulaMarkup(source,katex);assert.equal(result.error,null,category+':'+name);assert.match(result.html,/<math/);count++}}assert.ok(count>=40);assert.ok(MATH_SYMBOL_GROUPS.length>=4);assert.match(formulaMarkup(String.raw`\frac{x^2}{\sqrt{y}}`,katex).html,/<mfrac>/);assert.match(formulaMarkup(String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`,katex).html,/<mtable[ >]/)})
test('公式解析错误有可读回退，不允许公式加载远程资源或执行程序',()=>{assert.ok(formulaMarkup(String.raw`\frac{a`,katex).error);const result=formulaMarkup(String.raw`\href{javascript:alert(1)}{x}`,katex);assert.ok(!result.html.includes('href="javascript:'));assert.ok(!formulaMarkup(String.raw`\includegraphics{https://example.com/x.png}`,katex).html.includes('<img'));assert.ok(formulaMarkup('x'.repeat(10001),katex).error)})
function graphicRuntime(b,options={}){const r=runtime(b,options);r.context.testRasterBoundary=options.raster|| (async()=>({src:formulaPng,width:3,height:2,displayWidth:150,displayHeight:100}));vm.runInNewContext('rasterFormula = testRasterBoundary',r.context);return r}
test('公式库确认异步生成独立PNG图形，原公式与实现映射保留且可撤销',async()=>{
  const r=graphicRuntime(board()),source=String.raw`\int_0^1 x^2\,\mathrm{d}x`;r.api.select('a');r.api.math.openFormulaLibrary({value:source});assert.equal(r.node('formula-dialog').open,true)
  const inserted=await r.api.math.applyFormula();assert.equal(inserted.type,'image');assert.equal(inserted.math,'');assert.equal(inserted.image.src,formulaPng);assert.equal(inserted.formulaGraphic.originalMath,source);assert.equal(inserted.formulaGraphic.currentMath,source);assert.equal(inserted.formulaGraphic.semanticStatus,'source-aligned');assert.deepEqual(boardDiagnostics(r.api.board),[])
  assert.equal(r.api.board.elements[0].math,'y = f(x)');assert.equal(r.api.board.elements[0].implementation.code,'return input;');assert.equal(r.api.board.elements.length,4)
  r.api.undo();assert.equal(r.api.board.elements.length,3);assert.equal(r.api.board.elements[0].math,'y = f(x)');r.api.redo();assert.equal(r.api.board.elements[3].formulaGraphic.currentMath,source)
})
test('手写结果经校对确认才写入，保留原笔迹、程序表达和撤销能力',()=>{const r=runtime(board());r.api.select('a');r.node('ink-result').value='接收请求后检查输入';r.node('ink-destination').value='new';const before=r.api.board.elements.length;assert.equal(before,3);r.api.math.applyInkResult();assert.equal(r.api.board.elements.length,4);assert.equal(r.api.board.elements[3].text,'接收请求后检查输入');assert.equal(r.api.board.elements[3].handwriting.reviewed,true);assert.equal(r.api.board.elements[0].implementation.code,'return input;');r.api.undo();assert.equal(r.api.board.elements.length,3);r.node('ink-result').value='const x = 1';r.api.math.applyInkResult();assert.equal(r.api.board.elements.length,3)})


test('已确认的手写图元能重新打开原笔迹并继续编辑，异常笔迹不进入画板',()=>{const b=board();b.elements[0].handwriting={mode:'math',reviewed:true,strokes:[[[20,30],[60,80]]],candidate:{text:'x',engine:'test'},sourceElements:[]};const r=runtime(b);r.api.select('a');r.api.math.openHandwriting();assert.equal(r.api.math.mode,'math');assert.equal(JSON.stringify(r.api.math.strokes),JSON.stringify(b.elements[0].handwriting.strokes));assert.equal(r.node('ink-destination').value,'edit:primary');r.node('ink-result').value='x^2';r.api.math.applyInkResult();assert.equal(r.api.board.elements.length,3);assert.equal(r.api.board.elements[0].math,'x^2');assert.equal(r.api.board.elements[0].handwriting.candidate.text,'x');assert.equal(r.api.board.elements[0].implementation.code,'return input;');b.elements[0].handwriting.strokes=[[['bad',20]]];const bad=runtime(b);bad.api.select('a');bad.api.math.openHandwriting();assert.equal(bad.api.math.strokes.length,0)})


test('连接检测兼容没有超时快捷接口的浏览器，断线后可以恢复',async()=>{let online=false;const r=runtime(board(),{recognitionProvider:'local',globals:{AbortSignal:{},fetch:async()=>{if(!online)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({service:'anatomy-handwriting',ready:true})}}}});await r.api.math.checkInkService();assert.match(r.node('ink-service').textContent,/重新连接/);online=true;await r.api.math.checkInkService();assert.match(r.node('ink-service').textContent,/已就绪/);assert.equal(r.node('ink-reconnect').disabled,false)})
test('未确认的笔迹、模式和校对结果经过关闭和页面重开仍可恢复',()=>{const r=runtime(board());r.api.math.openHandwriting();r.fire('ink-mode-math','click');r.fire('ink-pad','pointerdown',ev(100,100));r.fire('ink-pad','pointermove',ev(150,180));r.fire('ink-pad','pointerup',ev(150,180));r.node('ink-result').value='y=ax';r.fire('ink-result','input');r.fire('ink-close','click');const reopened=runtime(board(),{storage:r.storage});reopened.api.math.openHandwriting();assert.equal(reopened.api.math.mode,'math');assert.equal(reopened.api.math.strokes.length,1);assert.equal(reopened.node('ink-result').value,'y=ax');assert.match(reopened.node('ink-feedback').textContent,/已恢复/);reopened.api.math.applyInkResult();assert.equal([...reopened.storage.keys()].some(k=>k.endsWith(':handwriting')),false)})

test('工程导读沿作者步骤定位，可回到上一步且不会修改工程数据',()=>{
  const b=board();b.reading={summary:'把输入变成输出。',steps:[{element:'b',title:'先看输出',description:'先理解交付结果。'},{element:'a',title:'再找输入',description:'沿依赖回看入口。'}]};const r=runtime(b);
  assert.deepEqual([...r.api.selected],['b']);r.api.goReadingStep(1);assert.deepEqual([...r.api.selected],['a']);assert.match(r.node('reading-card-title').textContent,/再找输入/);assert.ok(!r.node('reading-card-description').innerHTML.includes('return input;'));r.api.goReadingStep(0);assert.deepEqual([...r.api.selected],['b']);assert.equal(r.api.bundle().edits.length,0);
  r.fire('reading-content','click',{target:{closest:q=>q==='[data-guide-action]'?{dataset:{guideAction:'edit'}}:null}});r.fire('reading-content','input',{target:{dataset:{guideField:'steps.0.description'},value:'结果应满足新的边界。'}});r.fire('reading-content','click',{target:{closest:q=>q==='[data-guide-action]'?{dataset:{guideAction:'confirm'}}:null}});assert.equal(r.api.bundle().edits[0].patch.board.reading.steps[0].description,'结果应满足新的边界。');r.api.undo();assert.equal(r.api.board.reading.steps[0].description,'先理解交付结果。')
})
test('导读引用和人读语言必须通过检查，删除图元清理步骤且可撤销',async t=>{
  const {call}=await fixture(t),b=board();b.reading={steps:[{element:'a',title:'看入口',description:'入口接收数据。'}]};assert.equal((await call('board',{board:b})).ok,true);
  for(const reading of [null,{steps:[{element:'gone'}]},{steps:[{element:'a',description:'const x = 1;'}]},{steps:[{element:'a',title:42}]}]){assert.equal((await call('board',{board:{...b,reading}})).ok,false)}
  const r=runtime(b);r.api.remove();assert.equal(r.api.board.reading.steps.length,0);r.api.undo();assert.equal(r.api.board.reading.steps[0].element,'a');assert.deepEqual(boardDiagnostics(r.api.board),[])
})

test('自由布局选择不被刷新状态覆盖，撤销恢复自动布局',()=>{const r=runtime(board());r.node('manual-layout').checked=true;r.fire('manual-layout','change');assert.equal(r.api.board.layout.mode,'manual');assert.equal(r.node('manual-layout').checked,true);r.api.undo();assert.equal(r.node('manual-layout').checked,false)})


test('公式库默认独立新建，多次生成保留原有表达和程序映射',async()=>{
  const r=graphicRuntime(board());r.api.select('a');r.api.math.openFormulaLibrary();assert.equal(r.node('formula-operation').value,'new');assert.equal(r.node('formula-input').hidden,true)
  const source=r.node('formula-input').value;await r.api.math.applyFormula();assert.equal(r.api.board.elements.length,4);assert.equal(r.api.board.elements[3].formulaGraphic.currentMath,source)
  r.api.math.openFormulaLibrary({value:'z = x - y'});await r.api.math.applyFormula();assert.equal(r.api.board.elements.length,5);assert.equal(r.api.board.elements[4].formulaGraphic.currentMath,'z = x - y');assert.equal(r.api.board.elements[3].formulaGraphic.currentMath,source)
  assert.equal(r.api.board.elements[0].math,'y = f(x)');assert.equal(r.api.board.elements[0].implementation.code,'return input;');assert.equal(r.api.board.elements[0].mathExpressions,undefined)
  r.fire('undo','click');assert.equal(r.api.board.elements.length,4);r.fire('redo','click');assert.equal(r.api.board.elements.length,5);assert.deepEqual(boardDiagnostics(r.api.board),[])
})
test('模板选择只更新图形预览，关闭不写原公式，异步转换期间变化拒绝插入',async()=>{
  let finish;const r=graphicRuntime(board(),{raster:()=>new Promise(resolve=>finish=resolve)});r.api.select('a');r.api.math.openFormulaLibrary({value:'y = x'})
  r.fire('formula-templates','click',{target:{closest:()=>({dataset:{template:'0'}})}});assert.equal(r.node('formula-input').hidden,true);assert.equal(r.node('formula-input').value,FORMULA_GROUPS[0][1][0][1]);assert.equal(r.api.board.elements[0].math,'y = f(x)')
  r.fire('formula-close','click');assert.equal(r.api.board.elements.length,3);assert.equal(r.api.board.elements[0].math,'y = f(x)')
  r.api.math.openFormulaLibrary({value:'y = x'});const pending=r.api.math.applyFormula();r.api.change(()=>r.api.board.elements[0].math='y = 2x');finish({src:formulaPng,width:3,height:2,displayWidth:150,displayHeight:100})
  assert.equal(await pending,false);assert.equal(r.api.board.elements.length,3);assert.equal(r.api.board.elements[0].math,'y = 2x');assert.equal(r.node('formula-dialog').open,true)
})
test('手写数学可追加或明确编辑单条，原公式与原笔迹均保留',()=>{
  const b=board();b.elements[0].handwriting={mode:'math',reviewed:true,strokes:[[[10,10],[20,20]]]};
  const r=runtime(b);r.api.select('a');r.api.math.openHandwriting();r.node('ink-destination').value='append';r.node('ink-result').value='z = x + 1';r.fire('ink-apply','click');
  const first=r.api.board.elements[0],id=first.mathExpressions[0].id;
  assert.equal(first.math,'y = f(x)');assert.equal(first.mathExpressions[0].value,'z = x + 1');
  assert.equal(JSON.stringify(first.handwriting.strokes),JSON.stringify(b.elements[0].handwriting.strokes));assert.equal(first.mathExpressions[0].handwriting.reviewed,true);
  r.api.math.openHandwriting();r.node('ink-destination').value='edit:'+id;r.node('ink-result').value='z = x + 2';r.fire('ink-apply','click');
  assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 2');assert.equal(r.api.board.elements[0].math,'y = f(x)');
  r.fire('undo','click');assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 1');r.fire('redo','click');assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 2')
})
test('确认连续输入后全局撤销和重做，新确认取消重做分支',()=>{
  const r=runtime(board());r.api.select('a');const input=value=>{r.node('canvas-text-input').value=value;r.fire('canvas-text-input','input')};
  r.api.canvas.openTextEditor('a');input('第一次修改');input('第二次修改');assert.equal(r.api.board.elements[0].text,'处理输入');r.api.canvas.confirm();
  r.fire('undo','click');assert.equal(r.api.board.elements[0].text,'处理输入');r.fire('redo','click');assert.equal(r.api.board.elements[0].text,'第二次修改');
  r.fire('undo','click');r.api.canvas.openTextEditor('a');input('新的修改分支');r.api.canvas.confirm();assert.equal(r.node('redo').disabled,true);r.fire('redo','click');assert.equal(r.api.board.elements[0].text,'新的修改分支');
  r.fire('undo','click');assert.equal(r.api.board.elements[0].text,'处理输入')
})
test('拖动绘制期间全局撤销终止在途操作，后续指针事件安全且可重做',()=>{
  const r=runtime(board());r.api.setTool('rect');r.fire('surface','pointerdown',ev(100,100));r.fire('surface','pointermove',ev(250,220));
  assert.equal(r.api.board.elements.length,4);const created=JSON.stringify(r.api.board.elements[3]);
  r.callbacks.get('keydown')({key:'z',ctrlKey:true,target:{},preventDefault(){}});assert.equal(r.api.board.elements.length,3);
  r.fire('surface','pointermove',ev(300,300));r.fire('surface','pointerup',ev(300,300));assert.equal(r.api.board.elements.length,3);
  r.fire('redo','click');assert.equal(JSON.stringify(r.api.board.elements[3]),created)
})
test('从自由布局切换自动排布只产生一个可撤销的全局步骤',()=>{
  const b=board();b.layout={mode:'manual'};b.elements[1].x=20;const r=runtime(b),before=JSON.stringify(r.api.board);
  r.node('manual-layout').checked=false;r.fire('manual-layout','change');assert.equal(r.api.board.layout.mode,'auto');assert.notEqual(JSON.stringify(r.api.board),before);
  r.fire('undo','click');assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.node('undo').disabled,true);r.fire('redo','click');assert.equal(r.api.board.layout.mode,'auto')
})

test('向中文手写部位追加主公式保留中文笔迹，并能继续编辑独立数学笔迹',()=>{
  const b=board();b.elements[0].math='';b.elements[0].handwriting={mode:'text',reviewed:true,strokes:[[[10,10],[20,20]]],candidate:{text:'处理输入',engine:'text-test'}};
  const original=JSON.stringify(b.elements[0].handwriting),r=runtime(b);r.api.select('a');r.api.math.openHandwriting();r.fire('ink-mode-math','click');r.fire('ink-clear','click');
  r.fire('ink-pad','pointerdown',ev(100,100));r.fire('ink-pad','pointermove',ev(180,150));r.fire('ink-pad','pointerup',ev(180,150));const strokes=JSON.stringify(r.api.math.strokes);
  r.node('ink-destination').value='append';r.node('ink-result').value='y = x + 1';r.fire('ink-apply','click');
  assert.equal(r.api.board.elements[0].math,'y = x + 1');assert.equal(JSON.stringify(r.api.board.elements[0].handwriting),original);
  assert.equal(r.api.board.elements[0].mathHandwriting.mode,'math');assert.equal(JSON.stringify(r.api.board.elements[0].mathHandwriting.strokes),strokes);
  r.api.math.openHandwriting({expression:'primary'});assert.equal(r.node('ink-destination').value,'edit:primary');assert.equal(r.node('ink-result').value,'y = x + 1');assert.equal(JSON.stringify(r.api.math.strokes),strokes);
  r.node('ink-result').value='y = x + 2';r.fire('ink-apply','click');assert.equal(r.api.board.elements[0].math,'y = x + 2');assert.equal(JSON.stringify(r.api.board.elements[0].handwriting),original);
  r.fire('undo','click');assert.equal(r.api.board.elements[0].math,'y = x + 1');assert.equal(JSON.stringify(r.api.board.elements[0].handwriting),original)
})

test('追加表达式可恢复自身笔迹与识别结果继续手写，不混用主公式笔迹',()=>{
  const b=board();b.elements[0].handwriting={mode:'math',reviewed:true,strokes:[[[10,10],[20,20]]],candidate:{text:'y = f(x)',engine:'primary-test'}};
  b.elements[0].mathExpressions=[{id:'extra',value:'z = x + 1',handwriting:{mode:'math',reviewed:true,strokes:[[[100,100],[200,200]]],candidate:{text:'z = x + 1',engine:'extra-test'}}}];
  const primary=JSON.stringify(b.elements[0].handwriting),r=runtime(b);r.api.select('a');r.api.math.openHandwriting({expression:'extra'});
  assert.equal(r.api.math.mode,'math');assert.equal(r.node('ink-destination').value,'edit:extra');assert.equal(r.node('ink-result').value,'z = x + 1');assert.equal(JSON.stringify(r.api.math.strokes),JSON.stringify(b.elements[0].mathExpressions[0].handwriting.strokes));
  r.node('ink-result').value='z = x + 2';r.fire('ink-apply','click');assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 2');assert.equal(r.api.board.elements[0].mathExpressions[0].handwriting.candidate.engine,'extra-test');assert.equal(JSON.stringify(r.api.board.elements[0].handwriting),primary);
  r.fire('undo','click');assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 1');r.fire('redo','click');assert.equal(r.api.board.elements[0].mathExpressions[0].value,'z = x + 2')
})

test('手写编辑主公式和追加公式拒绝陈旧表达值，关闭重开仍保留原校对基线',()=>{
  for(const id of ['primary','extra']){
    const b=board();b.elements[0].mathExpressions=[{id:'extra',value:'z = x + 1'}];const r=runtime(b);r.api.select('a');r.api.math.openHandwriting({expression:id});r.node('ink-result').value='w = x + 2';r.fire('ink-result','input');
    r.api.change(()=>{if(id==='primary')r.api.board.elements[0].math='y = 2x';else r.api.board.elements[0].mathExpressions[0].value='z = 2x'});
    r.fire('ink-apply','click');assert.match(r.node('ink-feedback').textContent,/已变化/);assert.equal(r.node('ink-dialog').open,true);
    assert.equal(id==='primary'?r.api.board.elements[0].math:r.api.board.elements[0].mathExpressions[0].value,id==='primary'?'y = 2x':'z = 2x');
    r.fire('ink-close','click');r.api.math.openHandwriting({expression:id});assert.equal(r.node('ink-result').value,'w = x + 2');r.fire('ink-apply','click');assert.match(r.node('ink-feedback').textContent,/已变化/);
    assert.equal(id==='primary'?r.api.board.elements[0].math:r.api.board.elements[0].mathExpressions[0].value,id==='primary'?'y = 2x':'z = 2x')
  }
})

test('中文手写写入选中部位也拒绝打开期间变化的中文说明',()=>{
  const b=board();b.elements[0].handwriting={mode:'text',reviewed:true,strokes:[[[10,10],[20,20]]],candidate:{text:'处理输入'}};
  const r=runtime(b);r.api.select('a');r.api.math.openHandwriting();assert.equal(r.node('ink-destination').value,'selected');r.node('ink-result').value='校对后的手写说明';
  r.api.change(()=>r.api.board.elements[0].text='另一版本的新说明');r.fire('ink-apply','click');
  assert.equal(r.api.board.elements[0].text,'另一版本的新说明');assert.match(r.node('ink-feedback').textContent,/中文说明已变化/);assert.equal(r.node('ink-dialog').open,true);
  assert.equal(r.api.board.elements[0].handwriting.candidate.text,'处理输入')
})

test('普通手写入口兼容只保留独立主公式笔迹的部位',()=>{
  const b=board();b.elements[0].mathHandwriting={mode:'math',reviewed:true,strokes:[[[100,100],[180,150]]],candidate:{text:'y = f(x)',engine:'separate-test'}};
  const r=runtime(b);r.api.select('a');r.api.math.openHandwriting();assert.equal(r.api.math.mode,'math');assert.equal(r.node('ink-destination').value,'edit:primary');
  assert.equal(r.node('ink-result').value,'y = f(x)');assert.equal(JSON.stringify(r.api.math.strokes),JSON.stringify(b.elements[0].mathHandwriting.strokes));
  r.node('ink-result').value='y = 2x';r.fire('ink-apply','click');assert.equal(r.api.board.elements[0].math,'y = 2x');assert.equal(r.api.board.elements[0].handwriting,undefined);
  assert.equal(r.api.board.elements[0].mathHandwriting.candidate.engine,'separate-test')
})

test('独立公式图形创建是一个全局撤销步骤，保留原有图元机读内容',async()=>{
  const r=graphicRuntime(board());r.api.select('a');const before=JSON.stringify(r.api.board);r.api.math.openFormulaLibrary({value:'y = x + 1'});await r.api.math.applyFormula()
  assert.notEqual(JSON.stringify(r.api.board),before);assert.equal(r.api.board.elements[0].implementation.code,'return input;');assert.equal(r.api.board.elements[3].formulaGraphic.currentMath,'y = x + 1')
  r.fire('undo','click');assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.node('undo').disabled,true);r.fire('redo','click');assert.equal(r.api.board.elements[3].formulaGraphic.currentMath,'y = x + 1')
})
