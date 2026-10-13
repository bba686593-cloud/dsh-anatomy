// Geometry uses board coordinates; pointer positions never depend on zoom.
function drawingPoint(point) {
  const x = Array.isArray(point) ? point[0] : point?.x, y = Array.isArray(point) ? point[1] : point?.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw TypeError('绘图坐标必须是有限数值。')
  return { x, y }
}

function drawingBox(element) {
  if (!element || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(element[key])) || element.width <= 0 || element.height <= 0 || !Number.isFinite(element.rotation ?? 0)) throw TypeError('图元需要有效的位置、正尺寸和旋转角。')
  return { x: element.x + element.width / 2, y: element.y + element.height / 2 }
}

function drawingRotate(point, degrees) {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c }
}

// Local coordinates are absolute board coordinates before element rotation.
export function localToWorld(element, point) {
  const center = drawingBox(element), p = drawingPoint(point), rotated = drawingRotate({ x: p.x - center.x, y: p.y - center.y }, element.rotation || 0)
  return { x: center.x + rotated.x, y: center.y + rotated.y }
}

export function worldToLocal(element, point) {
  const center = drawingBox(element), p = drawingPoint(point), rotated = drawingRotate({ x: p.x - center.x, y: p.y - center.y }, -(element.rotation || 0))
  return { x: center.x + rotated.x, y: center.y + rotated.y }
}

export function resizeHandles(element) {
  drawingBox(element)
  return [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]].map(([handle, x, y]) => ({ handle, ...localToWorld(element, { x: element.x + x * element.width, y: element.y + y * element.height }) }))
}

export function resizeElement(element, handle, pointer, options = {}) {
  const center = drawingBox(element), p = drawingPoint(pointer)
  const axes = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }[handle]
  if (!axes) throw RangeError('不支持的缩放手柄。')
  const [hx, hy] = axes, minimum = options.minSize ?? 1
  if (!Number.isFinite(minimum) || minimum <= 0) throw RangeError('最小尺寸必须大于零。')
  const fixedOffset = options.fromCenter ? { x: 0, y: 0 } : drawingRotate({ x: -hx * element.width / 2, y: -hy * element.height / 2 }, element.rotation || 0)
  const fixed = { x: center.x + fixedOffset.x, y: center.y + fixedOffset.y }, delta = drawingRotate({ x: p.x - fixed.x, y: p.y - fixed.y }, -(element.rotation || 0))
  const flip = options.allowFlip !== false, factor = options.fromCenter ? 2 : 1
  const sx = hx ? (flip ? Math.sign(delta.x) || hx : hx) : 0, sy = hy ? (flip ? Math.sign(delta.y) || hy : hy) : 0
  let width = hx ? Math.max(minimum, (flip ? Math.abs(delta.x) : hx * delta.x) * factor) : element.width
  let height = hy ? Math.max(minimum, (flip ? Math.abs(delta.y) : hy * delta.y) * factor) : element.height
  if (options.keepAspect) {
    let scale
    if (hx && hy) {
      const vx = flip ? Math.abs(delta.x) : Math.max(0, hx * delta.x), vy = flip ? Math.abs(delta.y) : Math.max(0, hy * delta.y)
      const bx = element.width / factor, by = element.height / factor
      scale = (vx * bx + vy * by) / (bx * bx + by * by)
    } else scale = hx ? width / element.width : height / element.height
    scale = Math.max(scale, minimum / element.width, minimum / element.height)
    width = element.width * scale; height = element.height * scale
  }
  const offset = options.fromCenter ? { x: 0, y: 0 } : drawingRotate({ x: sx * width / 2, y: sy * height / 2 }, element.rotation || 0)
  const result = structuredClone(element)
  result.width = width; result.height = height; result.x = fixed.x + offset.x - width / 2; result.y = fixed.y + offset.y - height / 2
  if (Array.isArray(result.points) && ((hx && sx !== hx) || (hy && sy !== hy))) result.points = result.points.map(([x, y]) => [hx && sx !== hx ? 1 - x : x, hy && sy !== hy ? 1 - y : y])
  return result
}

function drawingRebox(points, rotation = 0, minimum = 1) {
  const local = points.map(point => drawingRotate(drawingPoint(point), -rotation)), xs = local.map(p => p.x), ys = local.map(p => p.y)
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys), width = Math.max(minimum, right - left), height = Math.max(minimum, bottom - top)
  const cx = (left + right) / 2, cy = (top + bottom) / 2, center = drawingRotate({ x: cx, y: cy }, rotation)
  return { x: center.x - width / 2, y: center.y - height / 2, width, height, rotation, points: local.map(p => [(p.x - cx) / width + .5, (p.y - cy) / height + .5]) }
}

export function movePolygonVertex(element, index, pointer) {
  drawingBox(element)
  if (element.type !== 'polygon' || !Array.isArray(element.points) || !Number.isInteger(index) || index < 0 || index >= element.points.length) throw RangeError('请选择有效的多边形顶点。')
  const points = element.points.map(([x, y]) => localToWorld(element, { x: element.x + x * element.width, y: element.y + y * element.height }))
  points[index] = drawingPoint(pointer)
  return Object.assign(structuredClone(element), drawingRebox(points, element.rotation || 0))
}

export function rotateElement(element, pointer, options = {}) {
  const center = drawingBox(element), p = drawingPoint(pointer)
  if (p.x === center.x && p.y === center.y) return structuredClone(element)
  const angle = Math.atan2(p.y - center.y, p.x - center.x) * 180 / Math.PI
  let rotation
  if (options.start) {
    const start = drawingPoint(options.start), previous = Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI
    rotation = (element.rotation || 0) + ((angle - previous + 540) % 360 - 180)
  } else rotation = angle + 90
  if (options.snap) {
    if (!Number.isFinite(options.snap) || options.snap < 0) throw RangeError('旋转吸附角度必须为正数。')
    rotation = Math.round(rotation / options.snap) * options.snap
  }
  const result = structuredClone(element)
  result.rotation = ((rotation + 180) % 360 + 360) % 360 - 180
  if (Object.is(result.rotation, -0)) result.rotation = 0
  return result
}

function drawingDiskInterval(a, b, center, radius) {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy
  if (!length2) return null
  const ox = a.x - center.x, oy = a.y - center.y, cross = ox * dy - oy * dx, distance2 = cross * cross / length2
  if (distance2 >= radius * radius) return null // Tangency removes no length.
  const middle = -(ox * dx + oy * dy) / length2, half = Math.sqrt((radius * radius - distance2) / length2)
  const lo = Math.max(0, middle - half), hi = Math.min(1, middle + half)
  return hi > lo ? [lo, hi] : null
}

function drawingLinearInterval(value, delta, minimum, maximum) {
  if (!delta) return value >= minimum && value <= maximum ? [0, 1] : null
  const first = (minimum - value) / delta, second = (maximum - value) / delta
  const lo = Math.max(0, Math.min(first, second)), hi = Math.min(1, Math.max(first, second))
  return hi > lo ? [lo, hi] : null
}

function drawingCapsuleIntervals(a, b, from, to, radius) {
  const intervals = [drawingDiskInterval(a, b, from, radius), drawingDiskInterval(a, b, to, radius)].filter(Boolean)
  const ux = to.x - from.x, uy = to.y - from.y, length = Math.hypot(ux, uy)
  if (length) {
    const dx = b.x - a.x, dy = b.y - a.y, ox = a.x - from.x, oy = a.y - from.y
    const along = drawingLinearInterval((ox * ux + oy * uy) / length, (dx * ux + dy * uy) / length, 0, length)
    const across = drawingLinearInterval((ox * -uy + oy * ux) / length, (dx * -uy + dy * ux) / length, -radius, radius)
    if (along && across) {
      const lo = Math.max(along[0], across[0]), hi = Math.min(along[1], across[1])
      // A segment lying on the boundary is tangent, not erased.
      const middle = (lo + hi) / 2, px = ox + dx * middle, py = oy + dy * middle
      if (hi > lo && Math.abs((px * -uy + py * ux) / length) < radius) intervals.push([lo, hi])
    }
  }
  intervals.sort((a, b) => a[0] - b[0])
  const union = []
  for (const interval of intervals) {
    const last = union.at(-1)
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1])
    else union.push(interval.slice())
  }
  return union
}

function drawingInsideCapsule(point, from, to, radius) {
  const dx = to.x - from.x, dy = to.y - from.y, length2 = dx * dx + dy * dy
  const t = length2 ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length2)) : 0
  return Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t) < radius
}

export function cutPolyline(points, eraser) {
  if (!Array.isArray(points) || points.length < 2) throw TypeError('笔迹至少需要两个坐标。')
  const path = points.map(drawingPoint), to = drawingPoint(eraser), from = eraser.from ? drawingPoint(eraser.from) : to, radius = eraser.radius
  if (!Number.isFinite(radius) || radius <= 0) throw RangeError('橡皮半径必须大于零。')
  const fragments = []; let current = [], changed = false
  const append = point => { if (!current.length || Math.hypot(point.x - current.at(-1).x, point.y - current.at(-1).y) > 1e-9) current.push(point) }
  const finish = () => { if (current.length > 1) fragments.push(current); current = [] }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) { if (drawingInsideCapsule(a, from, to, radius)) { changed = true; finish() } else append(a); continue }
    const intervals = drawingCapsuleIntervals(a, b, from, to, radius), at = t => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    if (!intervals.length) { append(a); append(b); continue }
    changed = true; let cursor = 0
    for (const [lo, hi] of intervals) {
      if (lo > cursor) { append(at(cursor)); append(at(lo)) }
      finish(); cursor = hi
    }
    if (cursor < 1) { append(at(cursor)); append(b) }
  }
  finish()
  return { changed, fragments: changed ? fragments : [path] }
}

export function erasePen(element, eraser, idFactory) {
  drawingBox(element)
  if (element.type !== 'pen' || !Array.isArray(element.points)) throw TypeError('局部橡皮只切开自由笔迹。')
  const path = element.points.map(([x, y]) => localToWorld(element, { x: element.x + x * element.width, y: element.y + y * element.height }))
  const result = cutPolyline(path, eraser)
  if (!result.changed) return { changed: false, fragments: [structuredClone(element)] }
  const ids = new Set([element.id]), origin = element.fragmentOf || element.id
  return { changed: true, fragments: result.fragments.map((points, index) => {
    const fragment = structuredClone(element)
    if (index) {
      if (typeof idFactory !== 'function') throw TypeError('切开的新笔迹需要标识生成函数。')
      fragment.id = idFactory()
      if (typeof fragment.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(fragment.id) || ids.has(fragment.id)) throw RangeError('切开后的笔迹标识必须唯一有效。')
      ids.add(fragment.id)
    }
    Object.assign(fragment, drawingRebox(points)); fragment.fragmentOf = origin
    // Recognition evidence described the complete old stroke, not this piece.
    delete fragment.handwriting; delete fragment.mathHandwriting; delete fragment.mathDisplay
    if (fragment.recognition && typeof fragment.recognition === 'object' && !Array.isArray(fragment.recognition)) fragment.recognition.stale = true
    for (const expression of Array.isArray(fragment.mathExpressions) ? fragment.mathExpressions : []) if (expression?.display === 'ink') delete expression.display
    return fragment
  }) }
}

export function drawingClientSource() {
  return [drawingPoint, drawingBox, drawingRotate, localToWorld, worldToLocal, resizeHandles, resizeElement, drawingRebox, movePolygonVertex, rotateElement, drawingDiskInterval, drawingLinearInterval, drawingCapsuleIntervals, drawingInsideCapsule, cutPolyline, erasePen].map(fn => fn.toString()).join('\n')
}
