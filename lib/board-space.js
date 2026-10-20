// Pure world geometry shared by the renderer and document commands.
// x is right, y is down, z is height above the drawing plane.
export const SPACE_LINK_TYPES = ['line', 'arrow']
export const SPACE_MAX_RANK = 6
function spaceNumber(value, fallback = 0) { return Number.isFinite(value) ? value : fallback }
export function isSpaceLink(element) { return SPACE_LINK_TYPES.includes(element?.type) }
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

// Explicit layout only. Each component has a hub; long paths clamp, never reset.
export function autoDepth(elements, options = {}) {
  const list = Array.isArray(elements) ? elements : [], nodes = list.filter((e) => e && typeof e.id === 'string' && !isSpaceLink(e))
  const neighbours = new Map(nodes.map((e) => [e.id, new Set()]))
  for (const edge of list) {
    if (!isSpaceLink(edge) || !neighbours.has(edge.from) || !neighbours.has(edge.to) || edge.from === edge.to) continue
    neighbours.get(edge.from).add(edge.to); neighbours.get(edge.to).add(edge.from)
  }
  const sorted = [...neighbours.keys()].sort((a, b) => neighbours.get(b).size - neighbours.get(a).size || (a < b ? -1 : a > b ? 1 : 0)), rank = new Map()
  for (const root of sorted) {
    if (rank.has(root)) continue
    rank.set(root, 0)
    const queue = [root]
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]
      for (const next of [...neighbours.get(id)].sort()) {
        if (rank.has(next)) continue
        rank.set(next, Math.min(SPACE_MAX_RANK, rank.get(id) + 1)); queue.push(next)
      }
    }
  }
  const heights = nodes.map((node) => Math.abs(spaceNumber(node.height, 120))).sort((a, b) => a - b), median = heights.length ? heights[Math.floor(heights.length / 2)] : 120
  const step = Math.max(60, Math.min(420, median * spaceNumber(options.stepRatio, 1.8)))
  return new Map([...rank].map(([id, value]) => [id, value * step]))
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
