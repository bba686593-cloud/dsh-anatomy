import { programTrace } from './semantics.js'
import { readingDiagnostics } from './reading.js'
import { imageDiagnostics, formulaGraphicDiagnostics, parseImageSource, MAX_BOARD_IMAGE_BYTES } from './images.js'
import { spaceLinks, spaceStrokePoints, spacePenRig, spaceTranslateElement } from './board-space.js'

export const BOARD_TYPES = ['rect','ellipse','diamond','text','math','image','pen','polygon','line','arrow','frame']
export const MAX_MATH_EXPRESSIONS = 100
export const MAX_MATH_CONTENT_LENGTH = 10000
// Ink display uses stored source strokes, not a recognition candidate or an
// assertion that the handwritten expression has been visually understood.
export function validMathInk(handwriting) {
  const strokes=handwriting?.strokes
  return handwriting?.mode==='math'&&Array.isArray(strokes)&&strokes.length>0&&strokes.length<=200&&strokes.every(stroke=>Array.isArray(stroke)&&stroke.length>0&&stroke.length<=1500&&stroke.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&point[0]>=0&&point[0]<=1000&&point[1]>=0&&point[1]<=420))&&strokes.reduce((count,stroke)=>count+stroke.length,0)<=20000
}
// The existing math field keeps its stable identity; additions never replace it.
export function elementMathEntries(element) {
  const entries = typeof element?.math === 'string' && element.math.trim() ? [{id:'primary',value:element.math}] : []
  for (const entry of Array.isArray(element?.mathExpressions) ? element.mathExpressions : []) {
    if (entry && typeof entry.id === 'string' && typeof entry.value === 'string' && entry.value.trim()) entries.push({id:entry.id,value:entry.value})
  }
  return entries
}
export function boardFor(body, organs = [], flows = []) {
  if (body.board) return structuredClone(body.board)
  const byId=new Map(organs.map(o=>[o.id,o])),parents=new Map(organs.map(o=>[o.id,byId.has(o.parent)&&o.parent!==o.id?o.parent:null]))
  // A corrupt legacy parent cycle must not prevent opening the source data.
  // Break only its visual container cycle; structure.parent retains the fact.
  for(const o of organs){const path=[],seen=new Map();let id=o.id;while(id){if(seen.has(id)){parents.set(path.slice(seen.get(id)).sort()[0],null);break}seen.set(id,path.length);path.push(id);id=parents.get(id)}}
  const branch=new Set([...parents.values()].filter(Boolean)),groups=new Map([[null,[]]]),frames=[],cards=[]
  const systemNames=new Map((body.systems||[]).map(s=>[s.id,s.name||s.id]))
  const systemFor=o=>{let root=o;while(parents.get(root.id))root=byId.get(parents.get(root.id));return (root.systems||[])[0]||null}
  const systemFrame=sid=>'system-'+sid,moduleFrame=id=>'group-'+id
  function addFrame(id,text,frame,structure){const value={id,type:'frame',x:0,y:0,width:300,height:140,text,fill:'none',stroke:'#94a3b8',structure,...(frame?{frame}:{})};frames.push(value);groups.set(id,[]);return value}
  const systemIds=[...new Set(organs.map(systemFor).filter(Boolean))].sort()
  for(const sid of systemIds)addFrame(systemFrame(sid),systemNames.get(sid)||sid,null,{systems:[sid]})
  for(const o of [...organs].sort((a,b)=>a.id.localeCompare(b.id)))if(branch.has(o.id)){
    const p=parents.get(o.id),sid=systemFor(o),frame=p?moduleFrame(p):sid?systemFrame(sid):null
    addFrame(moduleFrame(o.id),o.name+' · 子模块',frame,{systems:[...(o.systems||[])]})
  }
  for(const o of organs){
    const p=parents.get(o.id),sid=systemFor(o),frame=branch.has(o.id)?moduleFrame(o.id):p?moduleFrame(p):sid?systemFrame(sid):null
    cards.push({id:'organ-'+o.id,type:'rect',x:0,y:0,width:270,height:140,text:o.name+'\n'+(o.gist||''),math:o.math||'',fill:'#eff6ff',stroke:'#4263eb',targets:[{kind:'organ',id:o.id}],structure:{systems:[...(o.systems||[])],...(byId.has(o.parent)?{parent:'organ-'+o.parent}:{})},...(frame?{frame}:{})})
  }
  for(const e of [...frames,...cards])groups.get(e.frame||null).push(e)
  const order=[null],offsets=new Map()
  for(let i=0;i<order.length;i++)for(const e of groups.get(order[i]))if(e.type==='frame')order.push(e.id)
  // Pack real containers first, then place their children using local offsets.
  // Parent and system membership never depend on accidental box intersections.
  for(const id of [...order].reverse()){
    const items=groups.get(id).sort((a,b)=>(a.type==='frame')-(b.type==='frame')||a.id.localeCompare(b.id)),cols=Math.min(3,items.length),widths=Array(cols).fill(0),heights=[]
    items.forEach((e,i)=>{widths[i%cols]=Math.max(widths[i%cols],e.width);heights[Math.floor(i/cols)]=Math.max(heights[Math.floor(i/cols)]||0,e.height)})
    items.forEach((e,i)=>offsets.set(e.id,{x:(id?24:80)+widths.slice(0,i%cols).reduce((n,w)=>n+w+48,0),y:(id?90:80)+heights.slice(0,Math.floor(i/cols)).reduce((n,h)=>n+h+36,0)}))
    if(id){const frame=frames.find(f=>f.id===id);frame.width=Math.max(300,widths.reduce((n,w)=>n+w,0)+Math.max(0,cols-1)*48+48);frame.height=Math.max(140,90+heights.reduce((n,h)=>n+h,0)+Math.max(0,heights.length-1)*36+24)}
  }
  const origins=new Map([[null,{x:0,y:0}]])
  for(const id of order)for(const e of groups.get(id)){const origin=origins.get(id),offset=offsets.get(e.id);e.x=origin.x+offset.x;e.y=origin.y+offset.y;if(e.type==='frame')origins.set(e.id,{x:e.x,y:e.y})}
  const elements=[...frames,...cards]
  for (const f of flows) {
    const a=elements.find(e=>e.id==='organ-'+f.from),b=elements.find(e=>e.id==='organ-'+f.to)
    if(a&&b) elements.unshift({id:'flow-'+f.id,type:'arrow',x:a.x+a.width,y:a.y+a.height/2,width:b.x-a.x-a.width,height:b.y-a.y,
      text:f.name||f.gist||'数据交接',stroke:'#64748b',from:a.id,to:b.id,...(f.direction==='two-way'?{direction:'two-way'}:{}),targets:[{kind:'flow',id:f.id}]})
  }
  return {version:1,elements}
}
export function boardDiagnostics(board, organs = [], flows = []) {
  const out=[],fail=(code,message,id)=>out.push({code:'board/'+code,message,subject:{element:id}})
  if(!board || board.version!==1 || !Array.isArray(board.elements)) {fail('shape','画板需要版本和图元列表');return out}
  if(Object.hasOwn(board,'spatialRig'))try{spacePenRig(board)}catch(error){fail('spatial-rig',error.message)}
  if(board.elements.length>2000){fail('limit','画板最多包含 2000 个图元');return out}
  const ids=new Set(),imageSources=new Set();let imageBytes=0
  const countImage=src=>{if(imageSources.has(src))return;try{const parsed=parseImageSource(src);imageSources.add(src);imageBytes+=parsed.bytes}catch{}}
  for(const e of board.elements){
    if(!e || typeof e!=='object'){fail('element','图元必须是对象');continue}
    if(typeof e.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(e.id)||ids.has(e.id)) fail('id','图元标识必须唯一，且只能包含字母、数字、横线与下划线',e.id)
    ids.add(e.id)
    if(!BOARD_TYPES.includes(e.type))fail('type','不支持的图元类型',e.id)
    if(e.type==='image'){
      for(const error of imageDiagnostics(e.image))fail(error.code,error.message,e.id)
      if(programTrace(e.image?.alt))out.push({code:'human/program-language',message:'图片说明只能使用自然语言与数学，程序表达请放入程序映射',subject:{element:e.id}})
      countImage(e.image?.src)
    }else if(e.image!==undefined)fail('image-type','图片数据只能属于图片图元',e.id)
    for(const error of formulaGraphicDiagnostics(e))fail(error.code,error.message,e.id)
    if(e.formulaGraphic)countImage(e.formulaGraphic.originalImage?.src)
    for(const k of ['x','y','width','height'])if(!Number.isFinite(e[k])||Math.abs(e[k])>1e7)fail('geometry','位置与尺寸必须是有限数值',e.id)
    if(!['line','arrow'].includes(e.type)&&(e.width<=0||e.height<=0))fail('size','图形宽高必须大于零',e.id)
    if(e.textAlign!==undefined&&!['left','center','right','start','end','justify'].includes(e.textAlign))fail('text-align','文字对齐方式无效',e.id)
    for(const k of ['rotation','rotationX','rotationY'])if(e[k]!==undefined&&(!Number.isFinite(e[k])||(k!=='rotation'&&Math.abs(e[k])>1e7)))fail('rotation','旋转角必须是有限数值，新增空间旋转角不能超过 ±10000000 度',e.id)
    if(e.extrusion!==undefined){
      if(!Number.isFinite(e.extrusion)||Math.abs(e.extrusion)>1e7)fail('extrusion','局部拉伸深度必须是 ±10000000 范围内的有限数值',e.id)
      if(!['rect','ellipse','diamond','polygon'].includes(e.type))fail('extrusion-type','只有矩形、椭圆、菱形与闭合多边形支持局部拉伸',e.id)
    }
    if(e.z!==undefined&&(!Number.isFinite(e.z)||Math.abs(e.z)>1e7))fail('depth','深度必须是有限数值',e.id)
    if(e.endZ!==undefined&&(!['line','arrow'].includes(e.type)||!Number.isFinite(e.endZ)||Math.abs(e.endZ)>1e7))fail('end-depth','连线终点高度必须是有限数值',e.id)
    if(e.direction!==undefined&&(e.type!=='arrow'||!['one-way','two-way'].includes(e.direction)))fail('direction','箭头方向只能选择单向或双向',e.id)
    if(e.points3d!==undefined&&(e.type!=='pen'||!Array.isArray(e.points3d)||e.points3d.length<2||e.points3d.length>20000||e.points3d.some(p=>!Array.isArray(p)||p.length!==3||p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7))))fail('points3d','三维笔迹需要 2–20000 个有限坐标点，且只能属于笔迹图元',e.id)
    for(const k of ['text','math','sourceTitle']) {
      if(e[k]!==undefined&&typeof e[k]!=='string')fail('text','说明与数学表达必须是文字',e.id)
      if(programTrace(e[k]))out.push({code:'human/program-language',message:'画板说明只写自然语言与数学表达，程序内容请写入程序映射',subject:{element:e.id}})
    }
    if(e.mathDisplay!==undefined&&!['ink','typeset'].includes(e.mathDisplay))fail('math-display','主公式显示只能选择原笔迹或数学排版',e.id)
    if(e.mathDisplay==='ink'){
      const handwriting=validMathInk(e.mathHandwriting)?e.mathHandwriting:validMathInk(e.handwriting)?e.handwriting:null
      if(!handwriting)fail('math-ink','原笔迹显示需要有效的数学手写笔迹；识别文字不能代替原始笔迹',e.id)
      else if(handwriting.reviewedValue!==undefined&&(typeof handwriting.reviewedValue!=='string'||handwriting.reviewedValue!==(e.math||'')))fail('math-ink-stale','主公式已变化，原笔迹与当前表达不一致；请重新校对或使用数学排版',e.id)
    }
    if(e.mathExpressions!==undefined&&!Array.isArray(e.mathExpressions))fail('math-expressions','新增数学表达必须是列表',e.id)
    const expressions=Array.isArray(e.mathExpressions)?e.mathExpressions:[],mathIds=new Set(['primary'])
    let mathLength=typeof e.math==='string'?e.math.length:0
    if(expressions.length>MAX_MATH_EXPRESSIONS)fail('math-limit','每个图元最多新增 '+MAX_MATH_EXPRESSIONS+' 条数学表达',e.id)
    for(const expression of expressions){
      if(!expression||typeof expression!=='object'||Array.isArray(expression)){fail('math-expressions','新增数学表达需要标识和文字内容',e.id);continue}
      if(typeof expression.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(expression.id)||mathIds.has(expression.id))fail('math-id','数学表达标识必须唯一，不能使用保留标识 primary',e.id)
      mathIds.add(expression.id)
      if(expression.display!==undefined&&!['ink','typeset'].includes(expression.display))fail('math-display','附加公式显示只能选择原笔迹或数学排版',e.id)
      if(expression.display==='ink'){
        if(!validMathInk(expression.handwriting))fail('math-ink','附加公式的原笔迹显示需要该表达自身的数学手写笔迹',e.id)
        else if(expression.handwriting.reviewedValue!==undefined&&(typeof expression.handwriting.reviewedValue!=='string'||expression.handwriting.reviewedValue!==(expression.value||'')))fail('math-ink-stale','附加公式已变化，原笔迹与当前表达不一致；请重新校对或使用数学排版',e.id)
      }
      if(typeof expression.value!=='string')fail('math-expressions','新增数学表达内容必须是文字',e.id)
      else{
        mathLength+=expression.value.length
        if(expression.value.length>MAX_MATH_CONTENT_LENGTH)fail('math-limit','单条数学表达不能超过 '+MAX_MATH_CONTENT_LENGTH+' 个字符',e.id)
        if(programTrace(expression.value))out.push({code:'human/program-language',message:'数学表达只能使用自然语言与数学语言，程序内容请写入程序映射',subject:{element:e.id,expression:expression.id}})
      }
    }
    if(mathLength>MAX_MATH_CONTENT_LENGTH)fail('math-limit','每个图元的数学表达总长度不能超过 '+MAX_MATH_CONTENT_LENGTH+' 个字符，请分成多个部位',e.id)
    for(const k of ['fill','stroke'])if(e[k]!==undefined&&!/^(none|#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8}))$/i.test(e[k]))fail('color','颜色必须是十六进制或 none',e.id)
    for(const k of ['strokeWidth','fontSize'])if(e[k]!==undefined&&(!Number.isFinite(e[k])||e[k]<=0||e[k]>200))fail('style','线宽与字号必须为正数且不超过 200',e.id)
    if(['pen','polygon'].includes(e.type) && (!Array.isArray(e.points)||e.points.length<(e.type==='polygon'?3:2)||e.points.length>10000||e.points.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))))fail('points','自由线至少两个点，多边形至少三个点，坐标须为有限数值',e.id)
    if(e.targets!==undefined&&!Array.isArray(e.targets))fail('targets','工程关联必须是列表',e.id)
    for(const t of Array.isArray(e.targets)?e.targets:[])if(!t || !(t.kind==='organ'?organs:t.kind==='flow'?flows:[]).some(x=>x.id===t.id))fail('target','图元引用了不存在的工程对象',e.id)
    if(e.implementation!==undefined && (!e.implementation||typeof e.implementation!=='object'||Array.isArray(e.implementation)||['code','language','note'].some(k=>e.implementation[k]!==undefined&&typeof e.implementation[k]!=='string')))fail('implementation','程序表达必须是对象，语言、代码和说明为文字',e.id)
    if(e.anchors!==undefined&&(!Array.isArray(e.anchors)||e.anchors.some(a=>!a||typeof a.file!=='string'||!a.file.trim()||['symbol','sha256','role','reason'].some(k=>a[k]!==undefined&&typeof a[k]!=='string'))))fail('anchors','源码映射必须包含文件路径',e.id)
  }
  if(imageBytes>MAX_BOARD_IMAGE_BYTES)fail('image-limit','画板内嵌图片合计不能超过 8 MiB，请压缩图片或分成多个画板')
  for(const e of board.elements.filter(e=>e&&typeof e==='object'))for(const k of ['from','to'])if(e[k]!==undefined && (!['line','arrow'].includes(e.type)||!ids.has(e[k])||e[k]===e.id||(e.from!==undefined&&e.from===e.to)||['line','arrow'].includes(board.elements.find(x=>x?.id===e[k])?.type)))fail('connection','连线端点必须引用另一个非连线图元',e.id)
  out.push(...readingDiagnostics(board))
  return out
}
export function elementProgram(element, organs = [], flows = []) {
  const linked=(element.targets??[]).map(t=>({kind:t.kind,value:(t.kind==='organ'?organs:flows).find(o=>o.id===t.id)})).filter(t=>t.value)
  const drawing=Object.fromEntries(['derivedFrom','fragmentOf','expressionOrigin','points','points3d','handwriting','mathHandwriting','mathDisplay','recognition'].filter(key=>element[key]!==undefined).map(key=>[key,structuredClone(element[key])]))
  if(element.type==='pen'&&Array.isArray(element.points3d))drawing.points3d=spaceStrokePoints(element).map(p=>[p.x,p.y,p.z])
  return {element:element.id,type:element.type,geometry:{x:element.x,y:element.y,width:element.width,height:element.height,rotation:element.rotation||0,...Object.fromEntries(['z','endZ','rotationX','rotationY','extrusion'].filter(key=>element[key]!==undefined).map(key=>[key,element[key]]))},...drawing,mathExpressions:elementMathEntries(element),...(element.mathExpressions!==undefined?{mathExpressionsRaw:structuredClone(element.mathExpressions)}:{}),...(element.type==='image'?{image:structuredClone(element.image)}:{}),...(element.formulaGraphic?{formulaGraphic:structuredClone(element.formulaGraphic),currentMath:element.formulaGraphic.currentMath,formulaPending:element.formulaGraphic.semanticStatus==='needs-review'}:{}),implementation:element.implementation??{},anchors:element.anchors??[],linked}
}
export function lineEnds(element,elements) {
  const source=elements.find(e=>e.id===element.from),target=elements.find(e=>e.id===element.to)
  const center=e=>({x:e.x+e.width/2,y:e.y+e.height/2})
  const a=source?center(source):{x:element.x,y:element.y},b=target?center(target):{x:element.x+element.width,y:element.y+element.height}
  const boundary=(e,toward)=>{
    const c=center(e),angle=(e.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle)
    const dx=(toward.x-c.x)*cos+(toward.y-c.y)*sin,dy=-(toward.x-c.x)*sin+(toward.y-c.y)*cos,rx=e.width/2,ry=e.height/2
    if(!dx&&!dy)return c
    const k=e.type==='ellipse'?1/Math.hypot(dx/rx,dy/ry):e.type==='diamond'?1/(Math.abs(dx)/rx+Math.abs(dy)/ry):Math.min(rx/Math.abs(dx),ry/Math.abs(dy))
    return{x:c.x+k*(dx*cos-dy*sin),y:c.y+k*(dx*sin+dy*cos)}
  }
  return {a:source?boundary(source,b):a,b:target?boundary(target,a):b}
}
function boardSpatialLine(element,elements) {
  return ['z','endZ','rotationX','rotationY'].some(key=>element[key]!==undefined)||!!element.rotation||elements.some(node=>(node.id===element.from||node.id===element.to)&&['z','rotationX','rotationY','extrusion'].some(key=>node[key]!==undefined))
}
function boardClearBakedLinePose(element) {
  delete element.rotationX;delete element.rotationY
  if(element.rotation!==undefined)element.rotation=0
}
export function deleteElements(board, ids) {
  const selected=new Set(ids)
  const spatial = new Map(spaceLinks(board.elements).map(edge=>[edge.id,edge]))
  // Preserve attached lines: deleting a shape detaches its endpoints at their current positions.
  for(const e of board.elements)if(['line','arrow'].includes(e.type)&&!selected.has(e.id)&&(selected.has(e.from)||selected.has(e.to))){
    const edge=spatial.get(e.id)
    const posed=boardSpatialLine(e,board.elements),{a,b}=posed?edge:lineEnds(e,board.elements);e.x=a.x;e.y=a.y;e.width=b.x-a.x;e.height=b.y-a.y
    if(posed){e.z=edge.a.z;e.endZ=edge.b.z;boardClearBakedLinePose(e)}
    if(selected.has(e.from))delete e.from
    if(selected.has(e.to))delete e.to
  }
  board.elements=board.elements.filter(e=>!selected.has(e.id))
  if(board.reading)board.reading.steps=board.reading.steps.filter(step=>!selected.has(step.element))
}
export function moveElements(board, ids, dx, dy, original = structuredClone(board)) {
  const selected = new Set(ids)
  const spatial = new Map(spaceLinks(original.elements).map(edge=>[edge.id,edge]))
  for (const e of board.elements.filter(e => selected.has(e.id))) {
    const old = original.elements.find(o => o.id === e.id)
    if (!old) continue
    e.x = old.x + dx; e.y = old.y + dy
    if(e.type==='pen'&&Array.isArray(old.points3d))e.points3d=spaceTranslateElement({...old},dx,dy).points3d
    if (['line', 'arrow'].includes(e.type)) {
      // A free connector already stores its local geometry. Translate its
      // pivot without baking a second copy of the same Euler rotation.
      if(!old.from&&!old.to)continue
      const edge=spatial.get(old.id),posed=boardSpatialLine(old,original.elements)
      const { a, b } = posed?edge:lineEnds(old, original.elements)
      e.x = a.x + dx; e.y = a.y + dy; e.width = b.x - a.x; e.height = b.y - a.y
      if(posed){e.z=edge.a.z;e.endZ=edge.b.z;boardClearBakedLinePose(e)}
      for (const end of ['from', 'to']) {
        if (old[end] && selected.has(old[end])) e[end] = old[end]
        else delete e[end]
      }
    }
  }
}
export function boardBundle(base, current, body, baseHash) {
  return {schema:'anatomy-edits/1',body,baseHash,createdAt:new Date().toISOString(),edits:JSON.stringify(base)===JSON.stringify(current)?[]:[{kind:'body',patch:{board:structuredClone(current)}}]}
}
