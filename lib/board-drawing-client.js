// Drawing operations change the visible board, keep source evidence, and form one undo step.
function manualDrawing(){board.layout={...(board.layout||{}),mode:'manual'}}
function drawingMapping(e){const c=structuredClone(e);for(const k of ['id','type','x','y','width','height','rotation','text','math','mathExpressions','mathDisplay','handwriting','mathHandwriting','points','points3d','endZ','from','to','image'])delete c[k];return c}
function outlinePoints(e){
  if(e.type==='ellipse')return Array.from({length:97},(_,i)=>[.5+.5*Math.cos(i*Math.PI/48),.5+.5*Math.sin(i*Math.PI/48)]);
  if(e.type==='diamond')return [[.5,0],[1,.5],[.5,1],[0,.5],[.5,0]];
  if(e.type==='polygon')return [...e.points.map(p=>[...p]),[...e.points[0]]];
  return [[0,0],[1,0],[1,1],[0,1],[0,0]]
}
function drawingContentBoxes(e){
  const relation=['line','arrow'].includes(e.type),selector=['g.element','g.relation-label'].flatMap(kind=>[kind+'[data-id="'+e.id+'"] .shape-prose',kind+'[data-id="'+e.id+'"] [data-expression]']).join(', '),result=[];
  for(const n of world.querySelectorAll?.(selector)||[]){const r=n.getBoundingClientRect(),a=point({clientX:r.left,clientY:r.top}),b=point({clientX:r.right,clientY:r.bottom});const ink=n.querySelector?.('.original-ink'),matrix=ink?.getScreenCTM?.(),part=n.getAttribute('data-expression')||'text',h=inkExpression(e,part)?.handwriting;const rawWorld=matrix&&h?.strokes?.map(s=>s.map(([x,y])=>point({clientX:matrix.a*x+matrix.c*y+matrix.e,clientY:matrix.b*x+matrix.d*y+matrix.f})));let scale=1;const foreign=n.closest?.('foreignObject');for(let node=n;node&&node!==foreign;node=node.parentElement){const m=inlineCssMatrix(inlineComputedStyle(node).transform);scale*=Math.hypot(m.a,m.b);if(!foreign)break}const width=n.offsetWidth? n.offsetWidth*scale:b.x-a.x,height=n.offsetHeight?n.offsetHeight*scale:b.y-a.y,midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2},center=relation?midpoint:worldToLocal(e,midpoint);result.push({part,x:center.x-width/2,y:center.y-height/2,width,height,fontSize:(parseFloat(inlineComputedStyle(n).fontSize)||e.fontSize||20)*scale,textAlign:inlineComputedStyle(n).textAlign,rotation:relation?0:e.rotation||0,world:relation,rawWorld})}return result
}
function detachedContent(e,boxes=drawingContentBoxes(e)){
  const parent=structuredClone(e),children=[],entries=elementMathEntries(e),inset=12,relation=['line','arrow'].includes(e.type);
  const count=(!relation&&e.text?.trim()?1:0)+entries.length,h=Math.max(24,(e.height-24)/Math.max(1,count));let row=0;
  function child(type,part,text,math){const box=boxes.find(b=>b.part===part)||{x:e.x+inset,y:e.y+inset+row++*h,width:Math.max(1,e.width-24),height:h};const c={...drawingMapping(e),id:uid(),type,x:box.x,y:box.y,width:box.width,height:box.height,text,math,fill:'none',stroke:e.stroke||'#6366f1',fontSize:box.fontSize||e.fontSize||20,textAlign:box.textAlign||(['rect','ellipse','diamond','polygon'].includes(e.type)?'center':'left'),rotation:box.rotation??(relation?0:e.rotation||0),derivedFrom:e.id};if(c.rotation){const center=localToWorld(e,{x:box.x+box.width/2,y:box.y+box.height/2});c.x=center.x-box.width/2;c.y=center.y-box.height/2}children.push(c);return c}
  if(!relation&&e.text?.trim()){const c=child('text','text',e.text,'');if(e.handwriting?.mode==='text')c.handwriting=structuredClone(e.handwriting)}
  for(const f of entries){const c=child('math',f.id,'',f.value),raw=inkExpression(e,f.id);if(raw?.handwriting)c.mathHandwriting=structuredClone(raw.handwriting);if(f.id==='primary'&&e.mathDisplay)c.mathDisplay=e.mathDisplay;else if(raw?.display)c.mathDisplay=raw.display;c.expressionOrigin=f.id;for(const[k,v]of Object.entries(raw||{}))if(!['id','value','handwriting','display'].includes(k))c[k]=structuredClone(v)}
  parent.sourceTitle=humanText(e.text?.trim().split('\n')[0]||e.sourceTitle||'');if(!relation)parent.text='';parent.math='';delete parent.mathExpressions;if(!relation||parent.handwriting?.mode==='math')delete parent.handwriting;delete parent.mathHandwriting;delete parent.mathDisplay;
  return {parent,children}
}
function splitDrawing(){const e=chosen();if(!e||selected.size!==1||canvasDraftPending())return;const parts=detachedContent(e);if(!parts.children.length){message('这个图形没有需要拆开的文字或公式。');return}change(()=>{manualDrawing();board.elements.splice(board.elements.indexOf(e),1,parts.parent,...parts.children);selected=new Set(parts.children.map(c=>c.id))});message('已拆开，框、文字和公式可以分别移动、修改和擦除。')}
function convertDrawing(type){const e=chosen();if(!e||selected.size!==1||canvasDraftPending())return;const allowed=['rect','ellipse','diamond','polygon','text'];if(!allowed.includes(type)||!allowed.includes(e.type)&&e.type!=='frame')return;change(()=>{manualDrawing();e.type=type;if(type==='polygon')e.points=[[0,0],[1,0],[1,1],[0,1]];else delete e.points;if(type==='text')e.fill='none'});message('已改变形状，可继续拖动控制点。')}
function drawingHandleSvg(){if(tool!=='select'||selected.size!==1||inlineWritingOpen())return '';const e=chosen();if(!e)return '';const size=9/view.scale;
  const knob=(p,attrs,label,cls='drawing-handle')=>'<rect class="'+cls+'" '+attrs+' aria-label="'+label+'" x="'+(p.x-size/2)+'" y="'+(p.y-size/2)+'" width="'+size+'" height="'+size+'"/>';
  if(['line','arrow'].includes(e.type)){const {a,b}=lineEnds(e,board.elements);return knob(a,'data-endpoint="from" data-control-id="'+e.id+'"','移动起点')+knob(b,'data-endpoint="to" data-control-id="'+e.id+'"','移动终点')}
  const handles=resizeHandles(e).map(p=>knob(p,'data-resize="'+e.id+'" data-handle="'+p.handle+'"','缩放 '+p.handle)).join('');
  const top=localToWorld(e,{x:e.x+e.width/2,y:e.y}),rotation=localToWorld(e,{x:e.x+e.width/2,y:e.y-28/view.scale});
  const vertices=e.type==='polygon'?(e.points||[]).map((p,i)=>knob(localToWorld(e,{x:e.x+p[0]*e.width,y:e.y+p[1]*e.height}),'data-vertex="'+i+'" data-control-id="'+e.id+'"','移动顶点 '+(i+1),'drawing-vertex')).join(''):'';
  return '<g class="drawing-controls">'+handles+'<path d="M'+top.x+' '+top.y+' L'+rotation.x+' '+rotation.y+'" stroke="#818cf8" stroke-width="'+1/view.scale+'"/><circle class="drawing-rotate" data-rotate="'+e.id+'" aria-label="旋转图形" cx="'+rotation.x+'" cy="'+rotation.y+'" r="'+6/view.scale+'"/>'+vertices+'</g>'
}
function eraserCursorSvg(){return tool==='eraser'&&eraserPosition?'<circle class="eraser-cursor" pointer-events="none" cx="'+eraserPosition.x+'" cy="'+eraserPosition.y+'" r="'+drawingRadius()+'" stroke-width="'+1/view.scale+'"/>':''}
function drawingRadius(){return Number($('eraser-size').value||24)/2/view.scale}
function eraseHumanPart(e,part){
  if(part==='text'){e.text='';if(e.type==='image')e.image.alt='图片';if(e.handwriting?.mode==='text')delete e.handwriting}
  else if(part==='primary'){e.math='';delete e.mathDisplay;delete e.mathHandwriting;if(e.handwriting?.mode==='math')delete e.handwriting}
  else e.mathExpressions=(e.mathExpressions||[]).filter(f=>f.id!==part);
  if(['text','math'].includes(e.type)&&!e.text?.trim()&&!elementMathEntries(e).length)deleteElements(board,[e.id])
}
function inkAsPens(e,box){const h=primaryMathInk(e);if(!validMathInk(h))return [];const all=h.strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(1,Math.max(...xs)-left),height=Math.max(1,Math.max(...ys)-top);return h.strokes.map((s,i)=>{let path=box?.rawWorld?.[i]||s.map(p=>localToWorld(e,{x:e.x+(p[0]-left)/w*e.width,y:e.y+(p[1]-top)/height*e.height}));if(path.length===1)path=[path[0],{x:path[0].x+.01,y:path[0].y}];return {...structuredClone(e),...normalizedPoints(path),rotation:0,id:i?uid():e.id,type:'pen',text:'',math:'',mathExpressions:[],mathDisplay:undefined,handwriting:undefined,mathHandwriting:undefined,recognition:{...e.recognition,stale:true,previousMath:e.math},fill:'none',fragmentOf:e.id}})}

function eraseDrawingAt(p,from,target){
  eraserPosition=p;const radius=drawingRadius(),node=target||null,id=node?.closest?.('[data-id]')?.getAttribute('data-id'),e=get(id),part=node?.closest?.('[data-expression]')?.getAttribute('data-expression')||(node?.closest?.('.shape-prose')?'text':null);
  if($('eraser-mode').value==='object'){const hit=e||shapeAt(p);if(hit){manualDrawing();deleteElements(board,[hit.id]);selected.delete(hit.id)}return}
  const rawBoxes=new Map();const rawHit=e&&part&&(part==='primary'?e.mathDisplay:inkExpression(e,part)?.display)==='ink';
  if(rawHit&&(e.type!=='math'||part!=='primary')){const boxes=drawingContentBoxes(e),parts=detachedContent(e);for(const child of parts.children){const box=boxes.find(b=>b.part===child.expressionOrigin);if(box?.rawWorld)rawBoxes.set(child.id,{...box,part:'primary'})}board.elements.splice(board.elements.indexOf(e),1,parts.parent,...parts.children);manualDrawing()}
  if(e&&part&&!rawHit){manualDrawing();eraseHumanPart(e,part)}
  const originals=[...board.elements];for(const original of originals){if(!get(original.id))continue;let pen=original,parts=null;
    if(original.type==='math'&&original.mathDisplay==='ink'){const boxes=drawingContentBoxes(original),raw=inkAsPens(original,rawBoxes.get(original.id)||boxes.find(b=>b.part==='primary'));if(!raw.length)continue;const hit=raw.some(r=>erasePen(r,{...p,radius,from},uid).changed);if(!hit)continue;const content=structuredClone(original);content.math='';delete content.mathDisplay;delete content.mathHandwriting;if(content.handwriting?.mode==='math')delete content.handwriting;const rest=detachedContent(content,boxes).children;board.elements.splice(board.elements.indexOf(original),1,...raw,...rest);for(const r of raw){const erased=erasePen(r,{...p,radius,from},uid);if(erased.changed){if(erased.fragments.length)board.elements.splice(board.elements.indexOf(r),1,...erased.fragments);else deleteElements(board,[r.id])}}manualDrawing();continue}
    if(['rect','ellipse','diamond','polygon','frame'].includes(original.type)){pen={...structuredClone(original),type:'pen',points:outlinePoints(original),fill:'none'};parts=detachedContent(original)}
    else if(['line','arrow'].includes(original.type)){const {a,b}=lineEnds(original,board.elements),edge=spaceLinks(board.elements).find(link=>link.id===original.id);pen={...structuredClone(original),type:'pen',...normalizedPoints([a,b]),rotation:0,z:edge.a.z,points3d:[[a.x,a.y,edge.a.z],[b.x,b.y,edge.b.z]],fill:'none'};delete pen.from;delete pen.to;delete pen.endZ}
    else if(original.type!=='pen')continue;
    const erased=erasePen(pen,{...p,radius,from},uid);if(!erased.changed)continue;
    if(parts){for(const f of erased.fragments){f.text='';f.math='';delete f.mathExpressions;delete f.mathDisplay;delete f.handwriting;delete f.mathHandwriting}board.elements.splice(board.elements.indexOf(original),0,...parts.children)}
    const idx=board.elements.indexOf(original);if(erased.fragments.length)board.elements.splice(idx,1,...erased.fragments);else deleteElements(board,[original.id]);manualDrawing()
  }selected=new Set([...selected].filter(get))
}
function renderDrawingTools(){if(typeof lassoRegion!=='undefined'){const enabled=!!lassoRegion&&lassoInkSlices.some(s=>s.inside.length||s.graphic||s.visual||s.visualExtras);if($('recognize-lasso-text'))$('recognize-lasso-text').hidden=!enabled;if($('recognize-lasso-math'))$('recognize-lasso-math').hidden=!enabled;}
  $('drawing-options').hidden=!['pen','eraser','rect','ellipse','diamond','polygon','line','arrow','frame'].includes(tool);
  $('pen-options').hidden=tool==='eraser';$('eraser-options').hidden=tool!=='eraser';
  const e=chosen();$('shape-kind').hidden=selected.size!==1||!['rect','ellipse','diamond','polygon','frame','text'].includes(e?.type);if(e)$('shape-kind').value=e.type==='frame'?'rect':e.type;
  $('split-drawing').hidden=selected.size!==1||!e||!['rect','ellipse','diamond','polygon','frame'].includes(e.type)||!e.text?.trim()&&!elementMathEntries(e).length;
  $('recognize-drawing').hidden=true;
  $('toggle-ink').hidden=selected.size!==1||!validMathInk(primaryMathInk(e))||!e.math?.trim();$('toggle-ink').textContent=e?.mathDisplay==='ink'?'排版公式':'原笔迹'
}
function toggleDrawingInk(){const e=chosen(),h=primaryMathInk(e);if(!e||!validMathInk(h)||canvasDraftPending())return;if(h.reviewedValue&&h.reviewedValue!==e.math){message('公式已修改，原笔迹对应的是旧表达。可以重新手写并校对。');return}change(()=>{e.mathDisplay=e.mathDisplay==='ink'?'typeset':'ink';manualDrawing()})}
function drawingInkMarkup(e,id){const f=inkExpression(e,id),display=id==='primary'?e.mathDisplay:f?.display,h=f?.handwriting;if(display!=='ink'||!validMathInk(h))return null;const all=h.strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x=Math.min(...xs)-5,y=Math.min(...ys)-5,w=Math.max(10,Math.max(...xs)-x+5),height=Math.max(10,Math.max(...ys)-y+5);return '<svg class="original-ink" xmlns="http://www.w3.org/2000/svg" viewBox="'+[x,y,w,height].join(' ')+'" role="img" aria-label="保留的公式原笔迹">'+h.strokes.map(s=>s.length===1?'<circle cx="'+s[0][0]+'" cy="'+s[0][1]+'" r="2" fill="currentColor"/>':'<polyline points="'+s.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>').join('')+'</svg>'}
$('shape-kind').addEventListener('change',ev=>convertDrawing(ev.target.value));$('split-drawing').addEventListener('click',splitDrawing);$('recognize-drawing').addEventListener('click',()=>openLassoHandwriting('math'));$('toggle-ink').addEventListener('click',toggleDrawingInk);
for(const id of ['draw-color','draw-width','eraser-size','eraser-mode'])$(id).addEventListener('input',()=>{renderScene()});
window.__anatomyBoard.drawing={split:splitDrawing,convert:convertDrawing,erase:(p,from)=>change(()=>eraseDrawingAt(p,from)),toggleInk:toggleDrawingInk};
renderDrawingTools();

function selectedInkUnchanged(){return !!inkSourceIds.length&&JSON.stringify(inkSourceIds.map(get))===inkSourceBaseline}

function keepDrawingInk(){
  if(inkPaperSession)return;
  if(inkSourceIds.length&&selectedInkUnchanged()){closeInk(true);setTool('pen');message('保留画板原笔迹，可以继续画。');return}
  if(inkSourceIds.length&&!selectedInkUnchanged()){$('ink-feedback').textContent='原笔迹已变化，请关闭后重新选择。';return}
  const strokes=inkStrokes.filter(s=>s.length>0);if(!strokes.length){$('ink-feedback').textContent='先画一些笔迹。';return}
  const r=surface.getBoundingClientRect(),all=strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),width=Math.max(1,Math.max(...xs)-left),height=Math.max(1,Math.max(...ys)-top),scale=Math.min(1,440/width,200/height),cx=(r.width/2-view.x)/view.scale-width*scale/2,cy=(r.height/2-view.y)/view.scale-height*scale/2;
  const pens=strokes.map(s=>{const pts=s.map(p=>({x:cx+(p[0]-left)*scale,y:cy+(p[1]-top)*scale}));if(pts.length===1)pts.push({...pts[0],x:pts[0].x+.01});return {...makeElement('pen',0,0),...normalizedPoints(pts),text:'',math:'',fill:'none'}});
  const next=structuredClone(board);next.elements.push(...pens);const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length){$('ink-feedback').textContent=errors[0].message;return}
  change(()=>{board=next;manualDrawing();selected=new Set(pens.map(e=>e.id))});closeInk(true);setTool('select');message('原笔迹已放入画板，没有识别或替换。')
}
