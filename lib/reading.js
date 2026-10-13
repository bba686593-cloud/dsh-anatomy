import { humanText, programTrace } from './semantics.js'
import { elementMathEntries } from './board.js'

const connector = e => ['line', 'arrow'].includes(e.type)
export function relationName(element, flows = []) {
  if (element.text?.trim()) return humanText(element.text.trim())
  for (const ref of element.targets || []) {
    const flow = ref.kind === 'flow' && flows.find(f => f.id === ref.id)
    if (flow && (flow.name?.trim() || flow.gist?.trim())) return humanText(flow.name?.trim() || flow.gist.trim())
  }
  return '关系待说明'
}
export function partTitle(element, flows = []) {
  return connector(element) ? relationName(element, flows) : humanText(element.text?.trim().split('\n')[0] || element.image?.alt || (elementMathEntries(element).length ? '数学关系' : '未说明的部位'))
}
export function readingDiagnostics(board) {
  const reading = board.reading
  if (reading === undefined) return []
  const errors = [], fail = message => errors.push({code:'board/reading',message})
  if (!reading || typeof reading !== 'object' || Array.isArray(reading) || !Array.isArray(reading.steps)) {
    fail('工程导读需要说明和步骤列表'); return errors
  }
  if (reading.steps.length > 2000) fail('阅读步骤不能超过 2000 项')
  const prose = value => {
    if (value !== undefined && typeof value !== 'string') fail('导读标题与说明必须是文字')
    if (programTrace(value)) errors.push({code:'human/program-language',message:'工程导读只能包含自然语言与数学，程序表达请放入程序映射'})
  }
  prose(reading.summary)
  for (const step of reading.steps) {
    if (!step || typeof step !== 'object' || !board.elements.some(e => e?.id === step.element)) {fail('阅读步骤必须指向存在的图元');continue}
    prose(step.title);prose(step.description)
  }
  return errors
}
// Prefer authored explanations, then existing business scenarios. The fallback
// is a directory, not a guessed execution order inferred from canvas positions.
export function readingRoutes(board, body = {}, organs = [], flows = []) {
  const normalize = step => ({...step,title:humanText(step.title || partTitle(board.elements.find(e=>e.id===step.element),flows)),description:humanText(step.description || '')})
  const routes=[]
  if (board.reading?.steps?.length) routes.push({id:'authored',title:'工程主线',summary:humanText(board.reading.summary || body.oneline || ''),basis:'作者编写的阅读路线',steps:board.reading.steps.filter(s=>board.elements.some(e=>e.id===s.element)).map(normalize)})
  for (const scenario of body.scenarios || []) {
    const steps = (scenario.steps || []).flatMap(step => {
      const element = board.elements.find(e => !connector(e) && e.targets?.some(t=>t.kind==='organ'&&t.id===step.organ))
      return element ? [normalize({element:element.id,description:step.action})] : []
    })
    if (steps.length) routes.push({id:'scenario-'+scenario.id,title:humanText(scenario.name || '已有业务场景'),summary:humanText([scenario.trigger,scenario.outcome].filter(Boolean).join(' → ')),basis:'来自工程已记录的业务场景',steps})
  }
  if (!routes.length) {
    const parts=board.elements.filter(e=>!connector(e)&&e.type!=='frame'&&(e.text?.trim()||e.image?.alt||elementMathEntries(e).length||e.anchors?.length||e.targets?.length))
    routes.push({id:'directory',title:'工程部位索引',summary:humanText(board.reading?.summary || body.oneline || '工程目的尚未说明。'),basis:'尚未编写阅读主线；以下为部位索引，不代表执行顺序。',steps:parts.map(e=>normalize({element:e.id,description:organs.find(o=>e.targets?.some(t=>t.kind==='organ'&&t.id===o.id))?.gist || e.text || e.image?.alt || ''}))})
  }
  return routes
}
// Place relation labels separately from shapes, with a leader when offset.
// Rectangle obstacles are conservative for rotated shapes; labels never overlap.
export function relationLabelLayout(board, flows, endpoints) {
  const obstacles=board.elements.filter(e=>!connector(e)&&e.type!=='pen').map(e=>{
    const a=(e.rotation||0)*Math.PI/180,w=Math.abs(e.width*Math.cos(a))+Math.abs(e.height*Math.sin(a)),h=Math.abs(e.width*Math.sin(a))+Math.abs(e.height*Math.cos(a))
    const math=elementMathEntries(e),font=e.fontSize||16,mathHeight=math.length*Math.max(50,font*3)+Math.max(0,math.length-1)*12+(e.text&&math.length?12:0)
    return e.type==='frame'?{x:e.x,y:e.y,w:e.width,h:24+Math.ceil(Array.from(e.text||'').length*font/Math.max(1,e.width-32))*font*1.6+mathHeight}:{x:e.x+e.width/2-w/2,y:e.y+e.height/2-h/2,w,h}
  }), labels=[]
  const overlaps=r=>obstacles.some(o=>r.x<o.x+o.w+8&&r.x+r.w+8>o.x&&r.y<o.y+o.h+8&&r.y+r.h+8>o.y)
  for(const e of board.elements.filter(connector)) {
    const mathExpressions=elementMathEntries(e)
    const {a,b}=endpoints(e,board.elements),full=relationName(e,flows),text=Array.from(full).length>96?Array.from(full).slice(0,93).join('')+'…':full,font=Math.min(20,e.fontSize||15),w=Math.min(250,Math.max(120,Array.from(text).length*font*.8+28)),h=Math.max(40,Math.ceil(Array.from(text).length*font/w)*font*1.65+18)+mathExpressions.length*52
    const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,length=Math.hypot(b.x-a.x,b.y-a.y)||1,nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length
    let box=null
    for(let offset=0;offset<=400&&!box;offset+=40)for(const sign of offset?[1,-1]:[1])for(const t of [.5,.3,.7]){
      if(box)break
      const candidate={x:a.x+(b.x-a.x)*t+nx*offset*sign-w/2,y:a.y+(b.y-a.y)*t+ny*offset*sign-h/2,w,h}
      if(!overlaps(candidate)){box=candidate;break}
    }
    if(!box){box={x:mx-w/2,y:Math.max(my,...obstacles.map(o=>o.y+o.h))+24,w,h}}
    obstacles.push(box);labels.push({...box,id:e.id,text,font,mx,my,math:e.math||'',mathExpressions})
  }
  return labels
}
