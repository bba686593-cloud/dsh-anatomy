// Formula graphics are pixels on the paper; symbolic originals remain machine provenance.
const formulaRasterCache=new Map(),graphicCanvasCache=new Map();
let graphicQueue=Promise.resolve(),graphicJobCount=0;
function graphicJob(fn){graphicBusy=true;graphicJobCount++;graphicQueue=graphicQueue.then(fn).catch(error=>message('图形修改未完成：'+error.message)).finally(()=>{graphicJobCount--;graphicBusy=graphicJobCount>0});return graphicQueue}
async function flushGraphicJobs(){await graphicQueue}
function decodeGraphic(src){return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('公式图形无法读取'));img.src=src})}
async function rasterFormula(value,{fontSize=30}={}){
  const cacheKey=value+'\n'+fontSize;if(formulaRasterCache.has(cacheKey))return formulaRasterCache.get(cacheKey);
  const job=(async()=>{if(formulaMarkup(value,katex).error)throw Error('数学表达无法排版');if(!window.MathJax?.startup?.promise)throw Error('公式图形排版尚未就绪');await window.MathJax.startup.promise;
    const node=await window.MathJax.tex2svgPromise(value,{display:true}),svg=node.querySelector('svg');if(!svg||node.querySelector('[data-mml-node="merror"]'))throw Error('公式无法转换为图形');
    if(svg.querySelector('script,foreignObject,a,image')||[...svg.querySelectorAll('*')].some(n=>[...n.attributes].some(a=>/^on/i.test(a.name)||/href$/i.test(a.name)&&!a.value.startsWith('#'))))throw Error('公式包含不安全的图形引用');
    const [x,y,w,h]=svg.getAttribute('viewBox').split(/\s+/).map(Number),k=fontSize/1000,pad=5,width=Math.max(1,Math.ceil(w*k+pad*2)),height=Math.max(1,Math.ceil(h*k+pad*2));
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.setAttribute('viewBox',[x-pad/k,y-pad/k,w+2*pad/k,h+2*pad/k].join(' '));svg.style.color='#18233b';
    const img=await decodeGraphic('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg))),canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;if(canvas.width>16000||canvas.height>16000||canvas.width*canvas.height>40000000)throw Error('公式图形过大，请分开放入画板');canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return {src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth:width,displayHeight:height}
  })();formulaRasterCache.set(cacheKey,job);try{return await job}catch(error){formulaRasterCache.delete(cacheKey);throw error}
}
function formulaImageElement(value,raster,{at=null,metadata={}}={}){const r=surface.getBoundingClientRect(),w=raster.displayWidth||raster.width/2,h=raster.displayHeight||raster.height/2,e={...makeElement('image',at?.x??(r.width/2-view.x)/view.scale-w/2,at?.y??(r.height/2-view.y)/view.scale-h/2,w,h),...structuredClone(metadata)};e.type='image';e.text='';e.math='';delete e.mathExpressions;delete e.mathDisplay;delete e.mathHandwriting;e.image={src:raster.src,width:raster.width,height:raster.height,alt:'数学图形'};e.formulaGraphic={version:1,originalMath:value,currentMath:value,semanticStatus:'source-aligned',originalImage:{src:raster.src,width:raster.width,height:raster.height},renderer:{name:'MathJax SVG',version:'3.2.2'},edits:[]};return e}
async function insertFormulaGraphic(value,options={}){const sourceBoard=board,revision=versionSession.selected?.revision,baseline=JSON.stringify(board),raster=await rasterFormula(value);if(board!==sourceBoard||revision!==versionSession.selected?.revision||baseline!==JSON.stringify(board)||canvasDraftPending()||options.guard&&options.guard()===false)throw Error('准备图形时画板已变化，请重新粘贴');const e=formulaImageElement(value,raster,options);const next=structuredClone(board);next.elements.push(e);const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length)throw Error(errors[0].message);change(()=>{board=next;manualDrawing();selected=new Set([e.id])});return e}
async function prepareFormulaGraphic(id,expression='primary'){
  const e=get(id);if(!e||e.formulaGraphic)return e;const entries=elementMathEntries(e);if(!entries.some(f=>f.id===expression))return e;
  const sourceBoard=board,selectionRevision=versionSession.selected?.revision,baseline=JSON.stringify(e),boxes=drawingContentBoxes(e),parts=detachedContent(e,boxes),children=[],single=e.type==='math'&&!e.text?.trim()&&entries.length===1;let selectedGraphic;
  for(const child of parts.children){if(child.type!=='math'||child.mathDisplay==='ink'){children.push(child);continue}const raster=await rasterFormula(child.math,{fontSize:child.fontSize||24});if(board!==sourceBoard||get(id)!==e||versionSession.selected?.revision!==selectionRevision||JSON.stringify(get(id))!==baseline)throw Error('原公式或选定版本已变化，请重新选择');
    const fit=Math.min(child.width/(raster.displayWidth||raster.width/2),child.height/(raster.displayHeight||raster.height/2)),width=(raster.displayWidth||raster.width/2)*fit,height=(raster.displayHeight||raster.height/2)*fit,candidate=formulaImageElement(child.math,raster,{at:{x:child.x+(child.width-width)/2,y:child.y+(child.height-height)/2},metadata:{...drawingMapping(child),id:single?e.id:child.id,width,height,rotation:child.rotation||0,derivedFrom:e.id,expressionOrigin:child.expressionOrigin}});drawingCopyErasures(child,candidate);for(const stroke of candidate.erasures||[])markErasedGraphic(candidate,stroke);candidate.formulaGraphic.sourceElement=structuredClone(e);candidate.formulaGraphic.expressionId=child.expressionOrigin;children.push(candidate);if(child.expressionOrigin===expression)selectedGraphic=candidate
  }
  if(!selectedGraphic)return e;board.elements.splice(board.elements.indexOf(e),1,...(single?children:[parts.parent,...children]));manualDrawing();return selectedGraphic
}
async function graphicsEraseAt(p,from,target){eraseDrawingAt(p,from,target)}
function applyCanvasErasures(canvas,e,surface='body',sourceBox=null,carrier=null){
  const strokes=(e.erasures||[]).filter(stroke=>(stroke.surface||'body')===surface);if(!strokes.length)return canvas;
  carrier=carrier||drawingSurfaceBox(e,surface);sourceBox=sourceBox||carrier;if(!sourceBox||!carrier)return canvas;
  const ctx=canvas.getContext('2d'),kx=canvas.width/sourceBox.width,ky=canvas.height/sourceBox.height;ctx.save();ctx.globalCompositeOperation='destination-out';ctx.translate((carrier.x+(carrier.flipX?carrier.width:0)-sourceBox.x)*kx,(carrier.y+(carrier.flipY?carrier.height:0)-sourceBox.y)*ky);ctx.scale((carrier.flipX?-carrier.width:carrier.width)*kx,(carrier.flipY?-carrier.height:carrier.height)*ky);
  for(const stroke of strokes){const [rx,ry]=stroke.radius,points=stroke.points.map(p=>[p[0]/rx,p[1]/ry]);ctx.save();ctx.scale(rx,ry);ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(...points[0]);for(const p of points.slice(1))ctx.lineTo(...p);ctx.stroke();ctx.beginPath();ctx.arc(...points.at(-1),1,0,Math.PI*2);ctx.fill();ctx.restore()}
  ctx.restore();return canvas
}
async function graphicCanvas(e){
  const src=e.image.src;let source=graphicCanvasCache.get(src);
  if(!source){const img=await decodeGraphic(src);source=document.createElement('canvas');source.width=e.image.width;source.height=e.image.height;source.getContext('2d').drawImage(img,0,0,source.width,source.height);graphicCanvasCache.set(src,source);if(graphicCanvasCache.size>40)graphicCanvasCache.delete(graphicCanvasCache.keys().next().value)}
  if(!(e.erasures||[]).some(stroke=>(stroke.surface||'body')==='body'))return source;
  const box=e.formulaGraphic?drawingSurfaceBox(e):lassoVisualImageBox(e),factor=Math.max(1,Math.min(2*box.width/source.width,2*box.height/source.height,4096/source.width,4096/source.height)),canvas=document.createElement('canvas');canvas.width=Math.ceil(source.width*factor);canvas.height=Math.ceil(source.height*factor);canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);return applyCanvasErasures(canvas,e,'body',box)
}
function graphicPixelPoint(e,p){const q=worldToLocal(e,p);return {x:(q.x-e.x)*e.image.width/e.width,y:(q.y-e.y)*e.image.height/e.height}}
function markGraphicEdited(e,kind,geometry,layout=true){e.formulaGraphic.currentMath=null;e.formulaGraphic.semanticStatus='needs-review';delete e.formulaGraphic.review;e.formulaGraphic.edits.push({kind,...geometry});if(layout)manualDrawing()}
async function mergeGraphicPen(pen){
  if(!pen||pen.type!=='pen')return;
  // Only adjacent topmost content can be fused without changing paint order.
  // A separate stroke can also paint back into a previously erased region.
  if(board.elements.at(-1)!==pen)return;
  const original=board.elements.at(-2);if(!original||original.erasures?.length)return;
  for(const entry of elementMathEntries(original)){
    const box=drawingContentBoxes(original).find(b=>b.part===entry.id);
    if(!box||!lassoHit(pen,[[box.x,box.y],[box.x+box.width,box.y],[box.x+box.width,box.y+box.height],[box.x,box.y+box.height]].map(([x,y])=>box.world?{x,y}:localToWorld(original,{x,y}))))continue;
    if((entry.id==='primary'?original.mathDisplay:inkExpression(original,entry.id)?.display)==='ink')continue;
    await prepareFormulaGraphic(original.id,entry.id);break
  }
  if(get(pen.id)!==pen||board.elements.at(-1)!==pen)return;
  const e=board.elements.at(-2);if(!e?.formulaGraphic||e.erasures?.length||!lassoHit(pen,[[e.x,e.y],[e.x+e.width,e.y],[e.x+e.width,e.y+e.height],[e.x,e.y+e.height]].map(([x,y])=>localToWorld(e,{x,y}))))return;
  const strokes=penToStroke(pen).map(([x,y])=>({x,y})),baseline=JSON.stringify(e),old=await graphicCanvas(e);
  if(JSON.stringify(get(e.id))!==baseline||get(pen.id)!==pen||board.elements.at(-1)!==pen||board.elements.at(-2)!==e)return;
  const kx=e.image.width/e.width,ky=e.image.height/e.height,width=pen.strokeWidth||3,localPoints=strokes.map(p=>{const q=worldToLocal(e,p);return{x:q.x-e.x,y:q.y-e.y}}),pts=localPoints.map(p=>({x:p.x*kx,y:p.y*ky})),padX=width*kx/2+2,padY=width*ky/2+2,left=Math.floor(Math.min(0,...pts.map(p=>p.x-padX))),top=Math.floor(Math.min(0,...pts.map(p=>p.y-padY))),right=Math.ceil(Math.max(old.width,...pts.map(p=>p.x+padX))),bottom=Math.ceil(Math.max(old.height,...pts.map(p=>p.y+padY))),c=document.createElement('canvas');
  c.width=right-left;c.height=bottom-top;if(c.width*c.height>40000000)throw Error('补画区域过大，请分开绘制');const ctx=c.getContext('2d');ctx.drawImage(old,-left,-top);ctx.save();ctx.translate(-left,-top);ctx.scale(kx,ky);ctx.strokeStyle=pen.stroke;ctx.fillStyle=pen.stroke;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  if(localPoints.every(p=>p.x===localPoints[0].x&&p.y===localPoints[0].y)){ctx.arc(localPoints[0].x,localPoints[0].y,width/2,0,Math.PI*2);ctx.fill()}
  else{ctx.moveTo(localPoints[0].x,localPoints[0].y);for(const p of localPoints.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke()}ctx.restore();
  const sourceGeometry={x:e.x,y:e.y,width:e.width,height:e.height,rotation:e.rotation||0},worldCenter=localToWorld(e,{x:e.x+(left+c.width/2)*e.width/old.width,y:e.y+(top+c.height/2)*e.height/old.height}),w=c.width*e.width/old.width,h=c.height*e.height/old.height;e.x=worldCenter.x-w/2;e.y=worldCenter.y-h/2;e.width=w;e.height=h;e.image={...e.image,src:c.toDataURL('image/png'),width:c.width,height:c.height};graphicCanvasCache.set(e.image.src,c);markGraphicEdited(e,'ink',{points:pts.map(p=>[p.x-left,p.y-top]),strokeWidth:width,strokeWidthSpace:'world',pixelScale:{x:kx,y:ky},sourceGeometry,imageOffset:{x:-left,y:-top},color:pen.stroke,rawElement:structuredClone(pen)});board.elements=board.elements.filter(p=>p!==pen);selected=new Set([e.id]);
}
function lassoSvg(){const active=drag?.kind==='lasso',region=active?drag.points:lassoRegion;if(!region?.length)return '';return '<path class="lasso-region'+(active?' lasso-stroke':'')+'" data-lasso-path pointer-events="none" fill-rule="evenodd" d="M'+region.map(p=>p.x+' '+p.y).join(' L')+(active?'':' Z')+'" stroke-width="'+2/view.scale+'"/>'}
function completeLasso(points){
  tool='lasso';canvasTap=null;for(const b of document.querySelectorAll('[data-tool]'))b.setAttribute('aria-pressed',String(b.dataset.tool==='lasso'));surface.classList.toggle('draw',true);surface.classList.toggle('lasso-mode',true);surface.classList.toggle('pan',false);
  const first=points[0],furthest=first&&points.reduce((a,p)=>Math.hypot(p.x-first.x,p.y-first.y)>Math.hypot(a.x-first.x,a.y-first.y)?p:a,first),span=furthest&&Math.hypot(furthest.x-first.x,furthest.y-first.y),area=span&&points.some(p=>Math.abs((furthest.x-first.x)*(p.y-first.y)-(furthest.y-first.y)*(p.x-first.x))/span>2/view.scale);
  lassoRegion=points.length>=3&&span*view.scale>6&&area?points.map(p=>({...p})):null;lassoInkSlices=[];selected.clear();
  if(lassoRegion){selected=new Set(lassoSelection(board.elements,lassoRegion));for(const original of board.elements){
    const geometryHit=selected.has(original.id);
    if(original.type==='pen'){if(geometryHit)lassoInkSlices.push({original:structuredClone(original),...clipPenToLasso(original,lassoRegion,uid)})}
    else if(original.formulaGraphic){if(geometryHit)lassoInkSlices.push({original:structuredClone(original),graphic:true,inside:[],outside:[]})}
    else if(original.mathDisplay==='ink'&&validMathInk(primaryMathInk(original))&&!original.erasures?.length){
      const boxes=lassoVisualBoxes(original),pens=inkAsPens(original,boxes.find(b=>b.part==='primary')).map(p=>({...p,id:uid(),derivedFrom:original.id})),parts=pens.map(p=>clipPenToLasso(p,lassoRegion,uid)),inside=parts.flatMap(p=>p.inside),rest=structuredClone(original);rest.math='';delete rest.mathDisplay;delete rest.mathHandwriting;if(rest.handwriting?.mode==='math')delete rest.handwriting;
      const extrasBoxes=boxes.filter(box=>box.part!=='primary'),hasExtras=humanText(rest.text||'').trim()||elementMathEntries(rest).length,extrasHit=hasExtras&&lassoVisualBoxesHit(original,extrasBoxes.length?extrasBoxes:fallbackLassoVisualBoxes(rest),lassoRegion);
      if(inside.length||extrasHit){selected.add(original.id);const retained=original.type==='math'?detachedContent(rest,boxes).children:[rest];lassoInkSlices.push({original:structuredClone(original),inside,outside:inside.length?[...parts.flatMap(p=>p.outside),...retained]:[structuredClone(original)],...(extrasHit?{visualExtras:{original:rest,boxes:extrasBoxes}}:{})})}
    }
    else if(humanText(original.text||'').trim()||elementMathEntries(original).length||original.type==='image'&&safeBoardImage(original)){
      const boxes=lassoVisualBoxes(original),imageBox=lassoVisualImageBox(original),hitBoxes=boxes.length?boxes:fallbackLassoVisualBoxes(original);
      if(lassoVisualBoxesHit(original,[...hitBoxes,...(imageBox?[imageBox]:[])],lassoRegion)){selected.add(original.id);lassoInkSlices.push({original:structuredClone(original),visual:true,inside:[],outside:[structuredClone(original)],boxes})}
    }
  }}render();message(!lassoRegion?'按住拖动围出一块区域，松手完成圈选。':lassoInkSlices.length?'已圈选内容，点击左侧「识别」选择中文或公式；可直接再圈。':'已圈选图形；可直接再圈，切换「选择」后编辑图形。')
}
function openLassoHandwriting(mode='math'){
  if(typeof spaceIsActive==='function'&&spaceIsActive())return spaceRecognitionRequest(mode);
  if(!lassoRegion){setTool('lasso');message('先在画板圈住需要识别的文字、公式、图片或笔迹。');return false}
  if(!lassoInkSlices.some(s=>s.inside.length||s.graphic||s.visual||s.visualExtras)){message('圈内没有可识别的文字、公式、图片或笔迹，圈选已保留，请重新圈选内容。');return false}
  selected=new Set(lassoInkSlices.map(s=>s.original.id));return openHandwriting({mode,lasso:true})
}
// Save only inert layout/style data, never DOM nodes or foreignObject markup.
function lassoVisualBoxes(e){
  const boxes=drawingContentBoxes(e),selector=['g.element','g.relation-label'].flatMap(kind=>[kind+'[data-id="'+e.id+'"] .shape-prose',kind+'[data-id="'+e.id+'"] [data-expression]']).join(', ');
  const nodes=[...(world.querySelectorAll?.(selector)||[])];
  return boxes.map((box,i)=>{const node=nodes[i],style=inlineComputedStyle(node);return {...box,fontFamily:style.fontFamily||'sans-serif',fontWeight:style.fontWeight||'400',fontStyle:style.fontStyle||'normal',color:style.color||'#24334e',lineHeight:box.fontSize*((parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.6||32)/(parseFloat(style.fontSize)||20)),...(box.part==='text'?{textLines:lassoVisualTextLines(e,node,box)}:{})}})
}
function lassoVisualTextLines(e,node,box){
  const textNode=node?.firstChild;if(textNode?.nodeType!==3||!document.createRange||textNode.textContent.length>20000)return null;
  const lines=[],range=document.createRange();let offset=0;
  try{for(const char of Array.from(textNode.textContent)){range.setStart(textNode,offset);offset+=char.length;range.setEnd(textNode,offset);if(char==='\n')continue;const rect=range.getBoundingClientRect();if(!rect.width||!rect.height)continue;const p=point({clientX:(rect.left+rect.right)/2,clientY:(rect.top+rect.bottom)/2}),center=box.world?p:worldToLocal(e,p),line=lines.at(-1);if(line&&Math.abs(line.y-center.y)<Math.max(1,box.fontSize*.2))line.text+=char;else lines.push({text:char,first:char,x:center.x,y:center.y})}return lines.length?lines:null}finally{range.detach?.()}
}
function lassoVisualBoxesHit(e,boxes,polygon){return boxes.some(box=>{const center=box.world?{x:box.x+box.width/2,y:box.y+box.height/2}:localToWorld(e,{x:box.x+box.width/2,y:box.y+box.height/2});return lassoHit({id:e.id,type:'text',x:center.x-box.width/2,y:center.y-box.height/2,width:box.width,height:box.height,rotation:box.world?0:e.rotation||0},polygon)})}
function lassoVisualImageBox(e){
  if(e.type!=='image'||!safeBoardImage(e))return null;const availableHeight=Math.max(20,e.height-imageCaptionHeight(e)),fit=Math.min(e.width/e.image.width,availableHeight/e.image.height),width=e.image.width*fit,height=e.image.height*fit;return {part:'image',x:e.x+(e.width-width)/2,y:e.y+(availableHeight-height)/2,width,height,world:false}
}
function fallbackLassoVisualBoxes(e){
  if(['line','arrow'].includes(e.type)){const label=lineLabels().find(l=>l.id===e.id);if(!label)return [];const boxes=[],fontSize=label.font,x=label.x+8,width=Math.max(1,label.w-16),height=Math.max(1,label.h-10),entries=elementMathEntries(e),text=humanText(label.text||'');let y=label.y+5;if(text){const h=Math.min(height,Math.max(1,text.split('\n').length)*fontSize*1.6);boxes.push({part:'text',x,y,width,height:h,fontSize,textAlign:'center',lineHeight:fontSize*1.6,world:true});y+=h+12}for(const f of entries){const h=Math.min(height,fontSize*2);boxes.push({part:f.id,x,y,width,height:h,fontSize,textAlign:'center',world:true});y+=h+12}return boxes}
  const relation=['line','arrow'].includes(e.type),standalone=['text','math'].includes(e.type),centered=['rect','ellipse','diamond','polygon'].includes(e.type),caption=e.type==='image'?imageCaptionHeight(e):0,insetX=e.type==='diamond'?.72:e.type==='ellipse'?.82:1,insetY=e.type==='diamond'?.45:e.type==='ellipse'?.64:1;
  const width=e.type==='image'?Math.max(1,e.width-24):Math.max(1,e.width*insetX-(standalone?0:Math.min(32,e.width*.18))),height=e.type==='image'?Math.max(1,caption-16):Math.max(1,e.height*insetY-(standalone?0:Math.min(24,e.height*.18))),x=e.type==='image'?e.x+12:e.x+(e.width-width)/2;
  let y=e.type==='image'?e.y+e.height-caption+8:centered?e.y+(e.height-height)/2:e.y+(standalone?0:Math.min(12,e.height*.09));
  const text=humanText(e.text||e.type==='image'&&e.image?.alt||''),entries=elementMathEntries(e),fontSize=e.fontSize||16,boxes=[],textAlign=e.textAlign||(centered?'center':'left');
  if(text){const lines=text.split('\n').reduce((count,line)=>count+Math.max(1,Math.ceil(Array.from(line).length*fontSize*.9/width)),0),h=Math.min(height,lines*fontSize*1.6);boxes.push({part:'text',x,y,width,height:h,fontSize,textAlign,lineHeight:fontSize*1.6,world:relation});y+=h+12}
  for(const f of entries){const size=Math.max(12,Math.min(Math.max(fontSize,20),Math.floor((width-10)/texWidthEm(f.value)))),h=Math.max(size*1.6,Math.min(height/Math.max(1,entries.length),size*3));boxes.push({part:f.id,x,y,width,height:h,fontSize:size,textAlign,world:relation});y+=h+12}
  return boxes
}
function lassoWrappedLines(text,width,ctx,fontSize){
  const lines=[];for(const paragraph of text.split('\n')){let line='';for(const char of Array.from(paragraph)){const next=line+char,measured=ctx.measureText?.(next)?.width??Array.from(next).length*fontSize*.9;if(line&&measured>width){lines.push(line);line=char}else line=next}lines.push(line)}return lines
}
async function rasterLassoVisual(slice){
  const e=slice.original,boxes=slice.boxes?.length?slice.boxes:fallbackLassoVisualBoxes(e),tiles=[];
  if(e.type==='image'&&safeBoardImage(e)){
    const source=await graphicCanvas({...e,erasures:[]});tiles.push({...lassoVisualImageBox(e),image:source})
  }
  for(const box of boxes){
    if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)continue;
    if(box.part==='text'){const text=humanText(e.text||e.type==='image'&&e.image?.alt||'');if(text.trim())tiles.push({...box,text})}
    else{const expression=inkExpression(e,box.part),value=expression?.value;if(!value?.trim())continue;
      if((box.part==='primary'?e.mathDisplay:expression.display)==='ink'&&validMathInk(expression.handwriting)){const pens=inkAsPens({...e,mathHandwriting:expression.handwriting},box);tiles.push({...box,pens});continue}
      const raster=await rasterFormula(value,{fontSize:box.fontSize||e.fontSize||20}),image=await decodeGraphic(raster.src),naturalWidth=raster.displayWidth||raster.width/2,naturalHeight=raster.displayHeight||raster.height/2,fit=Math.min(1,box.width/naturalWidth,box.height/naturalHeight),width=naturalWidth*fit,height=naturalHeight*fit;
      const align=box.textAlign||e.textAlign||(['rect','ellipse','diamond','polygon'].includes(e.type)?'center':'left'),offset=align==='center'?(box.width-width)/2:['right','end'].includes(align)?box.width-width:0;
      tiles.push({...box,image,x:box.x+offset,y:box.y+(box.height-height)/2,width,height})
    }
  }
  if(!tiles.length)throw Error('圈内没有可识别的可见内容。请重新圈选。');
  const worldSpace=['line','arrow'].includes(e.type),xs=tiles.flatMap(t=>[t.x,t.x+t.width]),ys=tiles.flatMap(t=>[t.y,t.y+t.height]),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(1,Math.max(...xs)-x),height=Math.max(1,Math.max(...ys)-y),k=Math.min(2,4096/width,4096/height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*k));canvas.height=Math.max(1,Math.ceil(height*k));const ctx=canvas.getContext('2d');ctx.save();ctx.scale(canvas.width/width,canvas.height/height);ctx.translate(-x,-y);
  for(const tile of tiles){
    if(tile.image){ctx.drawImage(tile.image,tile.x,tile.y,tile.width,tile.height);continue}
    if(tile.pens){for(const pen of tile.pens){const s=penToStroke(pen).map(([x,y])=>worldSpace?{x,y}:worldToLocal(e,{x,y}));ctx.strokeStyle=pen.stroke||'#18233b';ctx.lineWidth=pen.strokeWidth||3;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(s[0].x,s[0].y);for(const p of s.slice(1))ctx.lineTo(p.x,p.y);ctx.stroke()}continue}
    const fontSize=tile.fontSize||e.fontSize||16,lineHeight=tile.lineHeight||fontSize*1.6,align=tile.textAlign||e.textAlign||'left';ctx.font=(tile.fontStyle||'normal')+' '+(tile.fontWeight||'400')+' '+fontSize+'px '+(tile.fontFamily||'sans-serif');ctx.fillStyle=tile.color||'#24334e';ctx.textBaseline='top';ctx.textAlign=align==='center'?'center':['right','end'].includes(align)?'right':'left';
    const tx=tile.x+(ctx.textAlign==='center'?tile.width/2:ctx.textAlign==='right'?tile.width:0);ctx.save();ctx.beginPath();ctx.rect(tile.x,tile.y,tile.width,tile.height);ctx.clip();if(tile.textLines?.length){ctx.textAlign='left';ctx.textBaseline='alphabetic';for(const line of tile.textLines){const metrics=ctx.measureText(line.text),first=ctx.measureText(line.first),ascent=metrics.fontBoundingBoxAscent??fontSize*.8,descent=metrics.fontBoundingBoxDescent??fontSize*.2;ctx.fillText(line.text,line.x-first.width/2,line.y+(ascent-descent)/2)}}else{const lines=lassoWrappedLines(tile.text,tile.width,ctx,fontSize);for(let i=0;i<lines.length;i++)ctx.fillText(lines[i],tx,tile.y+i*lineHeight+(lineHeight-fontSize)/2)}ctx.restore()
  }
  ctx.restore();applyCanvasErasures(canvas,e,worldSpace?'label':'body',{x,y,width,height});
  return {canvas,x,y,width,height,world:worldSpace}
}
function lassoSourcePoint(e,source,p){const q=source.world?p:worldToLocal(e,p);return{x:(q.x-source.x)*source.canvas.width/source.width,y:(q.y-source.y)*source.canvas.height/source.height}}
function lassoSourceWorld(e,source,x,y){const p={x:source.x+x*source.width/source.canvas.width,y:source.y+y*source.height/source.canvas.height};return source.world?p:localToWorld(e,p)}
async function captureLassoRaster(session){
  const polygon=session.region,px=polygon.map(p=>p.x),py=polygon.map(p=>p.y),region={x:Math.min(...px),y:Math.min(...py),right:Math.max(...px),bottom:Math.max(...py)},content=[],pictures=new Map();
  for(const slice of session.slices){
    const e=slice.original,sources=[];
    if(slice.graphic)sources.push({canvas:await graphicCanvas(e),x:e.x,y:e.y,width:e.width,height:e.height,world:false});
    if(slice.visual)sources.push(await rasterLassoVisual(slice));
    if(slice.visualExtras)sources.push(await rasterLassoVisual(slice.visualExtras));
    for(const source of sources){
      const mask=document.createElement('canvas');mask.width=source.canvas.width;mask.height=source.canvas.height;const ctx=mask.getContext('2d');ctx.drawImage(source.canvas,0,0);ctx.globalCompositeOperation='destination-in';ctx.beginPath();const points=polygon.map(p=>lassoSourcePoint(e,source,p));ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill('evenodd');
      const data=ctx.getImageData(0,0,mask.width,mask.height).data;let left=mask.width,top=mask.height,right=-1,bottom=-1;
      for(let i=3;i<data.length;i+=4)if(data[i]){const n=(i-3)/4,x=n%mask.width,y=Math.floor(n/mask.width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}
      if(right>=left){for(const [x,y]of [[left,top],[right+1,top],[right+1,bottom+1],[left,bottom+1]])content.push(lassoSourceWorld(e,source,x,y));if(!pictures.has(e.id))pictures.set(e.id,[]);pictures.get(e.id).push(source)}
    }
    if(!slice.graphic&&!slice.visual)for(const pen of slice.inside){const r=(pen.strokeWidth||3)/2;for(const [x,y]of penToStroke(pen))content.push({x:x-r,y:y-r},{x:x+r,y:y+r})}
  }
  if(!content.length)throw Error('圈内没有可识别的可见内容。请重新圈选。');
  const x=Math.max(region.x,Math.min(...content.map(p=>p.x))),y=Math.max(region.y,Math.min(...content.map(p=>p.y))),width=Math.max(1,Math.min(region.right,Math.max(...content.map(p=>p.x)))-x),height=Math.max(1,Math.min(region.bottom,Math.max(...content.map(p=>p.y)))-y),k=Math.min(900/width,320/height),c=document.createElement('canvas');c.width=1000;c.height=420;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.translate(50,50);ctx.scale(k,k);ctx.translate(-x,-y);ctx.beginPath();ctx.moveTo(polygon[0].x,polygon[0].y);for(const p of polygon.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.clip('evenodd');
  for(const slice of session.slices){
    const e=slice.original;for(const source of pictures.get(e.id)||[]){const center=source.world?{x:source.x+source.width/2,y:source.y+source.height/2}:localToWorld(e,{x:source.x+source.width/2,y:source.y+source.height/2});ctx.save();ctx.translate(center.x,center.y);ctx.rotate((source.world?0:e.rotation||0)*Math.PI/180);ctx.drawImage(source.canvas,-source.width/2,-source.height/2,source.width,source.height);ctx.restore()}
    if(!slice.graphic&&!slice.visual)for(const pen of slice.inside){const s=penToStroke(pen);ctx.strokeStyle=pen.stroke||'#18233b';ctx.lineWidth=pen.strokeWidth||3;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(...s[0]);for(const p of s.slice(1))ctx.lineTo(...p);ctx.stroke()}
  }
  return {src:c.toDataURL('image/png'),bounds:{x,y,width,height}}
}
async function clipFormulaOutside(original,polygon){
  const e=structuredClone(original),source=await graphicCanvas(original),c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d');ctx.drawImage(source,0,0);const points=polygon.map(p=>{const q=graphicPixelPoint(e,p);return{x:q.x*source.width/e.image.width,y:q.y*source.height/e.image.height}});ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill('evenodd');if(!ctx.getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v))return [];e.image={...e.image,src:c.toDataURL('image/png'),width:c.width,height:c.height};delete e.erasures;markGraphicEdited(e,'crop',{points:points.map(p=>[p.x,p.y]),region:'圈内已识别；此图只保留圈外像素'},false);return [e]
}
async function applyRecognizedDrawing(value,handwriting){
  if(!selectedInkUnchanged()){$('ink-feedback').textContent='原笔迹已变化，请重新圈选识别。';return false}const requestRevision=inkRevision,sourceSession=inkLassoSession,sourceBoard=board,versionRevision=versionSession.selected?.revision,raw=inkSourceIds.map(get).map(e=>structuredClone(e)),slices=typeof inkLassoSession!=='undefined'&&inkLassoSession?structuredClone(inkLassoSession.slices):lassoInkSlices.length?structuredClone(lassoInkSlices):raw.map(original=>({original,inside:[original],outside:[]})),inside=slices.flatMap(s=>s.inside),all=inside.flatMap(penToStroke),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),bounds=sourceSession?.bounds||(all.length?{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(30,Math.max(...xs)-Math.min(...xs)),height:Math.max(30,Math.max(...ys)-Math.min(...ys))}:null);if(!bounds)return false;
  let candidate;try{if(inkMode==='math'){const raster=await rasterFormula(value);if($('ink-result').value.trim()!==value||inkRevision!==requestRevision||inkLassoSession!==sourceSession||!$('ink-dialog').open||board!==sourceBoard||!selectedInkUnchanged()||versionSession.selected?.revision!==versionRevision)throw Error('识别已取消，或原笔迹和版本已变化，请重新圈选');candidate=formulaImageElement(value,raster,{at:{x:bounds.x,y:bounds.y}})}else candidate={...makeElement('text',bounds.x,bounds.y,Math.max(100,bounds.width),Math.max(40,bounds.height)),text:value,handwriting};
    for(const slice of slices)if(slice.graphic)slice.outside=await clipFormulaOutside(slice.original,sourceSession?.region||lassoRegion);if($('ink-result').value.trim()!==value||inkRevision!==requestRevision||inkLassoSession!==sourceSession||!$('ink-dialog').open||board!==sourceBoard||!selectedInkUnchanged()||versionSession.selected?.revision!==versionRevision)throw Error('识别已取消，或原内容已变化，请重新圈选');const outside=slices.flatMap(s=>s.outside),outsideIds=new Set(outside.map(e=>e.id)),reused=raw.find(e=>!outsideIds.has(e.id));candidate.id=reused?.id||uid();const mapping=drawingMapping(raw[0]);delete mapping.formulaGraphic;delete mapping.erasures;Object.assign(candidate,mapping,{id:candidate.id,type:candidate.type,derivedFrom:raw[0].id});candidate.recognition={rawElements:raw,reviewedValue:value,sourceElements:inkSourceIds,region:structuredClone(sourceSession?.region||lassoRegion),mappings:raw.map(e=>({id:e.id,...drawingMapping(e)})),candidate:handwriting.candidate};candidate.anchors=raw.flatMap(e=>e.anchors||[]).filter((a,i,all)=>all.findIndex(b=>JSON.stringify(a)===JSON.stringify(b))===i);candidate.targets=raw.flatMap(e=>e.targets||[]).filter((a,i,all)=>all.findIndex(b=>b.kind===a.kind&&b.id===a.id)===i);
    const next=structuredClone(board),removed=new Set(raw.filter(e=>!outsideIds.has(e.id)).map(e=>e.id)),sourceIds=new Set(raw.map(e=>e.id)),lastSource=next.elements.findLast(e=>sourceIds.has(e.id))?.id,slicesById=new Map(slices.map(slice=>[slice.original.id,slice]));
    // Keep each unrecognized remainder at its source's paint position. The
    // consolidated result occupies the last source slot, below later content.
    next.elements=next.elements.flatMap(e=>sourceIds.has(e.id)?[...(slicesById.get(e.id)?.outside||[]),...(e.id===lastSource?[candidate]:[])]:[e]);for(const e of next.elements){if(removed.has(e.from))e.from=candidate.id;if(removed.has(e.to))e.to=candidate.id}for(const step of next.reading?.steps||[])if(removed.has(step.element))step.element=candidate.id;const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length)throw Error(errors[0].message);change(()=>{board=next;manualDrawing();selected=new Set([candidate.id]);lassoRegion=null;lassoInkSlices=[]});closeInk(true);setTool('select');message('已在圈选位置排版；圈外笔迹与原稿保留。');return candidate
  }catch(error){$('ink-feedback').textContent=error.message;return false}
}
function boardGraphicPayload(elements){return {schema:'anatomy-graphics/1',body:A.body.slug,anatomyHash:A.anatomyHash,elements:structuredClone(elements)}}
async function copyGraphicElement(e){graphicClipboard=boardGraphicPayload([e]);if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'&&e.type==='image'){const source=e.erasures?.length?(await graphicCanvas(e)).toDataURL('image/png'):e.image.src,blob=await(await fetch(source)).blob();await navigator.clipboard.write([new ClipboardItem({'image/png':blob,'text/plain':new Blob([JSON.stringify(graphicClipboard)],{type:'text/plain'})})])}else await navigator.clipboard.writeText(JSON.stringify(graphicClipboard));message('图形已复制，可粘贴到画板。')}
async function copyFormulaGraphic(value){const raster=await rasterFormula(value);await copyGraphicElement(formulaImageElement(value,raster));}
function pasteGraphicPayload(payload){if(payload?.schema!=='anatomy-graphics/1'||!Array.isArray(payload.elements))return false;if(payload.body!==A.body.slug||payload.anatomyHash!==A.anatomyHash){message('图形来自另一个工程，源码映射需要先核对；可粘贴纯图片。');return true}const ids=new Map(payload.elements.map(e=>[e.id,uid()])),copies=payload.elements.map(e=>{const c=structuredClone(e);c.id=ids.get(e.id);c.x+=28;c.y+=28;if(c.type==='pen'&&Array.isArray(c.points3d))c.points3d=spaceStrokePoints(c).map(p=>[p.x,p.y,p.z]);if(c.from)c.from=ids.get(c.from)||c.from;if(c.to)c.to=ids.get(c.to)||c.to;return c}),next=structuredClone(board);next.elements.push(...copies);const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length){message(errors[0].message);return true}change(()=>{board=next;manualDrawing();selected=new Set(copies.map(e=>e.id))});return true}
document.addEventListener('copy',ev=>{if(editingTarget(ev.target)||document.querySelector?.('dialog[open]')||!selected.size)return;const elements=board.elements.filter(e=>selected.has(e.id));graphicClipboard=boardGraphicPayload(elements);ev.clipboardData?.setData('text/plain',JSON.stringify(graphicClipboard));ev.preventDefault();const e=elements.length===1?elements[0]:null;if(e?.type==='image'&&e.image.src.startsWith('data:image/png;')&&typeof navigator!=='undefined'&&navigator.clipboard?.write)copyGraphicElement(structuredClone(e)).catch(()=>message('画板数据已复制；当前浏览器未能写入图片剪贴板。'));else message('已复制选中图形和它的程序映射。')});
document.addEventListener('paste',ev=>{if(editingTarget(ev.target)||document.querySelector?.('dialog[open]')||canvasDraftPending())return;try{const p=JSON.parse(ev.clipboardData?.getData('text/plain')||'null');if(pasteGraphicPayload(p))ev.preventDefault()}catch{}},true);
$('recognize-lasso-text')?.addEventListener('click',()=>openLassoHandwriting('text'));$('recognize-lasso-math')?.addEventListener('click',()=>openLassoHandwriting('math'));
window.__anatomyBoard.graphics={raster:rasterFormula,prepare:prepareFormulaGraphic,flush:flushGraphicJobs,paste:pasteGraphicPayload,lasso:completeLasso,get region(){return lassoRegion},get slices(){return lassoInkSlices}};
