// Spatial recognition owns an immutable viewport session. Never route its
// profile through the 2D lasso's clipping, tool switching, or source replacement.
function spaceRecognitionState() {
  const camera=spaceState.engine?.info(),rect=spaceHost().getBoundingClientRect();
  return JSON.stringify({board,selectionRevision:versionSession.selected?.revision,tool,selected:[...selected],placement:spaceState.placement,profileReady:spaceState.profileReady,pose:spaceState.pose,tip:spaceState.penRig?.tip,transform:spaceState.transform,camera:camera&&{target:camera.target,distance:camera.distance,yaw:camera.yaw,pitch:camera.pitch,labelLayout:camera.labelLayout},viewport:[rect.width,rect.height]});
}
function spaceRecognitionCurrent(session) {
  return !!spaceMode&&!!session?.space&&session.state===spaceRecognitionState();
}
function spaceRecognitionCarrier(element) {
  if(!isSpaceLink(element))return element;
  if(spaceState.engine?.labelGeometry){
    const label=spaceState.engine.labelGeometry(element.id);
    if(label){
      if(!label.visible)throw Error('当前视角中这条说明已收起，请先聚焦该对象后再识别。');
      if(label.carrier)return {...element,...label.carrier,type:'text',extrusion:0};
    }
  }
  const link=spaceLinks(board.elements).find(edge=>edge.id===element.id);
  if(!link)return element;
  // Relation labels are separate, horizontal planes at the actual endpoints'
  // midpoint, including when stored link x/y/width/height are placeholders.
  const width=Math.min(280,Math.max(100,String(element.text||'').length*10)),height=elementMathEntries(element).length?100:42;
  return {...element,type:'text',x:(link.a.x+link.b.x-width)/2,y:(link.a.y+link.b.y-height)/2,z:(link.a.z+link.b.z)/2+2,width,height,rotationX:0,rotationY:0,rotation:0,extrusion:0};
}
function spaceRecognitionOutline(element,base=false) {
  const label=isSpaceLink(element)&&spaceState.engine?.labelGeometry?.(element.id);
  if(label){if(!label.visible)return [];if(label.corners?.length>=3)return label.corners.map(p=>spaceState.engine.project(p))}
  element=spaceRecognitionCarrier(element);
  if(element.type==='pen')return spaceWorldStroke(element).map(p=>spaceState.engine.project(p));
  let points=spaceShapeOutline(element);
  if(points.length<3)points=[{x:element.x,y:element.y},{x:element.x+element.width,y:element.y},{x:element.x+element.width,y:element.y+element.height},{x:element.x,y:element.y+element.height}];
  const z=(element.z||0)+(base?0:Math.max(0,element.extrusion||0));
  return points.map(p=>spaceState.engine.project(spacePosePoint(element,{x:p.x,y:p.y,z})));
}
function spaceRecognitionBox(points,pad=0) {
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs)-pad,y=Math.min(...ys)-pad,right=Math.max(...xs)+pad,bottom=Math.max(...ys)+pad;
  return [{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];
}
function spaceRecognitionVisibleRegion(points) {
  const rect=spaceHost().getBoundingClientRect();let output=points;
  for(const [axis,bound,sign]of [['x',0,1],['x',rect.width,-1],['y',0,1],['y',rect.height,-1]]){
    const input=output;output=[];if(!input.length)break;
    let a=input.at(-1),insideA=(a[axis]-bound)*sign>=0;
    for(const b of input){const insideB=(b[axis]-bound)*sign>=0;
      if(insideA!==insideB){const t=(bound-a[axis])/(b[axis]-a[axis]);output.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})}
      if(insideB)output.push(b);a=b;insideA=insideB;
    }
  }
  return output;
}
function spaceRecognitionReadable(element) {
  return element.type==='pen'||element.type==='image'||!!element.text?.trim()||!!element.math?.trim()||!!element.mathExpressions?.some(f=>f.value?.trim());
}
function spaceRecognitionScope() {
  const pending=spaceState.profileReady&&spacePlacementElement(),items=pending?[pending]:board.elements.filter(e=>selected.has(e.id));
  if(!items.length)return null;
  if(items.some(e=>isSpaceLink(e)&&spaceState.engine?.labelGeometry?.(e.id)?.visible===false))throw Error('当前视角中这条说明已收起，请先选中并点「阅读大小」，再识别。');
  const projected=items.map(e=>spaceRecognitionOutline(e,!!pending));
  if(projected.some(path=>!path.length||path.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.depth<=0)))throw Error('识别区域没有完整出现在视图中，请调整视角后重试。');
  let region=items.length===1?projected[0]:spaceRecognitionBox(projected.flat());
  if(items.length===1&&items[0].type==='pen')region=spaceRecognitionBox(region,8);
  region=spaceRecognitionVisibleRegion(region);
  if(region.length<3||region.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.depth<=0))throw Error('识别区域没有完整出现在视图中，请调整视角后重试。');
  // Use projected paths, rather than unrotated document boxes, to find the
  // semantic sources. The GPU capture still supplies the actual occlusion.
  const originals=board.elements.filter(e=>{
    if(!spaceRecognitionReadable(e))return false;
    const path=spaceRecognitionOutline(e);if(!path.length||path.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.depth<=0))return false;
    const closed=e.type==='pen'?path:[...path,path[0]];
    return drawingPathLassoHit(closed,region,2)||(e.type!=='pen'&&region.some(p=>drawingLassoInside(p,path)));
  }).map(e=>structuredClone(e));
  if(originals.length>500)throw Error('圈内来源太多，请分成较小区域识别。');
  const target=structuredClone(spaceRecognitionCarrier(items[0]));
  return {space:true,state:spaceRecognitionState(),region:region.map(p=>({x:p.x,y:p.y})),originals,baseline:JSON.stringify(originals),selectionRevision:versionSession.selected?.revision,target,profile:pending?structuredClone(pending):null,slices:originals.map(original=>({original,visual:true}))};
}
const spaceRecognitionEmpty='圈内没有可识别的文字、公式、图片或笔迹。三维轮廓和拉伸深度已保留，可取消后重新圈住内容。';
function spaceRecognitionRequest(mode=null) {
  if(spaceState.depthPreview){message('请先应用或取消分层预览，再识别。');return false}
  if(inkApplying||spaceState.gesture||spaceState.viewDrag){message('请先松开鼠标，完成当前操作。');return false}
  if(canvasDraftPending()){message('请先完成或取消正在编辑的内容，再识别。');return false}
  let session;try{spaceSyncScene();session=spaceRecognitionScope()}catch(error){message(error.message);return false}
  if(!session){message('先用三维套索圈住文字、公式、图片或笔迹，或用「选择」点中组件，再点击识别。');return false}
  if(mode==='text'||mode==='math'){
    if(!session.originals.length){message(spaceRecognitionEmpty);return false}
    return spaceRecognitionOpen({mode,session});
  }
  lassoChoiceSession=session;
  $('ink-choice-feedback').textContent=session.originals.length?'按当前三维视角识别圈内内容。确认后在同一三维姿态新增结果，原内容、轮廓和拉伸草稿保留。':spaceRecognitionEmpty;
  $('ink-choice-dialog').showModal();return true;
}
async function spaceRecognitionStart(mode) {
  const session=lassoChoiceSession;
  if(!$('ink-choice-dialog').open||!session?.space)return false;
  if(!spaceRecognitionCurrent(session)){closeLassoRecognitionChoice();message('三维内容、姿态或选定版本已变化，请重新点击识别。');return false}
  if(!session.originals.length){$('ink-choice-feedback').textContent=spaceRecognitionEmpty;return false}
  closeLassoRecognitionChoice();
  if(!await spaceRecognitionOpen({mode,session})||inkLassoSession!==session||!$('ink-dialog').open)return false;
  return recognizeInk();
}
async function spaceRecognitionOpen(options={}) {
  const session=options.session||spaceRecognitionScope();
  if(inkApplying||!session?.originals.length||!spaceRecognitionCurrent(session)){message('圈内没有可识别内容，或三维内容已变化。原内容与轮廓保留，请重新圈选。');return false}
  const previous=loadInkDraft();
  inkPaperSession=null;inkLassoSession=session;inkSourceIds=session.originals.map(e=>e.id);inkSourceBaseline=session.baseline;
  inkTarget=null;inkOriginal=null;inkActive=null;inkStrokes=[];inkMode=options.mode==='text'?'text':'math';
  inkChanged();$('ink-dialog').showModal();setInkMode(inkMode);
  const revision=inkRevision;session.capturing=true;session.captureError=false;
  $('ink-keep').hidden=false;$('ink-feedback').textContent='正在准备三维圈内预览…';
  $('ink-instructions').textContent='预览来自当前三维视角。确认后按原三维姿态新增结果，原内容、轮廓和拉伸草稿均保留。';updateInkPresentation();
  const current=()=>inkLassoSession===session&&revision===inkRevision&&$('ink-dialog').open&&spaceRecognitionCurrent(session);
  try{
    const started=Date.now();
    while(spaceState.engine.info().pendingImages>0){if(!current())throw Error('三维内容或选定版本已变化，请重新圈选。');if(Date.now()-started>8000)throw Error('圈内图片仍在加载，请稍后重试。');await new Promise(resolve=>setTimeout(resolve,25))}
    if(!current())throw Error('三维内容或选定版本已变化，请重新圈选。');
    const captured=spaceState.engine.captureRecognition({region:session.region});parseImageSource(captured.src);
    session.image=captured.src;session.bounds=structuredClone(captured.bounds);session.capturing=false;
    if(previous?.lassoSession?.space&&previous.lassoSession.state===session.state&&previous.mode===inkMode){$('ink-result').value=previous.result||'';inkRecognition=previous.candidate||null;previewInkResult();$('ink-feedback').textContent='已恢复这一区域上次未确认的识别结果，三维草稿仍保留。'}
    else $('ink-feedback').textContent='请核对三维圈内预览，再识别中文或公式。';
    updateInkPresentation();saveInkDraft();checkInkService();return true;
  }catch(error){if(inkLassoSession===session){session.capturing=false;session.captureError=true;$('ink-feedback').textContent='三维预览未完成：'+error.message+' 原内容、轮廓与拉伸草稿保留。';updateInkPresentation()}return false}
}
async function spaceRecognitionApply(value,handwriting) {
  const session=inkLassoSession,revision=inkRevision;
  const current=()=>inkLassoSession===session&&spaceRecognitionCurrent(session)&&revision===inkRevision&&$('ink-dialog').open&&$('ink-result').value.trim()===value;
  if(!current())throw Error('三维内容、结果或选定版本已变化，请重新识别。');
  const source=session.target,cap=(source.z||0)+Math.max(0,source.extrusion||0),center=spacePosePoint(source,{x:source.x+source.width/2,y:source.y+source.height/2,z:cap});
  let candidate;
  if(inkMode==='math')candidate=formulaImageElement(value,await rasterFormula(value));
  else{const width=Math.max(100,source.width),font=source.fontSize||19,lines=textLines(value,width,font);candidate=makeElement('text',0,0,width,Math.max(font*1.6,lines.length*font*1.5+16));candidate.text=value}
  if(!current())throw Error('生成结果时三维内容、结果或选定版本已变化，请重新识别。');
  const metadata=drawingMapping(session.originals[0]);
  for(const key of ['z','rotationX','rotationY','extrusion','formulaGraphic','recognition','fragmentOf','derivedFrom'])delete metadata[key];
  // Geometry comes only from the result and the snapshotted carrier pose.
  Object.assign(candidate,metadata,{id:candidate.id,type:candidate.type,x:center.x-candidate.width/2,y:center.y-candidate.height/2,z:center.z,rotationX:source.rotationX||0,rotationY:source.rotationY||0,rotation:source.rotation||0,handwriting:structuredClone(handwriting)});
  candidate.anchors=session.originals.flatMap(e=>e.anchors||[]).filter((a,i,all)=>all.findIndex(b=>JSON.stringify(a)===JSON.stringify(b))===i);
  candidate.targets=session.originals.flatMap(e=>e.targets||[]).filter((a,i,all)=>all.findIndex(b=>b.kind===a.kind&&b.id===a.id)===i);
  candidate.recognition={rawElements:structuredClone(session.originals),reviewedValue:value,sourceElements:[...inkSourceIds],candidate:handwriting.candidate,space:{version:1,region:structuredClone(session.region),profile:structuredClone(session.profile),pose:{rotationX:source.rotationX||0,rotationY:source.rotationY||0,rotation:source.rotation||0},center}};
  const next=structuredClone(board);next.elements.push(candidate);
  const errors=boardDiagnostics(next,A.organs,A.flows);if(errors.length)throw Error(errors[0].message);
  change(()=>{board=next;manualDrawing()});closeInk(true);spaceRequestPaint();message('识别结果已按三维姿态新增，原内容、轮廓和拉伸草稿保留，可撤销。');return candidate;
}
