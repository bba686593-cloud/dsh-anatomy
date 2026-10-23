// Erasures belong to the original surface, rather than to a white overlay.
// Normalized local coordinates keep holes attached when a part is transformed.
export const MAX_SURFACE_ERASURE_POINTS = 8192

export function surfaceErasureDiagnostics(element) {
  const strokes = element.erasures
  if (strokes === undefined) return []
  const fail = message => [{ code: 'erasures', message }]
  if (!Array.isArray(strokes) || strokes.length > MAX_SURFACE_ERASURE_POINTS) return fail('局部擦除必须是有效路径列表。')
  let count = 0
  for (const stroke of strokes) {
    if (!stroke || typeof stroke !== 'object' || !['body', 'label'].includes(stroke.surface || 'body')) return fail('擦除路径需要图形或关系说明表面。')
    const dimension = stroke.radius?.length
    if (![2, 3].includes(dimension) || !stroke.radius.every(n => Number.isFinite(n) && n > 0 && n <= 1e7)) return fail('擦除半径必须是两个或三个有效正数。')
    if (!Array.isArray(stroke.points) || !stroke.points.length || stroke.points.some(p => !Array.isArray(p) || p.length !== dimension || p.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7))) return fail('擦除路径需要与半径维度一致的有限局部坐标。')
    count += stroke.points.length
    if (count > MAX_SURFACE_ERASURE_POINTS) return fail('单个部位的擦除路径最多包含 ' + MAX_SURFACE_ERASURE_POINTS + ' 个点。')
  }
  return []
}

export function surfaceErased(element, point, surface = 'body') {
  for (const stroke of element.erasures || []) {
    if ((stroke.surface || 'body') !== surface) continue
    const dimensions = Math.min(point.length, stroke.radius.length)
    const distance = (a, b) => {
      let length = 0, dot = 0
      const p = [], d = []
      for (let i = 0; i < dimensions; i++) {
        p[i] = (point[i] - a[i]) / stroke.radius[i]
        d[i] = (b[i] - a[i]) / stroke.radius[i]
        length += d[i] * d[i]; dot += p[i] * d[i]
      }
      const t = length ? Math.max(0, Math.min(1, dot / length)) : 0
      return p.reduce((sum, value, i) => sum + (value - t * d[i]) ** 2, 0)
    }
    for (let i = 0; i < stroke.points.length; i++) if (distance(stroke.points[Math.max(0, i - 1)], stroke.points[i]) <= 1) return true
  }
  return false
}

export function appendSurfaceErasure(element, stroke) {
  const candidate = { surface: stroke.surface || 'body', points: stroke.points.map(p => [...p]), radius: [...stroke.radius] }
  if (surfaceErasureDiagnostics({ erasures: [candidate] }).length) throw Error('擦除坐标无效。')
  const strokes = element.erasures || [], count = strokes.reduce((n, item) => n + item.points.length, 0)
  if (count + candidate.points.length > MAX_SURFACE_ERASURE_POINTS) throw Error('这个部位的擦除路径过多，请先撤销部分擦除或拆分部位。')
  const last = strokes[strokes.length - 1]
  if (last && JSON.stringify(last) === JSON.stringify(candidate)) return false
  element.erasures = [...strokes, candidate]
  if (element.formulaGraphic) {
    const graphic = element.formulaGraphic
    graphic.semanticStatus = 'needs-review'; graphic.currentMath = null
    delete graphic.review
    graphic.edits = [...(graphic.edits || []), { kind: 'erase', surface: candidate.surface }]
  }
  return true
}

export function surfaceVisualSource(element) {
  // Preserve existing review fingerprints for untouched historic images.
  return element.erasures?.length ? JSON.stringify([element.image?.src || '', element.erasures]) : element.image?.src || ''
}
