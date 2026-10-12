import { elementMathEntries } from './board.js'

// Geometry only: stable identities, semantics, mappings and pencil points survive.
export function layoutBox(e) {
  const r=(e.rotation||0)*Math.PI/180,c=Math.abs(Math.cos(r)),s=Math.abs(Math.sin(r)),w=e.width*c+e.height*s,h=e.width*s+e.height*c
  return {x:e.x+(e.width-w)/2,y:e.y+(e.height-h)/2,width:w,height:h}
}
export function boxesOverlap(a,b,gap=0) { return a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y }
export function autoLayout(input, measured={}) {
  const board=structuredClone(input), elements=board.elements||[], shapes=elements.filter(e=>!['line','arrow'].includes(e.type)), frames=shapes.filter(e=>e.type==='frame')
  const parent=new Map(), children=new Map([[null,[]]]),headers=new Map()
  for(const e of shapes){
    const candidates=frames.filter(f=>f.id!==e.id&&f.width*f.height>e.width*e.height&&e.x+e.width/2>f.x&&e.x+e.width/2<f.x+f.width&&e.y+e.height/2>f.y&&e.y+e.height/2<f.y+f.height).sort((a,b)=>a.width*a.height-b.width*b.height)
    const p=candidates[0]?.id??null;parent.set(e.id,p);if(!children.has(p))children.set(p,[]);children.get(p).push(e)
  }
  const shift=(e,dx,dy)=>{e.x+=dx;e.y+=dy;for(const c of children.get(e.id)||[])shift(c,dx,dy)}
  function size(e){
    const math=elementMathEntries(e)
    if(!e.text&&!math.length)return
    const font=e.fontSize||16,ix=e.type==='diamond'?.72:e.type==='ellipse'?.82:1,iy=e.type==='diamond'?.45:e.type==='ellipse'?.64:1
    const available=Math.max(40,e.width*ix-32), chars=Math.max(3,Math.floor(available/font)), lines=String(e.text||'').split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil(Array.from(s).length/chars)),0)
    const formula=math.length*Math.max(50,font*3)+Math.max(0,math.length-1)*12, need=measured[e.id]
    if(e.type==='frame'){headers.set(e.id,Math.max(76,need?.headerHeight||Math.ceil(lines*font*1.6+formula+(e.text&&math.length?12:0)+24)));return}
    e.width=Math.max(e.width,need?.width||0)
    e.height=Math.max(e.height,Math.ceil((Math.max(need?.height||0,lines*font*1.6+formula+(e.text&&math.length?12:0))+24)/iy))
  }
  function arrange(p){
    const group=children.get(p)||[], f=elements.find(e=>e.id===p)
    for(const e of group){size(e);if(e.type==='frame')arrange(e.id)}
    group.sort((a,b)=>a.y-b.y||a.x-b.x||a.id.localeCompare(b.id))
    const placed=[]
    for(const e of group){
      let box=layoutBox(e)
      if(f){shift(e,Math.max(0,f.x+20-box.x),Math.max(0,f.y+(headers.get(f.id)||Math.max(76,measured[f.id]?.headerHeight||0))-box.y));box=layoutBox(e)}
      for(let attempts=0;attempts<=placed.length;attempts++){
        const hits=placed.filter(o=>boxesOverlap(box,o,24));if(!hits.length)break
        const dy=Math.max(...hits.map(o=>o.y+o.height+24))-box.y;shift(e,0,dy);box=layoutBox(e)
      }
      placed.push(box)
    }
    if(f&&placed.length){f.width=Math.max(f.width,...placed.map(o=>o.x+o.width-f.x+24));f.height=Math.max(f.height,...placed.map(o=>o.y+o.height-f.y+24))}
  }
  arrange(null)
  return board
}
