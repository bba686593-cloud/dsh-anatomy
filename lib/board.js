import { programTrace } from './semantics.js'
import { readingDiagnostics } from './reading.js'

export const BOARD_TYPES = ['rect','ellipse','diamond','text','math','pen','polygon','line','arrow','frame']
export const MAX_MATH_EXPRESSIONS = 100
export const MAX_MATH_CONTENT_LENGTH = 10000
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
  const elements = organs.map((o,i) => ({id:'organ-'+o.id,type:'rect',x:80+(i%3)*340,y:80+Math.floor(i/3)*220,width:270,height:140,
    text:o.name+'\n'+(o.gist||''),math:o.math||'',fill:'#eff6ff',stroke:'#4263eb',targets:[{kind:'organ',id:o.id}]}))
  for (const f of flows) {
    const a=elements.find(e=>e.id==='organ-'+f.from),b=elements.find(e=>e.id==='organ-'+f.to)
    if(a&&b) elements.unshift({id:'flow-'+f.id,type:'arrow',x:a.x+a.width,y:a.y+a.height/2,width:b.x-a.x-a.width,height:b.y-a.y,
      text:f.name||f.gist||'数据交接',stroke:'#64748b',from:a.id,to:b.id,targets:[{kind:'flow',id:f.id}]})
  }
  return {version:1,elements}
}
export function boardDiagnostics(board, organs = [], flows = []) {
  const out=[],fail=(code,message,id)=>out.push({code:'board/'+code,message,subject:{element:id}})
  if(!board || board.version!==1 || !Array.isArray(board.elements)) {fail('shape','画板需要版本和图元列表');return out}
  if(board.elements.length>2000){fail('limit','画板最多包含 2000 个图元');return out}
  const ids=new Set()
  for(const e of board.elements){
    if(!e || typeof e!=='object'){fail('element','图元必须是对象');continue}
    if(typeof e.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(e.id)||ids.has(e.id)) fail('id','图元标识必须唯一，且只能包含字母、数字、横线与下划线',e.id)
    ids.add(e.id)
    if(!BOARD_TYPES.includes(e.type))fail('type','不支持的图元类型',e.id)
    for(const k of ['x','y','width','height'])if(!Number.isFinite(e[k])||Math.abs(e[k])>1e7)fail('geometry','位置与尺寸必须是有限数值',e.id)
    if(!['line','arrow'].includes(e.type)&&(e.width<=0||e.height<=0))fail('size','图形宽高必须大于零',e.id)
    if(e.rotation!==undefined&&!Number.isFinite(e.rotation))fail('rotation','旋转角必须是有限数值',e.id)
    for(const k of ['text','math']) {
      if(e[k]!==undefined&&typeof e[k]!=='string')fail('text','说明与数学表达必须是文字',e.id)
      if(programTrace(e[k]))out.push({code:'human/program-language',message:'画板说明只写自然语言与数学表达，程序内容请写入程序映射',subject:{element:e.id}})
    }
    if(e.mathExpressions!==undefined&&!Array.isArray(e.mathExpressions))fail('math-expressions','新增数学表达必须是列表',e.id)
    const expressions=Array.isArray(e.mathExpressions)?e.mathExpressions:[],mathIds=new Set(['primary'])
    let mathLength=typeof e.math==='string'?e.math.length:0
    if(expressions.length>MAX_MATH_EXPRESSIONS)fail('math-limit','每个图元最多新增 '+MAX_MATH_EXPRESSIONS+' 条数学表达',e.id)
    for(const expression of expressions){
      if(!expression||typeof expression!=='object'||Array.isArray(expression)){fail('math-expressions','新增数学表达需要标识和文字内容',e.id);continue}
      if(typeof expression.id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(expression.id)||mathIds.has(expression.id))fail('math-id','数学表达标识必须唯一，不能使用保留标识 primary',e.id)
      mathIds.add(expression.id)
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
  for(const e of board.elements.filter(e=>e&&typeof e==='object'))for(const k of ['from','to'])if(e[k]!==undefined && (!['line','arrow'].includes(e.type)||!ids.has(e[k])||e[k]===e.id||(e.from!==undefined&&e.from===e.to)||['line','arrow'].includes(board.elements.find(x=>x?.id===e[k])?.type)))fail('connection','连线端点必须引用另一个非连线图元',e.id)
  out.push(...readingDiagnostics(board))
  return out
}
export function elementProgram(element, organs = [], flows = []) {
  const linked=(element.targets??[]).map(t=>({kind:t.kind,value:(t.kind==='organ'?organs:flows).find(o=>o.id===t.id)})).filter(t=>t.value)
  return {element:element.id,mathExpressions:elementMathEntries(element),implementation:element.implementation??{},anchors:element.anchors??[],linked}
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
export function deleteElements(board, ids) {
  const selected=new Set(ids)
  // Preserve attached lines: deleting a shape detaches its endpoints at their current positions.
  for(const e of board.elements)if(['line','arrow'].includes(e.type)&&!selected.has(e.id)&&(selected.has(e.from)||selected.has(e.to))){
    const {a,b}=lineEnds(e,board.elements);e.x=a.x;e.y=a.y;e.width=b.x-a.x;e.height=b.y-a.y
    if(selected.has(e.from))delete e.from
    if(selected.has(e.to))delete e.to
  }
  board.elements=board.elements.filter(e=>!selected.has(e.id))
  if(board.reading)board.reading.steps=board.reading.steps.filter(step=>!selected.has(step.element))
}
export function moveElements(board, ids, dx, dy, original = structuredClone(board)) {
  const selected = new Set(ids)
  for (const e of board.elements.filter(e => selected.has(e.id))) {
    const old = original.elements.find(o => o.id === e.id)
    if (!old) continue
    e.x = old.x + dx; e.y = old.y + dy
    if (['line', 'arrow'].includes(e.type)) {
      const { a, b } = lineEnds(old, original.elements)
      e.x = a.x + dx; e.y = a.y + dy; e.width = b.x - a.x; e.height = b.y - a.y
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
