import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { deflateSync } from 'node:zlib'
import { renderAnatomy } from '../lib/render.js'
import { boardDiagnostics } from '../lib/board.js'
import { localToWorld } from '../lib/drawing.js'
const plain=v=>JSON.parse(JSON.stringify(v));
const mapping={implementation:{language:'JavaScript',code:'process(input)',note:'处理输入',extra:7},anchors:[{file:'lib/board.js',sha256:'a'.repeat(64),role:'implementation'}],targets:[],custom:{keep:true}};
const rect={id:'box',type:'rect',x:100,y:100,width:300,height:180,text:'处理输入',math:'y=ax',mathExpressions:[{id:'extra',value:'x>0',metadata:{keep:true}}],fill:'#eff6ff',stroke:'#6366f1',...mapping};
const pen={id:'ink',type:'pen',x:100,y:350,width:300,height:1,points:[[0,0],[1,0]],text:'',math:'',stroke:'#18233b',strokeWidth:3,fill:'none',...mapping};
function fixturePNG(width=3,height=2,color=0){
 const crc=buffer=>{let c=0xffffffff;for(const byte of buffer){c^=byte;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1}return(c^0xffffffff)>>>0};
 const chunk=(name,data)=>{const tag=Buffer.from(name),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);tag.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc(Buffer.concat([tag,data])),b.length-4);return b};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const rows=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+1+x*4;rows[p]=color;rows[p+3]=255}
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]).toString('base64')
}
const fixtureRaster={src:fixturePNG(),width:3,height:2,displayWidth:60,displayHeight:40};
function fixtureCapture(session){const xs=session.region.map(p=>p.x),ys=session.region.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);return {src:fixturePNG(),bounds:{x,y,width:Math.max(1,Math.max(...xs)-x),height:Math.max(1,Math.max(...ys)-y)}}}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
function runtime(elements=[rect,pen],options={}){
 const nodes=new Map(),storage=new Map(),listeners={};
 const node=id=>{if(nodes.has(id))return nodes.get(id);const classes=new Set(),captures=new Set(),n={id,value:'',innerHTML:'',textContent:'',style:{},dataset:{},hidden:id==='inline-writing'||options.lassoUI&&['canvas-text-editor','canvas-tools'].includes(id),open:false,listeners:{},attributes:{},classList:{add(...values){for(const value of values)classes.add(value)},remove(...values){for(const value of values)classes.delete(value)},contains(value){return classes.has(value)},toggle(value,force){const enabled=force??!classes.has(value);enabled?classes.add(value):classes.delete(value);return enabled}},setAttribute(k,v){this.attributes[k]=v},getAttribute(k){return this.attributes[k]},hasAttribute(k){return this.attributes[k]!==undefined},addEventListener(k,f){(this.listeners[k]??=[]).push(f)},querySelectorAll(){return []},querySelector(){return null},getBoundingClientRect(){return {left:0,top:0,width:1000,height:700}},focus(){},setPointerCapture(id){captures.add(id)},hasPointerCapture(id){return captures.has(id)},releasePointerCapture(id){captures.delete(id)},showModal(){this.open=true},close(){this.open=false},contains(){return false},click(){}};nodes.set(id,n);return n};
 const document={compatMode:'CSS1Compat',getElementById:node,querySelectorAll:()=>[],querySelector:()=>null,body:node('body'),addEventListener(k,f){(listeners[k]??=[]).push(f)}};
 const toolbarActions=Object.fromEntries(['text','delete','program','style','duplicate','front','back'].map(action=>{const button=node('canvas-action-'+action);button.dataset.canvasAction=action;button.setAttribute('data-canvas-action',action);if(['text','program','style'].includes(action))button.setAttribute('data-single','');return[action,button]}));
 if(options.lassoUI){const toolbar=node('canvas-tools');toolbar.querySelectorAll=selector=>selector==='[data-canvas-action]'?Object.values(toolbarActions):selector==='[data-single]'?Object.values(toolbarActions).filter(b=>b.hasAttribute('data-single')):[];toolbar.querySelector=selector=>selector==='.canvas-more'?node('canvas-more'):null}
 const imageRequests=[],canvasLog=[];
 class FixtureImage{set src(value){this._src=value;this._paint=0;imageRequests.push(this)}get src(){return this._src}}
 document.createElement=()=>{const canvas={width:3,height:2,_paint:0,toDataURL(){return fixturePNG(this.width,this.height,this._paint)},getContext(){return ctx}};let matrix=[1,0,0,1,0,0],path=[];const stack=[],record=(kind,extra={})=>canvasLog.push({kind,matrix:[...matrix],path:plain(path),lineWidth:ctx.lineWidth,font:ctx.font,width:canvas.width,height:canvas.height,...extra}),multiply=([a,b,c,d,e,f])=>{const [u,v,w,z,x,y]=matrix;matrix=[u*a+w*b,v*a+z*b,u*c+w*d,v*c+z*d,u*e+w*f+x,v*e+z*f+y]};const ctx={drawImage(image,...args){record('drawImage',{src:image.src,args});canvas._paint=image._paint||0},fillText(value,x,y,maxWidth){record('fillText',{value,x,y,maxWidth});canvas._paint++},measureText(value){return {width:value.length*12}},save(){stack.push([...matrix])},restore(){matrix=stack.pop()||matrix},scale(x,y){multiply([x,0,0,y,0,0])},translate(x,y){multiply([1,0,0,1,x,y])},rotate(angle){const c=Math.cos(angle),s=Math.sin(angle);multiply([c,s,-s,c,0,0])},beginPath(){path=[]},closePath(){path.push({kind:'close'})},rect(x,y,width,height){path.push({kind:'rect',x,y,width,height})},clip(rule){record('clip',{rule})},moveTo(x,y){path.push({kind:'move',x,y})},lineTo(x,y){path.push({kind:'line',x,y})},arc(x,y,radius){path.push({kind:'arc',x,y,radius})},stroke(){record('stroke');canvas._paint++},fill(){record('fill');canvas._paint++},fillRect(){},getImageData(){return {data:Uint8ClampedArray.of(0,0,0,255)}}};return canvas};
 const context={document,window:{addEventListener(){}},structuredClone,AbortController,Blob,URL,console,Image:FixtureImage,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:options.fetch|| (async()=>({ok:true,json:async()=>({service:'anatomy-handwriting',ready:true})}))};
 const html=renderAnatomy({slug:'drawing-test',title:'自由绘图验证',board:{version:1,elements:structuredClone(elements),layout:{mode:'manual'}}},[],[]);vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],context);
 context.fixtureRasterFactory=options.raster|| (async()=>plain(fixtureRaster));vm.runInNewContext('rasterFormula=async(...args)=>fixtureRasterFactory(...args)',context);
 if(!options.realCapture){context.fixtureCaptureFactory=options.capture|| (async session=>fixtureCapture(session));vm.runInNewContext('captureLassoRaster=async(...args)=>fixtureCaptureFactory(...args)',context)}
 // Browser startup is not part of these rendering-boundary tests. Enable
 // graphics event paths only after evaluating the bundled browser script.
 if(options.graphics)document.head={};
 const api=context.window.__anatomyBoard,fire=(id,k,e={})=>{const event={preventDefault(){},stopPropagation(){},...e};return Promise.all((node(id).listeners[k]||[]).map(f=>f(event)))};
 const target=(id,part)=>({closest(selector){if(selector==='[data-id]')return {getAttribute:()=>id};if(selector==='[data-expression]'&&part&&part!=='text')return {getAttribute:()=>part};if(selector==='.shape-prose'&&part==='text')return {};return null}});
 const pointer=(kind,x,y,t={closest(){return null}},extra={})=>{const v=api.view;return fire('surface',kind,{button:0,pointerId:1,clientX:x*v.scale+v.x,clientY:y*v.scale+v.y,target:t,preventDefault(){},...extra})};
 const handle=(kind,id,value)=>({closest(sel){if(sel==='[data-resize],[data-rotate],[data-vertex],[data-endpoint]')return {hasAttribute:k=>k==='data-'+kind,getAttribute:k=>k==='data-'+kind?value:k==='data-control-id'?id:k==='data-resize'&&kind==='resize'?id:null};return null}});
 return {api,node,fire,pointer,target,handle,storage,document,context,imageRequests,canvasLog,toolbarActions,dispatchDocument:(kind,event)=>Promise.all((listeners[kind]||[]).map(fn=>fn({target:{matches:()=>false},preventDefault(){},...event}))),evaluate:code=>vm.runInNewContext(code,context),releaseImages(){for(const image of imageRequests)if(!image.released){image.released=true;image.onload?.()}}};
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
const fullInkRegion=[{x:90,y:330},{x:410,y:330},{x:410,y:370},{x:90,y:370}];
async function openLasso(r,region=fullInkRegion,mode='math'){
 r.api.graphics.lasso(region);await r.fire(mode==='math'?'recognize-lasso-math':'recognize-lasso-text','click');
 assert.equal(r.node('ink-dialog').open,true);
}
async function recognize(r){await openLasso(r);r.node('ink-result').value='y=ax';await r.fire('ink-result','input');return await r.api.math.applyInkResult()}
test('圈选笔迹显式校对后在原处生成PNG，原稿与全部映射重载和撤销均保留',async()=>{
 const r=runtime([pen]),before=plain(r.api.board);await recognize(r);const e=r.api.board.elements[0];
 assert.equal(e.id,'ink');assert.equal(e.type,'image');assert.equal(e.math,'');assert.equal(e.mathExpressions,undefined);assert.match(e.image.src,/^data:image\/png;base64,/);assert.equal(e.formulaGraphic.currentMath,'y=ax');assert.equal(e.formulaGraphic.semanticStatus,'source-aligned');assert.deepEqual(plain(e.recognition.rawElements),[pen]);assert.deepEqual(plain(e.anchors),mapping.anchors);assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.custom),mapping.custom);
 assert.equal(r.node('ink-result').hidden,true);assert.equal(r.node('ink-result').readOnly,true);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const confirmed=plain(r.api.board),restored=runtime(confirmed.elements);assert.deepEqual(plain(restored.api.board),confirmed);
 r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),confirmed);
});
test('识别面板打开后原笔迹移动或擦改，旧结果不能覆盖当前原稿',async()=>{
 const r=runtime([pen]);await openLasso(r);r.api.change(()=>{r.api.board.elements[0].x+=20});const changed=plain(r.api.board);r.node('ink-result').value='y=ax';await r.api.math.applyInkResult();
 assert.deepEqual(plain(r.api.board),changed);assert.equal(r.api.board.elements[0].type,'pen');assert.match(r.node('ink-feedback').textContent,/笔迹.*变化/);
});
test('已识别公式点击只选择PNG图形，文字编辑层不出现LaTex或覆盖旧原稿',async()=>{
 const r=runtime([pen]);await recognize(r);const before=plain(r.api.board);
 assert.equal(r.api.canvas.openPaperEditor('ink','primary'),false);assert.equal(r.api.canvas.draft,null);assert.equal(r.node('inline-writing').hidden,true);assert.equal(r.node('paper-equations').innerHTML,'');assert.deepEqual(plain(r.api.board),before);assert.match(r.node('toast').textContent,/图形/);
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

const middleInkRegion=[{x:200,y:330},{x:300,y:330},{x:300,y:370},{x:200,y:370}];
const response=data=>({ok:true,json:async()=>data});
const graphicFixture=()=>({id:'formula',type:'image',x:100,y:100,width:60,height:40,text:'',math:'',fill:'none',stroke:'#18233b',...plain(mapping),image:{src:fixtureRaster.src,width:3,height:2,alt:'数学图形'},formulaGraphic:{version:1,originalMath:'y=ax',currentMath:'y=ax',semanticStatus:'source-aligned',originalImage:{src:fixtureRaster.src,width:3,height:2},renderer:{name:'MathJax SVG',version:'3.2.2'},edits:[]}});

test('套索只识别穿过圈内的笔迹段，圈外两段、映射、原稿与连线绑定保持',async()=>{
 const link={id:'link',type:'arrow',x:100,y:350,width:100,height:100,from:'ink',text:'关联原笔迹'},r=runtime([pen,link]),before=plain(r.api.board);
 r.api.setTool('lasso');await r.pointer('pointerdown',200,330);await r.pointer('pointermove',300,330);await r.pointer('pointermove',300,370);await r.pointer('pointermove',200,370);await r.pointer('pointerup',200,370);
 assert.equal(r.api.graphics.slices.length,1);const slices=plain(r.api.graphics.slices[0]);assert.equal(slices.inside.length,1);assert.equal(slices.outside.length,2);assert.equal(r.node('world').innerHTML.includes('lasso-region'),true);
 await r.fire('recognize-lasso-math','click');r.node('ink-result').value='y=ax';await r.fire('ink-result','input');const candidate=await r.api.math.applyInkResult();
 assert.equal(candidate.type,'image');assert.equal(candidate.x,200);assert.equal(candidate.y,330);assert.notEqual(candidate.id,'ink');assert.deepEqual(plain(candidate.recognition.rawElements),[pen]);assert.deepEqual(plain(candidate.recognition.region),middleInkRegion);
 const outside=r.api.board.elements.filter(e=>e.type==='pen');assert.deepEqual(plain(outside),slices.outside);for(const e of outside){assert.deepEqual(plain(e.anchors),mapping.anchors);assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.custom),mapping.custom)}
 assert.equal(r.api.board.elements.find(e=>e.id==='link').from,'ink');assert.equal(boardDiagnostics(plain(r.api.board)).length,0);const confirmed=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),confirmed);
});

test('圈选中文只替换圈内笔迹为文字，原处圈外笔迹不动且撤销完整恢复',async()=>{
 const r=runtime([pen]),before=plain(r.api.board);await openLasso(r,middleInkRegion,'text');const outside=plain(r.api.graphics.slices[0].outside);r.node('ink-result').value='输入检查';await r.fire('ink-result','input');const candidate=await r.api.math.applyInkResult();
 assert.equal(candidate.type,'text');assert.equal(candidate.text,'输入检查');assert.equal(candidate.x,200);assert.equal(candidate.y,330);assert.deepEqual(plain(r.api.board.elements.filter(e=>e.type==='pen')),outside);assert.deepEqual(plain(candidate.recognition.rawElements),[pen]);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

test('多条圈内笔迹识别合并源码锚点，所有原映射与未知字段都留在原稿记录',async()=>{
 const second={...plain(pen),id:'second',y:360,anchors:[...mapping.anchors,{file:'lib/render.js',sha256:'b'.repeat(64),role:'implementation'}],implementation:{language:'JavaScript',code:'secondStep()',note:'另一步'},custom:{second:true}},r=runtime([pen,second]);
 await recognize(r);const e=r.api.board.elements[0];assert.equal(e.type,'image');assert.deepEqual(plain(e.anchors),second.anchors);assert.deepEqual(plain(e.recognition.rawElements),[pen,second]);assert.equal(e.recognition.mappings.length,2);assert.deepEqual(plain(e.recognition.mappings[1].implementation),second.implementation);assert.deepEqual(plain(e.recognition.mappings[1].custom),second.custom);
});

test('关闭识别面板使正在等待PNG的确认失效，不在关闭后替换笔迹或新增撤销记录',async()=>{
 const work=deferred(),r=runtime([pen],{raster:()=>work.promise}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='此前已确认的修改'});const before=plain(r.api.board);await openLasso(r);r.node('ink-result').value='y=ax';const pending=r.api.math.applyInkResult();await Promise.resolve();await r.fire('ink-close','click');work.resolve(plain(fixtureRaster));
 assert.equal(await pending,false);assert.equal(r.node('ink-dialog').open,false);assert.deepEqual(plain(r.api.board),before);assert.ok([...r.storage.keys()].some(k=>k.endsWith(':handwriting')));r.api.undo();assert.deepEqual(plain(r.api.board),initial);
});

test('PNG准备期间移动原笔迹或切换选定版本，旧识别结果保留但拒绝应用',async()=>{
 for(const change of ['ink','version']){
  const work=deferred();let revision='selected-1';const r=runtime([pen],{raster:()=>work.promise,fetch:async path=>path.startsWith('/api/versions')?response({ok:true,selected:{id:'saved',revision},versions:[]}):response({service:'anatomy-handwriting',ready:true})});await r.api.versions.refresh();await openLasso(r);r.node('ink-result').value='y=ax';const pending=r.api.math.applyInkResult();await Promise.resolve();
  if(change==='ink')r.api.change(()=>{r.api.board.elements[0].x+=10});else{revision='selected-2';await r.api.versions.refresh()}
  const current=plain(r.api.board);work.resolve(plain(fixtureRaster));assert.equal(await pending,false);assert.deepEqual(plain(r.api.board),current);assert.equal(r.node('ink-dialog').open,true);assert.equal(r.node('ink-result').value,'y=ax');assert.match(r.node('ink-feedback').textContent,/变化|取消/);
 }
});

test('同一公式数据但另一历史的对象引用已替换，旧图形转换不能splice最后一个部位',async()=>{
 const printed={...plain(rect),id:'printed',type:'math',text:'',mathExpressions:[]},other={id:'other',type:'text',x:500,y:100,width:180,height:60,text:'另一部位'},work=deferred(),r=runtime([printed,other],{raster:()=>work.promise});
 const pending=r.api.graphics.prepare('printed','primary');r.api.change(()=>{r.api.board.elements=plain(r.api.board.elements);r.api.board.elements[1].text='另一历史版本的说明'});const current=plain(r.api.board);work.resolve(plain(fixtureRaster));await assert.rejects(pending,/原公式|版本.*变化/);assert.deepEqual(plain(r.api.board),current);assert.equal(r.api.board.elements[1].id,'other');assert.equal(new Set(r.api.board.elements.map(e=>e.id)).size,2);
});

test('图形转换等待时撤销排在转换事务之后，重做恢复PNG及原公式来源',async()=>{
 const printed={...plain(rect),id:'printed',type:'math',text:'',mathExpressions:[]},work=deferred(),r=runtime([printed],{graphics:true,raster:()=>work.promise}),before=plain(r.api.board),v=r.api.view;
 await r.fire('surface','dblclick',{clientX:200*v.scale+v.x,clientY:150*v.scale+v.y,target:r.target('printed','primary')});await Promise.resolve();r.api.undo();assert.deepEqual(plain(r.api.board),before);work.resolve(plain(fixtureRaster));await r.api.graphics.flush();await Promise.resolve();assert.deepEqual(plain(r.api.board),before);r.api.redo();const e=r.api.board.elements[0];assert.equal(e.type,'image');assert.equal(e.formulaGraphic.originalMath,'y=ax');assert.deepEqual(plain(e.formulaGraphic.sourceElement),printed);
});

test('异步橡皮的最终历史纳入队列，等待期间Undo随后可完整Redo',async()=>{
 const r=runtime([graphicFixture()],{graphics:true}),before=plain(r.api.board);r.api.setTool('eraser');await r.pointer('pointerdown',130,120,r.target('formula'));const ending=r.pointer('pointerup',130,120,r.target('formula'));await Promise.resolve();assert.equal(r.imageRequests.length,1);r.api.undo();r.releaseImages();await ending;await r.api.graphics.flush();await Promise.resolve();assert.deepEqual(plain(r.api.board),before);r.api.redo();const e=r.api.board.elements[0];assert.notEqual(e.image.src,before.elements[0].image.src);assert.equal(e.formulaGraphic.semanticStatus,'needs-review');assert.equal(e.formulaGraphic.currentMath,null);assert.equal(e.formulaGraphic.edits[0].kind,'erase');
});

test('取消正在等待解码的橡皮拖动恢复原图与原语义，不留下幽灵历史',async()=>{
 const r=runtime([graphicFixture()],{graphics:true}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='保留前一步'});const before=plain(r.api.board);r.api.setTool('eraser');await r.pointer('pointerdown',130,120,r.target('formula'));const canceled=r.pointer('pointercancel',130,120,r.target('formula'));await Promise.resolve();r.releaseImages();await canceled;await r.api.graphics.flush();assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
});

test('保存等待异步橡皮和最终history完成，写出的PNG与画板一致且可撤销',async()=>{
 let posted=null;const r=runtime([graphicFixture()],{graphics:true,fetch:async(path,options={})=>{if(path==='/api/versions'&&options.method==='POST')posted=JSON.parse(options.body);return path.startsWith('/api/versions')?response({ok:true,selected:{id:'saved',revision:'saved-revision'},versions:[]}):response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);await r.api.versions.refresh();r.api.setTool('eraser');await r.pointer('pointerdown',130,120,r.target('formula'));const ending=r.pointer('pointerup',130,120,r.target('formula')),saving=r.api.versions.save();await Promise.resolve();assert.equal(posted,null);r.releaseImages();await ending;assert.equal(await saving,true);assert.deepEqual(plain(posted.board),plain(r.api.board));assert.equal(posted.board.elements[0].formulaGraphic.semanticStatus,'needs-review');r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

test('补画的解码与finalization组成一个图形队列事务，等待时撤销不会错撤上一步',async()=>{
 const r=runtime([graphicFixture()],{graphics:true});r.api.change(()=>{r.api.board.elements[0].custom.prior='不会被本次撤销移除'});const before=plain(r.api.board);r.api.setTool('pen');await r.pointer('pointerdown',110,110);await r.pointer('pointermove',120,120);const ending=r.pointer('pointerup',120,120);await Promise.resolve();assert.equal(r.imageRequests.length,1);r.api.undo();r.releaseImages();await ending;await r.api.graphics.flush();await Promise.resolve();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.equal(r.api.board.elements.length,1);assert.equal(r.api.board.elements[0].formulaGraphic.semanticStatus,'needs-review');assert.equal(r.api.board.elements[0].formulaGraphic.edits[0].kind,'ink');assert.equal(r.api.board.elements[0].formulaGraphic.edits[0].rawElement.type,'pen');
});

test('圈选预览捕获未完成时关闭或保留原稿，晚到的预览不能重新打开或改动画板',async()=>{
 for(const action of ['ink-close','ink-keep']){
  const work=deferred(),r=runtime([pen],{capture:()=>work.promise}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='本次预览前的修改'});const before=plain(r.api.board);
  r.api.graphics.lasso(fullInkRegion);const opening=r.fire('recognize-lasso-math','click'),session=r.api.math.lassoSession;assert.equal(session.capturing,true);assert.equal(r.node('ink-recognize').disabled,true);assert.equal(r.node('ink-result').disabled,true);assert.deepEqual(plain(r.api.board),before);
  await r.fire(action,'click');work.resolve(fixtureCapture(session));assert.deepEqual(await opening,[false]);assert.equal(r.node('ink-dialog').open,false);assert.equal(r.api.math.lassoSession,null);assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
 }
});

test('圈选预览捕获期间原稿或选定版本变化，陈旧图片不能成为可确认预览',async()=>{
 for(const stale of ['ink','version']){
  const work=deferred();let revision='selected-1';const r=runtime([pen],{capture:()=>work.promise,fetch:async path=>path.startsWith('/api/versions')?response({ok:true,selected:{id:'saved',revision},versions:[]}):response({service:'anatomy-handwriting',ready:true})});await r.api.versions.refresh();r.api.graphics.lasso(fullInkRegion);const opening=r.fire('recognize-lasso-math','click'),session=r.api.math.lassoSession;
  if(stale==='ink')r.api.change(()=>{r.api.board.elements[0].x+=10});else{revision='selected-2';await r.api.versions.refresh()}const current=plain(r.api.board);work.resolve(fixtureCapture(session));assert.deepEqual(await opening,[false]);assert.equal(session.image,undefined);assert.equal(session.captureError,true);assert.equal(r.node('ink-recognize').disabled,true);assert.deepEqual(plain(r.api.board),current);assert.match(r.node('ink-feedback').textContent,/变化/);
 }
});

const middleGraphicRegion=[{x:120,y:110},{x:145,y:110},{x:145,y:135},{x:120,y:135}];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('圈选PNG公式保留圈外图形，识别结果在圈选位置生成且原图和映射可撤销恢复',async()=>{
 const r=runtime([graphicFixture()]);r.api.change(()=>{r.api.board.layout.mode='auto'});const before=plain(r.api.board);await openLasso(r,middleGraphicRegion);assert.equal(r.api.math.lassoSession.slices[0].graphic,true);assert.match(r.node('ink-paths').innerHTML,/<image href="data:image\/png;base64,/);
 r.node('ink-result').value='x^2';await r.fire('ink-result','input');const applying=r.api.math.applyInkResult();await settle();assert.equal(r.imageRequests.length,1);assert.deepEqual(plain(r.api.board),before);r.releaseImages();const candidate=await applying;
 assert.equal(candidate.type,'image');assert.equal(candidate.x,120);assert.equal(candidate.y,110);assert.notEqual(candidate.id,'formula');assert.equal(candidate.formulaGraphic.currentMath,'x^2');assert.deepEqual(plain(candidate.recognition.rawElements),before.elements);assert.deepEqual(plain(candidate.anchors),mapping.anchors);const outside=r.api.board.elements.find(e=>e.id==='formula');assert.notEqual(outside.image.src,before.elements[0].image.src);assert.equal(outside.formulaGraphic.semanticStatus,'needs-review');assert.equal(outside.formulaGraphic.currentMath,null);assert.equal(outside.formulaGraphic.edits.at(-1).kind,'crop');assert.deepEqual(plain(outside.formulaGraphic.originalImage),before.elements[0].formulaGraphic.originalImage);assert.deepEqual(plain(outside.implementation),mapping.implementation);assert.equal(r.api.board.layout.mode,'manual');assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const confirmed=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),confirmed);
});

test('裁剪圈外PNG等待解码时取消或改候选结果，真实图像和自动布局不提前改变',async()=>{
 for(const stale of ['close','result']){
  const r=runtime([graphicFixture()]),initial=plain(r.api.board);r.api.change(()=>{r.api.board.layout.mode='auto';r.api.board.elements[0].custom.prior='此前已确认的修改'});const before=plain(r.api.board);await openLasso(r,middleGraphicRegion);r.node('ink-result').value='x^2';await r.fire('ink-result','input');const applying=r.api.math.applyInkResult();await settle();assert.equal(r.imageRequests.length,1);assert.deepEqual(plain(r.api.board),before);
  if(stale==='close')await r.fire('ink-close','click');else{r.node('ink-result').value='x^3';await r.fire('ink-result','input')}r.releaseImages();assert.equal(await applying,false);assert.deepEqual(plain(r.api.board),before);assert.match(r.node('ink-feedback').textContent,/取消|变化/);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
 }
});

test('PNG识别准备时回到另一历史，即使圈内笔迹相同也拒绝在新画板应用旧事务',async()=>{
 const sibling={id:'other',type:'text',x:500,y:100,width:180,height:60,text:'初始说明'},work=deferred(),r=runtime([pen,sibling],{raster:()=>work.promise}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[1].text='此前修改的说明'});const prior=plain(r.api.board);await openLasso(r);r.node('ink-result').value='y=ax';const applying=r.api.math.applyInkResult();r.api.undo();assert.deepEqual(plain(r.api.board),initial);work.resolve(plain(fixtureRaster));assert.equal(await applying,false);assert.deepEqual(plain(r.api.board),initial);assert.match(r.node('ink-feedback').textContent,/变化|取消/);r.api.redo();assert.deepEqual(plain(r.api.board),prior);
});

test('同一识别结果异步确认期间重复点击不会重复插入PNG或产生两步历史',async()=>{
 const work=deferred(),r=runtime([pen],{raster:()=>work.promise}),before=plain(r.api.board);await openLasso(r);r.node('ink-result').value='y=ax';const applying=r.api.math.applyInkResult();assert.equal(await r.api.math.applyInkResult(),false);assert.equal(r.node('ink-apply').disabled,true);work.resolve(plain(fixtureRaster));const candidate=await applying;assert.equal(candidate.type,'image');assert.equal(r.api.board.elements.length,1);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

test('同圈的公式PNG与笔迹一起预览和识别，两个来源与圈外剩余内容均保留',async()=>{
 const nearbyPen={...plain(pen),id:'nearby',x:90,y:120,width:100},region=[{x:115,y:105},{x:150,y:105},{x:150,y:135},{x:115,y:135}];let captureSources;
 const r=runtime([graphicFixture(),nearbyPen],{capture:async session=>{captureSources=plain(session.slices);return fixtureCapture(session)}}),before=plain(r.api.board);await openLasso(r,region);assert.equal(captureSources.length,2);assert.equal(captureSources[0].graphic,true);assert.equal(captureSources[1].inside.length,1);const outsidePen=plain(captureSources[1].outside);
 r.node('ink-result').value='x+1';await r.fire('ink-result','input');const applying=r.api.math.applyInkResult();await settle();r.releaseImages();const candidate=await applying;assert.equal(candidate.type,'image');assert.deepEqual(plain(candidate.recognition.rawElements),before.elements);assert.equal(candidate.recognition.mappings.length,2);assert.deepEqual(plain(candidate.anchors),mapping.anchors);assert.deepEqual(plain(r.api.board.elements.filter(e=>e.type==='pen')),outsidePen);assert.ok(r.api.board.elements.find(e=>e.id==='formula'&&e.formulaGraphic.semanticStatus==='needs-review'));assert.equal(boardDiagnostics(plain(r.api.board)).length,0);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

function displayedContentSlots(r,element,specs,surface='element'){
 const angle=(surface==='relation-label'?0:element.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),center={x:element.x+element.width/2,y:element.y+element.height/2},rotate=p=>({x:center.x+(p.x-center.x)*cos-(p.y-center.y)*sin,y:center.y+(p.x-center.x)*sin+(p.y-center.y)*cos});
 const displayed=specs.map(spec=>{const scale=spec.scales.reduce((a,b)=>a*b,1),width=spec.width*scale,height=spec.height*scale,worldCenter=rotate({x:spec.x+width/2,y:spec.y+height/2}),corners=[[spec.x,spec.y],[spec.x+width,spec.y],[spec.x+width,spec.y+height],[spec.x,spec.y+height]].map(([x,y])=>rotate({x,y})),v=r.api.view;
  const foreign={tagName:'foreignObject'},parents=spec.scales.reduceRight((parent,s)=>({style:{transform:`matrix(${s},0,0,${s},0,0)`},parentElement:parent}),foreign),n={offsetWidth:spec.width,offsetHeight:spec.height,style:{fontSize:spec.fontSize+'px',transform:'none'},parentElement:parents,getAttribute:k=>k==='data-expression'&&spec.part!=='text'?spec.part:null,querySelector:()=>null,closest:selector=>selector==='foreignObject'?foreign:null,getBoundingClientRect:()=>({left:Math.min(...corners.map(p=>p.x))*v.scale+v.x,top:Math.min(...corners.map(p=>p.y))*v.scale+v.y,right:Math.max(...corners.map(p=>p.x))*v.scale+v.x,bottom:Math.max(...corners.map(p=>p.y))*v.scale+v.y})};return {...spec,width,height,fontSize:spec.fontSize*scale,worldCenter,n};
 });
 r.node('world').querySelectorAll=selector=>selector.includes(`g.${surface}[data-id="${element.id}"]`)?displayed.map(s=>s.n):[];return displayed;
}
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} should equal ${expected}`);
const assertDisplayedPart=(element,slot,width=slot.width,height=slot.height)=>{near(element.x,slot.worldCenter.x-width/2);near(element.y,slot.worldCenter.y-height/2);near(element.width,width);near(element.height,height);near(element.fontSize,slot.fontSize)};

test('复合框转PNG时正文和全部公式按真实显示槽位拆开，空框保留导读名称而不重新居中',async()=>{
 const source={...plain(rect),type:'frame',width:400,height:260,text:'处理输入\n保持原显示位置',extension:{sourceKey:'完整保存'}},calls=[],r=runtime([source],{raster:async(value,options)=>{calls.push({value,...options});return plain(fixtureRaster)}}),slots=displayedContentSlots(r,source,[{part:'text',x:124,y:121,width:220,height:36,fontSize:30,scales:[.8]},{part:'primary',x:160,y:174,width:100,height:56,fontSize:32,scales:[.75]},{part:'extra',x:250,y:224,width:120,height:60,fontSize:40,scales:[.6]}]);
 const selected=await r.api.graphics.prepare('box','primary'),elements=r.api.board.elements,parent=elements.find(e=>e.id==='box'),text=elements.find(e=>e.type==='text'),primary=elements.find(e=>e.expressionOrigin==='primary'),extra=elements.find(e=>e.expressionOrigin==='extra');
 assert.equal(elements.length,4);assert.equal(parent.type,'frame');assert.equal(parent.text,'');assert.equal(parent.math,'');assert.equal(parent.mathExpressions,undefined);assert.equal(parent.sourceTitle,'处理输入');for(const key of ['x','y','width','height'])assert.equal(parent[key],source[key]);assert.equal(selected.id,primary.id);assert.equal(text.text,source.text);assertDisplayedPart(text,slots[0]);assertDisplayedPart(primary,slots[1],63,42);assertDisplayedPart(extra,slots[2],54,36);assert.deepEqual(calls,[{value:'y=ax',fontSize:24},{value:'x>0',fontSize:24}]);
 assert.equal(primary.type,'image');assert.equal(extra.type,'image');assert.deepEqual(plain(extra.metadata),{keep:true});for(const e of elements){assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.anchors),mapping.anchors);assert.deepEqual(plain(e.custom),mapping.custom);assert.deepEqual(plain(e.extension),source.extension)}for(const image of [primary,extra]){assert.deepEqual(plain(image.formulaGraphic.sourceElement),source);assert.equal(image.formulaGraphic.expressionId,image.expressionOrigin);assert.equal(image.derivedFrom,'box');assert.equal(image.math,'');assert.match(image.image.src,/^data:image\/png;base64,/)}assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});

test('旋转且嵌套CSS缩放的复合框拆分只旋转一次，保留未旋转尺寸和显示字号',async()=>{
 const source={...plain(rect),type:'frame',width:400,height:260,rotation:37,fontSize:18},r=runtime([source]),slots=displayedContentSlots(r,source,[{part:'text',x:124,y:121,width:240,height:48,fontSize:40,scales:[.8,.75]},{part:'primary',x:160,y:174,width:125,height:70,fontSize:40,scales:[.8,.75]},{part:'extra',x:250,y:224,width:120,height:60,fontSize:40,scales:[.8,.75]}]);
 await r.api.graphics.prepare('box','extra');const elements=r.api.board.elements,parent=elements.find(e=>e.id==='box'),text=elements.find(e=>e.type==='text'),primary=elements.find(e=>e.expressionOrigin==='primary'),extra=elements.find(e=>e.expressionOrigin==='extra');assert.equal(elements.length,4);assert.equal(parent.rotation,37);assertDisplayedPart(text,slots[0]);assertDisplayedPart(primary,slots[1],63,42);assertDisplayedPart(extra,slots[2],54,36);for(const e of [text,primary,extra]){assert.equal(e.rotation,37);assert.equal(e.derivedFrom,'box');assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.anchors),mapping.anchors)}near(text.width,144);near(text.height,28.8);near(text.fontSize,24);assert.equal(primary.formulaGraphic.expressionId,'primary');assert.equal(extra.formulaGraphic.expressionId,'extra');assert.deepEqual(plain(extra.formulaGraphic.sourceElement),source);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});

test('水平连线的公式从relation-label真实槽位转换，保留原关系名称且不复制正文',async()=>{
 for(const type of ['line','arrow']){
  const source={...plain(mapping),id:'named-arrow',type,x:100,y:100,width:300,height:0,text:'交付处理结果',math:'y=ax',extension:{sourceKey:'原关系映射'}},r=runtime([source]),slots=displayedContentSlots(r,source,[{part:'text',x:320,y:72,width:200,height:30,fontSize:22,scales:[1]},{part:'primary',x:360,y:108,width:80,height:40,fontSize:28,scales:[.75]}],'relation-label'),nameBefore=r.evaluate("relationName(get('named-arrow'),A.flows)");
  const image=await r.api.graphics.prepare('named-arrow','primary'),parent=r.api.board.elements.find(e=>e.id==='named-arrow');assert.equal(r.api.board.elements.length,2);assert.equal(parent.type,type);assert.equal(parent.text,'交付处理结果');assert.equal(parent.math,'');assert.equal(parent.mathExpressions,undefined);assert.equal(r.evaluate("relationName(get('named-arrow'),A.flows)"),nameBefore);assert.equal(r.api.board.elements.filter(e=>e.type==='text').length,0);for(const key of ['x','y','width','height'])assert.equal(parent[key],source[key]);assertDisplayedPart(image,slots[1],45,30);assert.equal(image.rotation,0);assert.equal(image.type,'image');assert.deepEqual(plain(image.formulaGraphic.sourceElement),source);assert.deepEqual(plain(parent.extension),source.extension);assert.deepEqual(plain(image.extension),source.extension);assert.deepEqual(plain(image.anchors),mapping.anchors);assert.deepEqual(plain(image.implementation),mapping.implementation);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 }
});

test('箭头旋转不旋转独立关系标签，两个公式保持标签显示位置、字号和来源',async()=>{
 const source={...plain(rect),id:'named-arrow',type:'arrow',width:300,height:120,rotation:37,text:'交付处理结果'},r=runtime([source]),slots=displayedContentSlots(r,source,[{part:'text',x:450,y:170,width:200,height:30,fontSize:24,scales:[1]},{part:'primary',x:475,y:208,width:125,height:70,fontSize:40,scales:[.8,.75]},{part:'extra',x:510,y:256,width:120,height:60,fontSize:40,scales:[.8,.75]}],'relation-label');
 const selected=await r.api.graphics.prepare('named-arrow','extra'),parent=r.api.board.elements.find(e=>e.id==='named-arrow'),primary=r.api.board.elements.find(e=>e.expressionOrigin==='primary'),extra=r.api.board.elements.find(e=>e.expressionOrigin==='extra');assert.equal(r.api.board.elements.length,3);assert.equal(parent.text,source.text);assert.equal(parent.rotation,37);assert.equal(r.evaluate("relationName(get('named-arrow'),A.flows)"),source.text);assert.equal(selected.id,extra.id);assertDisplayedPart(primary,slots[1],63,42);assertDisplayedPart(extra,slots[2],54,36);for(const image of [primary,extra]){assert.equal(image.rotation,0);near(image.fontSize,24);assert.equal(image.derivedFrom,'named-arrow');assert.deepEqual(plain(image.formulaGraphic.sourceElement),source);assert.deepEqual(plain(image.implementation),mapping.implementation);assert.deepEqual(plain(image.anchors),mapping.anchors)}assert.deepEqual(plain(extra.metadata),{keep:true});assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
});

test('非等比缩放公式沿边补画仍为世界3px，横纵扩边分别留足且一次撤销恢复原图',async()=>{
 const source={...graphicFixture(),width:60,height:80,image:{src:fixturePNG(120,40),width:120,height:40,alt:'数学图形'}};source.formulaGraphic.originalImage={src:source.image.src,width:120,height:40};
 const r=runtime([source],{graphics:true}),before=plain(r.api.board);Object.assign(r.api.view,{x:0,y:0,scale:1});r.api.setTool('pen');await r.pointer('pointerdown',102,100);await r.pointer('pointermove',158,100);const raw=plain(r.api.board.elements.find(e=>e.type==='pen')),ending=r.pointer('pointerup',158,100);await settle();r.releaseImages();await ending;await r.api.graphics.flush();
 const e=r.api.board.elements[0],paint=r.canvasLog.find(op=>op.kind==='stroke'),edit=e.formulaGraphic.edits[0];assert.equal(r.api.board.elements.length,1);assert.ok(paint);assert.deepEqual(paint.matrix,[2,0,0,.5,1,3]);assert.equal(paint.lineWidth,3);assert.deepEqual(paint.path,[{kind:'move',x:2,y:0},{kind:'line',x:58,y:0}]);assert.equal(e.image.width,122);assert.equal(e.image.height,43);near(paint.lineWidth*paint.matrix[0]*e.width/e.image.width,3);near(paint.lineWidth*paint.matrix[3]*e.height/e.image.height,3);assert.deepEqual(plain(edit.points),[[5,3],[117,3]]);assert.deepEqual(plain(edit.pixelScale),{x:2,y:.5});assert.deepEqual(plain(edit.imageOffset),{x:1,y:3});assert.equal(edit.strokeWidth,3);assert.equal(edit.strokeWidthSpace,'world');assert.deepEqual(plain(edit.rawElement),raw);assert.deepEqual(plain(edit.sourceGeometry),{x:100,y:100,width:60,height:80,rotation:0});assert.deepEqual(plain(e.formulaGraphic.originalImage),source.formulaGraphic.originalImage);assert.deepEqual(plain(e.implementation),mapping.implementation);assert.deepEqual(plain(e.anchors),mapping.anchors);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const merged=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),merged);
});

test('旋转非等比公式的单点补画绘制圆点，扩边后世界位置不漂移且原笔迹可撤销',async()=>{
 const source={...graphicFixture(),width:60,height:80,rotation:30,image:{src:fixturePNG(120,40),width:120,height:40,alt:'数学图形'}};source.formulaGraphic.originalImage={src:source.image.src,width:120,height:40};
 const r=runtime([source],{graphics:true}),before=plain(r.api.board),point=localToWorld(source,{x:160,y:180});Object.assign(r.api.view,{x:0,y:0,scale:1});r.api.setTool('pen');await r.pointer('pointerdown',point.x,point.y);r.evaluate('get(drag.id).points=[[0,0],[0,0]]');const raw=plain(r.api.board.elements.find(e=>e.type==='pen')),ending=r.pointer('pointerup',point.x,point.y);await settle();r.releaseImages();await ending;await r.api.graphics.flush();
 const e=r.api.board.elements[0],paint=r.canvasLog.find(op=>op.kind==='fill'),edit=e.formulaGraphic.edits[0];assert.equal(r.api.board.elements.length,1);assert.ok(paint);assert.equal(r.canvasLog.filter(op=>op.kind==='stroke').length,0);assert.deepEqual(paint.matrix,[2,0,0,.5,0,0]);assert.equal(paint.path.length,1);assert.equal(paint.path[0].kind,'arc');near(paint.path[0].x,60);near(paint.path[0].y,80);near(paint.path[0].radius,1.5);assert.equal(e.rotation,30);near(e.image.width,125);near(e.image.height,43);near(paint.path[0].radius*2*paint.matrix[0]*e.width/e.image.width,3);near(paint.path[0].radius*2*paint.matrix[3]*e.height/e.image.height,3);
 const pixel=edit.points[0],resultPoint=localToWorld(e,{x:e.x+pixel[0]*e.width/e.image.width,y:e.y+pixel[1]*e.height/e.image.height});near(resultPoint.x,point.x);near(resultPoint.y,point.y);const oldCorner=localToWorld(source,{x:source.x,y:source.y}),newCorner=localToWorld(e,{x:e.x,y:e.y});near(oldCorner.x,newCorner.x);near(oldCorner.y,newCorner.y);assert.deepEqual(plain(edit.rawElement),raw);assert.deepEqual(plain(edit.sourceGeometry),{x:100,y:100,width:60,height:80,rotation:30});assert.deepEqual(plain(e.custom),mapping.custom);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const merged=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),merged);
});

test('水平箭头旧公式直接补画使用关系标签世界槽位，名称源码与一步撤销完整保留',async()=>{
 const source={...plain(mapping),id:'named-arrow',type:'arrow',x:100,y:100,width:300,height:0,text:'交付处理结果',math:'y=ax',extension:{sourceKey:'原关系映射'}},r=runtime([source],{graphics:true}),before=plain(r.api.board);Object.assign(r.api.view,{x:0,y:0,scale:1});displayedContentSlots(r,source,[{part:'text',x:320,y:72,width:200,height:30,fontSize:22,scales:[1]},{part:'primary',x:360,y:108,width:80,height:40,fontSize:28,scales:[.75]}],'relation-label');
 r.api.setTool('pen');await r.pointer('pointerdown',380,123);await r.pointer('pointermove',400,123);const raw=plain(r.api.board.elements.find(e=>e.type==='pen')),ending=r.pointer('pointerup',400,123);await settle();assert.equal(r.imageRequests.length,1);r.releaseImages();await ending;await r.api.graphics.flush();
 const parent=r.api.board.elements.find(e=>e.id==='named-arrow'),image=r.api.board.elements.find(e=>e.formulaGraphic);assert.equal(r.api.board.elements.length,2);assert.equal(parent.text,source.text);assert.equal(parent.height,0);assert.equal(parent.math,'');assert.equal(r.evaluate("relationName(get('named-arrow'),A.flows)"),source.text);assert.equal(r.api.board.elements.filter(e=>e.type==='text'||e.type==='pen').length,0);assert.ok(image);assert.equal(image.rotation,0);assert.equal(image.formulaGraphic.semanticStatus,'needs-review');assert.deepEqual(plain(image.formulaGraphic.sourceElement),source);assert.deepEqual(plain(image.formulaGraphic.edits[0].rawElement),raw);assert.deepEqual(plain(image.implementation),mapping.implementation);assert.deepEqual(plain(image.anchors),mapping.anchors);assert.deepEqual(plain(image.extension),source.extension);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);
 const merged=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),merged);
});

const lassoRuntime=(elements=[rect,pen])=>{const r=runtime(elements,{lassoUI:true});Object.assign(r.api.view,{x:0,y:0,scale:1});return r};
async function dragLasso(r,points,target=r.target('box'),pointerId=1){await r.pointer('pointerdown',...points[0],target,{pointerId});for(const p of points.slice(1,-1))await r.pointer('pointermove',...p,target,{pointerId});await r.pointer('pointerup',...points.at(-1),target,{pointerId})}
const rectLasso=[[90,90],[410,90],[410,290],[90,290]];
const penLasso=[[90,330],[410,330],[410,370],[90,370]];

test('进入套索清除旧选择与控制框，图元和关系标签不保留移动或悬停交互层',()=>{
 const link={id:'link',type:'arrow',x:100,y:300,width:300,height:0,text:'传递结果'},r=lassoRuntime([rect,link]),before=plain(r.api.board);r.api.select('box');assert.match(r.node('world').innerHTML,/data-resize=/);r.api.setTool('lasso');assert.deepEqual(plain(r.api.selected),[]);assert.equal(r.node('surface').classList.contains('lasso-mode'),true);assert.equal(r.node('world').innerHTML.includes('data-resize='),false);assert.equal(r.node('world').innerHTML.includes('selected-outline'),false);assert.equal(r.node('canvas-tools').hidden,true);assert.equal(r.evaluate('canvasTap'),null);assert.deepEqual(plain(r.api.board),before);
});

test('保持套索工具连续圈选，从矩形正文公式或任何旧控制点下笔均不移动变形或打开编辑',async()=>{
 const r=lassoRuntime(),before=plain(r.api.board);r.api.setTool('lasso');await dragLasso(r,rectLasso);assert.equal(r.evaluate('tool'),'lasso');assert.equal(r.node('world').innerHTML.includes('data-resize='),false);assert.equal(r.node('world').innerHTML.includes('selected-outline'),false);
 for(const target of [r.target('box'),r.target('box','text'),r.target('box','primary'),r.handle('resize','box','nw'),r.handle('rotate','box','box'),r.handle('vertex','box','0'),r.handle('endpoint','box','to')]){await dragLasso(r,[[250,190],[430,190],[430,300],[250,300]],target);assert.equal(r.evaluate('tool'),'lasso');assert.deepEqual(plain(r.api.board),before);assert.equal(r.api.canvas.draft,null);assert.equal(r.node('inline-writing').hidden,true);assert.equal(r.node('formula-dialog').open,false);assert.equal(r.node('program-dialog').open,false);assert.deepEqual(plain(r.api.graphics.region[0]),{x:250,y:190})}
});

test('短点击和双击套索不留逐点顶点或触发图元编辑，下一次按住拖动独立自动闭合',async()=>{
 const r=lassoRuntime(),before=plain(r.api.board);r.api.setTool('lasso');for(let i=0;i<2;i++){await r.pointer('pointerdown',150,160,r.target('box','text'));await r.pointer('pointerup',150,160,r.target('box','text'));await r.fire('surface','click',{clientX:150,clientY:160,target:r.target('box','text')})}await r.fire('surface','dblclick',{clientX:150,clientY:160,target:r.target('box','text')});await r.dispatchDocument('keydown',{key:'Enter'});assert.equal(r.evaluate('tool'),'lasso');assert.equal(r.api.graphics.region,null);assert.deepEqual(plain(r.api.selected),[]);assert.equal(r.api.canvas.draft,null);
 await dragLasso(r,penLasso,r.target('box'));assert.deepEqual(plain(r.api.graphics.region),penLasso.map(([x,y])=>({x,y})));await r.fire('surface','dblclick',{clientX:200,clientY:350,target:r.target('ink')});assert.equal(r.evaluate('tool'),'lasso');assert.equal(r.api.canvas.draft,null);assert.deepEqual(plain(r.api.board),before);
});

test('套索只消费同一指针，其他触点不截断或改写路径，cancel与丢失capture取消且仍可重新圈选',async()=>{
 const r=lassoRuntime(),before=plain(r.api.board);r.api.setTool('lasso');await r.pointer('pointerdown',90,330,r.target('box'),{pointerId:7});await r.pointer('pointermove',410,330,r.target('box'),{pointerId:7});await r.pointer('pointerdown',900,900,r.target('box'),{pointerId:9,isPrimary:false});await r.pointer('pointermove',900,920,r.target('box'),{pointerId:9});await r.pointer('pointerup',900,920,r.target('box'),{pointerId:9});await r.pointer('pointercancel',900,920,r.target('box'),{pointerId:9});await r.fire('surface','lostpointercapture',{pointerId:9});assert.equal(r.evaluate('drag?.kind'),'lasso');await r.pointer('pointermove',410,370,r.target('box'),{pointerId:7});await r.pointer('pointerup',90,370,r.target('box'),{pointerId:7});assert.deepEqual(plain(r.api.graphics.region),penLasso.map(([x,y])=>({x,y})));
 for(const cancel of ['pointercancel','lostpointercapture']){await r.pointer('pointerdown',100,100,r.target('box'),{pointerId:12});await r.pointer('pointermove',400,100,r.target('box'),{pointerId:12});await r.fire('surface',cancel,{pointerId:12});assert.equal(r.evaluate('drag'),null);assert.equal(r.api.graphics.region,null);assert.deepEqual(plain(r.api.selected),[]);assert.equal(r.evaluate('tool'),'lasso');await dragLasso(r,penLasso,r.target('box'),14);assert.ok(r.api.graphics.region)}assert.deepEqual(plain(r.api.board),before);
});

test('套索保留coalesced曲线和最后pointerup位置，坐标按画板缩放转换且样本数量有限',async()=>{
 const r=lassoRuntime([]);Object.assign(r.api.view,{x:35,y:45,scale:2});r.api.setTool('lasso');const sample=(x,y)=>({clientX:35+x*2,clientY:45+y*2,pointerId:11});await r.pointer('pointerdown',0,0,undefined,{pointerId:11});await r.pointer('pointermove',100,100,undefined,{pointerId:11,getCoalescedEvents:()=>[sample(100,0),sample(100,100)]});await r.pointer('pointerup',0,100,undefined,{pointerId:11});assert.deepEqual(plain(r.api.graphics.region),[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
 const many=lassoRuntime([]);many.api.setTool('lasso');await many.pointer('pointerdown',0,0);await many.pointer('pointermove',100210,30,undefined,{getCoalescedEvents:()=>Array.from({length:10020},(_,i)=>({clientX:(i+1)*10,clientY:i%2?30:0,pointerId:1}))});assert.ok(many.evaluate('drag.points.length')<=10000);await many.pointer('pointerup',0,30);assert.ok(many.api.graphics.region.length<=10000);
});

test('按住圈选期间滚轮和选择编辑快捷键隔离，Escape只取消圈且不新增全局修改历史',async()=>{
 const r=lassoRuntime(),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='此前的修改'});const before=plain(r.api.board);r.api.setTool('lasso');await r.pointer('pointerdown',90,330);await r.pointer('pointermove',410,330);const view=plain(r.api.view),path=r.evaluate('JSON.stringify(drag.points)');let prevented=0;await r.fire('surface','wheel',{deltaY:800,clientX:400,clientY:300,preventDefault(){prevented++}});for(const event of [{key:'a',ctrlKey:true},{key:'d',ctrlKey:true},{key:'z',ctrlKey:true},{key:'y',ctrlKey:true},{key:'Delete'},{key:'Backspace'},{key:'ArrowRight'},{key:'r'},{key:'v'},{key:'Enter'},{key:' ',code:'Space'}])await r.dispatchDocument('keydown',event);assert.equal(prevented,1);assert.deepEqual(plain(r.api.view),view);assert.deepEqual(plain(r.api.board),before);assert.deepEqual(plain(r.api.selected),[]);assert.equal(r.evaluate('JSON.stringify(drag.points)'),path);assert.equal(r.evaluate('tool'),'lasso');assert.equal(r.evaluate('space'),false);
 await r.dispatchDocument('keydown',{key:'Escape'});assert.equal(r.evaluate('drag'),null);assert.equal(r.api.graphics.region,null);assert.equal(r.evaluate('tool'),'lasso');assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
});

test('圈选完成只显示两个识别入口，普通图元操作关闭，显式选择工具才恢复控制点',async()=>{
 const r=lassoRuntime();r.api.setTool('lasso');await dragLasso(r,penLasso);assert.equal(r.evaluate('tool'),'lasso');assert.equal(r.node('canvas-tools').hidden,false);assert.equal(r.node('recognize-lasso-text').hidden,false);assert.equal(r.node('recognize-lasso-math').hidden,false);for(const button of Object.values(r.toolbarActions))assert.equal(button.hidden,true);for(const id of ['canvas-more','shape-kind','split-drawing','toggle-ink'])assert.equal(r.node(id).hidden,true);assert.equal(r.node('world').innerHTML.includes('data-resize='),false);
 r.api.setTool('select');assert.equal(r.node('surface').classList.contains('lasso-mode'),false);assert.equal(r.node('canvas-tools').hidden,false);assert.equal(r.toolbarActions.program.hidden,false);assert.equal(r.node('canvas-more').hidden,false);assert.match(r.node('world').innerHTML,/data-resize=/);r.api.setTool('lasso');await dragLasso(r,rectLasso);assert.equal(r.node('canvas-tools').hidden,false);assert.equal(r.node('recognize-lasso-text').hidden,false);assert.equal(r.node('recognize-lasso-math').hidden,false);
});

const visualText={id:'printed-text',type:'text',x:110,y:120,width:260,height:80,text:'输入检查与处理',fontSize:24,...plain(mapping)};
const visualMath={id:'printed-math',type:'math',x:110,y:120,width:260,height:80,text:'',math:'y=ax',fontSize:28,...plain(mapping)};
const visualImage={id:'native-image',type:'image',x:110,y:120,width:260,height:80,text:'',math:'',image:{src:fixtureRaster.src,width:3,height:2,alt:'原始截图'},extension:{sourceKey:'图片来源'},...plain(mapping)};
const allContentLasso=[[90,90],[410,90],[410,380],[90,380]];

test('普通文字、打印公式、图片、含正文公式的形状与混合圈选，左侧识别均先选类型且保留原内容',async()=>{
 for(const elements of [[visualText],[visualMath],[visualImage],[rect],[visualText,visualMath,visualImage,rect,pen]])for(const mode of ['text','math']){
  const posted=[],value=mode==='text'?'圈内内容':'x+1',r=runtime(elements,{lassoUI:true,fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push({method:options.method,...JSON.parse(options.body)});return response({ok:true,text:value,engine:'visual-choice-test'})}return response({service:'anatomy-handwriting',ready:true})}}),initial=plain(r.api.board);
  Object.assign(r.api.view,{x:0,y:0,scale:1});r.api.change(()=>{r.api.board.elements[0].custom.prior='识别前已确认的修改'});const before=plain(r.api.board);r.api.setTool('lasso');await dragLasso(r,allContentLasso,r.target(elements[0].id));const region=plain(r.api.graphics.region),sources=plain(r.api.graphics.slices);
  assert.equal(sources.length,elements.length);for(const slice of sources.filter(s=>s.original.type!=='pen')){assert.equal(slice.visual,true);assert.deepEqual(slice.outside,[slice.original]);assert.deepEqual(slice.inside,[])}
  await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);assert.equal(r.node('ink-dialog').open,false);assert.equal(posted.length,0);assert.deepEqual(plain(r.api.graphics.region),region);assert.match(r.node('world').innerHTML,/lasso-region/);
  await r.fire('ink-choice-'+mode,'click');assert.equal(r.node('ink-choice-dialog').open,false);assert.equal(r.node('ink-dialog').open,true);assert.equal(posted.length,1);assert.equal(posted[0].method,'POST');assert.equal(posted[0].mode,mode);assert.match(posted[0].image,/^data:image\/png;base64,/);assert.deepEqual(plain(r.api.graphics.region),region);assert.deepEqual(plain(r.api.board),before);
  const candidate=await r.api.math.applyInkResult();assert.ok(candidate);assert.equal(candidate.type,mode==='text'?'text':'image');assert.deepEqual(plain(candidate.recognition.rawElements),before.elements);assert.deepEqual(plain(candidate.recognition.sourceElements),before.elements.map(e=>e.id));assert.equal(candidate.recognition.mappings.length,elements.length);assert.deepEqual(plain(candidate.anchors),mapping.anchors);assert.deepEqual(plain(candidate.implementation),mapping.implementation);
  for(const original of before.elements.filter(e=>e.type!=='pen'))assert.deepEqual(plain(r.api.board.elements.find(e=>e.id===original.id)),original);
  if(elements.some(e=>e.type==='pen'))assert.deepEqual(plain(r.api.board.elements.filter(e=>e.type==='pen')),sources.filter(s=>s.original.type==='pen').flatMap(s=>s.outside));
  assert.equal(boardDiagnostics(plain(r.api.board)).length,0);const confirmed=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);r.api.redo();r.api.redo();assert.deepEqual(plain(r.api.board),confirmed);
 }
});

test('空白有效圈选点击左侧识别仍弹类型选择，提示无内容且取消不丢圈或写历史',async()=>{
 for(const action of ['button','cancel']){
  let posted=0,captures=0;const r=runtime([visualText],{lassoUI:true,capture:async session=>{captures++;return fixtureCapture(session)},fetch:async path=>{if(path==='/api/recognize')posted++;return response({service:'anatomy-handwriting',ready:true})}}),initial=plain(r.api.board);
  r.api.change(()=>{r.api.board.elements[0].custom.prior='圈选前修改'});const before=plain(r.api.board);Object.assign(r.api.view,{x:0,y:0,scale:1});r.api.setTool('lasso');await dragLasso(r,[[600,500],[800,500],[800,650],[600,650]]);const region=plain(r.api.graphics.region);assert.deepEqual(plain(r.api.graphics.slices),[]);
  await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);assert.match(r.node('ink-choice-feedback').textContent,/没有|无.*内容|可识别/);for(const mode of ['text','math']){await r.fire('ink-choice-'+mode,'click');assert.equal(r.node('ink-choice-dialog').open,true);assert.equal(r.node('ink-dialog').open,false);assert.deepEqual(plain(r.api.graphics.region),region)}
  if(action==='button')await r.fire('ink-choice-cancel','click');else await r.fire('ink-choice-dialog','cancel');assert.equal(r.node('ink-choice-dialog').open,false);assert.deepEqual(plain(r.api.graphics.region),region);assert.match(r.node('world').innerHTML,/lasso-region/);assert.equal(posted,0);assert.equal(captures,0);assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
 }
});

test('普通可见内容的真实圈选捕获绘制文字、公式和图片并以圈线裁剪，捕获不修改源对象',async()=>{
 for(const element of [visualText,visualMath,visualImage,rect]){
  const rasterValues=[],posted=[],r=runtime([element],{realCapture:true,raster:async value=>{rasterValues.push(value);return plain(fixtureRaster)},fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push(JSON.parse(options.body));return response({ok:true,text:'圈内内容'})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);
  r.api.graphics.lasso(allContentLasso.map(([x,y])=>({x,y})));await r.fire('open-handwriting','click');let finished=false;const choosing=r.fire('ink-choice-text','click').finally(()=>{finished=true});for(let i=0;i<10&&!finished;i++){await settle();r.releaseImages()}await choosing;
  assert.equal(posted.length,1);assert.match(posted[0].image,/^data:image\/png;base64,/);assert.ok(r.canvasLog.some(op=>op.kind==='clip'&&op.rule==='evenodd'&&op.path.at(-1)?.kind==='close'));
  if(element.text){const textPaint=r.canvasLog.filter(op=>op.kind==='fillText');assert.ok(textPaint.map(op=>op.value).join('').includes(element.text),'可见正文须实际绘制到识别图片');assert.ok(textPaint.every(op=>/\d+(?:\.\d+)?px/.test(op.font)),'正文须使用画板字号绘制');assert.ok(r.canvasLog.some(op=>op.kind==='clip'&&op.path.some(p=>p.kind==='rect')),'正文须裁到显示槽位')}
  if(element.math){for(const value of [element.math,...(element.mathExpressions||[]).map(part=>part.value)])assert.ok(rasterValues.includes(value),'主公式与附加公式须全部渲染');assert.ok(r.canvasLog.some(op=>op.kind==='drawImage'),'打印公式须绘制成图片')}
  if(element.type==='image')assert.ok(r.canvasLog.some(op=>op.kind==='drawImage'&&op.src===element.image.src),'原生图片须实际绘制到识别图片');assert.deepEqual(plain(r.api.board),before);
 }
});

test('普通可见内容在识别选择后改变时，旧圈选源仍被阻断且不捕获不POST',async()=>{
 for(const element of [visualText,visualMath,visualImage,rect]){
  let posted=0,captures=0;const r=runtime([element],{capture:async session=>{captures++;return fixtureCapture(session)},fetch:async path=>{if(path==='/api/recognize')posted++;return response({service:'anatomy-handwriting',ready:true})}});r.api.graphics.lasso(allContentLasso.map(([x,y])=>({x,y})));await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);r.api.change(()=>{r.api.board.elements[0].x+=10});const current=plain(r.api.board);await r.fire('ink-choice-math','click');assert.equal(captures,0);assert.equal(posted,0);assert.equal(r.node('ink-dialog').open,false);assert.deepEqual(plain(r.api.board),current);
 }
});

test('同圈普通文字、公式PNG与笔迹确认后，各类原内容及圈外剩余保持原有规则',async()=>{
 const nearbyPen={...plain(pen),id:'nearby',x:90,y:120,width:100},region=[{x:115,y:105},{x:150,y:105},{x:150,y:135},{x:115,y:135}],r=runtime([visualText,graphicFixture(),nearbyPen],{fetch:async path=>path==='/api/recognize'?response({ok:true,text:'x+1'}):response({service:'anatomy-handwriting',ready:true})}),before=plain(r.api.board);
 r.api.graphics.lasso(region);const slices=plain(r.api.graphics.slices);assert.equal(slices.length,3);assert.equal(slices[0].visual,true);assert.equal(slices[1].graphic,true);assert.equal(slices[2].inside.length,1);await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);await r.fire('ink-choice-math','click');assert.deepEqual(plain(r.api.graphics.region),region);assert.deepEqual(plain(r.api.board),before);
 const applying=r.api.math.applyInkResult();await settle();r.releaseImages();const candidate=await applying;assert.ok(candidate);assert.deepEqual(plain(r.api.board.elements.find(e=>e.id===visualText.id)),before.elements[0]);assert.deepEqual(plain(r.api.board.elements.filter(e=>e.type==='pen')),slices[2].outside);assert.ok(r.api.board.elements.find(e=>e.id==='formula'&&e.formulaGraphic.semanticStatus==='needs-review'));assert.deepEqual(plain(candidate.recognition.rawElements),before.elements);assert.equal(candidate.recognition.mappings.length,3);assert.deepEqual(plain(candidate.anchors),mapping.anchors);assert.equal(boardDiagnostics(plain(r.api.board)).length,0);const confirmed=plain(r.api.board);r.api.undo();assert.deepEqual(plain(r.api.board),before);r.api.redo();assert.deepEqual(plain(r.api.board),confirmed);
});

test('旧原笔迹复合形状的真实预览同时捕获正文和附加打印公式，校对只记录同一个来源',async()=>{
 const source={...plain(rect),mathDisplay:'ink',mathHandwriting:{mode:'math',reviewedValue:'y=ax',strokes:[[[0,0],[100,0]],[[50,15],[50,30]]]}},rasterValues=[],posted=[],r=runtime([source],{realCapture:true,raster:async value=>{rasterValues.push(value);return plain(fixtureRaster)},fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push(JSON.parse(options.body));return response({ok:true,text:'已识别复合内容'})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);
 r.api.graphics.lasso(allContentLasso.map(([x,y])=>({x,y})));assert.equal(r.api.graphics.slices.length,1);await r.fire('open-handwriting','click');let finished=false;const choosing=r.fire('ink-choice-text','click').finally(()=>{finished=true});for(let i=0;i<10&&!finished;i++){await settle();r.releaseImages()}await choosing;assert.equal(posted.length,1);assert.ok(r.canvasLog.filter(op=>op.kind==='fillText').map(op=>op.value).join('').includes(source.text),'旧原笔迹旁的正文须进入预览');assert.ok(rasterValues.includes('x>0'),'旧原笔迹旁的附加公式须进入预览');assert.equal(rasterValues.includes('y=ax'),false);assert.ok(r.canvasLog.some(op=>op.kind==='stroke'),'主公式继续绘制原笔迹');assert.ok(r.canvasLog.some(op=>op.kind==='clip'&&op.rule==='evenodd'));assert.deepEqual(plain(r.api.board),before);
 const candidate=await r.api.math.applyInkResult();assert.ok(candidate);assert.deepEqual(plain(candidate.recognition.sourceElements),[source.id]);assert.deepEqual(plain(candidate.recognition.rawElements),[source]);assert.equal(candidate.recognition.mappings.length,1);const retained=r.api.board.elements.find(e=>e.id===source.id);assert.equal(retained.text,source.text);assert.deepEqual(plain(retained.mathExpressions),source.mathExpressions);assert.deepEqual(plain(retained.anchors),mapping.anchors);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

test('仅圈空心形状内部正文或公式不碰边框，仍按可见内容打开选择识别且保留原对象',async()=>{
 for(const mode of ['text','math']){
  const source={...plain(rect),fill:'none'},posted=[],value=mode==='text'?'处理输入':'y=ax',r=runtime([source],{fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push(JSON.parse(options.body));return response({ok:true,text:value})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);
  displayedContentSlots(r,source,[{part:'text',x:150,y:145,width:200,height:35,fontSize:24,scales:[1]},{part:'primary',x:160,y:200,width:180,height:40,fontSize:24,scales:[1]},{part:'extra',x:180,y:250,width:140,height:24,fontSize:24,scales:[1]}]);
  const region=(mode==='text'?[[165,140],[335,140],[335,185],[165,185]]:[[170,195],[330,195],[330,245],[170,245]]).map(([x,y])=>({x,y}));r.context.fixtureRegion=region;assert.deepEqual(plain(r.evaluate('lassoSelection(board.elements,fixtureRegion)')),[],'内容圈不应命中空心形状边框');r.api.graphics.lasso(region);assert.equal(r.api.graphics.slices.length,1);assert.equal(r.api.graphics.slices[0].visual,true);await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);assert.deepEqual(plain(r.api.graphics.region),region);await r.fire('ink-choice-'+mode,'click');assert.equal(posted.length,1);assert.equal(posted[0].mode,mode);const candidate=await r.api.math.applyInkResult();assert.ok(candidate);assert.deepEqual(plain(candidate.recognition.rawElements),[source]);assert.deepEqual(plain(candidate.recognition.sourceElements),[source.id]);assert.deepEqual(plain(r.api.board.elements.find(e=>e.id===source.id)),source);r.api.undo();assert.deepEqual(plain(r.api.board),before);
 }
});

test('只圈移离线条的关系标签文字，仍可选择识别且保留原连线和源码映射',async()=>{
 const source={...plain(mapping),id:'off-line-label',type:'arrow',x:100,y:100,width:300,height:0,text:'输出处理结果'},posted=[],r=runtime([source],{fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push(JSON.parse(options.body));return response({ok:true,text:'输出处理结果'})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);displayedContentSlots(r,source,[{part:'text',x:450,y:300,width:200,height:30,fontSize:22,scales:[1]}],'relation-label');
 const region=[[455,295],[640,295],[640,340],[455,340]].map(([x,y])=>({x,y}));r.context.fixtureRegion=region;assert.deepEqual(plain(r.evaluate('lassoSelection(board.elements,fixtureRegion)')),[],'标签圈不应命中远处连线');r.api.graphics.lasso(region);assert.equal(r.api.graphics.slices.length,1);await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);assert.deepEqual(plain(r.api.graphics.region),region);await r.fire('ink-choice-text','click');assert.equal(posted.length,1);const candidate=await r.api.math.applyInkResult();assert.ok(candidate);assert.deepEqual(plain(candidate.recognition.sourceElements),[source.id]);assert.deepEqual(plain(candidate.recognition.rawElements),[source]);assert.deepEqual(plain(candidate.anchors),mapping.anchors);assert.deepEqual(plain(candidate.implementation),mapping.implementation);assert.deepEqual(plain(r.api.board.elements.find(e=>e.id===source.id)),source);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});

test('左侧识别复用圈选，先选择中文或公式，再自动提交对应模式并保留圈外笔迹',async()=>{
 for(const mode of ['text','math']){
  const posted=[],value=mode==='text'?'输入检查':'y=ax',r=runtime([pen],{fetch:async(path,options={})=>{if(path==='/api/recognize'){posted.push({method:options.method,...JSON.parse(options.body)});return response({ok:true,text:value,engine:'choice-test'})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);
  r.api.graphics.lasso(middleInkRegion);const outside=plain(r.api.graphics.slices[0].outside),selected=plain(r.api.selected);await r.fire('open-handwriting','click');
  assert.equal(r.node('ink-choice-dialog').open,true);assert.equal(r.node('ink-dialog').open,false);assert.equal(posted.length,0);assert.deepEqual(plain(r.api.graphics.region),middleInkRegion);assert.deepEqual(plain(r.api.selected),selected);
  await r.fire('ink-choice-'+mode,'click');assert.equal(r.node('ink-choice-dialog').open,false);assert.equal(r.node('ink-dialog').open,true);assert.equal(r.api.math.mode,mode);assert.equal(posted.length,1);assert.equal(posted[0].method,'POST');assert.equal(posted[0].mode,mode);assert.match(posted[0].image,/^data:image\/png;base64,/);assert.equal(r.node('ink-result').value,value);assert.deepEqual(plain(r.api.board),before);
  const candidate=await r.api.math.applyInkResult();assert.equal(candidate.type,mode==='text'?'text':'image');assert.deepEqual(plain(candidate.recognition.region),middleInkRegion);assert.deepEqual(plain(candidate.recognition.rawElements),[pen]);assert.deepEqual(plain(r.api.board.elements.filter(e=>e.type==='pen')),outside);r.api.undo();assert.deepEqual(plain(r.api.board),before);
 }
});

test('取消左侧识别选择不请求不改内容，保留套索和之前的撤销历史',async()=>{
 for(const action of ['button','cancel']){
  let posted=0;const r=runtime([pen],{fetch:async path=>{if(path==='/api/recognize')posted++;return response({service:'anatomy-handwriting',ready:true})}}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='选择识别前的修改'});const before=plain(r.api.board);r.api.graphics.lasso(fullInkRegion);const selected=plain(r.api.selected);await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);
  if(action==='button')await r.fire('ink-choice-cancel','click');else await r.fire('ink-choice-dialog','cancel');assert.equal(r.node('ink-choice-dialog').open,false);assert.equal(r.node('ink-dialog').open,false);assert.deepEqual(plain(r.api.graphics.region),fullInkRegion);assert.deepEqual(plain(r.api.selected),selected);
  await r.fire('ink-choice-text','click');await r.fire('ink-choice-math','click');assert.equal(posted,0);assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
 }
});

test('选择识别后等待捕获完成才发请求，重复点击选择不会重复捕获或识别',async()=>{
 const work=deferred();let captures=0,posted=0;const r=runtime([pen],{capture:()=>{captures++;return work.promise},fetch:async path=>{if(path==='/api/recognize'){posted++;return response({ok:true,text:'y=ax'})}return response({service:'anatomy-handwriting',ready:true})}}),before=plain(r.api.board);r.api.graphics.lasso(fullInkRegion);await r.fire('open-handwriting','click');const choosing=r.fire('ink-choice-math','click'),session=r.api.math.lassoSession;
 assert.equal(r.node('ink-choice-dialog').open,false);assert.equal(session.capturing,true);assert.equal(r.node('ink-recognize').disabled,true);assert.equal(captures,1);assert.equal(posted,0);assert.deepEqual(plain(r.api.board),before);await r.fire('ink-choice-math','click');await r.fire('ink-choice-text','click');assert.equal(captures,1);assert.equal(posted,0);
 work.resolve(fixtureCapture(session));await choosing;assert.equal(captures,1);assert.equal(posted,1);assert.equal(r.node('ink-result').value,'y=ax');await r.fire('ink-choice-math','click');assert.equal(posted,1);assert.deepEqual(plain(r.api.board),before);
});

test('自动识别等待捕获时关闭面板或保留原稿，晚到预览不发请求也不新增历史',async()=>{
 for(const action of ['ink-close','ink-keep','cancel']){
  const work=deferred();let posted=0;const r=runtime([pen],{capture:()=>work.promise,fetch:async path=>{if(path==='/api/recognize')posted++;return response({service:'anatomy-handwriting',ready:true})}}),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='自动识别前的修改'});const before=plain(r.api.board);r.api.graphics.lasso(fullInkRegion);await r.fire('open-handwriting','click');const choosing=r.fire('ink-choice-text','click'),session=r.api.math.lassoSession;assert.equal(session.capturing,true);assert.equal(posted,0);
  if(action==='cancel')await r.fire('ink-dialog','cancel');else await r.fire(action,'click');work.resolve(fixtureCapture(session));await choosing;assert.equal(posted,0);assert.equal(r.node('ink-dialog').open,false);assert.equal(r.api.math.lassoSession,null);assert.deepEqual(plain(r.api.board),before);r.api.undo();assert.deepEqual(plain(r.api.board),initial);
 }
});

test('自动识别捕获失败或期间原稿和选定版本变化，均不提交陈旧图片',async()=>{
 for(const stale of ['capture','ink','version']){
  const work=deferred();let revision='selected-1',posted=0;const r=runtime([pen],{capture:async()=>{const captured=await work.promise;if(stale==='capture')throw Error('捕获失败');return captured},fetch:async path=>{if(path==='/api/recognize'){posted++;return response({ok:true,text:'y=ax'})}return path.startsWith('/api/versions')?response({ok:true,selected:{id:'saved',revision},versions:[]}):response({service:'anatomy-handwriting',ready:true})}});await r.api.versions.refresh();r.api.graphics.lasso(fullInkRegion);await r.fire('open-handwriting','click');const choosing=r.fire('ink-choice-math','click'),session=r.api.math.lassoSession;assert.equal(session.capturing,true);assert.equal(posted,0);
  if(stale==='ink')r.api.change(()=>{r.api.board.elements[0].x+=10});else if(stale==='version'){revision='selected-2';await r.api.versions.refresh()}const current=plain(r.api.board);work.resolve(fixtureCapture(session));await choosing;assert.equal(posted,0);assert.equal(session.image,undefined);assert.equal(session.captureError,true);assert.equal(r.node('ink-recognize').disabled,true);assert.deepEqual(plain(r.api.board),current);assert.match(r.node('ink-feedback').textContent,stale==='capture'?/未完成|失败/:/变化/);
 }
});

test('识别选择打开后内容、版本或圈线变化，选择旧选项不捕获也不发请求',async()=>{
 for(const stale of ['ink','version','region']){
  let revision='selected-1',captures=0,posted=0;const r=runtime([pen],{capture:async session=>{captures++;return fixtureCapture(session)},fetch:async path=>{if(path==='/api/recognize'){posted++;return response({ok:true,text:'y=ax'})}return path.startsWith('/api/versions')?response({ok:true,selected:{id:'saved',revision},versions:[]}):response({service:'anatomy-handwriting',ready:true})}});await r.api.versions.refresh();r.api.graphics.lasso(fullInkRegion);await r.fire('open-handwriting','click');assert.equal(r.node('ink-choice-dialog').open,true);
  if(stale==='ink')r.api.change(()=>{r.api.board.elements[0].x+=10});else if(stale==='version'){revision='selected-2';await r.api.versions.refresh()}else r.api.graphics.lasso(middleInkRegion);const current=plain(r.api.board);await r.fire('ink-choice-math','click');assert.equal(captures,0);assert.equal(posted,0);assert.equal(r.node('ink-dialog').open,false);assert.equal(r.node('ink-choice-dialog').open,false);assert.deepEqual(plain(r.api.board),current);
 }
});

test('圈选完成的隐藏选择不响应编辑快捷键，复制与全局撤销保留且按V后可移动删除',async()=>{
 const r=lassoRuntime(),initial=plain(r.api.board);r.api.change(()=>{r.api.board.elements[0].custom.prior='此前修改'});const before=plain(r.api.board);r.api.setTool('lasso');await dragLasso(r,penLasso);const selected=plain(r.api.selected);assert.deepEqual(selected,['ink']);
 for(const event of [{key:'ArrowRight'},{key:'Delete'},{key:'Backspace'},{key:'d',ctrlKey:true},{key:'a',ctrlKey:true}])await r.dispatchDocument('keydown',event);assert.deepEqual(plain(r.api.board),before);assert.deepEqual(plain(r.api.selected),selected);assert.equal(r.evaluate('tool'),'lasso');assert.match(r.node('toast').textContent,/切换.*选择/);
 let copied;await r.dispatchDocument('copy',{clipboardData:{setData(type,value){if(type==='text/plain')copied=value}}});assert.deepEqual(JSON.parse(copied).elements,[before.elements.find(e=>e.id==='ink')]);assert.deepEqual(plain(r.api.board),before);await r.dispatchDocument('keydown',{key:'z',ctrlKey:true});assert.deepEqual(plain(r.api.board),initial);assert.equal(r.evaluate('tool'),'lasso');await r.dispatchDocument('keydown',{key:'y',ctrlKey:true});assert.deepEqual(plain(r.api.board),before);
 await r.dispatchDocument('keydown',{key:'v'});assert.equal(r.evaluate('tool'),'select');await r.dispatchDocument('keydown',{key:'ArrowRight'});assert.equal(r.api.board.elements.find(e=>e.id==='ink').x,before.elements.find(e=>e.id==='ink').x+1);const moved=plain(r.api.board);await r.dispatchDocument('keydown',{key:'Delete'});assert.equal(r.api.board.elements.some(e=>e.id==='ink'),false);assert.equal(r.api.board.elements.find(e=>e.id==='box').custom.prior,'此前修改');r.api.undo();assert.deepEqual(plain(r.api.board),moved);r.api.undo();assert.deepEqual(plain(r.api.board),before);
});
