// Drawing operations change the visible board, keep source evidence, and form one undo step.
function manualDrawing(){board.layout={...(board.layout||{}),mode:'manual'}}
function drawingMapping(e){const c=structuredClone(e);for(const k of ['id','type','x','y','width','height','rotation','text','math','mathExpressions','mathDisplay','handwriting','mathHandwriting','points','points3d','endZ','from','to','image','erasures'])delete c[k];return c}
function drawingContentBoxes(e){
  const relation=['line','arrow'].includes(e.type),selector=['g.element','g.relation-label'].flatMap(kind=>[kind+'[data-id="'+e.id+'"] .shape-prose',kind+'[data-id="'+e.id+'"] [data-expression]']).join(', '),result=[];
  for(const n of world.querySelectorAll?.(selector)||[]){const r=n.getBoundingClientRect(),a=point({clientX:r.left,clientY:r.top}),b=point({clientX:r.right,clientY:r.bottom});const ink=n.querySelector?.('.original-ink'),matrix=ink?.getScreenCTM?.(),part=n.getAttribute('data-expression')||'text',h=inkExpression(e,part)?.handwriting;const rawWorld=matrix&&h?.strokes?.map(s=>s.map(([x,y])=>point({clientX:matrix.a*x+matrix.c*y+matrix.e,clientY:matrix.b*x+matrix.d*y+matrix.f})));let scale=1;const foreign=n.closest?.('foreignObject');for(let node=n;node&&node!==foreign;node=node.parentElement){const m=inlineCssMatrix(inlineComputedStyle(node).transform);scale*=Math.hypot(m.a,m.b);if(!foreign)break}const width=n.offsetWidth? n.offsetWidth*scale:b.x-a.x,height=n.offsetHeight?n.offsetHeight*scale:b.y-a.y,midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2},center=relation?midpoint:worldToLocal(e,midpoint);result.push({part,x:center.x-width/2,y:center.y-height/2,width,height,fontSize:(parseFloat(inlineComputedStyle(n).fontSize)||e.fontSize||20)*scale,textAlign:inlineComputedStyle(n).textAlign,rotation:relation?0:e.rotation||0,world:relation,rawWorld})}return result
}
function detachedContent(e,boxes=drawingContentBoxes(e)){
  const parent=structuredClone(e),children=[],entries=elementMathEntries(e),inset=12,relation=['line','arrow'].includes(e.type);
  const count=(!relation&&e.text?.trim()?1:0)+entries.length,h=Math.max(24,(e.height-24)/Math.max(1,count));let row=0;
  function child(type,part,text,math){const box=boxes.find(b=>b.part===part)||{x:e.x+inset,y:e.y+inset+row++*h,width:Math.max(1,e.width-24),height:h};const c={...drawingMapping(e),id:uid(),type,x:box.x,y:box.y,width:box.width,height:box.height,text,math,fill:'none',stroke:e.stroke||'#6366f1',fontSize:box.fontSize||e.fontSize||20,textAlign:box.textAlign||(['rect','ellipse','diamond','polygon'].includes(e.type)?'center':'left'),rotation:box.rotation??(relation?0:e.rotation||0),derivedFrom:e.id};if(c.rotation){const center=localToWorld(e,{x:box.x+box.width/2,y:box.y+box.height/2});c.x=center.x-box.width/2;c.y=center.y-box.height/2}drawingCopyErasures(e,c,relation?'label':'body');children.push(c);return c}
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
function inkAsPens(e,box){const h=primaryMathInk(e);if(!validMathInk(h))return [];const all=h.strokes.flat(),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(1,Math.max(...xs)-left),height=Math.max(1,Math.max(...ys)-top);return h.strokes.map((s,i)=>{let path=box?.rawWorld?.[i]||s.map(p=>localToWorld(e,{x:e.x+(p[0]-left)/w*e.width,y:e.y+(p[1]-top)/height*e.height}));if(path.length===1)path=[path[0],{x:path[0].x+.01,y:path[0].y}];return {...structuredClone(e),...normalizedPoints(path),rotation:0,id:i?uid():e.id,type:'pen',text:'',math:'',mathExpressions:[],mathDisplay:undefined,handwriting:undefined,mathHandwriting:undefined,recognition:{...e.recognition,stale:true,previousMath:e.math},fill:'none',fragmentOf:e.id}})}

// Erasures stay on the original surface. Moving or resizing a component carries
// its holes with it without separating text, formulas, or source mappings.
function drawingSurfaceBox(e,surface='body'){
  if(surface==='label'){const label=lineLabels().find(label=>label.id===e.id);return label?{x:label.x,y:label.y,width:label.w,height:label.h}:null}
  // Positive bounds support hit tests; directed UVs keep holes near their endpoint.
  if(['line','arrow'].includes(e.type)){const {a,b}=lineEnds(e,board.elements);return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.max(1,Math.abs(b.x-a.x)),height:Math.max(1,Math.abs(b.y-a.y)),flipX:b.x<a.x,flipY:b.y<a.y}}
  return{x:e.x,y:e.y,width:Math.max(1,e.width),height:Math.max(1,e.height)}
}
function drawingSurfacePoint(e,p,box,surface='body'){
  const q=surface==='body'&&!['line','arrow'].includes(e.type)?worldToLocal(e,p):p;
  const u=(q.x-box.x)/box.width,v=(q.y-box.y)/box.height;return[box.flipX?1-u:u,box.flipY?1-v:v]
}
function drawingCopyErasures(source,target,surface='body'){
  const carrier=drawingSurfaceBox(source,surface);if(!carrier)return target;
  const strokes=(source.erasures||[]).filter(stroke=>(stroke.surface||'body')===surface).map(stroke=>({surface:'body',points:stroke.points.map(p=>{
    const q={x:carrier.x+(carrier.flipX?1-p[0]:p[0])*carrier.width,y:carrier.y+(carrier.flipY?1-p[1]:p[1])*carrier.height},world=surface==='body'&&!['line','arrow'].includes(source.type)?localToWorld(source,q):q,local=worldToLocal(target,world);return[(local.x-target.x)/target.width,(local.y-target.y)/target.height]
  }),radius:[stroke.radius[0]*carrier.width/target.width,stroke.radius[1]*carrier.height/target.height]}));
  if(strokes.length)target.erasures=strokes;return target
}
function elementErasureHit(e,p,box=drawingSurfaceBox(e),surface='body'){
  if(!box)return false;const q=drawingSurfacePoint(e,p,box,surface);return surfaceErased(e,q,surface)
}
function applyElementErasureSvg(e,content,box=drawingSurfaceBox(e),surface='body'){
  const strokes=(e.erasures||[]).filter(stroke=>(stroke.surface||'body')===surface);if(!strokes.length||!box)return content;
  const id='erase-'+e.id+'-'+surface,pad=Math.max(24,12*(e.strokeWidth||2)),path=strokes.map(stroke=>{
    const [rx,ry]=stroke.radius,points=stroke.points.map(p=>[p[0]/rx,p[1]/ry]);
    return '<g transform="scale('+rx+' '+ry+')"><path d="M'+points.map(p=>p.join(' ')).join(' L')+'" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+points.at(-1)[0]+'" cy="'+points.at(-1)[1]+'" r="1" fill="black"/></g>'
  }).join('');
  return '<defs><mask id="'+id+'" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="'+(box.x-pad)+'" y="'+(box.y-pad)+'" width="'+(box.width+pad*2)+'" height="'+(box.height+pad*2)+'" style="mask-type:luminance"><rect x="'+(box.x-pad)+'" y="'+(box.y-pad)+'" width="'+(box.width+pad*2)+'" height="'+(box.height+pad*2)+'" fill="white"/><g transform="translate('+(box.x+(box.flipX?box.width:0))+' '+(box.y+(box.flipY?box.height:0))+') scale('+(box.flipX?-box.width:box.width)+' '+(box.flipY?-box.height:box.height)+')">'+path+'</g></mask></defs><g mask="url(#'+id+')">'+content+'</g>'
}
function drawingSurfaceTouched(a,b,radius,box){
  const inside=p=>p.x>=box.x&&p.x<=box.x+box.width&&p.y>=box.y&&p.y<=box.y+box.height;
  if(inside(a)||inside(b))return true;
  const corners=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}];
  return corners.some((corner,i)=>drawingInsideCapsule(corner,a,b,radius)||drawingCapsuleIntervals(corner,corners[(i+1)%4],a,b,radius).length)
}
function markErasedGraphic(e,stroke){
  if(!e.formulaGraphic)return;e.formulaGraphic.currentMath=null;e.formulaGraphic.semanticStatus='needs-review';delete e.formulaGraphic.review;
  const last=e.formulaGraphic.edits.at(-1);if(!stroke||last?.kind==='erase'&&last.surface===stroke.surface)return;
  const points=stroke.points.map(p=>[p[0]*e.image.width,p[1]*e.image.height]);
  e.formulaGraphic.edits.push({kind:'erase',surface:stroke.surface,points,radius:Math.max(stroke.radius[0]*e.image.width,stroke.radius[1]*e.image.height),source:'surface-mask'})
}
function eraseDrawingAt(p,from,target){
  eraserPosition=p;const radius=drawingRadius(),id=target?.closest?.('[data-id]')?.getAttribute('data-id'),e=get(id);
  if($('eraser-mode').value==='object'){const hit=e||shapeAt(p);if(hit){manualDrawing();deleteElements(board,[hit.id]);selected.delete(hit.id)}return}
  for(const original of [...board.elements]){
    if(original.type==='pen'){
      const erased=erasePen(original,{...p,radius,from},uid);if(!erased.changed)continue;const idx=board.elements.indexOf(original);
      if(erased.fragments.length)board.elements.splice(idx,1,...erased.fragments);else deleteElements(board,[original.id]);manualDrawing();continue
    }
    for(const surface of ['body',...(['line','arrow'].includes(original.type)?['label']:[])]){
      const box=drawingSurfaceBox(original,surface);if(!box)continue;
      const a=surface==='body'&&!['line','arrow'].includes(original.type)?worldToLocal(original,from||p):from||p,b=surface==='body'&&!['line','arrow'].includes(original.type)?worldToLocal(original,p):p;
      if(!drawingSurfaceTouched(a,b,radius,box))continue;
      const stroke={surface,points:[drawingSurfacePoint(original,from||p,box,surface),drawingSurfacePoint(original,p,box,surface)],radius:[radius/box.width,radius/box.height]};
      if(appendSurfaceErasure(original,stroke)!==false)manualDrawing()
    }
  }
  selected=new Set([...selected].filter(get))
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
