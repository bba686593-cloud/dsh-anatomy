// Optional real WebGL2 renderer regression; see README for browser setup.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.ANATOMY_PLAYWRIGHT_MODULE || 'playwright')
import { readFile } from 'node:fs/promises'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const browser=await chromium.launch({headless:true,...(process.env.ANATOMY_BROWSER_EXECUTABLE?{executablePath:process.env.ANATOMY_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']})
try {
const page=await browser.newPage({viewport:{width:1100,height:750}})
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') errors.push(m.text())})
await page.setContent('<style>body{margin:0}#h{position:absolute;left:40px;top:30px;width:1000px;height:680px}</style><div id="h"></div>')
await page.addScriptTag({path:root+'/lib/vendor/three-space.js'})
await page.addScriptTag({content:(await readFile(root+'/lib/board-space.js','utf8')).replace(/export /g,'')})
await page.addScriptTag({path:root+'/lib/board-space-renderer.js'})
const result=await page.evaluate(async()=>{
 let invalidations=0
 const host=document.getElementById('h'),engine=window.engine=createSpaceRenderer(host,{onInvalidate(){invalidations++}})
 const back={id:'back',type:'rect',x:0,y:0,width:200,height:200,z:0,fill:'#fde68a',stroke:'#334155',strokeWidth:3,text:'后方图形'}
 const front={id:'front',type:'ellipse',x:0,y:0,width:200,height:200,z:100,fill:'#93c5fd',stroke:'#334155',strokeWidth:3,text:'GPU 深度'}
 let board={elements:[front,back]};engine.sync(board,new Set(['front']));engine.fit(true);engine.draw()
 const at=p=>{const q=engine.project(p);return{x:q.x+40,y:q.y+30}}, pick=p=>{const q=at(p);return engine.pick(q.x,q.y)}
 let q=at({x:100,y:100,z:100}),r=engine.unproject(q.x,q.y,100)
 const checks={depth:pick({x:100,y:100,z:100})==='front',roundTrip:Math.hypot(r.x-100,r.y-100)<1e-6,ellipseCorner:pick({x:9,y:9,z:100})!=='front'}
 engine.draw();let baseline=invalidations;engine.sync(structuredClone(board),new Set(['front']));engine.draw();checks.idleSync=invalidations===baseline
 engine.fit(false);checks.restoreTilt=engine.info().pitch<1.2
 engine.fit(true)
 let c=document.createElement('canvas');c.width=c.height=100;let ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,100,100);ctx.clearRect(30,30,40,40)
 const img={id:'img',type:'image',x:0,y:0,width:200,height:200,z:200,formulaGraphic:{},image:{src:c.toDataURL('image/png'),width:100,height:100}}
 board.elements.push(img);engine.sync(board,[]);await new Promise(r=>setTimeout(r,120));engine.draw();checks.transparentHole=pick({x:100,y:100,z:200})!=='img';checks.imageSolid=pick({x:20,y:20,z:200})==='img'
 board.elements=[{id:'frame',type:'frame',x:-40,y:-40,width:280,height:280,z:300,stroke:'#64748b'},{...back,text:''}];engine.sync(board,[]);engine.fit(true);engine.draw();checks.frameInterior=pick({x:100,y:100,z:300})==='frame'
 board.elements=[{id:'pen',type:'pen',x:0,y:0,width:200,height:100,z:60,points:[[0,0],[1,0]],points3d:[[1000,1000,60],[1200,1000,80]],rotation:90,strokeWidth:4}];engine.sync(board,[]);engine.fit(true);engine.draw();checks.penTransform=pick({x:150,y:50,z:70})==='pen'
 // Ink slots must display saved source strokes, including additional formulas.
 // A typesetting spy makes accidental candidate substitution observable.
 let formulaCalls=0
 const solid=document.createElement('canvas');solid.width=80;solid.height=20;solid.getContext('2d').fillRect(0,0,80,20)
 window.rasterFormula=async()=>{formulaCalls++;return{src:solid.toDataURL('image/png')}}
 const horizontal={mode:'math',strokes:[[[20,20],[180,20]],[[20,80],[180,80]]]}
 const vertical={mode:'math',strokes:[[[20,20],[20,80]],[[180,20],[180,80]]]}
 const ink={id:'ink',type:'math',x:0,y:0,z:0,width:200,height:100,math:'candidate',mathDisplay:'ink',mathHandwriting:horizontal}
 engine.sync({elements:[ink]},[]);engine.fit(true);engine.draw()
 checks.primaryInk=pick({x:100,y:4,z:0})==='ink'&&pick({x:100,y:27,z:0})===null&&formulaCalls===0
 delete ink.mathHandwriting;ink.handwriting=horizontal
 engine.sync({elements:[ink]},[]);engine.draw();checks.legacyInk=pick({x:100,y:4,z:0})==='ink'&&formulaCalls===0
 ink.math='';delete ink.mathDisplay;delete ink.handwriting
 ink.mathExpressions=[{id:'extra',value:'candidate',display:'ink',handwriting:horizontal}]
 engine.sync({elements:[ink]},[]);engine.draw();checks.expressionInk=pick({x:100,y:4,z:0})==='ink'&&formulaCalls===0
 ink.mathExpressions[0].handwriting=vertical
 engine.sync({elements:[ink]},[]);engine.draw()
 checks.inkEditInvalidatesTexture=pick({x:37,y:27,z:0})==='ink'&&pick({x:100,y:4,z:0})===null&&formulaCalls===0
 ink.mathExpressions[0].display='typeset'
 engine.sync({elements:[ink]},[]);await new Promise(r=>setTimeout(r,60));engine.draw()
 checks.inkDisplaySwitch=formulaCalls===1&&pick({x:100,y:27,z:0})==='ink'
 ink.mathExpressions[0].display='ink';ink.mathExpressions[0].handwriting=null
 engine.sync({elements:[ink]},[]);await new Promise(r=>setTimeout(r,30));engine.draw();checks.missingInkNeverTypesets=formulaCalls===1
 // Keep distant documents on the same globally aligned work grid, following pan.
 engine.sync({elements:[{...back,x:100000,y:-80000,text:''}]},[]);engine.fit(true);engine.setPlane(0,true,100);engine.draw()
 const gridBefore=engine.info(),revision=gridBefore.revision,geometryCount=gridBefore.geometries
 const aligned=info=>Math.abs(info.gridCenter.x-info.target.x)<=50&&Math.abs(info.gridCenter.y-info.target.y)<=50&&info.gridCenter.x%100===0&&info.gridCenter.y%100===0
 checks.distantGrid=aligned(gridBefore)
 engine.pan(450,-300);engine.draw();const gridAfter=engine.info()
 checks.gridFollowsCamera=aligned(gridAfter)&&gridAfter.gridCenter.x!==gridBefore.gridCenter.x&&gridAfter.revision===revision&&gridAfter.geometries===geometryCount
 engine.setPlane(0,false,100)
 engine.sync({elements:[]},[]);engine.draw();checks.deleteGeometries=engine.info().geometries===0
 // The four world anchors remain fixed while only the pen tip moves. Rig
 // geometry is retained across pointer events and never enters element picks.
 engine.fit(false)
 const anchors=[{x:-250,y:-200,z:180},{x:250,y:-200,z:180},{x:250,y:200,z:180},{x:-250,y:200,z:180}],tip={x:0,y:0,z:50}
 engine.setPenRig({visible:true,tip,anchors,drawing:false});engine.draw()
 const rigStart=engine.info(),tipScreen=at(tip),tipHit=engine.pickPen(tipScreen.x,tipScreen.y)
 checks.penTipPick=!!tipHit&&tipHit.distance<1e-6&&engine.pick(tipScreen.x,tipScreen.y)===null
 checks.penTipPickRadius=!!engine.pickPen(tipScreen.x+19,tipScreen.y)&&!engine.pickPen(tipScreen.x+21,tipScreen.y)
 checks.penRigDistances=rigStart.penRig.lengths.every((length,i)=>Math.abs(length-Math.hypot(anchors[i].x-tip.x,anchors[i].y-tip.y,anchors[i].z-tip.z))<1e-6)
 const forward=engine.viewDirection(),onView=engine.unprojectView(tipScreen.x+20,tipScreen.y+15,tip)
 checks.penViewPlane=Math.abs((onView.x-tip.x)*forward.x+(onView.y-tip.y)*forward.y+(onView.z-tip.z)*forward.z)<1e-6&&Math.abs(Math.hypot(forward.x,forward.y,forward.z)-1)<1e-9
 checks.penForwardDepth=engine.project({x:tip.x+forward.x*50,y:tip.y+forward.y*50,z:tip.z+forward.z*50}).depth>engine.project(tip).depth
 engine.fitPenRig();engine.draw()
 checks.penFitMargins=anchors.concat(tip).every(p=>{const q=engine.project(p);return q.x>=40&&q.x<=960&&q.y>=72&&q.y<=584})
 const fitted=anchors.concat(tip).map(p=>engine.project(p)),spanX=Math.max(...fitted.map(p=>p.x))-Math.min(...fitted.map(p=>p.x)),spanY=Math.max(...fitted.map(p=>p.y))-Math.min(...fitted.map(p=>p.y))
 checks.penFitUsesViewport=Math.max(spanX/(1000-160),spanY/(680-81.6-108.8))>0.88
 checks.penFitKeepsAnchors=JSON.stringify(engine.info().penRig.anchors)===JSON.stringify(anchors)
 baseline=invalidations;engine.setPenRig({visible:true,tip:{...tip},anchors:structuredClone(anchors),drawing:false});engine.draw();checks.penRigIdle=baseline===invalidations
 for(let i=0;i<80;i++){engine.setPenRig({tip:{x:i,y:i/2,z:50+i},drawing:true});engine.draw()}
 checks.penRigReusesGeometry=engine.info().geometries===rigStart.geometries&&engine.info().revision===rigStart.revision&&engine.info().elements===0
 engine.orbit(40,20);engine.pan(100,-20);engine.zoom(1.2);engine.draw()
 checks.penAnchorsStayFixed=JSON.stringify(engine.info().penRig.anchors)===JSON.stringify(anchors)
 const copy=engine.info().penRig;copy.anchors[0].x=999;copy.tip.x=999;checks.penInfoIsSnapshot=engine.info().penRig.anchors[0].x===anchors[0].x&&engine.info().penRig.tip.x===79
 const cameraBefore=JSON.stringify({target:engine.info().target,yaw:engine.info().yaw,pitch:engine.info().pitch,distance:engine.info().distance})
 engine.setPenRig({tip:{x:0,y:0,z:0},drawing:false});engine.draw()
 checks.penDoesNotMoveCamera=cameraBefore===JSON.stringify({target:engine.info().target,yaw:engine.info().yaw,pitch:engine.info().pitch,distance:engine.info().distance})
 const distant={...back,x:2000,y:-1500,z:700,text:''},fitBoard={elements:[distant]},fitBoardBefore=JSON.stringify(fitBoard)
 engine.sync(fitBoard,[]);engine.fitPenRig(true);engine.draw()
 checks.penFitIncludesContent=anchors.concat([{x:distant.x,y:distant.y,z:distant.z},{x:distant.x+distant.width,y:distant.y+distant.height,z:distant.z}]).every(p=>{const q=engine.project(p);return q.depth>0&&q.x>=40&&q.x<=960&&q.y>=72&&q.y<=584})&&engine.info().pitch>1.5
 checks.penNeverMutatesBoard=JSON.stringify(fitBoard)===fitBoardBefore
 engine.setPenRig({visible:false});engine.draw();checks.penHide=engine.info().penRig.visible===false&&!engine.pickPen(tipScreen.x,tipScreen.y)
 // A pending component uses real document geometry without becoming a
 // document element, pick target or camera/bounds input. Held movement keys
 // must update its transform without rebuilding GPU or text resources.
 engine.sync({elements:[{...back,text:''}]},[]);engine.fit(true);engine.draw()
 const placementBaseline=engine.info(),placementCamera=JSON.stringify({target:placementBaseline.target,yaw:placementBaseline.yaw,pitch:placementBaseline.pitch,distance:placementBaseline.distance})
 const addedObjects=[],originalAdd=AnatomyThree.Group.prototype.add
 AnatomyThree.Group.prototype.add=function(...objects){addedObjects.push(...objects);return originalAdd.apply(this,objects)}
 const ghost={id:'ghost',type:'rect',x:20,y:30,z:200,width:120,height:80,rotation:20,text:'待放置组件',fill:'#c084fc'}
 engine.setPlacement(ghost);engine.draw()
 AnatomyThree.Group.prototype.add=originalAdd
 const ghostGroup=addedObjects.find(node=>node.name==='space-component-placement'),renderedScene=ghostGroup.parent.parent,ghostInfo=engine.info(),ghostMaterials=[]
 ghostGroup.traverse(node=>{if(node.material)ghostMaterials.push(node.material)})
 checks.placementIsSeparate=ghostInfo.elements===1&&ghostInfo.revision===placementBaseline.revision&&pick({x:80,y:70,z:200})==='back'
 checks.placementRealGeometry=ghostGroup.children.length>=3&&ghostMaterials.every(style=>style.transparent&&style.opacity>0&&style.opacity<1&&!style.depthWrite)
 checks.placementPose=ghostGroup.position.x===80&&ghostGroup.position.y===-70&&ghostGroup.position.z===200&&Math.abs(ghostGroup.rotation.z+20*Math.PI/180)<1e-9
 checks.placementDiagnostics=JSON.stringify(ghostInfo.placement)===JSON.stringify({id:'ghost',type:'rect',x:20,y:30,z:200,rotation:20,rotationX:0,rotationY:0,extrusion:0})
 ghostInfo.placement.x=999;checks.placementInfoSnapshot=engine.info().placement.x===20
 baseline=invalidations;engine.setPlacement({...ghost});engine.draw();checks.placementIdle=baseline===invalidations
 const ghostGeometryCount=engine.info().geometries,ghostTextureCount=engine.info().textures,ghostChildren=ghostGroup.children.map(node=>node.uuid).join(',')
 for(let i=0;i<80;i++){engine.setPlacement({...ghost,x:20+i,y:30-i,z:200+i,rotation:20+i});engine.draw()}
 checks.placementReusesResources=renderedScene.getObjectByName('space-component-placement')===ghostGroup&&ghostChildren===ghostGroup.children.map(node=>node.uuid).join(',')&&engine.info().geometries===ghostGeometryCount&&engine.info().textures===ghostTextureCount
 checks.placementDoesNotMoveCamera=placementCamera===JSON.stringify({target:engine.info().target,yaw:engine.info().yaw,pitch:engine.info().pitch,distance:engine.info().distance})
 engine.fit(true);engine.draw();checks.placementExcludedFromFit=placementCamera===JSON.stringify({target:engine.info().target,yaw:engine.info().yaw,pitch:engine.info().pitch,distance:engine.info().distance})
 engine.setPlacement({...ghost,type:'ellipse'});engine.draw();checks.placementShapeChange=renderedScene.getObjectByName('space-component-placement')!==ghostGroup
 engine.setPlacement(null);engine.draw();checks.placementClears=engine.info().placement===null&&engine.info().geometries===placementBaseline.geometries&&!renderedScene.getObjectByName('space-component-placement')
 baseline=invalidations;engine.setPlacement(null);engine.draw();checks.placementClearIdle=baseline===invalidations
 engine.setPlacement({id:'arrow-ghost',type:'arrow',x:10,y:20,z:30,width:100,height:0,rotation:90,strokeWidth:3});engine.draw()
 const arrowGhost=renderedScene.getObjectByName('space-component-placement'),arrowVertices=arrowGhost.children[0].geometry.getAttribute('position')
 const arrowA=new AnatomyThree.Vector3().fromBufferAttribute(arrowVertices,0).applyMatrix4(arrowGhost.matrixWorld),arrowB=new AnatomyThree.Vector3().fromBufferAttribute(arrowVertices,1).applyMatrix4(arrowGhost.matrixWorld)
 checks.placementArrowRotates=Math.abs(arrowA.x-60)<1e-6&&Math.abs(arrowB.x-60)<1e-6&&Math.abs(arrowA.y-30)<1e-6&&Math.abs(arrowB.y+70)<1e-6
 engine.setPlacement({id:'slope-ghost',type:'line',x:10,y:20,z:30,endZ:80,width:100,height:0});engine.draw()
 const slopeGhost=renderedScene.getObjectByName('space-component-placement'),slopeVertices=slopeGhost.children[0].geometry.getAttribute('position')
 const slopeStart=new AnatomyThree.Vector3().fromBufferAttribute(slopeVertices,0).applyMatrix4(slopeGhost.matrixWorld),slopeEnd=new AnatomyThree.Vector3().fromBufferAttribute(slopeVertices,1).applyMatrix4(slopeGhost.matrixWorld)
 checks.placementSlopedLine=Math.abs(slopeStart.z-30)<1e-6&&Math.abs(slopeEnd.z-80)<1e-6
 engine.setPlacement({id:'slope-ghost',type:'line',x:20,y:20,z:40,endZ:90,width:100,height:0});engine.draw()
 checks.placementSlopedLineReusesGeometry=renderedScene.getObjectByName('space-component-placement')===slopeGhost
 const signedGhost={id:'signed-ghost',type:'arrow',x:10,y:20,z:30,endZ:-25,width:-100,height:-40,rotationX:31,rotationY:-27,rotation:18}
 engine.setPlacement(signedGhost);engine.draw()
 const signedGroup=renderedScene.getObjectByName('space-component-placement'),signedVertices=signedGroup.children[0].geometry.getAttribute('position')
 checks.placementSignedLinkPose=[{x:10,y:20,z:30},{x:-90,y:-20,z:-25}].every((point,index)=>{const expected=spacePosePoint(signedGhost,point),actual=new AnatomyThree.Vector3().fromBufferAttribute(signedVertices,index).applyMatrix4(signedGroup.matrixWorld);return Math.hypot(actual.x-expected.x,actual.y+expected.y,actual.z-expected.z)<1e-6})
 const mathGhost={id:'math-ghost',type:'math',x:10,y:20,z:30,width:200,height:100,math:'a^2+b^2=c^2'},formulaBefore=formulaCalls
 engine.setPlacement(mathGhost);await new Promise(resolve=>setTimeout(resolve,60));engine.draw()
 const formulaAfter=formulaCalls,mathGroup=renderedScene.getObjectByName('space-component-placement')
 for(let i=0;i<20;i++){engine.setPlacement({...mathGhost,x:i,z:i*2,rotation:i*5});engine.draw()}
 checks.placementFormulaReusesResources=formulaAfter===formulaBefore+1&&formulaCalls===formulaAfter&&renderedScene.getObjectByName('space-component-placement')===mathGroup
 // A new projected density may need another GPU raster, while the original
 // decoded image must remain shared. Verify both the source reuse and the
 // pixels of the actual placement texture rather than a global cache count.
 const imageSourceDescriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')
 let placementImageLoads=0
 try{
   Object.defineProperty(HTMLImageElement.prototype,'src',{...imageSourceDescriptor,set(value){if(value===img.image.src)placementImageLoads++;return imageSourceDescriptor.set.call(this,value)}})
   engine.setPlacement({...img,id:'image-ghost',x:30,y:40,z:50});engine.draw()
 }finally{Object.defineProperty(HTMLImageElement.prototype,'src',imageSourceDescriptor)}
 const placementImageGroup=renderedScene.getObjectByName('space-component-placement'),placementImageCanvas=placementImageGroup.children.find(node=>node.material?.map)?.material.map.image
 const placementAlpha=(x,y)=>placementImageCanvas.getContext('2d').getImageData(Math.floor(x*placementImageCanvas.width),Math.floor(y*placementImageCanvas.height),1,1).data[3]
 checks.placementImageSharesTexture=placementImageLoads===0&&engine.info().pendingImages===0&&placementAlpha(.1,.1)>240&&placementAlpha(.5,.5)===0&&engine.info().textureBytes<=engine.info().textureBudget
 engine.setPlacement(null);engine.draw()
 const recordGroup=id=>{let group;renderedScene.traverse(node=>{if(node.userData.spaceId===id)group=node.parent});return group}
 const nativePoint=p=>({x:p.x,y:-p.y,z:p.z}),delta3=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)
 const container={id:'container',type:'frame',x:-100,y:-100,z:0,width:400,height:400},contained={id:'contained',type:'rect',x:0,y:0,z:0,width:200,height:120,fill:'#93c5fd'}
 engine.sync({elements:[container,contained]},[]);engine.fit(true);engine.draw()
 checks.frameDoesNotStealContainedPick=pick({x:30,y:30,z:0})==='contained'
 checks.frameEmptyInteriorPick=pick({x:-50,y:-50,z:0})==='container'
 const pixelAt=p=>{const q=engine.project(p),c=document.createElement('canvas');c.width=engine.canvas.width;c.height=engine.canvas.height;const context=c.getContext('2d');context.drawImage(engine.canvas,0,0);return Array.from(context.getImageData(Math.floor(q.x*c.width/engine.canvas.clientWidth),Math.floor(q.y*c.height/engine.canvas.clientHeight),1,1).data)}
 const stackRed={id:'stack-red',type:'rect',x:0,y:0,z:0,width:200,height:120,fill:'#ef4444',text:'红色组件'},stackBlue={...stackRed,id:'stack-blue',fill:'#3b82f6',text:'蓝色组件'}
 engine.sync({elements:[stackRed,stackBlue]},[]);engine.fit(true);engine.draw()
 const stackPoint={x:30,y:30,z:0},bluePixel=pixelAt(stackPoint),redGroup=recordGroup('stack-red'),blueGroup=recordGroup('stack-blue'),stackTextures=engine.info().textures,stackRevision=engine.info().revision
 checks.coplanarPickMatchesVisibleFront=bluePixel[0]===59&&bluePixel[1]===130&&bluePixel[2]===246&&pick(stackPoint)==='stack-blue'
 engine.sync({elements:[stackBlue,stackRed]},[]);engine.draw()
 const redPixel=pixelAt(stackPoint)
 checks.documentReorderUpdatesVisibleAndPick=redPixel[0]===239&&redPixel[1]===68&&redPixel[2]===68&&pick(stackPoint)==='stack-red'&&engine.info().revision===stackRevision+1
 checks.documentReorderReusesResources=recordGroup('stack-red')===redGroup&&recordGroup('stack-blue')===blueGroup&&engine.info().textures===stackTextures
 const textBack={...stackRed,text:'AAAAAAAAAAAAAAAA'},blankFront={...stackBlue,text:''}
 const scanDarkText=()=>{const c=document.createElement('canvas');c.width=engine.canvas.width;c.height=engine.canvas.height;const context=c.getContext('2d');context.drawImage(engine.canvas,0,0);let count=0,first=null;for(let x=20;x<180;x+=2)for(let y=30;y<90;y+=2){const q=engine.project({x,y,z:0}),color=context.getImageData(Math.floor(q.x),Math.floor(q.y),1,1).data;if(color[0]<70&&color[1]<100&&color[2]<130){count++;if(!first)first={x,y,z:0}}}return{count,first}}
 engine.sync({elements:[textBack]},[]);engine.fit(true);engine.draw();const visibleBackText=scanDarkText()
 engine.sync({elements:[textBack,blankFront]},[]);engine.draw()
 checks.backTextDoesNotLeakThroughFront=visibleBackText.count>0&&scanDarkText().count===0&&pick(visibleBackText.first)==='stack-blue'
 const translucent=document.createElement('canvas');translucent.width=translucent.height=100;const translucentContext=translucent.getContext('2d');translucentContext.fillStyle='rgba(255,0,0,0.5)';translucentContext.fillRect(0,0,50,100)
 const translucentImage={id:'translucent-front',type:'image',x:0,y:0,z:50,width:200,height:120,formulaGraphic:{},image:{src:translucent.toDataURL('image/png'),width:100,height:100}}
 engine.sync({elements:[blankFront,translucentImage]},[]);engine.fit(true);await new Promise(resolve=>setTimeout(resolve,60));engine.draw()
 const blendedPixel=pixelAt({x:30,y:30,z:50}),holePixel=pixelAt({x:160,y:60,z:50})
 checks.frontImagePreservesTransparency=blendedPixel[0]>100&&blendedPixel[2]>80&&holePixel[0]===59&&holePixel[1]===130&&holePixel[2]===246&&pick({x:30,y:30,z:50})==='translucent-front'&&pick({x:160,y:60,z:50})==='stack-blue'
 engine.sync({elements:[{...stackBlue,z:80},stackRed]},[]);engine.fit(true);engine.draw()
 const foregroundPoint={x:30,y:30,z:80},foregroundPixel=pixelAt(foregroundPoint)
 checks.realDepthOverridesArrayOrder=pick(foregroundPoint)==='stack-blue'&&foregroundPixel[0]===59&&foregroundPixel[1]===130&&foregroundPixel[2]===246
 const pose=(e,p)=>{
   const rx=(e.rotationX||0)*Math.PI/180,ry=(e.rotationY||0)*Math.PI/180,rz=(e.rotation||0)*Math.PI/180,cx=e.x+e.width/2,cy=e.y+e.height/2
   let x=p.x-cx,y=p.y-cy,z=p.z-(e.z||0),ny=y*Math.cos(rx)-z*Math.sin(rx),nz=y*Math.sin(rx)+z*Math.cos(rx)
   y=ny;z=nz;const nx=x*Math.cos(ry)+z*Math.sin(ry);nz=-x*Math.sin(ry)+z*Math.cos(ry);x=nx;z=nz
   return{x:cx+x*Math.cos(rz)-y*Math.sin(rz),y:cy+x*Math.sin(rz)+y*Math.cos(rz),z:(e.z||0)+z}
 }
 const prism={id:'solid',type:'rect',x:-100,y:-60,z:30,width:200,height:120,extrusion:90,fill:'#93c5fd',text:'实体组件'}
 engine.sync({elements:[prism]},[]);engine.fit(false);engine.draw()
 const solidGroup=recordGroup('solid'),volume=solidGroup.children.find(node=>node.geometry?.type==='ExtrudeGeometry')
 volume.geometry.computeBoundingBox()
 checks.extrusionSolid=!!volume&&volume.geometry.groups.some(group=>group.materialIndex===1)&&volume.geometry.boundingBox.min.z===0&&volume.geometry.boundingBox.max.z===90
 checks.extrusionCapAndSidePick=pick({x:0,y:0,z:120})==='solid'&&pick({x:0,y:60,z:75})==='solid'
 checks.extrusionTextOnCap=solidGroup.children.some(node=>node.material?.map&&Math.abs(node.position.z-90)<1e-6)
 engine.sync({elements:[prism]},['solid']);engine.draw()
 checks.extrusionSelectionOnCap=recordGroup('solid').children.some(node=>node.userData.selection&&Math.abs(node.position.z-90.8)<1e-6)
 engine.sync({elements:[prism]},[]);engine.draw()
 const tilted={...prism,rotationX:35,rotationY:-25,rotation:18}
 engine.sync({elements:[tilted]},[]);engine.draw()
 const posedGroup=recordGroup('solid'),posed=nativePoint(new AnatomyThree.Vector3(35,-20,70).applyMatrix4(posedGroup.matrixWorld)),expected=pose(tilted,{x:35,y:20,z:100})
 checks.threeAxisPoseOrder=delta3(posed,expected)<1e-6&&posedGroup.rotation.order==='ZYX'
 const solidChildren=posedGroup.children.map(node=>node.uuid).join(','),solidTextures=engine.info().textures
 for(let i=0;i<30;i++){engine.sync({elements:[{...tilted,x:-100+i,y:-60-i,z:30+i,rotationX:i,rotationY:-i,rotation:i*2}]},[]);engine.draw()}
 checks.documentPoseReusesResources=recordGroup('solid')===posedGroup&&solidChildren===posedGroup.children.map(node=>node.uuid).join(',')&&engine.info().textures===solidTextures
 engine.sync({elements:[{...prism,extrusion:-70}]},[]);engine.draw()
 const negativeVolume=recordGroup('solid').children.find(node=>node.geometry?.type==='ExtrudeGeometry');negativeVolume.geometry.computeBoundingBox()
 checks.signedExtrusion=negativeVolume.geometry.boundingBox.min.z===-70&&negativeVolume.geometry.boundingBox.max.z===0
 engine.fit(false);engine.orbit(0,-400);engine.draw()
 checks.negativeExtrusionVisibleFromBelow=engine.info().pitch<0&&engine.camera.position.z<-40&&pick({x:0,y:0,z:-40})==='solid'
 engine.orbit(0,-1e6);engine.draw();const lowerPitch=engine.info().pitch
 engine.orbit(0,1e6);engine.draw()
 checks.orbitBothHemispheresAvoidsPoles=lowerPitch< -1.5&&lowerPitch> -Math.PI/2&&engine.info().pitch>1.5&&engine.info().pitch<Math.PI/2&&[engine.camera.position.x,engine.camera.position.y,engine.camera.position.z].every(Number.isFinite)
 const profile={id:'profile',type:'polygon',x:0,y:0,z:0,width:200,height:200,points:[[0,0],[1,0],[1,.4],[.4,.4],[.4,1],[0,1]],fill:'none'}
 engine.sync({elements:[profile]},[]);engine.fit(true);engine.draw()
 checks.hollowProfileExactPick=pick({x:30,y:160,z:0})==='profile'&&pick({x:160,y:160,z:0})===null
 engine.setPlacement({...tilted,id:'volume-ghost'});engine.draw()
 const volumeGhost=renderedScene.getObjectByName('space-component-placement'),volumeGhostIds=volumeGhost.children.map(node=>node.uuid).join(','),volumeGhostRasters=new Set(),volumeGhostFormulaCalls=formulaCalls
 for(let i=0;i<30;i++){
   engine.setPlacement({...tilted,id:'volume-ghost',rotationX:i*2,rotationY:i,rotation:-i,x:i});engine.draw()
   const map=volumeGhost.children.find(node=>node.material?.map)?.material.map
   volumeGhostRasters.add(map.uuid)
 }
 checks.volumeGhostPoseReuse=renderedScene.getObjectByName('space-component-placement')===volumeGhost&&volumeGhostIds===volumeGhost.children.map(node=>node.uuid).join(',')&&volumeGhostRasters.size<10&&engine.info().textureBytes<=engine.info().textureBudget&&formulaCalls===volumeGhostFormulaCalls&&engine.info().placement.extrusion===90&&engine.info().placement.rotationX===58&&engine.info().placement.rotationY===29
 engine.setPlacement(null)
 engine.sync({elements:[{...back,text:''}]},[]);engine.fit(false);engine.draw()
 const plane={point:{x:10,y:20,z:30},normal:{x:.4,y:.5,z:1}},planePoint={x:60,y:20,z:10},planeScreen=at(planePoint),planeResult=engine.unprojectPlane(planeScreen.x,planeScreen.y,plane)
 checks.arbitraryPlaneRoundTrip=delta3(planePoint,planeResult)<1e-6
 checks.invalidPlaneRejected=engine.unprojectPlane(100,100,{point:{x:0,y:0,z:0},normal:{x:0,y:0,z:0}})===null
 const handleBaseline=engine.info(),handleCamera=JSON.stringify([handleBaseline.distance,handleBaseline.yaw,handleBaseline.pitch,handleBaseline.target]),handleCenter={x:100,y:100,z:0}
 engine.setManipulator({center:handleCenter,mode:'move'});engine.draw()
 const handles=renderedScene.getObjectByName('space-manipulator'),handleIds=handles.children.map(node=>node.uuid).join(',')
 const pickObject=node=>{const p=at(nativePoint(new AnatomyThree.Vector3().setFromMatrixPosition(node.matrixWorld)));return engine.pickManipulator(p.x,p.y)}
 const heads=handles.children.filter(node=>node.geometry.type==='ConeGeometry')
 checks.manipulatorThreeAxes=heads.length===3&&heads.every(node=>pickObject(node)?.axis===node.userData.manipulatorAxis)&&heads.map(node=>node.material.color.getHexString()).join(',')==='ef4444,22c55e,3b82f6'
 const xHead=heads.find(node=>node.userData.manipulatorAxis==='x'),screenSpan=()=>{const p=engine.project(nativePoint(new AnatomyThree.Vector3().setFromMatrixPosition(xHead.matrixWorld))),c=engine.project(handleCenter);return Math.hypot(p.x-c.x,p.y-c.y)}
 const beforeZoomSpan=screenSpan();engine.zoom(2);engine.draw();checks.manipulatorConstantScreenSize=Math.abs(screenSpan()-beforeZoomSpan)<.3
 engine.fit(false);engine.draw()
 checks.manipulatorDoesNotAffectFit=handleCamera===JSON.stringify([engine.info().distance,engine.info().yaw,engine.info().pitch,engine.info().target])&&engine.info().elements===1&&engine.info().revision===handleBaseline.revision
 const headPoint=at(nativePoint(new AnatomyThree.Vector3().setFromMatrixPosition(xHead.matrixWorld)))
 checks.manipulatorSeparatePick=engine.pick(headPoint.x,headPoint.y)!=='x'&&engine.pickManipulator(headPoint.x,headPoint.y)?.mode==='move'
 baseline=invalidations;engine.setManipulator({center:{...handleCenter},mode:'move'});engine.draw();checks.manipulatorIdle=invalidations===baseline
 engine.setManipulator({center:{x:120,y:110,z:10},mode:'move',size:90});engine.draw()
 checks.manipulatorReusesGeometry=renderedScene.getObjectByName('space-manipulator')===handles&&handles.children.map(node=>node.uuid).join(',')===handleIds
 engine.setManipulator({center:handleCenter,mode:'rotate'});engine.draw()
 const rings=renderedScene.getObjectByName('space-manipulator').children
 checks.manipulatorThreeRotationRings=rings.length===3&&rings.every(ring=>[.25,.6,1,1.4,2,2.7,3.5,4.3,5.1].some(angle=>{const p=at(nativePoint(new AnatomyThree.Vector3(Math.cos(angle)*64,Math.sin(angle)*64,0).applyMatrix4(ring.matrixWorld)));return engine.pickManipulator(p.x,p.y)?.axis===ring.userData.manipulatorAxis}))
 engine.setManipulator({center:handleCenter,mode:'extrude',normal:{x:1,y:2,z:3}});engine.draw()
 const normalHandles=renderedScene.getObjectByName('space-manipulator'),normalHead=normalHandles.children.find(node=>node.geometry.type==='ConeGeometry'),normalTip=nativePoint(new AnatomyThree.Vector3().setFromMatrixPosition(normalHead.matrixWorld)),direction={x:normalTip.x-handleCenter.x,y:normalTip.y-handleCenter.y,z:normalTip.z-handleCenter.z},directionLength=Math.hypot(direction.x,direction.y,direction.z)
 checks.manipulatorExtrudesAlongNormal=normalHandles.children.length===2&&Math.abs((direction.x+direction.y*2+direction.z*3)/directionLength/Math.sqrt(14)-1)<1e-6&&pickObject(normalHead)?.mode==='extrude'&&pickObject(normalHead)?.axis==='z'
 const handleSnapshot=engine.info().manipulator;handleSnapshot.center.x=999;handleSnapshot.normal.x=999;checks.manipulatorInfoSnapshot=engine.info().manipulator.center.x===100&&engine.info().manipulator.normal.x<1
 engine.setManipulator(null);engine.draw();checks.manipulatorClear=engine.info().manipulator===null&&engine.pickManipulator(headPoint.x,headPoint.y)===null&&engine.info().geometries===handleBaseline.geometries
 // Screen lasso selection follows actual posed geometry, independently of
 // front-most click picking. Empty parts of bounding boxes do not count.
 engine.setPlacement(null);engine.setPenRig({visible:false});engine.preview(null);engine.setPlane(0,false)
 const screenBox=(x,y,r=4)=>[{x:x-r,y:y-r},{x:x+r,y:y-r},{x:x+r,y:y+r},{x:x-r,y:y+r}]
 const regionAt=(point,r=4)=>{const p=engine.project(point);return engine.pickRegion(screenBox(p.x,p.y,r))}
 const viewportRegion=[{x:0,y:0},{x:1000,y:0},{x:1000,y:680},{x:0,y:680}]
 const regionPen={id:'region-pen',type:'pen',x:0,y:0,z:30,width:200,height:160,points:[[0,0],[1,0],[1,1]],points3d:[[0,0,30],[200,0,90],[200,160,140]],rotationX:23,rotationY:17,rotation:31,strokeWidth:4}
 engine.sync({elements:[regionPen]},[]);engine.fit(true);engine.draw()
 checks.regionSelectsPosed3DInk=regionAt(spacePosePoint(regionPen,{x:100,y:0,z:60})).includes('region-pen')
 checks.regionInkBoundingBoxEmpty=regionAt(spacePosePoint(regionPen,{x:20,y:140,z:80})).length===0
 const regionFrame={id:'region-frame',type:'frame',x:-40,y:-40,z:0,width:280,height:280,stroke:'#64748b'},regionCircle={id:'region-circle',type:'ellipse',x:0,y:0,z:10,width:200,height:200,fill:'#93c5fd',stroke:'#334155'}
 engine.sync({elements:[regionFrame]},[]);engine.fit(true);engine.draw()
 checks.regionFrameUsesBorder=regionAt({x:-40,y:100,z:0}).includes('region-frame')&&regionAt({x:100,y:100,z:0}).length===0
 engine.sync({elements:[regionCircle]},[]);engine.fit(true);engine.draw()
 checks.regionCircleUsesRealProfile=regionAt({x:100,y:100,z:10}).includes('region-circle')&&regionAt({x:5,y:5,z:10},2).length===0
 engine.sync({elements:[{...profile,id:'region-concave',fill:'#93c5fd'}]},[]);engine.fit(true);engine.draw()
 checks.regionConcaveOpeningEmpty=regionAt({x:160,y:160,z:0}).length===0&&regionAt({x:30,y:160,z:0}).includes('region-concave')
 const regionSolid={...tilted,id:'region-solid',rotationX:37,rotationY:29,rotation:-22,extrusion:-90}
 engine.sync({elements:[regionSolid]},[]);engine.fit(false);engine.draw()
 checks.regionTiltedSignedSolid=regionAt(spacePosePoint(regionSolid,{x:regionSolid.x+regionSolid.width/2,y:regionSolid.y,z:regionSolid.z-45})).includes('region-solid')
 const regionLinks=[{id:'region-a',type:'rect',x:-250,y:-30,z:-20,width:80,height:80,fill:'#dbeafe'}, {id:'region-b',type:'rect',x:220,y:50,z:130,width:80,height:80,fill:'#dbeafe'}, {id:'region-arrow',type:'arrow',x:0,y:0,width:1,height:1,from:'region-a',to:'region-b',strokeWidth:4}]
 engine.sync({elements:regionLinks},[]);engine.fit(false);engine.draw()
 const regionLink=spaceLinks(regionLinks)[0],regionLinkMiddle={x:(regionLink.a.x+regionLink.b.x)/2,y:(regionLink.a.y+regionLink.b.y)/2,z:(regionLink.a.z+regionLink.b.z)/2}
 checks.regionLinkedArrowActualEndpoints=regionAt(regionLinkMiddle).includes('region-arrow')
 const regionOverlap=[{...back,id:'region-back',text:''},{...back,id:'region-front',text:'',z:80}]
 engine.sync({elements:regionOverlap},[]);engine.fit(true);engine.draw()
 checks.regionThroughSelectsOverlappingObjects=JSON.stringify(regionAt({x:100,y:100,z:0}))===JSON.stringify(['region-back','region-front'])
 engine.sync({elements:[img]},[]);await new Promise(resolve=>setTimeout(resolve,80));engine.fit(true);engine.draw()
 checks.regionTransparentImageMask=regionAt({x:100,y:100,z:200}).length===0&&regionAt({x:20,y:20,z:200}).includes('img')
 const regionText={id:'region-text',type:'text',x:0,y:0,z:0,width:240,height:100,text:'TEXT',fontSize:24,fill:'none'}
 engine.sync({elements:[regionText]},[]);engine.fit(true);engine.draw()
 const regionTextMask=recordGroup('region-text').children.find(node=>node.userData.alpha).userData.alpha.alpha
 let inkPixel=-1;for(let i=3;i<regionTextMask.data.length;i+=4)if(regionTextMask.data[i]>=8){inkPixel=(i-3)/4;break}
 const textPixelPoint={x:(inkPixel%regionTextMask.width+.5)/regionTextMask.width*240,y:(Math.floor(inkPixel/regionTextMask.width)+.5)/regionTextMask.height*100,z:0}
 checks.regionTextUsesVisiblePixels=inkPixel>=0&&regionAt(textPixelPoint,1).includes('region-text')&&regionAt({x:230,y:90,z:0},2).length===0
 engine.sync({elements:[{...back,text:''}]},[]);engine.fit(true);engine.draw()
 const regionView=engine.viewDirection(),regionCamera=nativePoint(engine.camera.position),behindCenter={x:regionCamera.x-regionView.x*1000,y:regionCamera.y-regionView.y*1000,z:regionCamera.z-regionView.z*1000}
 engine.sync({elements:[{...back,id:'region-behind',text:'',x:behindCenter.x-100,y:behindCenter.y-100,z:behindCenter.z},{...back,id:'region-offscreen',text:'',x:1000000}]},[]);engine.draw()
 checks.regionRejectsBehindAndOffscreen=engine.pickRegion(viewportRegion).length===0
 checks.regionRejectsInvalidInput=[null,[],[{x:1,y:2},{x:3,y:4}],[{x:0,y:0},{x:NaN,y:2},{x:3,y:4}],[{x:2000,y:2000},{x:2100,y:2000},{x:2000,y:2100}]].every(region=>engine.pickRegion(region).length===0)
 engine.sync({elements:[]},[]);engine.setPenRig({visible:true,tip:{x:100,y:100,z:100},anchors});engine.setPlacement({...back,id:'region-ghost',text:''});engine.setManipulator({center:{x:100,y:100,z:0},mode:'move'});engine.preview([{x:0,y:0,z:0},{x:200,y:200,z:0}]);engine.setPlane(0,true);engine.draw()
 const regionDecorationState=JSON.stringify(engine.info())
 checks.regionExcludesDecorations=engine.pickRegion(viewportRegion).length===0&&JSON.stringify(engine.info())===regionDecorationState
 engine.setPlacement(null);engine.setManipulator(null);engine.preview(null);engine.setPenRig({visible:false});engine.setPlane(1000000,false)
 engine.sync({elements:[{...back,text:''}]},[]);engine.fit(false);engine.orbit(0,-engine.info().pitch/.006+.001);engine.draw()
 const zoomBefore=engine.info(),zoomPlane={...zoomBefore.target},zoomCursor={x:770,y:310},zoomAnchor=engine.unprojectView(zoomCursor.x,zoomCursor.y,zoomPlane)
 engine.zoom(1.12,zoomCursor.x,zoomCursor.y);engine.draw()
 const zoomAfter=engine.info(),zoomScreen=engine.project(zoomAnchor)
 checks.nearHorizontalZoomStable=Object.values(zoomAfter.target).every(Number.isFinite)&&Math.abs(zoomAfter.distance-zoomBefore.distance/1.12)<1e-6&&delta3(zoomAfter.target,zoomBefore.target)<zoomBefore.distance*.3&&Math.hypot(zoomScreen.x-(zoomCursor.x-40),zoomScreen.y-(zoomCursor.y-30))<1e-6
 engine.zoom(1/1.12,zoomCursor.x,zoomCursor.y);engine.draw()
 checks.nearHorizontalZoomReversible=delta3(engine.info().target,zoomBefore.target)<1e-6&&Math.abs(engine.info().distance-zoomBefore.distance)<1e-6
 const centerZoomTarget=JSON.stringify(engine.info().target);engine.zoom(1.1);engine.draw()
 checks.centerZoomKeepsTarget=JSON.stringify(engine.info().target)===centerZoomTarget
 engine.setPlane(0,false)
 const selectionTimings={}
 const benchmarkElements=Array.from({length:500},(_,i)=>({id:'region-load-'+i,type:['rect','ellipse','diamond'][i%3],x:i%25*90,y:Math.floor(i/25)*70,z:i%5*3,width:54,height:40,fill:'#dbeafe',stroke:'#334155'}))
 engine.sync({elements:benchmarkElements},[]);engine.fit(true);engine.draw()
 let selectionStarted=performance.now();const selected500=engine.pickRegion(viewportRegion);selectionTimings.scene500AllMs=performance.now()-selectionStarted
 selectionStarted=performance.now();engine.pickRegion(screenBox(500,340,12));selectionTimings.scene500SmallMs=performance.now()-selectionStarted
 checks.regionLargeScene=selected500.length===500
 const densePoints=Array.from({length:5000},(_,i)=>i<2500?[i/2499,0]:[1,(i-2500)/2499]),denseInk={id:'region-dense',type:'pen',x:0,y:0,z:0,width:600,height:200,points:densePoints,points3d:densePoints.map(([x,y],i)=>[x*600,y*200,Math.sin(i*.03)*40]),rotationX:15,rotationY:10,rotation:20,strokeWidth:3}
 engine.sync({elements:[denseInk,{...regionCircle,x:700}]},[]);engine.fit(true);engine.draw()
 const denseRegion=Array.from({length:128},(_,i)=>({x:500+Math.cos(i*Math.PI/64)*480,y:340+Math.sin(i*Math.PI/64)*320}))
 selectionStarted=performance.now();const denseSelection=engine.pickRegion(denseRegion);selectionTimings.ink5000AndCircleMs=performance.now()-selectionStarted
 checks.regionDenseInk=denseSelection.includes('region-dense')&&denseSelection.includes('region-circle')
 selectionStarted=performance.now();const denseMiss=regionAt(spacePosePoint(denseInk,{x:200,y:120,z:0}),2);selectionTimings.ink5000MissMs=performance.now()-selectionStarted
 checks.regionDenseInkEmptyBox=denseMiss.length===0
 // OCR receives the current depth-tested GPU content, without lasers, pending
 // components, handles, grid, preview lines or selection decorations. Copy the
 // transient WebGL buffer in the same synchronous call that renders it.
 const captureBoard={elements:[
   {id:'capture-back',type:'rect',x:0,y:0,z:0,width:240,height:160,fill:'#3b82f6',stroke:'none',text:''},
   {id:'capture-front',type:'rect',x:60,y:40,z:80,width:120,height:80,fill:'#ef4444',stroke:'none',text:''}
 ]},captureBoardBefore=JSON.stringify(captureBoard)
 engine.sync(captureBoard,['capture-front']);engine.fit(true);engine.draw()
 const captureRegion=[{x:20,y:20,z:0},{x:220,y:20,z:0},{x:20,y:140,z:0}].map(point=>{const projected=engine.project(point);return{x:projected.x,y:projected.y}})
 const regionBefore=JSON.stringify(captureRegion),cleanCapture=engine.captureRecognition({region:captureRegion})
 const decodeCapture=async value=>{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=value.src});const copy=document.createElement('canvas');copy.width=image.naturalWidth;copy.height=image.naturalHeight;const context=copy.getContext('2d');context.drawImage(image,0,0);return{canvas:copy,context,data:context.getImageData(0,0,copy.width,copy.height).data}}
 const cleanPixels=await decodeCapture(cleanCapture),captureScale=Math.min(900/cleanCapture.bounds.width,320/cleanCapture.bounds.height)
 const capturedPixel=point=>{const p=engine.project(point),x=Math.floor(50+(p.x-cleanCapture.bounds.x)*captureScale),y=Math.floor(50+(p.y-cleanCapture.bounds.y)*captureScale);return Array.from(cleanPixels.context.getImageData(x,y,1,1).data)}
 const frontCapturePixel=capturedPixel({x:100,y:60,z:80}),outsideCapturePixel=capturedPixel({x:210,y:130,z:0})
 let captureNonwhite=0;for(let i=0;i<cleanPixels.data.length;i+=4)if(cleanPixels.data[i]<250||cleanPixels.data[i+1]<250||cleanPixels.data[i+2]<250)captureNonwhite++
 checks.recognitionCaptureRealGPU=cleanPixels.canvas.width===1000&&cleanPixels.canvas.height===420&&captureNonwhite>1000
 checks.recognitionCapturePreservesOcclusion=frontCapturePixel[0]>200&&frontCapturePixel[1]<100&&frontCapturePixel[2]<100
 checks.recognitionCapturePolygonMask=outsideCapturePixel.every((value,index)=>value===255)&&Array.from(cleanPixels.context.getImageData(5,5,1,1).data).every(value=>value===255)
 checks.recognitionCaptureBounds=JSON.stringify(cleanCapture.bounds)===JSON.stringify({x:Math.min(...captureRegion.map(p=>p.x)),y:Math.min(...captureRegion.map(p=>p.y)),width:Math.max(...captureRegion.map(p=>p.x))-Math.min(...captureRegion.map(p=>p.x)),height:Math.max(...captureRegion.map(p=>p.y))-Math.min(...captureRegion.map(p=>p.y))})&&JSON.stringify(captureRegion)===regionBefore
 engine.setPenRig({visible:true,tip:{x:100,y:80,z:300},anchors:[{x:-50,y:-50,z:200},{x:290,y:-50,z:200},{x:290,y:210,z:400},{x:-50,y:210,z:400}],drawing:true})
 engine.setPlacement({id:'capture-ghost',type:'rect',x:0,y:0,z:200,width:240,height:160,fill:'#c084fc'})
 engine.setManipulator({center:{x:100,y:80,z:300},mode:'rotate'})
 engine.setPlane(150,true,20);engine.preview([{x:0,y:0,z:350},{x:240,y:160,z:350}]);engine.draw()
 const captureScene=renderedScene,decorations=captureScene.getObjectByName('four-anchor-space-pen').parent,selectionOutline=recordGroup('capture-front').children.find(node=>node.userData.selection)
 const captureSnapshot=()=>{const state=engine.info();delete state.drawCalls;return JSON.stringify({info:state,camera:engine.camera.matrixWorld.elements,projection:engine.camera.projectionMatrix.elements,background:captureScene.background.getHexString(),decoration:decorations.visible,selection:selectionOutline.visible})}
 const captureState=captureSnapshot()
 baseline=invalidations
 await new Promise(resolve=>setTimeout(resolve,40))
 const decoratedCapture=engine.captureRecognition({region:captureRegion})
 checks.recognitionCaptureExcludesDecorations=decoratedCapture.src===cleanCapture.src
 checks.recognitionCaptureRestoresState=captureSnapshot()===captureState&&invalidations>baseline&&JSON.stringify(captureBoard)===captureBoardBefore
 engine.draw()
 const normalBackground=captureScene.background,normalDecoration=decorations.visible,normalSelection=selectionOutline.visible,canvasDataURL=HTMLCanvasElement.prototype.toDataURL
 let captureFailure=false
 try{
   HTMLCanvasElement.prototype.toDataURL=function(...args){if(this.width===1000&&this.height===420)throw Error('expected capture failure');return canvasDataURL.apply(this,args)}
   engine.captureRecognition({region:captureRegion})
 }catch(error){captureFailure=error.message==='expected capture failure'}finally{HTMLCanvasElement.prototype.toDataURL=canvasDataURL}
 checks.recognitionCaptureFailureRestoresState=captureFailure&&captureScene.background===normalBackground&&decorations.visible===normalDecoration&&selectionOutline.visible===normalSelection
 let rejectedCaptures=0
 for(const region of [null,[],[{x:0,y:0},{x:1,y:1}],[{x:0,y:0},{x:NaN,y:2},{x:3,y:4}],[{x:2000,y:2000},{x:2100,y:2000},{x:2000,y:2100}],[{x:0,y:0},{x:1e-310,y:0},{x:0,y:1e-310}]])try{engine.captureRecognition({region})}catch{rejectedCaptures++}
 checks.recognitionCaptureRejectsInvalidRegion=rejectedCaptures===6
 const cameraBeforeOversize=JSON.stringify(engine.camera.matrixWorld.elements),oldHostWidth=host.style.width
 let oversizedRejected=false
 try{host.style.width='9000px';engine.captureRecognition({region:captureRegion})}catch{oversizedRejected=true}finally{host.style.width=oldHostWidth}
 checks.recognitionCaptureLimitsViewport=oversizedRejected&&JSON.stringify(engine.camera.matrixWorld.elements)===cameraBeforeOversize
 engine.sync({elements:[]},[])
 const blankCapture=await decodeCapture(engine.captureRecognition({region:captureRegion}))
 checks.recognitionCaptureBlankStaysWhite=blankCapture.data.every(value=>value===255)&&engine.info().penRig.visible&&!!engine.info().placement&&!!engine.info().manipulator
 const info=engine.info();engine.dispose();checks.dispose=host.children.length===0
 return {checks,info,selectionTimings}
})
console.log(JSON.stringify({result,errors},null,2))
if(errors.length||Object.values(result.checks).some(x=>!x))process.exitCode=1

} finally { await browser.close() }
