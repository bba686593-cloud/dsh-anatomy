// Pure world geometry shared by the renderer and document commands.
// x is right, y is down, z is height above the drawing plane.
export const SPACE_LINK_TYPES = ['line', 'arrow']
function spaceNumber(value, fallback = 0) { return Number.isFinite(value) ? value : fallback }
export function isSpaceLink(element) { return SPACE_LINK_TYPES.includes(element?.type) }
export function spaceHasGeometry(board) {
  return !!board?.spatialRig || (Array.isArray(board?.elements) ? board.elements : []).some((e) => e && (Array.isArray(e.points3d) || ['z', 'endZ', 'rotationX', 'rotationY', 'extrusion'].some((key) => Number.isFinite(e[key]))))
}
export function spaceCenter(element) {
  return { x: spaceNumber(element?.x) + spaceNumber(element?.width) / 2, y: spaceNumber(element?.y) + spaceNumber(element?.height) / 2 }
}

// Euler angles use board coordinates and degrees: apply X, then Y, then Z.
// This keeps the existing positive rotation direction in the x/right,y/down plane.
export function spaceRotateVector(vector, rx = 0, ry = 0, rz = 0) {
  const ax = spaceNumber(rx) * Math.PI / 180, ay = spaceNumber(ry) * Math.PI / 180, az = spaceNumber(rz) * Math.PI / 180
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az)
  const x = spaceNumber(vector?.x), y = spaceNumber(vector?.y), z = spaceNumber(vector?.z)
  const yx = y * cx - z * sx, zx = y * sx + z * cx
  const xy = x * cy + zx * sy, zy = -x * sy + zx * cy
  return { x: xy * cz - yx * sz, y: xy * sz + yx * cz, z: zy }
}
export function spacePosePoint(element, point) {
  const center = { ...spaceCenter(element), z: spaceNumber(element?.z) }
  const vector = spaceRotateVector({ x: spaceNumber(point?.x) - center.x, y: spaceNumber(point?.y) - center.y, z: spaceNumber(point?.z, center.z) - center.z }, element?.rotationX, element?.rotationY, element?.rotation)
  return { x: center.x + vector.x, y: center.y + vector.y, z: center.z + vector.z }
}
export function spaceUnposePoint(element, point) {
  const center = { ...spaceCenter(element), z: spaceNumber(element?.z) }
  let vector = { x: spaceNumber(point?.x) - center.x, y: spaceNumber(point?.y) - center.y, z: spaceNumber(point?.z, center.z) - center.z }
  // The inverse reverses the order; negating all three Euler angles at once
  // would give a different transform whenever more than one axis is tilted.
  vector = spaceRotateVector(vector, 0, 0, -spaceNumber(element?.rotation))
  vector = spaceRotateVector(vector, 0, -spaceNumber(element?.rotationY), 0)
  vector = spaceRotateVector(vector, -spaceNumber(element?.rotationX), 0, 0)
  return { x: center.x + vector.x, y: center.y + vector.y, z: center.z + vector.z }
}
export function spaceShapeOutline(element) {
  if (!element || !['rect', 'ellipse', 'diamond', 'polygon'].includes(element.type)) return []
  const x = spaceNumber(element.x), y = spaceNumber(element.y), w = spaceNumber(element.width), h = spaceNumber(element.height), z = spaceNumber(element.z)
  if (element.type === 'polygon') return (Array.isArray(element.points) ? element.points : []).filter((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)).map(([px, py]) => ({ x: x + px * w, y: y + py * h, z }))
  if (element.type === 'ellipse') return Array.from({ length: 64 }, (_, i) => { const angle = i * Math.PI / 32; return { x: x + w / 2 + Math.cos(angle) * w / 2, y: y + h / 2 + Math.sin(angle) * h / 2, z } })
  const points = element.type === 'diamond' ? [[.5, 0], [1, .5], [.5, 1], [0, .5]] : [[0, 0], [1, 0], [1, 1], [0, 1]]
  return points.map(([px, py]) => ({ x: x + px * w, y: y + py * h, z }))
}

// Absolute vertices, before element.rotation; no view-dependent default depth.
// Normalized x/y remain authoritative after a 2D resize, move or duplicate;
// points3d contributes the per-vertex height when both representations match.
export function spaceStrokePoints(element) {
  if (!element) return []
  const absolute = Array.isArray(element.points3d) ? element.points3d.filter((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) : []
  const x = spaceNumber(element.x), y = spaceNumber(element.y), w = spaceNumber(element.width), h = spaceNumber(element.height), z = spaceNumber(element.z)
  const normalized = (Array.isArray(element.points) ? element.points : []).filter((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite))
  if (absolute.length >= 2 && normalized.length === absolute.length && normalized.length === element.points.length && absolute.length === element.points3d.length) return normalized.map(([px, py], index) => ({ x: x + px * w, y: y + py * h, z: absolute[index][2] }))
  if (absolute.length >= 2) return absolute.map(([px, py, pz]) => ({ x: px, y: py, z: pz }))
  return normalized.map(([px, py]) => ({ x: x + px * w, y: y + py * h, z }))
}

// In-place document command: absolute ink must move with its element geometry.
export function spaceTranslateElement(element, dx = 0, dy = 0, dz = 0) {
  if (!element || typeof element !== 'object') return element
  dx = spaceNumber(dx); dy = spaceNumber(dy); dz = spaceNumber(dz)
  element.x = spaceNumber(element.x) + dx; element.y = spaceNumber(element.y) + dy
  if (dz || Number.isFinite(element.z)) element.z = spaceNumber(element.z) + dz
  if (Number.isFinite(element.endZ)) element.endZ += dz
  if (Array.isArray(element.points3d)) element.points3d = element.points3d.map((p) => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(Number.isFinite) ? [p[0] + dx, p[1] + dy, p[2] + dz, ...p.slice(3)] : p)
  return element
}
function spaceAttachmentCenter(element) {
  const extrusion = ['rect', 'ellipse', 'diamond', 'polygon'].includes(element?.type) ? spaceNumber(element.extrusion) : 0
  return spacePosePoint(element, { ...spaceCenter(element), z: spaceNumber(element?.z) + extrusion / 2 })
}
function spaceBoundary(element, toward) {
  const extrusion = ['rect', 'ellipse', 'diamond', 'polygon'].includes(element?.type) ? spaceNumber(element.extrusion) : 0
  const center = { ...spaceCenter(element), z: spaceNumber(element?.z) + extrusion / 2 }
  const local = spaceUnposePoint(element, toward), dx = local.x - center.x, dy = local.y - center.y, dz = local.z - center.z
  const w = Math.abs(spaceNumber(element?.width)) / 2, h = Math.abs(spaceNumber(element?.height)) / 2
  if (!w || !h) return spacePosePoint(element, center)
  // Exact quarter turns leave tiny sin/cos residuals. A link along a face's
  // normal must meet its center/cap rather than amplify that residue to an edge.
  const planar = Math.hypot(dx, dy) > Math.max(1, Math.abs(dz), w, h) * 1e-12
  let factor = !planar ? Infinity : element.type === 'ellipse' ? 1 / Math.hypot(dx / w, dy / h) : element.type === 'diamond' ? 1 / (Math.abs(dx / w) + Math.abs(dy / h)) : 1 / Math.max(Math.abs(dx / w), Math.abs(dy / h))
  if (element.type === 'polygon') {
    const outline = spaceShapeOutline(element), cross = (a, b) => a.x * b.y - a.y * b.x, direction = { x: dx, y: dy }
    let nearest = Infinity, inside = false, closest = null, distance = Infinity
    for (let i = 0; i < outline.length; i++) {
      const start = outline[i], b = outline[(i + 1) % outline.length], a = { x: start.x - center.x, y: start.y - center.y }, edge = { x: b.x - start.x, y: b.y - start.y }
      if ((start.y > center.y) !== (b.y > center.y) && center.x < (b.x - start.x) * (center.y - start.y) / (b.y - start.y) + start.x) inside = !inside
      const length = edge.x * edge.x + edge.y * edge.y, uClosest = length ? Math.max(0, Math.min(1, ((local.x - start.x) * edge.x + (local.y - start.y) * edge.y) / length)) : 0
      const candidate = { x: start.x + edge.x * uClosest, y: start.y + edge.y * uClosest }, candidateDistance = Math.hypot(candidate.x - local.x, candidate.y - local.y)
      if (candidateDistance < distance) { distance = candidateDistance; closest = candidate }
      const denominator = cross(direction, edge)
      if (!planar || Math.abs(denominator) < 1e-12) continue
      const t = cross(a, edge) / denominator, u = cross(a, direction) / denominator
      if (t >= 0 && u >= -1e-10 && u <= 1 + 1e-10) nearest = Math.min(nearest, t)
    }
    // A concave profile can leave its bounding-box center in empty space.
    // Project onto an actual profile segment instead of inventing a box edge
    // or a cap in the opening of a U-shaped outline.
    if (closest && (!inside || planar && !Number.isFinite(nearest))) {
      const base = spaceNumber(element.z), z = extrusion ? Math.max(Math.min(base, base + extrusion), Math.min(Math.max(base, base + extrusion), local.z)) : base
      return spacePosePoint(element, { ...closest, z })
    }
    if (Number.isFinite(nearest)) factor = nearest
  }
  if (extrusion && dz) factor = Math.min(factor, Math.abs(extrusion / (2 * dz)))
  if (!Number.isFinite(factor)) return spacePosePoint(element, center)
  return spacePosePoint(element, { x: center.x + dx * factor, y: center.y + dy * factor, z: extrusion ? center.z + dz * factor : center.z })
}
export function spaceLinks(elements) {
  const list = Array.isArray(elements) ? elements.filter((e) => e && typeof e.id === 'string') : []
  const byId = new Map(list.filter((e) => !isSpaceLink(e)).map((e) => [e.id, e]))
  return list.filter(isSpaceLink).map((element) => {
    const from = byId.has(element.from) ? element.from : null, to = byId.has(element.to) ? element.to : null
    const start = from ? spaceAttachmentCenter(byId.get(from)) : spacePosePoint(element, { x: spaceNumber(element.x), y: spaceNumber(element.y), z: spaceNumber(element.z) })
    const end = to ? spaceAttachmentCenter(byId.get(to)) : spacePosePoint(element, { x: spaceNumber(element.x) + spaceNumber(element.width), y: spaceNumber(element.y) + spaceNumber(element.height), z: spaceNumber(element.endZ, spaceNumber(element.z)) })
    return { id: element.id, type: element.type, from, to, a: from ? spaceBoundary(byId.get(from), end) : start, b: to ? spaceBoundary(byId.get(to), start) : end, z: spaceNumber(element.z), element }
  })
}

// Condense strongly connected components before ranking the directed graph.
// Cycles share a level; downstream components follow their longest predecessor.
function spaceGraphRanks(ids, edges) {
  const order = [...ids].sort(), next = new Map(order.map((id) => [id, []])), previous = new Map(order.map((id) => [id, []]))
  for (const [a, b] of edges) if (a !== b && next.has(a) && next.has(b)) { next.get(a).push(b); previous.get(b).push(a) }
  for (const neighbours of [...next.values(), ...previous.values()]) neighbours.sort()
  const seen = new Set(), finished = []
  for (const root of order) {
    if (seen.has(root)) continue
    const stack = [[root, 0]]; seen.add(root)
    while (stack.length) {
      const top = stack[stack.length - 1], neighbours = next.get(top[0])
      if (top[1] === neighbours.length) { finished.push(top[0]); stack.pop(); continue }
      const id = neighbours[top[1]++]
      if (!seen.has(id)) { seen.add(id); stack.push([id, 0]) }
    }
  }
  const component = new Map(), groups = []
  for (const root of finished.reverse()) {
    if (component.has(root)) continue
    const index = groups.length, members = [], stack = [root]; component.set(root, index)
    while (stack.length) {
      const id = stack.pop(); members.push(id)
      for (const before of previous.get(id)) if (!component.has(before)) { component.set(before, index); stack.push(before) }
    }
    groups.push(members.sort())
  }
  const outgoing = groups.map(() => new Set()), incoming = groups.map(() => 0), ranks = groups.map(() => 0)
  for (const [a, b] of edges) {
    const source = component.get(a), target = component.get(b)
    if (source === undefined || target === undefined || source === target || outgoing[source].has(target)) continue
    outgoing[source].add(target); incoming[target]++
  }
  const ready = incoming.flatMap((count, index) => count ? [] : [index])
  for (let index = 0; index < ready.length; index++) for (const target of outgoing[ready[index]]) {
    ranks[target] = Math.max(ranks[target], ranks[ready[index]] + 1)
    if (!--incoming[target]) ready.push(target)
  }
  return new Map(order.map((id) => [id, ranks[component.get(id)]]))
}
// This is an explicit document command, never part of opening a view. Frames
// describe partitions, not dependency nodes. Parent hierarchy takes precedence
// over a return flow; ordinary arrows then order nodes without invented hubs.
export function autoDepth(elements, options = {}) {
  const list = Array.isArray(elements) ? elements : [], nodes = list.filter((e) => e && typeof e.id === 'string' && !isSpaceLink(e) && e.type !== 'frame')
  const ids = new Set(nodes.map((e) => e.id)), parents = nodes.filter((e) => ids.has(e.structure?.parent)).map((e) => [e.structure.parent, e.id])
  const hierarchy = spaceGraphRanks(ids, parents), edges = [...parents]
  const connect = (from, to) => { if (ids.has(from) && ids.has(to) && hierarchy.get(from) <= hierarchy.get(to)) edges.push([from, to]) }
  for (const edge of list) if (edge?.type === 'arrow') { connect(edge.from, edge.to); if (edge.direction === 'two-way') connect(edge.to, edge.from) }
  const rank = spaceGraphRanks(ids, edges), heights = nodes.map((node) => Math.abs(spaceNumber(node.height, 120))).sort((a, b) => a - b), median = heights.length ? heights[Math.floor(heights.length / 2)] : 120
  const step = Math.max(60, Math.min(420, median * spaceNumber(options.stepRatio, 1.8)))
  return new Map([...rank].map(([id, value]) => [id, value * step]))
}
// Finite segment distance in world coordinates. Crossing reduction must not
// depend on whichever camera happened to be open when the command was invoked.
function spaceLayoutSegmentDistance(a, b, c, d) {
  const u = [b.x-a.x,b.y-a.y,b.z-a.z], v = [d.x-c.x,d.y-c.y,d.z-c.z], w = [a.x-c.x,a.y-c.y,a.z-c.z]
  const dot = (x,y) => x[0]*y[0]+x[1]*y[1]+x[2]*y[2]
  const aa=dot(u,u), bb=dot(u,v), cc=dot(v,v), dd=dot(u,w), ee=dot(v,w), det=aa*cc-bb*bb
  let s=det>1e-12 ? Math.max(0,Math.min(1,(bb*ee-cc*dd)/det)) : 0
  let t=cc>1e-12 ? (bb*s+ee)/cc : 0
  if(t<0){t=0;s=aa>1e-12?Math.max(0,Math.min(1,-dd/aa)):0}
  else if(t>1){t=1;s=aa>1e-12?Math.max(0,Math.min(1,(bb-dd)/aa)):0}
  return Math.hypot(w[0]+s*u[0]-t*v[0],w[1]+s*u[1]-t*v[1],w[2]+s*u[2]-t*v[2])
}
function spaceLayoutSegmentBox(a,b,box,padding=0) {
  let enter=0,leave=1
  for(const axis of ['x','y','z']){
    const low=box['min'+axis.toUpperCase()]-padding,high=box['max'+axis.toUpperCase()]+padding,delta=b[axis]-a[axis]
    if(Math.abs(delta)<1e-10){if(a[axis]<low||a[axis]>high)return false;continue}
    const p=(low-a[axis])/delta,q=(high-a[axis])/delta
    enter=Math.max(enter,Math.min(p,q));leave=Math.min(leave,Math.max(p,q))
    if(enter>leave)return false
  }
  return true
}
function spaceLayoutCrossing(a,b,c,d,view) {
  const project=p=>({x:p.x+view[0]*p.z,y:p.y+view[1]*p.z}), p=project(a),q=project(b),r=project(c),s=project(d)
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  return cross(p,q,r)*cross(p,q,s)<-1e-6&&cross(r,s,p)*cross(r,s,q)<-1e-6
}

// Explicit relationship layout. Unconnected freehand marks stay where drawn;
// neither opening a 3D view nor editing text invokes this command. Values are
// document positions (not camera transforms); the caller previews/applies them
// through the same translation command used by ordinary object movement.
export function spaceStructureLayout(elements, options = {}) {
  const list=(Array.isArray(elements)?elements:[]).filter(e=>e&&typeof e.id==='string'),byId=new Map(list.map(e=>[e.id,e]))
  const available=list.filter(e=>!isSpaceLink(e)&&e.type!=='frame').sort((a,b)=>a.id.localeCompare(b.id)),ids=new Set(available.map(e=>e.id))
  const edges=[],edgeKeys=new Set(),active=new Set(),neighbours=new Map(available.map(e=>[e.id,new Set()]))
  const connect=(a,b)=>{
    if(a===b||!ids.has(a)||!ids.has(b))return
    const key=[a,b].sort().join('\0');active.add(a);active.add(b)
    if(edgeKeys.has(key))return
    edgeKeys.add(key);edges.push([a,b].sort());neighbours.get(a).add(b);neighbours.get(b).add(a)
  }
  for(const e of list){if(isSpaceLink(e))connect(e.from,e.to);else connect(e.structure?.parent,e.id)}
  // Persisted semantic membership is useful even when a subsystem has no flow.
  // It never makes an unrelated pen stroke into an independent layout object.
  const memberships=new Map()
  for(const e of available)if(e.structure||e.frame){
    if(e.type==='pen'&&!active.has(e.id))continue
    active.add(e.id)
    const key=e.frame||e.structure?.systems?.[0]
    if(key){if(!memberships.has(key))memberships.set(key,[]);memberships.get(key).push(e.id)}
  }
  const componentNeighbours=new Map([...neighbours].map(([id,values])=>[id,new Set(values)]))
  for(const group of memberships.values())for(let i=1;i<group.length;i++){
    componentNeighbours.get(group[0]).add(group[i]);componentNeighbours.get(group[i]).add(group[0])
  }
  const components=[],visited=new Set()
  for(const id of [...active].sort())if(!visited.has(id)){
    const members=[],queue=[id];visited.add(id)
    for(let i=0;i<queue.length;i++){
      const current=queue[i];members.push(current)
      for(const next of [...componentNeighbours.get(current)].sort())if(active.has(next)&&!visited.has(next)){visited.add(next);queue.push(next)}
    }
    components.push(members.sort())
  }
  if(!components.length)return new Map()
  edges.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]))
  const geometry=new Map(available.map(e=>{
    const bounds=spaceScene({elements:[e]}).bounds
    return [e.id,{bounds,width:Math.max(1,bounds.maxX-bounds.minX),height:Math.max(1,bounds.maxY-bounds.minY),center:{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,z:(bounds.minZ+bounds.maxZ)/2}}]
  }))
  const heights=[...active].map(id=>geometry.get(id).height).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)]||120
  const gap=Math.max(48,Math.min(240,median*.65)),step=Math.max(60,Math.min(420,median*spaceNumber(options.stepRatio,1.8))),clearance=Math.max(14,Math.min(64,median*.3))
  const depths=autoDepth(list,options),depthUnit=Math.min(...[...depths.values()].filter(value=>value>0))||1,layouts=[]
  const shiftedBox=(id,point)=>{
    const g=geometry.get(id),b=g.bounds
    return {minX:point.x+(b.minX-g.center.x),maxX:point.x+(b.maxX-g.center.x),minY:point.y+(b.minY-g.center.y),maxY:point.y+(b.maxY-g.center.y),minZ:point.z+(b.minZ-g.center.z),maxZ:point.z+(b.maxZ-g.center.z)}
  }
  const union=boxes=>{
    const result={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity}
    for(const b of boxes)for(const axis of ['X','Y','Z']){result['min'+axis]=Math.min(result['min'+axis],b['min'+axis]);result['max'+axis]=Math.max(result['max'+axis],b['max'+axis])}
    return result
  }
  for(const members of components){
    const memberSet=new Set(members),connections=edges.filter(([a,b])=>memberSet.has(a)&&memberSet.has(b)),rank=new Map(members.map(id=>[id,Math.round((depths.get(id)||0)/depthUnit)]))
    if(!Math.max(...rank.values())&&members.length>1){
      // Undirected graphs and a single cyclic component have no DAG height.
      // Distance from a stable central node supplies useful spatial separation.
      const root=[...members].sort((a,b)=>neighbours.get(b).size-neighbours.get(a).size||a.localeCompare(b))[0],queue=[root],seen=new Set([root]);rank.set(root,0)
      for(let i=0;i<queue.length;i++)for(const id of [...componentNeighbours.get(queue[i])].sort())if(memberSet.has(id)&&!seen.has(id)){seen.add(id);rank.set(id,rank.get(queue[i])+1);queue.push(id)}
    }
    const layers=new Map()
    for(const id of members){const r=rank.get(id);if(!layers.has(r))layers.set(r,[]);layers.get(r).push(id)}
    const levels=[...layers.keys()].sort((a,b)=>a-b)
    // Bidirectional barycentre sweeps put related branches in matching lanes.
    for(let pass=0;pass<8;pass++){
      const order=new Map();for(const group of layers.values())group.forEach((id,i)=>order.set(id,group.length<2?0:i/(group.length-1)))
      for(const r of pass%2?[...levels].reverse():levels){
        const group=layers.get(r),scores=new Map(group.map(id=>{
          const adjacent=[...neighbours.get(id)].filter(other=>pass%2?rank.get(other)>r:rank.get(other)<r)
          return [id,adjacent.length?adjacent.reduce((sum,id)=>sum+order.get(id),0)/adjacent.length:order.get(id)]
        }))
        group.sort((a,b)=>scores.get(a)-scores.get(b)||order.get(a)-order.get(b)||a.localeCompare(b))
      }
    }
    const positions=new Map();let x=0
    for(const r of levels){
      const group=layers.get(r),width=Math.max(...group.map(id=>geometry.get(id).width)),height=Math.max(...group.map(id=>geometry.get(id).height))
      x+=width/2
      for(let i=0;i<group.length;i++)positions.set(group[i],{x,y:(i-(group.length-1)/2)*(height+gap),z:r*step+(group.length>1?Math.cos(i*Math.PI*2/3+r*.7)*step*.42:0)})
      x+=width/2+gap*2
    }
    // Local swaps use physical segment clearance and edge/object intersections,
    // with three projections only as a secondary readability tie breaker. The
    // bounded work budget keeps a 500-object command interactive.
    let budget=250000
    const score=touched=>{
      let value=0
      const local=connections.map(([a,b],i)=>touched.has(a)||touched.has(b)?i:-1).filter(i=>i>=0),localSet=new Set(local)
      for(const i of local){
        const [a,b]=connections[i],p=positions.get(a),q=positions.get(b)
        value+=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)/Math.max(1,step)*.005
        for(let j=0;j<connections.length;j++){
          if(j===i||localSet.has(j)&&j<i)continue
          const [c,d]=connections[j];if(a===c||a===d||b===c||b===d)continue
          if(--budget<0)return Infinity
          const r=positions.get(c),s=positions.get(d),distance=spaceLayoutSegmentDistance(p,q,r,s)
          if(distance<clearance)value+=24*(1-distance/clearance)**2
          for(const view of [[0,0],[.35,-.55],[-.4,-.3]])if(spaceLayoutCrossing(p,q,r,s,view))value+=.3
        }
        for(const id of members)if(id!==a&&id!==b){
          if(--budget<0)return Infinity
          if(spaceLayoutSegmentBox(p,q,shiftedBox(id,positions.get(id)),clearance*.3))value+=30
        }
      }
      for(const id of touched)for(let i=0;i<connections.length;i++)if(!localSet.has(i)){
        if(--budget<0)return Infinity
        const [a,b]=connections[i]
        if(spaceLayoutSegmentBox(positions.get(a),positions.get(b),shiftedBox(id,positions.get(id)),clearance*.3))value+=30
      }
      return value
    }
    for(let pass=0;pass<3&&budget>0;pass++)for(const group of layers.values())for(let i=0;i<group.length-1&&budget>0;i++){
      const a=group[i],b=group[pass%2?(i+Math.ceil(group.length/2))%group.length:i+1]
      if(a===b)continue
      const touched=new Set([a,b]),before=score(touched),pa=positions.get(a),pb=positions.get(b)
      positions.set(a,{x:pa.x,y:pb.y,z:pb.z});positions.set(b,{x:pb.x,y:pa.y,z:pa.z})
      const after=score(touched)
      if(!Number.isFinite(after)||after>=before-1e-8){positions.set(a,pa);positions.set(b,pb)}
    }
    layouts.push({members,positions,bounds:union(members.map(id=>shiftedBox(id,positions.get(id))))})
  }
  const original=union([...active].map(id=>geometry.get(id).bounds)),obstacles=available.filter(e=>!active.has(e.id)).map(e=>geometry.get(e.id).bounds)
  const totalArea=layouts.reduce((sum,entry)=>sum+(entry.bounds.maxX-entry.bounds.minX+gap*3)*(entry.bounds.maxY-entry.bounds.minY+gap*3),0),rowWidth=Math.max(Math.sqrt(totalArea)*1.3,...layouts.map(entry=>entry.bounds.maxX-entry.bounds.minX))
  let cursorX=original.minX,cursorY=original.minY,rowHeight=0
  const result=new Map(),intersects=(a,b)=>['X','Y','Z'].every(axis=>a['min'+axis]<b['max'+axis]+gap&&a['max'+axis]>b['min'+axis]-gap)
  for(const layout of layouts){
    const b=layout.bounds,width=b.maxX-b.minX
    if(cursorX>original.minX&&cursorX+width>original.minX+rowWidth){cursorX=original.minX;cursorY+=rowHeight+gap*3;rowHeight=0}
    let dx=cursorX-b.minX,dy=cursorY-b.minY,dz=original.minZ-b.minZ,placed
    for(let attempt=0;attempt<=obstacles.length;attempt++){
      placed={minX:b.minX+dx,maxX:b.maxX+dx,minY:b.minY+dy,maxY:b.maxY+dy,minZ:b.minZ+dz,maxZ:b.maxZ+dz}
      const hits=obstacles.filter(other=>intersects(placed,other))
      if(!hits.length)break
      dy=Math.max(...hits.map(other=>other.maxY))+gap-b.minY
    }
    for(const id of layout.members){
      const e=byId.get(id),p=layout.positions.get(id),g=geometry.get(id)
      result.set(id,{x:spaceNumber(e.x)+p.x+dx-g.center.x,y:spaceNumber(e.y)+p.y+dy-g.center.y,z:spaceNumber(e.z)+p.z+dz-g.center.z})
    }
    obstacles.push(placed);cursorX+=width+gap*3;rowHeight=Math.max(rowHeight,placed.maxY-cursorY)
  }
  // Frames keep their membership and become a common backdrop for their
  // rearranged descendants; they never create a hidden editing layer.
  const frames=list.filter(e=>e.type==='frame').sort((a,b)=>a.id.localeCompare(b.id)),resolving=new Set(),resolved=new Set()
  const framePose=frame=>{
    if(resolved.has(frame.id)||resolving.has(frame.id))return
    resolving.add(frame.id)
    const children=list.filter(e=>e.frame===frame.id&&e.id!==frame.id&&!(isSpaceLink(e)&&(e.from||e.to)))
    for(const child of children)if(child.type==='frame')framePose(child)
    const moved=children.some(e=>result.has(e.id))
    if(moved&&children.length){
      const boxes=children.map(e=>{
        const pose=result.get(e.id),copy=pose?{...e,...pose}:e
        if(pose&&e.type!=='frame'){
          const b=geometry.get(e.id)?.bounds
          if(b)return {minX:b.minX+pose.x-spaceNumber(e.x),maxX:b.maxX+pose.x-spaceNumber(e.x),minY:b.minY+pose.y-spaceNumber(e.y),maxY:b.maxY+pose.y-spaceNumber(e.y),minZ:b.minZ+pose.z-spaceNumber(e.z),maxZ:b.maxZ+pose.z-spaceNumber(e.z)}
        }
        return spaceScene({elements:[copy]}).bounds
      })
      // A frame remains a plane at its saved orientation. Fit the projection
      // of the 3D descendants into that plane's local U/V axes, then put the
      // plane behind their nearest N coordinate. Non-coplanar members keep
      // their heights; resizing a frame never flattens or rotates its content.
      const origin={...spaceCenter(frame),z:spaceNumber(frame.z)},u=spaceRotateVector({x:1,y:0,z:0},frame.rotationX,frame.rotationY,frame.rotation),v=spaceRotateVector({x:0,y:1,z:0},frame.rotationX,frame.rotationY,frame.rotation),n=spaceRotateVector({x:0,y:0,z:1},frame.rotationX,frame.rotationY,frame.rotation)
      let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity,minN=Infinity
      for(const b of boxes)for(const x of [b.minX,b.maxX])for(const y of [b.minY,b.maxY])for(const z of [b.minZ,b.maxZ]){
        const dx=x-origin.x,dy=y-origin.y,dz=z-origin.z,pu=dx*u.x+dy*u.y+dz*u.z,pv=dx*v.x+dy*v.y+dz*v.z,pn=dx*n.x+dy*n.y+dz*n.z
        minU=Math.min(minU,pu);maxU=Math.max(maxU,pu);minV=Math.min(minV,pv);maxV=Math.max(maxV,pv);minN=Math.min(minN,pn)
      }
      const width=Math.max(120,maxU-minU+48),height=Math.max(100,maxV-minV+96),cu=(minU+maxU)/2,cv=(minV+maxV)/2-24,cn=minN-12
      const center={x:origin.x+u.x*cu+v.x*cv+n.x*cn,y:origin.y+u.y*cu+v.y*cv+n.y*cn,z:origin.z+u.z*cu+v.z*cv+n.z*cn}
      result.set(frame.id,{x:center.x-width/2,y:center.y-height/2,z:center.z,width,height})
    }
    resolving.delete(frame.id);resolved.add(frame.id)
  }
  for(const frame of frames)framePose(frame)
  return new Map([...result].sort(([a],[b])=>a.localeCompare(b)).map(([id,pose])=>[id,Object.fromEntries(Object.entries(pose).map(([key,value])=>[key,Math.round(value*1e6)/1e6||0]))]))
}
export function spaceScene(board) {
  const elements = Array.isArray(board?.elements) ? board.elements.filter((e) => e && typeof e.id === 'string') : [], edges = spaceLinks(elements)
  const cards = elements.filter((e) => !isSpaceLink(e)).map((element) => ({ id: element.id, element, ...spaceCenter(element), z: spaceNumber(element.z), width: Math.abs(spaceNumber(element.width)), height: Math.abs(spaceNumber(element.height)), rotation: spaceNumber(element.rotation), rotationX: spaceNumber(element.rotationX), rotationY: spaceNumber(element.rotationY), extrusion: spaceNumber(element.extrusion) }))
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const include = (p) => {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x)
    bounds.minY = Math.min(bounds.minY, p.y); bounds.maxY = Math.max(bounds.maxY, p.y)
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z)
  }
  for (const card of cards) {
    const element = card.element, outline = spaceShapeOutline(element), stroke = element.type === 'pen' ? spaceStrokePoints(element) : []
    const profile = outline.length ? outline : stroke.length ? stroke : [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: card.x + sx * card.width / 2, y: card.y + sy * card.height / 2, z: card.z })))
    for (const p of profile) {
      include(spacePosePoint(element, p))
      if (outline.length && card.extrusion) include(spacePosePoint(element, { ...p, z: p.z + card.extrusion }))
    }
  }
  for (const edge of edges) { include(edge.a); include(edge.b) }
  if (!Number.isFinite(bounds.minX)) return { cards, edges, links: edges, center: { x: 0, y: 0, z: 0 }, radius: 600, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 } }
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }, radius = Math.max(120, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2)
  return { cards, edges, links: edges, center, radius, bounds }
}

// Construct once when entering the workspace. The controller owns this rig;
// neither subsequent document bounds nor the camera can move its anchors.
// Alternating corners of a box form a tetrahedron, so the four cable lengths
// determine a point in all three dimensions, including its height.
export function spacePenRig(board) {
  // A saved frame is authoritative even if artwork now extends beyond it.
  // Reject corruption rather than silently constructing four different corners.
  if (board && Object.prototype.hasOwnProperty.call(board, 'spatialRig')) {
    const saved = board.spatialRig, lengths = saved?.version === 1 ? spacePenLengths(saved.anchors, saved.tip) : null
    const recovered = lengths && spacePenPoint(saved.anchors, lengths)
    if (!recovered) throw Error('空间笔定位框数据无效')
    const tolerance = 1e-7 + Number.EPSILON * 64 * Math.max(...saved.anchors.flatMap((anchor) => [Math.abs(anchor.x), Math.abs(anchor.y), Math.abs(anchor.z)]), Math.abs(saved.tip.x), Math.abs(saved.tip.y), Math.abs(saved.tip.z))
    if (Math.hypot(recovered.x - saved.tip.x, recovered.y - saved.tip.y, recovered.z - saved.tip.z) > tolerance) throw Error('空间笔定位框数据无效')
    const anchors = saved.anchors.map((anchor, index) => ({ id: ['A', 'B', 'C', 'D'][index], x: anchor.x, y: anchor.y, z: anchor.z }))
    const tip = { x: saved.tip.x, y: saved.tip.y, z: saved.tip.z }
    return {
      anchors, tip,
      bounds: { minX: Math.min(...anchors.map((anchor) => anchor.x)), maxX: Math.max(...anchors.map((anchor) => anchor.x)), minY: Math.min(...anchors.map((anchor) => anchor.y)), maxY: Math.max(...anchors.map((anchor) => anchor.y)), minZ: Math.min(...anchors.map((anchor) => anchor.z)), maxZ: Math.max(...anchors.map((anchor) => anchor.z)) }
    }
  }
  const { bounds } = spaceScene(board)
  const cx = bounds.minX + (bounds.maxX - bounds.minX) / 2, cy = bounds.minY + (bounds.maxY - bounds.minY) / 2, cz = bounds.minZ + (bounds.maxZ - bounds.minZ) / 2
  const hx = Math.max(320, (bounds.maxX - bounds.minX) * 0.65), hy = Math.max(240, (bounds.maxY - bounds.minY) * 0.65), hz = Math.max(260, (bounds.maxZ - bounds.minZ) * 0.65)
  return {
    anchors: [
      { id: 'A', x: cx - hx, y: cy - hy, z: cz - hz },
      { id: 'B', x: cx + hx, y: cy + hy, z: cz - hz },
      { id: 'C', x: cx + hx, y: cy - hy, z: cz + hz },
      { id: 'D', x: cx - hx, y: cy + hy, z: cz + hz }
    ],
    tip: { x: cx, y: cy, z: cz },
    bounds: { minX: cx - hx, maxX: cx + hx, minY: cy - hy, maxY: cy + hy, minZ: cz - hz, maxZ: cz + hz }
  }
}
function spacePenVector(point) { return point && ['x', 'y', 'z'].every((key) => Number.isFinite(point[key])) }
export function spacePenLengths(anchors, point) {
  if (!Array.isArray(anchors) || anchors.length !== 4 || !Array.from(anchors).every(spacePenVector) || !spacePenVector(point)) return null
  const lengths = anchors.map((anchor) => Math.hypot(point.x - anchor.x, point.y - anchor.y, point.z - anchor.z))
  return lengths.every((length) => Number.isFinite(length) && length > 0) ? lengths : null
}
export function spacePenPoint(anchors, lengths) {
  if (!Array.isArray(anchors) || anchors.length !== 4 || !Array.from(anchors).every(spacePenVector) || !Array.isArray(lengths) || lengths.length !== 4 || !Array.from(lengths).every((length) => Number.isFinite(length) && length > 0)) return null
  // Subtract sphere A from spheres B/C/D. Solve in a scaled coordinate system
  // relative to A, avoiding squared world coordinates and their cancellation
  // after translating an engineering drawing far from the origin.
  const origin = anchors[0], offsets = anchors.slice(1).map((anchor) => [anchor.x - origin.x, anchor.y - origin.y, anchor.z - origin.z])
  const scale = Math.max(...offsets.flat().map(Math.abs))
  if (!Number.isFinite(scale) || scale <= 0) return null
  const radius = lengths[0] / scale
  const rows = offsets.map((offset, index) => {
    const d = offset.map((value) => value / scale), r = lengths[index + 1] / scale
    return [...d, (d.reduce((sum, value) => sum + value * value, 0) + (lengths[0] - lengths[index + 1]) / scale * (radius + r)) / 2]
  })
  if (!rows.every((row) => row.every(Number.isFinite))) return null
  for (let column = 0; column < 3; column++) {
    let pivot = column
    for (let row = column + 1; row < 3; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    if (Math.abs(rows[pivot][column]) < 1e-10) return null
    ;[rows[column], rows[pivot]] = [rows[pivot], rows[column]]
    const divisor = rows[column][column]
    for (let index = column; index < 4; index++) rows[column][index] /= divisor
    for (let row = 0; row < 3; row++) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let index = column; index < 4; index++) rows[row][index] -= factor * rows[column][index]
    }
  }
  const local = rows.map((row) => row[3])
  if (!local.every(Number.isFinite)) return null
  // A linear solution alone also exists for contradictory lengths; require
  // that it lies on every original sphere before accepting a pen position.
  const tolerance = 1e-8 / scale + Math.max(1, ...lengths.map((length) => length / scale)) * Number.EPSILON * 64
  for (let index = 0; index < 4; index++) {
    const offset = index ? offsets[index - 1].map((value) => value / scale) : [0, 0, 0]
    if (Math.abs(Math.hypot(...local.map((value, axis) => value - offset[axis])) - lengths[index] / scale) > tolerance) return null
  }
  const point = { x: origin.x + local[0] * scale, y: origin.y + local[1] * scale, z: origin.z + local[2] * scale }
  return spacePenVector(point) ? point : null
}

// Erase intersections, not just sampled vertices. Correct the screen parameter
// for perspective before interpolating surviving world vertices.
export function spaceClipStroke(points, project, center, radius) {
  if (!Array.isArray(points) || points.length < 2) return []
  if (!Number.isFinite(radius) || radius <= 0) return [points.map((p) => ({ ...p }))]
  const runs = [], run = []
  const flush = () => { if (run.length >= 2) runs.push(run.splice(0)); else run.length = 0 }
  const append = (p) => { const prev = run[run.length - 1]; if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y, spaceNumber(p.z) - spaceNumber(prev.z)) > 1e-9) run.push(p) }
  const lerp = (a, b, t, pa, pb) => {
    // Preserve untouched endpoint values exactly: callers use equality to avoid
    // replacing an unhit stroke because floating-point interpolation drifted.
    if (t === 0) return { ...a }
    if (t === 1) return { ...b }
    if (Number.isFinite(pa.depth) && Number.isFinite(pb.depth) && pa.depth > 0 && pb.depth > 0) t = t * pa.depth / ((1 - t) * pb.depth + t * pa.depth)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: spaceNumber(a.z) + (spaceNumber(b.z) - spaceNumber(a.z)) * t }
  }
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1], pa = project(a), pb = project(b)
    if (!pa || !pb || !Number.isFinite(pa.x) || !Number.isFinite(pa.y) || !Number.isFinite(pb.x) || !Number.isFinite(pb.y) || pa.depth <= 0 || pb.depth <= 0) { append({ ...a }); append({ ...b }); continue }
    const dx = pb.x - pa.x, dy = pb.y - pa.y, fx = pa.x - center.x, fy = pa.y - center.y, qa = dx * dx + dy * dy, qb = 2 * (fx * dx + fy * dy), qc = fx * fx + fy * fy - radius * radius, disc = qb * qb - 4 * qa * qc
    let intervals = [[0, 1]]
    if (qa <= 1e-12) intervals = qc < 0 ? [] : intervals
    else if (disc > 1e-9) {
      const root = Math.sqrt(disc), enter = Math.max(0, (-qb - root) / (2 * qa)), leave = Math.min(1, (-qb + root) / (2 * qa))
      if (enter < leave) intervals = [...(enter > 0 ? [[0, enter]] : []), ...(leave < 1 ? [[leave, 1]] : [])]
    }
    if (!intervals.length) { flush(); continue }
    for (const [start, end] of intervals) {
      if (start > 0) flush()
      append(lerp(a, b, start, pa, pb)); append(lerp(a, b, end, pa, pb))
      if (end < 1) flush()
    }
  }
  flush()
  return runs
}
