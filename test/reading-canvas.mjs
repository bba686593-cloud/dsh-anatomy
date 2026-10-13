import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {boardDiagnostics,elementMathEntries,elementProgram} from '../lib/board.js'
import {readingRoutes,partTitle,relationName} from '../lib/reading.js'
import {humanText} from '../lib/semantics.js'

const client=readFileSync(new URL('../lib/board-reading-client.js',import.meta.url),'utf8')
const fixture=()=>({version:1,elements:[
  {id:'input',type:'rect',x:0,y:0,width:180,height:120,text:'接收输入',math:'y=f(x)',mathExpressions:[{id:'boundary',value:'x\\geq 0',handwriting:{strokes:[[[1,2],[3,4]]]},extra:{keep:true}}],implementation:{code:'return input;'},anchors:[{file:'src/input.js',sha256:'a'.repeat(64)}]},
  {id:'output',type:'rect',x:280,y:0,width:180,height:120,text:'生成结果'},
  {id:'relation',type:'arrow',x:180,y:60,width:100,height:0,from:'input',to:'output'}
],reading:{summary:'将输入整理成结果。',extension:{preserve:true},steps:[{element:'input',title:'理解输入',description:'核对输入范围。',custom:{keep:true}},{element:'output',title:'理解结果',description:'核对结果边界。'}]}})
const clickTarget=dataset=>({dataset,closest(selector){const attribute=selector.match(/^\[data-([a-z-]+)\]$/)?.[1],key=attribute?.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return key&&Object.hasOwn(dataset,key)?this:null}})
function runtime(initial=fixture(),options={}){
  const nodes=new Map(),calls=[],undo=[],redo=[],storage=options.storage||new Map();let saves=0;
  function node(id){if(nodes.has(id))return nodes.get(id);const listeners={};const value={id,innerHTML:'',textContent:'',value:'',hidden:false,disabled:false,open:false,listeners,classList:{toggle(){}},addEventListener(name,fn){(listeners[name]??=[]).push(fn)},showModal(){this.open=true},close(){this.open=false;for(const fn of listeners.close||[])fn({target:this})}};nodes.set(id,value);return value}
  const context={board:structuredClone(initial),A:{body:{oneline:'工程目的。'},organs:[],flows:[]},routeId:null,readingIndex:-1,editReading:false,tab:'human',selected:new Set(),structuredClone,Number,JSON,key:'anatomy-board:baseline',
    $:node,get:id=>context.board.elements.find(e=>e.id===id),chosen:()=>context.board.elements.find(e=>context.selected.has(e.id)),document:{body:node('body')},
    esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    boardDiagnostics,elementMathEntries,elementProgram,readingRoutes,partTitle,relationName,humanText,katex:{},formulaMarkup:tex=>({html:'<math>'+String(tex)+'</math>'}),
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},status(){calls.push(['status'])},message(text){calls.push(['message',text])},canvasDirty:false,canvasDraftPending(){return context.canvasDirty},
    flushField(){},setTool(tool){calls.push(['tool',tool])},focusPart(id){context.selected=new Set([id]);calls.push(['focus',id]);context.renderReading()},
    openProgram(id){calls.push(['program',id])},openPaperEditor(id){calls.push(['human',id])},renderScene(){calls.push(['scene'])},
    change(fn){const before=JSON.stringify(context.board);fn();if(before!==JSON.stringify(context.board)){undo.push(before);redo.length=0;saves++}context.renderReading()}
  };
  // The integrated page may render before the extension's var assignments run.
  vm.runInNewContext('initialDraftWasChanged=readingDraftChanged();renderReading();\n'+client,context);
  return {api:context,node,calls,undo,redo,storage,get saves(){return saves},fire(id,event,target={}){for(const fn of node(id).listeners[event]||[])fn({target})},click(dataset){this.fire('reading-content','click',clickTarget(dataset))},input(path,value){this.fire('reading-content','input',{dataset:{guideField:path},value})},back(){if(!undo.length)return;redo.push(JSON.stringify(context.board));context.board=JSON.parse(undo.pop());context.renderReading()},forward(){if(!redo.length)return;undo.push(JSON.stringify(context.board));context.board=JSON.parse(redo.pop());context.renderReading()}}
}
test('独立工程导读与画板阅读卡沿真实部位交互，阅读不形成编辑记录',()=>{
  const r=runtime(),before=JSON.stringify(r.api.board);assert.equal(r.node('reading-card').hidden,true);
  r.fire('open-reading','click');assert.equal(r.node('reading-dialog').open,true);assert.match(r.node('reading-content').innerHTML,/工程目的/);assert.match(r.node('reading-content').innerHTML,/全部部位/);
  r.click({readingStep:'0'});assert.equal(r.node('reading-dialog').open,false);assert.equal(r.node('reading-card').hidden,false);assert.equal(r.node('reading-card-title').textContent,'理解输入');assert.equal(r.node('reading-prev').disabled,true);assert.equal(r.node('reading-next').disabled,false);assert.deepEqual([...r.api.selected],['input']);
  r.fire('reading-next','click');assert.equal(r.node('reading-card-title').textContent,'理解结果');assert.equal(r.node('reading-next').disabled,true);
  r.fire('reading-prev','click');r.fire('reading-outline','click');assert.equal(r.node('reading-dialog').open,true);r.fire('reading-close','click');r.fire('reading-stop','click');assert.equal(r.node('reading-card').hidden,true);
  assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.saves,0);assert.equal(r.undo.length,0)
})
test('画板阅读卡呈现全部数学关系，人读隔离源码与程序，映射须明确打开',()=>{
  const r=runtime();r.api.goReadingStep(0);const human=r.node('reading-card-description').innerHTML+r.node('reading-content').innerHTML;
  assert.match(human,/y=f\(x\)/);assert.match(human,/x\\geq 0/);assert.ok(!human.includes('return input;'));assert.ok(!human.includes('src/input.js'));
  r.fire('reading-map','click');assert.deepEqual(r.calls.find(call=>call[0]==='program'),['program','input']);
  r.fire('reading-describe','click');assert.deepEqual(r.calls.find(call=>call[0]==='human'),['human','input']);assert.equal(r.saves,0)
})
test('导读编辑使用草稿，取消明确丢弃，关闭保留且不会写入工程',()=>{
  const r=runtime(),before=JSON.stringify(r.api.board);r.api.openReading();r.click({guideAction:'edit'});r.input('summary','新的工程目的。');r.input('steps.0.description','新的说明。');
  assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.saves,0);r.click({guideAction:'cancel'});assert.equal(JSON.stringify(r.api.board),before);
  r.click({guideAction:'edit'});r.input('summary','再次修改。');r.fire('reading-close','click');assert.equal(r.api.editReading,false);assert.equal(r.api.readingDraftChanged(),true);assert.equal(r.api.readingDraft.summary,'再次修改。');assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.saves,0);r.api.openReading();assert.equal(r.api.editReading,true);assert.match(r.node('reading-content').innerHTML,/再次修改/)
})
test('确认整份导读形成一步全局撤销，重排增删与公式源码扩展都保留',()=>{
  const r=runtime(),before=JSON.stringify(r.api.board);r.api.beginReadingEdit();r.input('summary','新的工程目的。');r.input('steps.0.description','新的输入边界。');r.click({guideMove:'0',guideDirection:'1'});r.node('reading-append-element').value='relation';r.click({guideAction:'append'});r.click({guideRemove:'1'});assert.equal(r.api.confirmReadingEdit(),true);
  assert.deepEqual(r.api.board.reading.steps.map(s=>s.element),['output','relation']);assert.equal(r.api.board.reading.extension.preserve,true);assert.equal(r.api.board.elements[0].mathExpressions[0].extra.keep,true);assert.equal(r.api.board.elements[0].anchors[0].sha256,'a'.repeat(64));assert.equal(r.api.board.elements[0].implementation.code,'return input;');assert.equal(r.saves,1);assert.equal(r.undo.length,1);
  assert.equal(r.api.readingDraftChanged(),false);assert.equal(r.storage.has('anatomy-board:baseline:reading-editor'),false);
  const after=JSON.stringify(r.api.board);r.back();assert.equal(JSON.stringify(r.api.board),before);r.forward();assert.equal(JSON.stringify(r.api.board),after)
})
test('导读程序混入由整张画板强校验拒绝，失败草稿可继续校对',()=>{
  const r=runtime(),before=JSON.stringify(r.api.board);r.api.beginReadingEdit();r.input('steps.0.description','const answer = 42;');assert.equal(r.api.confirmReadingEdit(),false);assert.equal(JSON.stringify(r.api.board),before);assert.equal(r.api.editReading,true);assert.equal(r.api.readingDraft.steps[0].description,'const answer = 42;');assert.match(r.node('reading-error').textContent,/自然语言与数学/);assert.equal(r.undo.length,0);
  r.input('steps.0.description','输入应满足范围约束。');assert.equal(r.api.confirmReadingEdit(),true);assert.equal(r.api.board.reading.steps[0].description,'输入应满足范围约束。')
})
test('部位删除及同时修改导读均阻断陈旧草稿，失败不覆盖最新工程',()=>{
  const r=runtime();r.api.beginReadingEdit();r.input('summary','等待确认的目的。');r.api.board.elements=r.api.board.elements.filter(e=>e.id!=='input');assert.equal(r.api.confirmReadingEdit(),false);assert.match(r.node('reading-error').textContent,/图元|连线/);assert.equal(r.api.readingDraft.summary,'等待确认的目的。');assert.equal(r.undo.length,0);
  const s=runtime();s.api.beginReadingEdit();s.input('summary','等待确认的目的。');s.api.board.reading.summary='其他操作已确认的目的。';assert.equal(s.api.confirmReadingEdit(),false);assert.equal(s.api.board.reading.summary,'其他操作已确认的目的。');assert.equal(s.api.readingDraft.summary,'等待确认的目的。');assert.match(s.node('reading-error').textContent,/已变化/)
})
test('缺口关系可返回画板，全部部位索引独立且空工程安全',()=>{
  const r=runtime();assert.match(r.node('reading-content').innerHTML,/1 条关系待说明/);r.api.openReading();r.click({readingPart:'relation'});assert.equal(r.node('reading-dialog').open,false);assert.deepEqual([...r.api.selected],['relation']);assert.equal(r.saves,0);
  const empty=runtime({version:1,elements:[]});empty.api.readingIndex=99;empty.api.renderReading();assert.equal(empty.api.readingIndex,-1);assert.equal(empty.api.goReadingStep(0),false);assert.equal(empty.api.readingActive(),false);empty.api.beginReadingEdit();assert.equal(empty.api.confirmReadingEdit(),true);assert.deepEqual(empty.api.board.reading.steps,[])
})
test('刷新恢复未确认导读草稿，保留原基线与程序输入等待校对',()=>{
  const first=runtime();assert.equal(first.api.initialDraftWasChanged,false);first.api.beginReadingEdit();first.input('summary','尚未确认的工程目的。');first.input('steps.0.description','const pending = 42;');first.fire('reading-close','click');
  const recovered=runtime(fixture(),{storage:first.storage});assert.equal(recovered.api.readingDraftChanged(),true);recovered.api.openReading();assert.equal(recovered.api.readingDraft.summary,'尚未确认的工程目的。');assert.equal(recovered.api.confirmReadingEdit(),false);assert.equal(recovered.api.readingDraft.steps[0].description,'const pending = 42;');
  recovered.input('steps.0.description','核对新的输入约束。');assert.equal(recovered.api.confirmReadingEdit(),true);assert.equal(recovered.api.readingDraftChanged(),false);assert.equal(recovered.storage.has('anatomy-board:baseline:reading-editor'),false);
  const changed=fixture();changed.reading.summary='工程已更新的目的。';const original=runtime();original.api.beginReadingEdit();original.input('summary','等待确认。');const stale=runtime(changed,{storage:original.storage});assert.equal(stale.api.confirmReadingEdit(),false);assert.match(stale.node('reading-error').textContent,/已变化/);assert.equal(stale.api.readingDraft.summary,'等待确认。');stale.api.cancelReadingEdit();assert.equal(stale.storage.size,0)
})
test('未确认画板编辑阻止导读导航与写入，保留目标、当前视图和双份草稿',()=>{
  const r=runtime();r.api.goReadingStep(0);r.api.beginReadingEdit();r.input('summary','导读草稿。');r.api.canvasDirty=true;const beforeCalls=r.calls.length;
  assert.equal(r.api.goReadingStep(1),false);assert.equal(r.api.readingIndex,0);assert.equal(r.api.openReading(),false);r.click({readingPart:'output'});assert.deepEqual([...r.api.selected],['input']);assert.equal(r.calls.slice(beforeCalls).some(call=>call[0]==='focus'),false);
  assert.equal(r.api.confirmReadingEdit(),false);assert.equal(r.api.readingDraft.summary,'导读草稿。');assert.match(r.node('reading-error').textContent,/画板上的编辑/);assert.equal(r.saves,0);assert.equal(r.api.canvasDirty,true)
})
