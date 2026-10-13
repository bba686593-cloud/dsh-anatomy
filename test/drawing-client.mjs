import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'
import { boardDiagnostics } from '../lib/board.js'
const plain=v=>JSON.parse(JSON.stringify(v));
const mapping={implementation:{language:'JavaScript',code:'process(input)',note:'处理输入',extra:7},anchors:[{file:'lib/board.js',sha256:'a'.repeat(64),role:'implementation'}],targets:[],custom:{keep:true}};
const rect={id:'box',type:'rect',x:100,y:100,width:300,height:180,text:'处理输入',math:'y=ax',mathExpressions:[{id:'extra',value:'x>0',metadata:{keep:true}}],fill:'#eff6ff',stroke:'#6366f1',...mapping};
const pen={id:'ink',type:'pen',x:100,y:350,width:300,height:1,points:[[0,0],[1,0]],text:'',math:'',stroke:'#18233b',strokeWidth:3,fill:'none',...mapping};
function runtime(elements=[rect,pen]){
 const nodes=new Map(),storage=new Map(),listeners={};
 const node=id=>{if(nodes.has(id))return nodes.get(id);const n={id,value:'',innerHTML:'',textContent:'',style:{},dataset:{},hidden:id==='inline-writing',open:false,listeners:{},attributes:{},classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},hasAttribute(k){return this.attributes[k]!==undefined},addEventListener(k,f){(this.listeners[k]??=[]).push(f)},querySelectorAll(){return []},querySelector(){return null},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700}},focus(){},setPointerCapture(){},showModal(){this.open=true},close(){this.open=false},contains(){return false},click(){}};nodes.set(id,n);return n};
 const document={compatMode:'CSS1Compat',getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,body:node('body'),addEventListener(k,f){(listeners[k]??=[]).push(f)}};
 const context={document,window:{addEventListener(){}},structuredClone,AbortController,Blob,URL,console,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async()=>({ok:true,json:async()=>({service:'anatomy-handwriting',ready:true})})};
 const html=renderAnatomy({slug:'drawing-test',title:'自由绘图验证',board:{version:1,elements:structuredClone(elements),layout:{mode:'manual'}}},[],[]);vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 const api=context.window.__anatomyBoard,fire=(id,k,e={})=>(node(id).listeners[k]||[]).forEach(f=>f(e));
 const target=(id,part)=>({closest(selector){if(selector==='[data-id]')return {getAttribute:()=>id};if(selector==='[data-expression]'&&part&&part!=='text')return {getAttribute:()=>part};if(selector==='.shape-prose'&&part==='text')return {};return null}});
 const pointer=(kind,x,y,t={closest(){return null}},extra={})=>{const v=api.view;fire('surface',kind,{button:0,pointerId:1,clientX:x*v.scale+v.x,clientY:y*v.scale+v.y,target:t,preventDefault(){},...extra})};
 const handle=(kind,id,value)=>({closest(sel){if(sel==='[data-resize],[data-rotate],[data-vertex],[data-endpoint]')return {hasAttribute:k=>k==='data-'+kind,getAttribute:k=>k==='data-'+kind?value:k==='data-control-id'?id:k==='data-resize'&&kind==='resize'?id:null};return null}});
 return {api,node,fire,pointer,target,handle,storage};
}
test('画笔连续输入直接保留原笔迹，无识别候选，拖动一次是一条撤销记录',()=>{
 const r=runtime([]);r.api.setTool('pen');r.pointer('pointerdown',10,20);r.pointer('pointermove',80,60);r.pointer('pointerup',80,60);
 assert.equal(r.api.board.elements[0].type,'pen');assert.ok(r.api.board.elements[0].points.length>=2);assert.equal(r.api.board.elements[0].math,'');assert.equal(r.api.board.elements[0].recognition,undefined);
 r.pointer('pointerdown',90,70);r.pointer('pointermove',120,100);r.pointer('pointerup',120,100);assert.equal(r.api.board.elements.length,2);r.api.undo();assert.equal(r.api.board.elements.length,1);r.api.redo();assert.equal(r.api.board.elements.length,2);
});
test('局部橡皮切开真实笔迹且映射不丢，完整擦除拖动可一步撤销重做',()=>{
 const r=runtime([pen]),before=plain(r.api.board);r.api.setTool('eraser');r.pointer('pointerdown',230,350);r.pointer('pointermove',260,350);r.pointer('pointerup',260,350);
 assert.equal(r.api.board.elements.length,2);for(const e of r.api.board.elements){assert.deepEqual(plain(e.anchors),mapping.anchors);assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.custom),mapping.custom)}
 const cut=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),cut);
});
test('擦掉框线只切边框，文字公式拆开继续留在纸上，并可完整撤销',()=>{
 const r=runtime([rect]),before=plain(r.api.board);r.api.setTool('eraser');r.pointer('pointerdown',240,100);r.pointer('pointerup',240,100);
 const children=r.api.board.elements.filter(e=>e.derivedFrom==='box');assert.equal(children.length,3);assert.ok(children.some(e=>e.text==='处理输入'));assert.ok(children.some(e=>e.math==='y=ax'));assert.ok(children.some(e=>e.math==='x>0'));
 for(const e of children)assert.deepEqual(plain(e.anchors),mapping.anchors);assert.ok(r.api.board.elements.some(e=>e.type==='pen'&&e.id==='box'));r.api.undo();assert.deepEqual(plain(r.api.board),before);
});
test('橡皮擦正文与一条公式只修改命中内容，不意外删除框或其他表达',()=>{
 const r=runtime([rect]);r.api.setTool('eraser');r.pointer('pointerdown',220,165,r.target('box','text'));r.pointer('pointerup',220,165);assert.equal(r.api.board.elements[0].text,'');assert.equal(r.api.board.elements[0].math,'y=ax');
 r.pointer('pointerdown',240,200,r.target('box','extra'));r.pointer('pointerup',240,200);assert.equal(r.api.board.elements[0].mathExpressions.length,0);assert.equal(r.api.board.elements[0].type,'rect');assert.deepEqual(plain(r.api.board.elements[0].anchors),mapping.anchors);
});
test('选中即显示八方向控制点，拖动西北手柄保持对角不动及完整机读字段',()=>{
 const r=runtime([rect]);r.api.select('box');assert.equal((r.node('world').innerHTML.match(/data-handle=/g)||[]).length,8);
 const h={closest(sel){return sel==='[data-resize],[data-rotate],[data-vertex],[data-endpoint]'?{hasAttribute:()=>false,getAttribute:k=>k==='data-resize'?'box':k==='data-handle'?'nw':null}:null}};
 r.pointer('pointerdown',100,100,h);r.pointer('pointermove',50,60);r.pointer('pointerup',50,60);const e=r.api.board.elements[0];assert.equal(e.x,50);assert.equal(e.y,60);assert.equal(e.x+e.width,400);assert.equal(e.y+e.height,280);assert.deepEqual(plain(e.anchors),mapping.anchors);r.api.undo();assert.equal(r.api.board.elements[0].width,300);
});
test('画板旋转、多边形顶点和连线端点都有真实指针路径',()=>{
 const poly={...rect,id:'poly',type:'polygon',text:'',math:'',mathExpressions:[],points:[[0,0],[1,0],[1,1],[0,1]]},line={id:'line',type:'arrow',x:450,y:100,width:100,height:50,text:'传递结果'};
 const r=runtime([poly,line]);r.api.select('poly');r.pointer('pointerdown',250,72,r.handle('rotate','poly','poly'));r.pointer('pointermove',428,190);r.pointer('pointerup',428,190);assert.ok(Math.abs(r.api.board.elements[0].rotation-90)<1e-7);r.api.undo();
 r.pointer('pointerdown',100,100,r.handle('vertex','poly','0'));r.pointer('pointermove',80,75);r.pointer('pointerup',80,75);assert.equal(r.api.board.elements[0].x,80);assert.equal(r.api.board.elements[0].y,75);assert.deepEqual(plain(r.api.board.elements[0].anchors),mapping.anchors);
 r.api.select('line');r.pointer('pointerdown',550,150,r.handle('endpoint','line','to'));r.pointer('pointermove',650,300);r.pointer('pointerup',650,300);assert.equal(r.api.board.elements[1].width,200);assert.equal(r.api.board.elements[1].height,200);
});
test('形状转换和拆分保留稳定来源、附加公式扩展与全局撤销',()=>{
 const r=runtime([rect]);r.api.select('box');r.api.drawing.convert('polygon');assert.equal(r.api.board.elements[0].points.length,4);assert.deepEqual(plain(r.api.board.elements[0].implementation),mapping.implementation);r.api.drawing.split();const math=r.api.board.elements.find(e=>e.expressionOrigin==='extra');assert.deepEqual(plain(math.metadata),{keep:true});assert.equal(math.derivedFrom,'box');r.api.undo();assert.equal(r.api.board.elements.length,1);assert.equal(r.api.board.elements[0].type,'polygon');r.api.undo();assert.equal(r.api.board.elements[0].type,'rect');
});
function recognize(r){r.api.select('ink');r.api.math.openHandwriting({mode:'math'});r.node('ink-result').value='y=ax';r.node('ink-destination').value='replace-ink';r.api.math.applyInkResult()}
test('笔迹显式校对后在原处排版，原稿和全部映射保留，切换重载及撤销不丢笔迹',()=>{
 const r=runtime([pen]);recognize(r);const e=r.api.board.elements[0];assert.equal(e.id,'ink');assert.equal(e.type,'math');assert.equal(e.mathDisplay,'typeset');assert.deepEqual(plain(e.recognition.rawElements),[pen]);assert.deepEqual(plain(e.anchors),mapping.anchors);
 r.api.drawing.toggleInk();assert.equal(r.api.board.elements[0].mathDisplay,'ink');assert.match(r.node('world').innerHTML,/original-ink/);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const restored=runtime(plain(r.api.board.elements));assert.match(restored.node('world').innerHTML,/original-ink/);restored.api.select('ink');restored.api.drawing.toggleInk();assert.equal(restored.api.board.elements[0].mathDisplay,'typeset');r.api.undo();r.api.undo();assert.deepEqual(plain(r.api.board.elements[0]),pen);
});
test('识别后原笔迹被移动或擦改，旧结果拒绝覆盖当前原稿',()=>{
 const r=runtime([pen]);r.api.select('ink');r.api.math.openHandwriting({mode:'math'});r.api.board.elements[0].x+=20;r.node('ink-result').value='y=ax';r.node('ink-destination').value='replace-ink';r.api.math.applyInkResult();assert.equal(r.api.board.elements[0].type,'pen');assert.match(r.node('ink-feedback').textContent,/原笔迹已变化/);
});
test('原笔迹模式中编辑公式改为打印，旧笔迹仅保留为原稿，不掩盖新意图',()=>{
 const r=runtime([pen]);recognize(r);r.api.drawing.toggleInk();r.api.canvas.openPaperEditor('ink','primary');r.api.paper.equation('primary','y=ax+b');assert.equal(r.api.canvas.confirm(),true);assert.equal(r.api.board.elements[0].mathDisplay,'typeset');assert.equal(r.api.board.elements[0].math,'y=ax+b');assert.ok(r.api.board.elements[0].mathHandwriting.strokes.length);r.api.drawing.toggleInk();assert.equal(r.api.board.elements[0].mathDisplay,'typeset');assert.match(r.node('toast').textContent,/旧表达/);
});
test('选择整图元橡皮时删除端点会解除连线绑定，并撤销恢复完整数据',()=>{
 const line={id:'link',type:'arrow',x:100,y:100,width:400,height:0,from:'box',text:'传递结果'},r=runtime([rect,line]);r.node('eraser-mode').value='object';r.api.setTool('eraser');r.pointer('pointerdown',250,190,r.target('box'));r.pointer('pointerup',250,190);assert.equal(r.api.board.elements.length,1);assert.equal(r.api.board.elements[0].from,undefined);r.api.undo();assert.equal(r.api.board.elements[1].from,'box');
});
test('擦主公式原笔迹保留正文和附加数学元数据，单点笔迹不消失',()=>{
 const h={mode:'math',reviewedValue:'y=ax',strokes:[[[0,0],[100,0]],[[50,30]]]},e={...rect,type:'math',math:'y=ax',mathDisplay:'ink',mathHandwriting:h,extension:{sourceKey:'必须保留'}};
 const r=runtime([e]);assert.match(r.node('world').innerHTML,/<circle cx="50" cy="30"/);r.api.drawing.erase({x:220,y:100});
 assert.ok(r.api.board.elements.some(e=>e.text==='处理输入'));assert.ok(r.api.board.elements.some(e=>e.math==='x>0'));const pens=r.api.board.elements.filter(e=>e.type==='pen');assert.ok(pens.length>=3);for(const p of r.api.board.elements)assert.deepEqual(plain(p.extension),{sourceKey:'必须保留'});assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});
test('框内部原笔迹与附加原笔迹可以拆开再擦，保留其他表达和来源',()=>{
 const h={mode:'math',reviewedValue:'y=ax',strokes:[[[0,0],[100,0]]]},r=runtime([{...rect,math:'y=ax',mathDisplay:'ink',mathHandwriting:h}]);r.api.setTool('eraser');r.pointer('pointerdown',220,178,r.target('box','primary'));r.pointer('pointerup',220,178);assert.ok(r.api.board.elements.some(e=>e.id==='box'&&e.type==='rect'));assert.ok(r.api.board.elements.some(e=>e.math==='x>0'));assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});
test('整圈外框擦掉后，文字与公式继续保留全部未知元数据',()=>{
 const e={...rect,extension:{sourceKey:'必须保留'},unrecognized:{origin:17}},r=runtime([e]);r.node('eraser-size').value='1000';r.api.drawing.erase({x:250,y:190});assert.equal(r.api.board.elements.length,3);for(const child of r.api.board.elements){assert.deepEqual(plain(child.extension),e.extension);assert.deepEqual(plain(child.unrecognized),e.unrecognized);assert.deepEqual(plain(child.anchors),e.anchors)}
});
test('没有真实笔画的打印公式不能切原稿，手写面板保留笔迹无需任何识别结果',()=>{
 const e={...rect,type:'math',math:'y=ax',mathHandwriting:{mode:'math',strokes:[]}},r=runtime([e]);r.api.select('box');assert.equal(r.node('toggle-ink').hidden,true);r.api.drawing.toggleInk();assert.equal(r.api.board.elements[0].mathDisplay,undefined);
 r.api.select(null);r.api.math.openHandwriting({mode:'math'});const before=plain(r.api.board),event=(x,y)=>({button:0,pointerId:5,clientX:x,clientY:y,preventDefault(){}});r.fire('ink-pad','pointerdown',event(100,100));r.fire('ink-pad','pointermove',event(300,150));r.fire('ink-pad','pointerup',event(300,150));r.fire('ink-keep','click');assert.equal(r.api.board.elements.length,before.elements.length+1);const added=r.api.board.elements.at(-1);assert.equal(added.type,'pen');assert.equal(added.math,'');assert.equal(added.recognition,undefined);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});
test('复合公式首次擦除沿旧SVG真实坐标命中，拆分尚未重绘也不会落空',()=>{
 const h={mode:'math',reviewedValue:'y=ax',strokes:[[[10,10],[110,10]]]},r=runtime([{...rect,math:'y=ax',mathDisplay:'ink',mathHandwriting:h}]),v=r.api.view;
 const n={getBoundingClientRect:()=>({left:v.x+150*v.scale,top:v.y+160*v.scale,right:v.x+350*v.scale,bottom:v.y+210*v.scale}),getAttribute:()=> 'primary',querySelector:()=>({getScreenCTM:()=>({a:v.scale,b:0,c:0,d:v.scale,e:v.x+140*v.scale,f:v.y+170*v.scale})})};
 r.node('world').querySelectorAll=selector=>selector.includes('data-id="box"')?[n]:[];r.api.setTool('eraser');r.pointer('pointerdown',190,180,r.target('box','primary'));r.pointer('pointerup',190,180);assert.ok(r.api.board.elements.filter(e=>e.type==='pen').length>=2);assert.ok(r.api.board.elements.some(e=>e.id==='box'&&e.type==='rect'));assert.ok(r.api.board.elements.some(e=>e.math==='x>0'));assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});
