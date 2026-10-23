// Space is a view/controller of the existing board, never a second document.
// GPU objects belong to the renderer; durable state and history belong to board-client.
var spaceMode = false
var spaceState = { engine: null, workZ: 0, grid: false, step: 100, gesture: null, frame: null, penRig: null, penDown: true, editScene: true, navigation: false, viewDrag: null, placement: null, pose: { rotationX: 0, rotationY: 0, rotation: 0 }, transform: 'move', profileReady: false, selectionMode: 'point' }
var SPACE_COMPONENTS = ['rect', 'ellipse', 'diamond', 'polygon', 'line', 'arrow', 'text', 'math', 'frame', 'image']
var SPACE_TOOL_KEYS = { '1': 'select', '2': 'pen', '3': 'rect', '4': 'ellipse', '5': 'diamond', '6': 'polygon', '7': 'arrow', '8': 'text', '9': 'eraser', '0': 'frame' }
var spaceInput = null

function spaceIsActive() { return spaceMode }
function spaceHost() { return $('space') }
function spaceCarrierTool() { return tool === 'pen' || tool === 'eraser' || tool === 'lasso' || SPACE_COMPONENTS.includes(tool) }
function spaceSelectedCenter() {
  var list = board.elements.filter(function (e) { return selected.has(e.id) })
  if (!list.length) return null
  var links = spaceLinks(board.elements)
  return list.reduce(function (sum, e) { var link = isSpaceLink(e) && links.find(function (edge) { return edge.id === e.id }); sum.x += (link ? (link.a.x + link.b.x) / 2 : e.x + e.width / 2) / list.length; sum.y += (link ? (link.a.y + link.b.y) / 2 : e.y + e.height / 2) / list.length; sum.z += (link ? (link.a.z + link.b.z) / 2 : e.z || 0) / list.length; return sum }, { x: 0, y: 0, z: 0 })
}
function spaceRestoreElement(target, original) {
  for (var key of Object.keys(target)) if (!Object.hasOwn(original, key)) delete target[key]
  Object.assign(target, structuredClone(original))
}
function spaceAdoptSelection() {
  if (tool !== 'select' || !selected.size) return
  var e = get(Array.from(selected)[0]), center = spaceSelectedCenter()
  if (center && spaceState.penRig && Math.hypot(center.x - spaceState.penRig.tip.x, center.y - spaceState.penRig.tip.y, center.z - spaceState.penRig.tip.z) > 1e-7) spacePositionPen(center, false)
  if (e) spaceState.pose = { rotationX: e.rotationX || 0, rotationY: e.rotationY || 0, rotation: e.rotation || 0 }
}
function spacePoseNormal() { return spaceRotateVector({ x: 0, y: 0, z: 1 }, spaceState.pose.rotationX, spaceState.pose.rotationY, spaceState.pose.rotation) }
function spaceTransformTarget() { return tool === 'select' ? selected.size && spaceState.editScene : !!spaceState.placement }
function spaceTransformCenter() { return tool === 'select' ? spaceSelectedCenter() : spaceState.penRig?.tip }
function spaceBoardLoaded() {
  if (!spaceState) return
  if (spaceState.depthPreview) spaceFinishDepthPreview(false)
  if (!spaceMode) { spaceState.penRig = null; spaceState.initialRig = null; spaceState.documentRigKey = undefined; spaceState.opened = false; return }
  if (board.spatialRig) { spaceState.penRig = spacePenRig(board); spaceState.workZ = spaceState.penRig.tip.z }
  spaceRequestPaint()
}
function spaceSyncScene() {
  var rigKey = JSON.stringify(board.spatialRig || null)
  if (spaceState.documentRigKey !== rigKey) {
    spaceState.documentRigKey = rigKey
    var savedRig = board.spatialRig ? spacePenRig(board) : spaceState.initialRig
    if (savedRig && spaceState.penRig) {
      spaceState.penRig.anchors = structuredClone(savedRig.anchors)
      if (tool === 'pen' && !spaceState.gesture && !spaceState.placement) { spaceState.penRig.tip = { ...savedRig.tip }; spaceState.workZ = savedRig.tip.z }
    }
  }
  spaceAdoptSelection()
  var transformTarget = tool === 'select' ? get(Array.from(selected)[0]) : spaceState.placement
  if (spaceState.transform === 'extrude' && !['rect', 'ellipse', 'diamond', 'polygon'].includes(transformTarget?.type)) spaceState.transform = 'move'
  spaceState.engine.resize()
  if (spaceState.depthPreview && spaceState.depthPreview.base !== JSON.stringify(board)) spaceFinishDepthPreview(false)
  spaceState.engine.sync(spaceState.depthPreview?.board || board, selected)
  spaceState.engine.setPlane(spaceState.workZ, spaceState.grid, spaceState.step)
  if (spaceState.penRig) spaceState.engine.setPenRig({ visible: !spaceState.navigation, anchors: spaceState.penRig.anchors, tip: spaceState.penRig.tip, drawing: tool === 'pen' && spaceState.penDown && !spaceState.spaceKey })
  spaceState.engine.setPlacement(spaceState.placement && !spaceState.navigation ? spacePlacementElement() : null)
  spaceState.engine.setManipulator?.(spaceTransformTarget() && !spaceState.navigation && spaceState.gesture?.mode !== 'select-area' ? { center: spaceTransformCenter(), mode: spaceState.transform, normal: spacePoseNormal() } : null)
}
function spacePaint() {
  if (!spaceMode || !spaceState.engine) return
  spaceSyncScene()
  spaceState.engine.draw()
  spacePositionInlineEditor()
  var selectionNote = tool === 'select' ? ' · ' + ({point:'点选对象 · 空白拖动框选',box:'拖动框选对象',lasso:'左拖画圈选择对象'}[spaceState.selectionMode]) + (selected.size ? ' · 已选 ' + selected.size + ' 个 · 移动/旋转作用于所选对象' : ' · 包含笔迹 · Shift 追加选择') : tool === 'lasso' ? spaceState.profileReady ? ' · 轮廓已闭合，拖拉伸手柄或输入深度，再放置' : ' · 在当前姿态平面按住左键画闭合轮廓' : spaceState.placement ? ' · 组件附在笔尖 · 调整三轴姿态后放置' : ' · 四角空间笔载体'
  $('space-note').textContent = board.elements.length + ' 个图元' + selectionNote + (tool === 'select' && !spaceState.editScene ? ' · 位置已锁定' : '')
  var crowded = spaceState.engine.info().labelLayout?.filter(function (label) { return label.reason === 'crowded' }).length || 0
  if (crowded) $('space-note').textContent += ' · ' + crowded + ' 条说明已收起，选中后点「阅读大小」查看'
  $('canvas-selection-title').hidden = tool !== 'select' || !selected.size
  $('space-pen').setAttribute('aria-pressed', String(tool === 'pen' && !spaceState.navigation))
  $('space-pen-down').setAttribute('aria-pressed', String(spaceState.penDown))
  $('space-pen-down').textContent = spaceState.penDown ? '● 落笔' : '○ 抬笔'
  $('space-pen-down').hidden = tool !== 'pen'
  $('space-navigation').setAttribute('aria-pressed', String(spaceState.navigation))
  $('space-edit-scene').setAttribute('aria-pressed', String(spaceState.editScene))
  $('space-edit-scene').textContent = spaceState.editScene ? '对象可移动' : '位置已锁定'
  $('space-selection-modes').hidden = tool !== 'select'
  for (var selectMode of ['point','box','lasso']) $('space-select-' + selectMode).setAttribute('aria-pressed', String(spaceState.selectionMode === selectMode))
  $('space-layers').disabled = !spaceState.editScene
  var meter = $('space-pen-meter')
  meter.hidden = spaceState.navigation
  if (spaceState.penRig) {
    var lengths = spacePenLengths(spaceState.penRig.anchors, spaceState.penRig.tip)
    meter.textContent = lengths ? lengths.map(function (length, index) { return 'ABCD'[index] + ' ' + length.toFixed(1) }).join('  ·  ') + '  |  高度 ' + spaceState.penRig.tip.z.toFixed(1) + (spaceState.placement ? ' · Enter 放置组件' : ' · WASD 移动 Q/E 升降') : ''
  }
  if (document.activeElement !== $('space-depth')) $('space-depth').value = String(Math.round(spaceState.workZ))
  $('space-grid').setAttribute('aria-pressed', String(spaceState.grid))
  $('space-grid-step').value = String(spaceState.step)
  for (var axis of ['rotationX', 'rotationY', 'rotation']) if (document.activeElement !== $('space-' + axis)) $('space-' + axis).value = String(Math.round(spaceState.pose[axis] * 10) / 10)
  for (var mode of ['move', 'rotate', 'extrude']) $('space-' + mode).setAttribute('aria-pressed', String(spaceState.transform === mode))
  var operationTarget = tool === 'select' ? '所选对象（包括笔迹）' : '笔尖载体与待放置对象'
  $('space-move').title = '移动' + operationTarget + '；拖动彩色轴或使用 WASD/QE。右键、中键和滚轮调整视角。'
  $('space-rotate').title = '旋转' + operationTarget + '；拖动三轴环、输入角度或使用 I/K、J/U、Z/X。右键旋转视角。'
  var target = tool === 'select' ? get(Array.from(selected)[0]) : spaceState.placement
  var canExtrude = target && ['rect', 'ellipse', 'diamond', 'polygon'].includes(target.type)
  if (!canExtrude && spaceState.transform === 'extrude') spaceState.transform = 'move'
  $('space-extrude').disabled = !canExtrude
  $('space-extrusion-label').hidden = !canExtrude
  if (document.activeElement !== $('space-extrusion')) $('space-extrusion').value = String(target?.extrusion || 0)
  $('space-place').hidden = !spaceState.placement
  $('space-profile-new').hidden = tool !== 'lasso' || !spaceState.profileReady
  $('zoom-value').textContent = '三维'
}
function spaceRequestPaint() {
  if (!spaceMode || spaceState.frame !== null) return
  spaceState.frame = requestAnimationFrame(function () { spaceState.frame = null; spacePaint() })
}
function spaceCanEdit() {
  if (spaceState.depthPreview) { message('请先应用或取消分层预览。'); return false }
  if (inlineWritingOpen() && !finishInlineWriting()) return false
  if (canvasDraftPending() || readingDraftChanged()) { message('请先确认或取消当前编辑。'); return false }
  if (graphicBusy || versionSession.busy) { message('正在处理画板，请稍候。'); return false }
  flushField()
  return true
}
function setSpaceMode(on) {
  if (!!on === spaceMode) return true
  if (!spaceCanEdit()) return false
  spaceCancelGesture()
  spaceEndView()
  var firstPen = on && !spaceState.penRig
  if (firstPen) {
    try { spaceState.penRig = spacePenRig(board); spaceState.initialRig = structuredClone(spaceState.penRig); spaceState.workZ = spaceState.penRig.tip.z }
    catch (error) { message(error.message); return false }
  }
  if (on && !spaceState.engine) {
    try {
      spaceState.engine = createSpaceRenderer(spaceHost(), {
        onInvalidate: spaceRequestPaint,
        onContextLost: function () {
          if (spaceState.depthPreview) spaceFinishDepthPreview(false)
          spaceCancelGesture()
          spaceEndView()
          // Loss of the GPU must always expose the document, including while
          // a project request or a text draft is pending.
          spaceMode = false
          spaceHost().hidden = true
          surface.hidden = false
          document.body.classList.remove('space-mode')
          spaceToolHints()
          $('space-toggle').setAttribute('aria-pressed', 'false')
          spaceState.engine?.dispose()
          spaceState.engine = null
          spaceState.opened = false
          render()
          message('三维图形连接已中断，已返回二维；画板修改已保留。')
        },
      })
    } catch (error) {
      if (firstPen) spaceState.penRig = null
      message('三维视图无法启动：' + error.message + '。可以继续使用二维画板。')
      return false
    }
  }
  spaceMode = !!on
  spaceHost().hidden = !spaceMode
  surface.hidden = spaceMode
  document.body.classList.toggle('space-mode', spaceMode)
  $('space-toggle').setAttribute('aria-pressed', String(spaceMode))
  if (spaceMode) {
    if (firstPen) setTool('pen')
    else { spaceState.navigation = tool === 'pan'; spacePreparePlacement(tool) }
    spaceState.engine.resize()
    spaceState.engine.sync(board, selected)
    spaceState.engine.setPenRig({ visible: true, anchors: spaceState.penRig.anchors, tip: spaceState.penRig.tip, drawing: spaceState.penDown })
    if (!spaceState.opened) { spaceState.engine.fitPenRig(false); spaceState.opened = true }
    spacePaint()
    spaceHost().focus()
  } else {
    $('canvas-selection-title').hidden = true
    spaceState.engine?.preview(null)
    render()
  }
  spaceToolHints()
  return true
}
function spacePoint(ev, z) {
  var point = spaceState.engine.unproject(ev.clientX, ev.clientY, z ?? spaceState.workZ)
  if (!point || ![point.x, point.y, point.z].every(Number.isFinite) || Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > 1e7) return null
  return point
}
function spaceBegin(ev, mode, extra) {
  var gesture = Object.assign({ mode: mode, pointer: ev.pointerId, mouse: spaceHasMouseButtons(ev), startX: ev.clientX, startY: ev.clientY, lastX: ev.clientX, lastY: ev.clientY, snapshot: JSON.stringify(board), selection: Array.from(selected), workZ: spaceState.workZ, penTip: spaceState.penRig ? { ...spaceState.penRig.tip } : null, poseBefore: structuredClone(spaceState.pose) }, extra || {})
  spaceState.gesture = gesture
  try { spaceHost().setPointerCapture(ev.pointerId) } catch (_) {}
  return gesture
}
function spaceRelease(gesture) {
  spaceState.gesture = null
  spaceReleasePointer(gesture.pointer)
  spaceState.engine?.preview(null)
  spaceSelectionPreview(null)
}
function spaceSelectionPoint(ev) {
  var rect = spaceHost().getBoundingClientRect()
  return { x: Math.max(0, Math.min(rect.width, ev.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, ev.clientY - rect.top)) }
}
function spaceSelectionPreview(region) {
  var overlay = $('space-selection-overlay'), path = $('space-selection-path')
  if (region?.length) overlay.removeAttribute('hidden')
  else overlay.setAttribute('hidden', '')
  overlay.style.display = region?.length ? 'block' : 'none'
  path.setAttribute('d', region?.length ? 'M' + region.map(function (p) { return p.x + ' ' + p.y }).join(' L') + ' Z' : '')
}
function spaceBeginSelection(ev, mode, id) {
  var point = spaceSelectionPoint(ev)
  spaceBegin(ev, 'select-area', { selectionMode: mode, screenPoints: [point], region: [], additive: !!ev.shiftKey, clickId: id || null, moved: false })
  spaceRequestPaint()
}
function spaceMoveSelection(ev, g) {
  var point = spaceSelectionPoint(ev), start = g.screenPoints[0]
  if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < 4) return
  g.moved = true
  if (g.selectionMode === 'lasso') {
    var previous = g.screenPoints[g.screenPoints.length - 1]
    if (g.screenPoints.length < 2048 && Math.hypot(point.x - previous.x, point.y - previous.y) >= 2) g.screenPoints.push(point)
    g.region = g.screenPoints
  } else g.region = [start, { x: point.x, y: start.y }, point, { x: start.x, y: point.y }]
  spaceSelectionPreview(g.region)
}
function spaceFinishSelection(ev, g) {
  spaceMoveSelection(ev, g)
  var first = g.region[0], second = first && g.region.find(function (p) { return Math.hypot(p.x - first.x, p.y - first.y) > 2 })
  var area = second && g.region.some(function (p) { return Math.abs((second.x-first.x)*(p.y-first.y)-(second.y-first.y)*(p.x-first.x)) / Math.hypot(second.x-first.x, second.y-first.y) > 1 })
  if (g.moved && !area) { spaceRelease(g); render(); return }
  var hits = g.moved ? spaceState.engine.pickRegion(g.region) : g.clickId ? [g.clickId] : []
  var next = new Set(g.additive ? g.selection : [])
  for (var id of hits) if (get(id)) next.add(id)
  spaceRelease(g)
  selected = next
  spaceAdoptSelection()
  render()
}
function spaceCancelGesture() {
  spaceState.captureResume = null
  if (spaceInput?.busy()) spaceInput.stop(true)
  var gesture = spaceState.gesture
  if (!gesture) return
  spaceRelease(gesture)
  if (JSON.stringify(board) !== gesture.snapshot) board = JSON.parse(gesture.snapshot)
  selected = new Set(gesture.selection.filter(get))
  spaceState.workZ = gesture.workZ
  if (gesture.penTip && spaceState.penRig) spaceState.penRig.tip = gesture.penTip
  if (gesture.poseBefore) spaceState.pose = gesture.poseBefore
  if (Object.hasOwn(gesture, 'placementBefore')) spaceState.placement = gesture.placementBefore
  if (Object.hasOwn(gesture, 'profileBefore')) spaceState.profileReady = gesture.profileBefore
  spaceRequestPaint()
  status()
}
function spaceCommitGesture(gesture) {
  spaceRelease(gesture)
  var errors = boardDiagnostics(board, A.organs, A.flows)
  if (errors.length) {
    board = JSON.parse(gesture.snapshot)
    selected = new Set(gesture.selection.filter(get))
    message(errors[0].message)
  } else if (gesture.snapshot !== JSON.stringify(board)) {
    remember(gesture.snapshot)
    saveLocal()
  }
  render()
}
function spaceDepth(delta) {
  if (!spaceCanEdit()) return
  if (tool === 'lasso' && spaceState.profileReady) { spaceSetExtrusion((spaceState.placement.extrusion || 0) + delta); return }
  if (spaceCarrierTool() && spaceState.penRig) {
    spacePositionPen({ ...spaceState.penRig.tip, z: spaceState.penRig.tip.z + delta })
    spacePaint()
    return
  }
  if (spaceState.editScene && selected.size) {
    change(function () {
      manualDrawing()
      for (var e of board.elements) if (selected.has(e.id)) spaceTranslateElement(e, 0, 0, delta)
    })
  }
  spaceState.workZ = Math.max(-1e7, Math.min(1e7, spaceState.workZ + delta))
  spacePaint()
}
// Four fixed non-coplanar anchors define one tip. Input changes cable lengths;
// their sphere intersections determine the durable world-space sample.
function spacePositionPen(point, record) {
  var rig = spaceState.penRig
  if (!rig || !point || ![point.x, point.y, point.z].every(Number.isFinite) || Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > 1e7) return false
  var lengths = spacePenLengths(rig.anchors, point), resolved = lengths && spacePenPoint(rig.anchors, lengths)
  if (!resolved) return false
  rig.tip = resolved
  spaceState.workZ = resolved.z
  var gesture = spaceState.gesture
  if (record && gesture?.mode === 'laser' && tool === 'pen') {
    if (spaceState.penDown && !spaceState.spaceKey) {
      var run = gesture.runs[gesture.runs.length - 1]
      if (!run) { run = []; gesture.runs.push(run) }
      var previous = run[run.length - 1]
      if (run.length < 20000 && (!previous || Math.hypot(resolved.x - previous.x, resolved.y - previous.y, resolved.z - previous.z) > .25)) run.push({ ...resolved })
    } else if (gesture.runs[gesture.runs.length - 1]?.length) gesture.runs.push([])
    spaceState.engine.preview(gesture.runs[gesture.runs.length - 1] || null)
  }
  spaceRequestPaint()
  return true
}
function spaceBeginPen(ev) {
  var picked = spaceState.engine.pickPen(ev.clientX, ev.clientY)
  var tip = spaceState.penRig.tip, at = spaceState.engine.unprojectView(ev.clientX, ev.clientY, tip)
  if (!at) return false
  var g = spaceBegin(ev, 'laser', { planePoint: { ...tip }, grab: picked ? { x: at.x - tip.x, y: at.y - tip.y, z: at.z - tip.z } : { x: 0, y: 0, z: 0 }, runs: [], erased: new Set() })
  if (!picked) spacePositionPen(at, false)
  g.runs = [tool === 'pen' && spaceState.penDown && !spaceState.spaceKey ? [{ ...spaceState.penRig.tip }] : []]
  return true
}
function spaceProfilePoint(ev, g) {
  var at = spaceState.engine.unprojectPlane(ev.clientX, ev.clientY, { point: g.origin, normal: g.normal })
  if (!at) return null
  var ref = Object.assign({ x: g.origin.x, y: g.origin.y, width: 0, height: 0, z: g.origin.z }, g.pose)
  var local = spaceUnposePoint(ref, at)
  return { x: local.x - g.origin.x + (g.profileOffset?.x || 0), y: local.y - g.origin.y + (g.profileOffset?.y || 0) }
}
function spaceProfileWorld(g, point) {
  var vector = spaceRotateVector({ x: point.x, y: point.y, z: 0 }, g.pose.rotationX, g.pose.rotationY, g.pose.rotation)
  return { x: g.origin.x + vector.x, y: g.origin.y + vector.y, z: g.origin.z + vector.z }
}
function spaceBeginProfile(ev) {
  var proto = { origin: { ...spaceState.penRig.tip }, pose: structuredClone(spaceState.pose), normal: spacePoseNormal() }, point = spaceProfilePoint(ev, proto)
  if (!point) { message('当前轮廓平面与视线平行，请旋转视角或调整平面姿态。'); return }
  var g = spaceBegin(ev, 'profile', Object.assign(proto, { profile: [point], placementBefore: structuredClone(spaceState.placement), profileBefore: spaceState.profileReady }))
  spaceState.placement = null; spaceState.profileReady = false
  spaceState.engine.preview(g.profile.map(function (p) { return spaceProfileWorld(g, p) }), true)
  spaceRequestPaint()
}
function spaceSimplifyProfile(points, tolerance) {
  var list = points.slice(), squared = tolerance * tolerance
  if (list.length > 3 && Math.hypot(list[0].x - list.at(-1).x, list[0].y - list.at(-1).y) <= tolerance) list.pop()
  if (list.length < 4) return list
  function simplify(chain) {
    var keep = new Set([0, chain.length - 1]), pending = [[0, chain.length - 1]]
    while (pending.length) {
      var part = pending.pop(), a = chain[part[0]], b = chain[part[1]], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy, far = squared, index = -1
      for (var i = part[0] + 1; i < part[1]; i++) {
        var p = chain[i], t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
        var distance = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2
        if (distance > far) { far = distance; index = i }
      }
      if (index >= 0) { keep.add(index); pending.push([part[0], index], [index, part[1]]) }
    }
    return chain.filter(function (_, i) { return keep.has(i) })
  }
  var split = 1, far = 0
  for (var i = 1; i < list.length; i++) { var distance = (list[i].x - list[0].x) ** 2 + (list[i].y - list[0].y) ** 2; if (distance > far) { far = distance; split = i } }
  return simplify(list.slice(0, split + 1)).slice(0, -1).concat(simplify(list.slice(split).concat([list[0]])).slice(0, -1))
}
function spaceFinishProfile(g) {
  var tolerance = .75 / Math.max(.01, spaceState.engine.project(g.origin).scale)
  var points = spaceSimplifyProfile(g.profile, tolerance), xs = points.map(function (p) { return p.x }), ys = points.map(function (p) { return p.y })
  var left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs) - left, h = Math.max(...ys) - top
  var area = points.reduce(function (sum, p, i) { var q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y }, 0)
  if (points.length < 3 || w < 1 || h < 1 || Math.abs(area) < 2) { spaceCancelGesture(); message('请画出有面积的闭合轮廓，松开左键后即可拉伸。'); return }
  var center = spaceProfileWorld(g, { x: left + w / 2, y: top + h / 2 })
  var e = Object.assign(makeElement('polygon', center.x - w / 2, center.y - h / 2, w, h), g.pose, { id: 'space-placement', z: center.z, extrusion: 0, points: points.map(function (p) { return [(p.x - left) / w, (p.y - top) / h] }) })
  spaceRelease(g)
  spaceState.placement = e; spaceState.profileReady = true; spaceState.pose = g.pose; spaceState.transform = 'extrude'
  spacePositionPen(center, false); spacePaint()
}
function spaceAxis(axis) { return { x: axis === 'x' ? 1 : 0, y: axis === 'y' ? 1 : 0, z: axis === 'z' ? 1 : 0 } }
function spaceBeginTransform(ev, handle) {
  if (!spaceTransformTarget()) return false
  var center = spaceTransformCenter(), axis = handle.mode === 'extrude' ? spacePoseNormal() : spaceAxis(handle.axis)
  var originals = tool === 'select' ? spaceSelectionOriginals() : null
  spaceBegin(ev, 'transform', { action: handle.mode, axis: handle.axis, direction: axis, center: { ...center }, originals: originals, placementBefore: structuredClone(spaceState.placement), profileBefore: spaceState.profileReady, poseStart: structuredClone(spaceState.pose), total: 0 })
  return true
}
function spaceApplyTransform(g, amount) {
  if (g.originals) {
    if (Math.abs(amount) < 1e-9) { board = JSON.parse(g.snapshot); spaceAdoptSelection(); spaceRequestPaint(); return }
    for (var original of g.originals) {
      var e = get(original.id); if (!e) continue
      spaceRestoreElement(e, original)
      if (g.action === 'move') spaceTranslateElement(e, g.direction.x * amount, g.direction.y * amount, g.direction.z * amount)
      else if (g.action === 'rotate') { var field = g.axis === 'x' ? 'rotationX' : g.axis === 'y' ? 'rotationY' : 'rotation'; e[field] = (original[field] || 0) + amount }
      else if (['rect', 'ellipse', 'diamond', 'polygon'].includes(e.type)) e.extrusion = (original.extrusion || 0) + amount
    }
    manualDrawing(); spaceAdoptSelection()
  } else if (g.action === 'move') spacePositionPen({ x: g.penTip.x + g.direction.x * amount, y: g.penTip.y + g.direction.y * amount, z: g.penTip.z + g.direction.z * amount }, false)
  else if (g.action === 'rotate') { var field = g.axis === 'x' ? 'rotationX' : g.axis === 'y' ? 'rotationY' : 'rotation'; spaceState.pose[field] = (g.poseStart[field] || 0) + amount }
  else if (spaceState.placement) spaceState.placement.extrusion = (g.placementBefore.extrusion || 0) + amount
  spaceRequestPaint()
}
function spaceMoveTransform(ev, g) {
  if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < 5) return
  var amount
  if (g.action === 'rotate') amount = ((ev.clientX - g.startX) - (ev.clientY - g.startY)) * .7
  else {
    var a = spaceState.engine.project(g.center), b = spaceState.engine.project({ x: g.center.x + g.direction.x * 100, y: g.center.y + g.direction.y * 100, z: g.center.z + g.direction.z * 100 })
    var dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
    amount = length < 4 ? -(ev.clientY - g.startY) / Math.max(.01, a.scale) : ((ev.clientX - g.startX) * dx + (ev.clientY - g.startY) * dy) / length * 100
  }
  if (g.moved || Math.abs(amount) > 1e-6) { g.moved = true; g.appliedAmount = g.total + amount; spaceApplyTransform(g, g.appliedAmount) }
}
function spaceReleasePointer(pointer) {
  if (spaceState.gesture?.pointer === pointer || spaceState.viewDrag?.pointer === pointer) return
  try { spaceHost().releasePointerCapture(pointer) } catch (_) {}
}
function spaceHasMouseButtons(ev) { return typeof ev.buttons === 'number' && (!ev.pointerType || ev.pointerType === 'mouse') }
function spaceBeginView(ev, mode, button) {
  if (spaceState.gesture?.mode === 'select-area') spaceCancelGesture()
  spaceState.viewDrag = { pointer: ev.pointerId, mode: mode, button: button || (ev.button === 1 ? 4 : ev.button === 2 ? 2 : 1), x: ev.clientX, y: ev.clientY }
  spaceHost().focus()
  if (!(spaceState.captureResume?.recover && spaceState.captureResume.pointer === ev.pointerId)) try { spaceHost().setPointerCapture(ev.pointerId) } catch (_) {}
}
function spaceEndView() {
  var viewDrag = spaceState.viewDrag
  spaceState.viewDrag = null
  if (viewDrag) spaceReleasePointer(viewDrag.pointer)
}
function spaceRebasePointer(ev) {
  var g = spaceState.gesture
  if (!g || g.input === 'keyboard') return
  var at = ev && ev.pointerId === g.pointer ? ev : { clientX: g.lastX, clientY: g.lastY }
  g.lastX = at.clientX; g.lastY = at.clientY
  if (g.mode === 'transform') { g.total = g.appliedAmount || g.total; g.startX = at.clientX; g.startY = at.clientY; g.center = { ...spaceTransformCenter() }; return }
  if (g.mode === 'profile') {
    var point = spaceProfilePoint(at, g), last = g.profile[g.profile.length - 1]
    if (point && last) g.profileOffset = { x: (g.profileOffset?.x || 0) + last.x - point.x, y: (g.profileOffset?.y || 0) + last.y - point.y }
    return
  }
  if (g.mode === 'laser') {
    var tip = spaceState.penRig.tip, aligned = spaceState.engine.unprojectView(at.clientX, at.clientY, tip)
    g.planePoint = { ...tip }
    if (aligned) g.grab = { x: aligned.x - tip.x, y: aligned.y - tip.y, z: aligned.z - tip.z }
  } else if (g.mode === 'move' || g.mode === 'depth') {
    g.originals = spaceSelectionOriginals()
    if (g.mode === 'depth' && g.originals.length) g.plane = g.originals[0].z || 0
    g.planePoint = spaceSelectedCenter()
    var point = spaceState.engine.unprojectView(at.clientX, at.clientY, g.planePoint || g.point)
    if (point) g.point = point
    g.startX = at.clientX; g.startY = at.clientY; g.moved = false
  }
}
// A mouse emits pointerdown only for its first button, and pointerup only
// after its last button. Chord changes arrive as pointermove + buttons.
function spaceMouseNavigation(ev, move) {
  if (!spaceHasMouseButtons(ev)) return false
  var button = ev.buttons & 4 ? 4 : ev.buttons & 2 ? 2 : spaceState.navigation && ev.buttons & 1 ? 1 : 0
  var view = spaceState.viewDrag, g = spaceState.gesture, finished = false
  if (view && view.pointer !== ev.pointerId) return false
  if (button && !view) {
    spaceBeginView(ev, button === 4 || ev.shiftKey || button === 1 && spaceState.spaceKey ? 'pan' : 'orbit', button)
    view = spaceState.viewDrag
  }
  if (g?.pointer === ev.pointerId && g.mouse && !(ev.buttons & 1)) {
    spaceFinishPointer(ev)
    finished = true
  }
  if (view && button) {
    var mode = button === 4 || ev.shiftKey || button === 1 && spaceState.spaceKey ? 'pan' : 'orbit'
    var dx = ev.clientX - view.x, dy = ev.clientY - view.y
    view.x = ev.clientX; view.y = ev.clientY; view.mode = mode; view.button = button
    ev.preventDefault()
    if (move && (dx || dy)) {
      if (mode === 'pan') spaceState.engine.pan(dx, dy)
      else spaceState.engine.orbit(dx, dy)
      spaceRequestPaint()
    }
    return true
  }
  if (view) {
    spaceEndView()
    spaceRebasePointer(ev)
    ev.preventDefault()
    return true
  }
  return finished
}
function spacePlacementElement() {
  if (!spaceState.placement || !spaceState.penRig) return null
  var e = structuredClone(spaceState.placement), tip = spaceState.penRig.tip
  e.x = tip.x - e.width / 2; e.y = tip.y - e.height / 2
  Object.assign(e, spaceState.pose)
  e.z = tip.z
  if (isSpaceLink(e)) e.endZ = tip.z
  return e
}
function spacePreparePlacement(next) {
  if (!SPACE_COMPONENTS.includes(next) || next === 'image') { spaceState.placement = null; return }
  var w = next === 'frame' ? 480 : 220, h = next === 'text' ? 70 : next === 'frame' ? 300 : isSpaceLink({type:next}) ? 0 : 130
  var e = makeElement(next, 0, 0, w, h)
  e.id = 'space-placement'; e.rotation = 0
  if (next === 'polygon') e.points = Array.from({ length: 6 }, function (_, i) { var a = i * Math.PI / 3; return [.5 + Math.cos(a) * .5, .5 + Math.sin(a) * .5] })
  spaceState.placement = e
}
function spaceSelectionOriginals() {
  var links = spaceLinks(board.elements)
  return board.elements.filter(function (e) { return selected.has(e.id) }).map(function (e) {
    var copy = structuredClone(e)
    if (isSpaceLink(e) && ['from', 'to'].some(function (end) { return e[end] && !selected.has(e[end]) })) {
      var edge = links.find(function (link) { return link.id === e.id })
      copy.x = edge.a.x; copy.y = edge.a.y; copy.z = edge.a.z; copy.width = edge.b.x - edge.a.x; copy.height = edge.b.y - edge.a.y; copy.endZ = edge.b.z
      delete copy.rotation; delete copy.rotationX; delete copy.rotationY
      for (var end of ['from', 'to']) if (!selected.has(e[end])) delete copy[end]
    }
    return copy
  })
}
function spacePlaceComponent() {
  if (!spaceMode || !spaceCanEdit()) return
  var gesture = spaceState.gesture
  if (gesture && gesture.input !== 'keyboard') {
    // Finish a tip-only preview before placing it. A separate pointer edit
    // must keep its own snapshot until release or cancellation.
    if (gesture.mode === 'laser' && spaceState.placement) spaceRelease(gesture)
    else if (gesture.mode !== 'laser' || tool !== 'pen') return
  }
  if (tool === 'pen') { spaceState.penDown = !spaceState.penDown; spacePaint(); return }
  if (tool === 'eraser' && spaceState.penRig) {
    spaceSyncScene()
    var point = spaceState.engine.project(spaceState.penRig.tip), rect = spaceHost().getBoundingClientRect()
    var ev = { pointerId: -1, clientX: rect.left + point.x, clientY: rect.top + point.y }
    var erase = spaceBegin(ev, 'erase', { input: 'keyboard', erased: new Set() }); spaceErase(ev, erase); spaceCommitGesture(erase)
    return
  }
  var e = spacePlacementElement()
  if (!e) return
  e.id = uid()
  change(function () { manualDrawing(); board.elements.push(e); board.spatialRig = { version: 1, anchors: structuredClone(spaceState.penRig.anchors), tip: { ...spaceState.penRig.tip } }; selected = new Set([e.id]) })
  if (tool === 'image' && spaceState.placementQueue?.length) spaceState.placement = spaceState.placementQueue.shift()
  if (tool === 'lasso') { spaceState.placement = null; spaceState.profileReady = false; spaceState.transform = 'move'; spacePaint() }
}
function spaceKeyboardState(kind, inputKind) {
  if (inputKind !== 'move') return
  if (kind === 'start') {
    if (spaceState.gesture || !spaceCanEdit()) return
    var ev = { pointerId: -1, clientX: 0, clientY: 0 }, tip = spaceState.penRig.tip
    if (tool === 'pen') spaceBegin(ev, 'laser', { input: 'keyboard', runs: [spaceState.penDown && !spaceState.spaceKey ? [{ ...tip }] : []] })
    else if (SPACE_COMPONENTS.includes(tool) || tool === 'eraser' || tool === 'lasso') spaceBegin(ev, 'keyboard-placement', { input: 'keyboard', placementBefore: structuredClone(spaceState.placement) })
    else if (tool === 'select' && selected.size && spaceState.editScene) spaceBegin(ev, 'keyboard-selection', { input: 'keyboard', originals: spaceSelectionOriginals(), travel: { x: 0, y: 0, z: 0, angle: 0, rx: 0, ry: 0 } })
    return
  }
  var gesture = spaceState.gesture
  if (gesture?.input !== 'keyboard') return
  if (kind === 'cancel') { spaceCancelGesture(); return }
  if (gesture.mode === 'laser') spacePointerUp({ pointerId: -1 })
  else if (gesture.mode === 'keyboard-selection') spaceCommitGesture(gesture)
  else { spaceRelease(gesture); spacePaint() }
}
function spaceKeyboardMove(motion, dt) {
  var g = spaceState.gesture
  if (g?.input !== 'keyboard') return
  var yaw = spaceState.engine.info().yaw || 0, speed = 240 * (motion.fast ? 3 : 1) * dt
  var dx = (Math.cos(yaw) * motion.right - Math.sin(yaw) * motion.forward) * speed
  var dy = (-Math.sin(yaw) * motion.right - Math.cos(yaw) * motion.forward) * speed
  var dz = motion.up * speed, rate = 90 * (motion.fast ? 3 : 1) * dt, angle = motion.rotate * rate, rx = (motion.rotateX || 0) * rate, ry = (motion.rotateY || 0) * rate
  if (!dx && !dy && !dz && !angle && !rx && !ry) return
  if (g.mode === 'keyboard-selection') {
    g.travel.x += dx; g.travel.y += dy; g.travel.z += dz; g.travel.angle += angle; g.travel.rx += rx; g.travel.ry += ry
    for (var original of g.originals) {
      var target = get(original.id)
      if (!target) continue
      spaceRestoreElement(target, original); spaceTranslateElement(target, g.travel.x, g.travel.y, g.travel.z)
      target.rotation = (original.rotation || 0) + g.travel.angle
      if (g.travel.rx || original.rotationX !== undefined) target.rotationX = (original.rotationX || 0) + g.travel.rx
      if (g.travel.ry || original.rotationY !== undefined) target.rotationY = (original.rotationY || 0) + g.travel.ry
    }
    manualDrawing(); spaceAdoptSelection(); spaceRequestPaint(); return
  }
  spaceState.pose.rotation += angle; spaceState.pose.rotationX += rx; spaceState.pose.rotationY += ry
  if (dx || dy || dz) spacePositionPen({ x: spaceState.penRig.tip.x + dx, y: spaceState.penRig.tip.y + dy, z: spaceState.penRig.tip.z + dz }, tool === 'pen')
  spaceRequestPaint()
}
function spaceToolHints() {
  for (var button of document.querySelectorAll('[data-tool]')) {
    var next = button.getAttribute('data-tool'), shortcut = Object.keys(SPACE_TOOL_KEYS).find(function (key) { return SPACE_TOOL_KEYS[key] === next }) || { lasso: 'B', line: 'L', math: 'M', pan: 'H' }[next]
    if (spaceMode) { if (!button.dataset.spaceTitle) button.dataset.spaceTitle = button.title || ''; button.setAttribute('data-space-key', shortcut || ''); if (shortcut) button.title = next === 'select' ? '选择 ' + shortcut + ' · 点选、Shift 多选、双击编辑；解锁位置后 WASD/QE 移动、Z/X 旋转' : next === 'eraser' ? '橡皮 ' + shortcut + ' · WASD/QE 定位，Enter 擦除' : next === 'pen' ? '空间笔 ' + shortcut + ' · WASD/QE 移动，Enter 落笔／抬笔' : button.dataset.spaceTitle.replace(/ [A-Z](?=[， ：]|$)/g, '') + ' · ' + shortcut + ' · WASD/QE 移动、Z/X 旋转、Enter 放置' }
    else { button.removeAttribute('data-space-key'); if (button.dataset.spaceTitle) { button.title = button.dataset.spaceTitle; delete button.dataset.spaceTitle } }
    if (spaceMode && next === 'select') button.title = '选择 1 · 点选/框选/圈选所有对象（含笔迹） · 对象用移动轴、旋转环或 WASD/QE、I/K/J/U/Z/X；Shift 追加选择'
    if (spaceMode && next === 'lasso') button.title = '三维套索 B · 左拖画当前姿态平面轮廓，松手后沿法线拉伸，再放置'
  }
}
function spaceNewStroke(points, source) {
  var element = source ? structuredClone(source) : makeElement('pen', 0, 0)
  Object.assign(element, normalizedPoints(points))
  element.id = uid()
  element.z = points[0].z
  element.points3d = points.map(function (p) { return [p.x, p.y, p.z] })
  if (source) { element.fragmentOf = source.fragmentOf || source.id; delete element.rotation; delete element.rotationX; delete element.rotationY; drawingStaleInk(element) }
  return element
}
function spaceWorldStroke(e) {
  return spaceStrokePoints(e).map(function (p) { return spacePosePoint(e, p) })
}
function spaceErase(ev, gesture) {
  var radius = (Number($('eraser-size').value) || 24) / 2
  var object = $('eraser-mode').value === 'object'
  if (object) {
    var id = spaceState.engine.pick(ev.clientX, ev.clientY)
    if (id && !gesture.erased.has(id)) {
      manualDrawing(); deleteElements(board, [id]); selected.delete(id); gesture.erased.add(id)
    }
  } else {
    var rect = spaceHost().getBoundingClientRect()
    var previous = gesture.lastEraseScreen || { x: ev.clientX, y: ev.clientY }
    var steps = Math.max(1, Math.ceil(Math.hypot(ev.clientX - previous.x, ev.clientY - previous.y) / Math.max(2, radius * .65)))
    var centers = []
    for (var step = 1; step <= steps; step++) {
      var cx = previous.x + (ev.clientX - previous.x) * step / steps, cy = previous.y + (ev.clientY - previous.y) * step / steps
      centers.push({ x: cx - rect.left, y: cy - rect.top })
      for (var sample of spaceState.engine.eraseSamples?.(cx, cy, radius) || []) {
        var target = get(sample.id)
        if (!target) continue
        try { if (appendSurfaceErasure(target, sample)) manualDrawing() }
        catch (error) { if (!gesture.erasureLimit) message(error.message); gesture.erasureLimit = true }
      }
    }
    gesture.lastEraseScreen = { x: ev.clientX, y: ev.clientY }
    for (var e of board.elements.slice()) {
      if (e.type !== 'pen') continue
      var points = spaceWorldStroke(e)
      var runs = [points]
      for (var strokeCenter of centers) runs = runs.flatMap(function (run) { return spaceClipStroke(run, function (p) { return spaceState.engine.project(p) }, strokeCenter, radius) })
      if (runs.length === 1 && JSON.stringify(runs[0]) === JSON.stringify(points)) continue
      if (!points.length) continue
      manualDrawing()
      var index = board.elements.findIndex(function (entry) { return entry.id === e.id })
      var fragments = runs.filter(function (run) { return run.length >= 2 }).map(function (run, offset) {
        var fragment = spaceNewStroke(run, e)
        if (!offset) fragment.id = e.id
        return fragment
      })
      if (fragments.length) board.elements.splice(index, 1, ...fragments)
      else deleteElements(board, [e.id])
      selected.delete(e.id)
    }
  }
  spaceRequestPaint()
}
function spacePointerDown(ev) {
  if (!spaceState.captureResume?.recover) spaceState.captureResume = null
  if (ev.target.closest('.space-tools') || ev.button > 2) return
  if (spaceMouseNavigation(ev, false) || spaceState.viewDrag) return
  var cameraInput = ev.button === 1 || ev.button === 2 || spaceState.navigation && ev.button === 0
  if (cameraInput) {
    ev.preventDefault(); spaceHost().focus()
    spaceBeginView(ev, ev.button === 1 || ev.button === 2 && ev.shiftKey || spaceState.navigation && ev.button === 0 && spaceState.spaceKey ? 'pan' : 'orbit')
    return
  }
  if (spaceState.gesture) return
  if (!spaceCanEdit()) return
  ev.preventDefault()
  spaceHost().focus()
  spaceSyncScene()
  if (ev.button !== 0) return
  var handle = !ev.altKey && spaceState.engine.pickManipulator?.(ev.clientX, ev.clientY)
  if (handle && spaceBeginTransform(ev, handle)) return
  if (tool === 'select' && spaceState.selectionMode !== 'point') { spaceBeginSelection(ev, spaceState.selectionMode, spaceState.engine.pick(ev.clientX, ev.clientY)); return }
  if (tool === 'lasso') { if (spaceState.profileReady) spaceBeginPen(ev); else spaceBeginProfile(ev); return }
  if (tool === 'pen' || SPACE_COMPONENTS.includes(tool)) { spaceBeginPen(ev); return }
  var id = spaceState.engine.pick(ev.clientX, ev.clientY), e = id ? get(id) : null
  if (tool === 'select') {
    if (ev.altKey) {
      var stack = spaceState.engine.pickAll?.(ev.clientX, ev.clientY) || (id ? [id] : [])
      var current = selected.size === 1 ? Array.from(selected)[0] : null
      if (stack.length) { id = stack[(stack.indexOf(current) + 1) % stack.length]; e = get(id) }
    }
    if (ev.shiftKey && e) { select(id, true); spaceAdoptSelection(); return }
    if (!e) { spaceBeginSelection(ev, 'box', null); return }
    if (!selected.has(id) && select(id) === false) return
    spaceAdoptSelection()
    if (!spaceState.editScene) { message('组件位置已手动锁定，点击上方「位置已锁定」可恢复移动和旋转。'); return }
    if (spaceState.transform === 'rotate') { spaceBeginTransform(ev, { mode: 'rotate', axis: 'z' }); return }
    var plane = Number.isFinite(e.z) ? e.z : 0, center = spaceSelectedCenter(), point = spaceState.engine.unprojectView(ev.clientX, ev.clientY, center)
    if (!point) return
    spaceState.workZ = plane
    spaceBegin(ev, ev.altKey ? 'depth' : 'move', { point: point, plane: plane, planePoint: center, originals: spaceSelectionOriginals() })
    return
  }
  if (tool === 'eraser' && spaceBeginPen(ev)) spaceErase(ev, spaceState.gesture)
}
function spacePointerMove(ev) {
  if (!spaceState.captureResume?.recover) spaceState.captureResume = null
  if (spaceMouseNavigation(ev, true)) return
  var viewDrag = spaceState.viewDrag
  if (viewDrag?.pointer === ev.pointerId) {
    ev.preventDefault()
    var vx = ev.clientX - viewDrag.x, vy = ev.clientY - viewDrag.y
    viewDrag.x = ev.clientX; viewDrag.y = ev.clientY
    if (viewDrag.mode === 'pan') spaceState.engine.pan(vx, vy)
    else spaceState.engine.orbit(vx, vy)
    spaceRequestPaint(); return
  }
  var cursor = $('space-cursor'), bounds = spaceHost().getBoundingClientRect()
  cursor.hidden = tool !== 'eraser'
  if (tool === 'eraser') {
    var radius = (Number($('eraser-size').value) || 24) / 2
    cursor.style.left = ev.clientX - bounds.left - radius + 'px'
    cursor.style.top = ev.clientY - bounds.top - radius + 'px'
    cursor.style.width = cursor.style.height = radius * 2 + 'px'
  }
  var g = spaceState.gesture
  spaceHost().style.cursor = spaceState.navigation ? (g ? 'grabbing' : 'grab') : tool === 'pen' || SPACE_COMPONENTS.includes(tool) ? (g?.mode === 'laser' ? 'grabbing' : spaceState.engine.pickPen(ev.clientX, ev.clientY) ? 'grab' : 'default') : 'default'
  if (!g || g.pointer !== ev.pointerId) return
  ev.preventDefault()
  var dy = ev.clientY - g.lastY
  g.lastX = ev.clientX; g.lastY = ev.clientY
  if (g.mode === 'select-area') { spaceMoveSelection(ev, g); return }
  if (g.mode === 'transform') { spaceMoveTransform(ev, g); return }
  if (g.mode === 'profile') {
    var next = spaceProfilePoint(ev, g), previous = g.profile[g.profile.length - 1]
    if (next && g.profile.length < 1024 && Math.hypot(next.x - previous.x, next.y - previous.y) > 1) g.profile.push(next)
    spaceState.engine.preview(g.profile.map(function (p) { return spaceProfileWorld(g, p) }), true)
    spaceRequestPaint(); return
  }
  if (g.mode === 'laser') {
    var candidate
    if (ev.altKey) {
      var scale = Math.max(.01, spaceState.engine.project(spaceState.penRig.tip).scale)
      candidate = { ...spaceState.penRig.tip, z: spaceState.penRig.tip.z - dy / scale }
      g.planePoint = { ...candidate }
      var aligned = spaceState.engine.unprojectView(ev.clientX, ev.clientY, candidate)
      if (aligned) g.grab = { x: aligned.x - candidate.x, y: aligned.y - candidate.y, z: aligned.z - candidate.z }
    } else {
      var projected = spaceState.engine.unprojectView(ev.clientX, ev.clientY, g.planePoint)
      if (projected) candidate = { x: projected.x - g.grab.x, y: projected.y - g.grab.y, z: projected.z - g.grab.z }
    }
    if (candidate) { spacePositionPen(candidate, true); if (tool === 'eraser') spaceErase(ev, g) }
    return
  }
  if (g.mode === 'move' || g.mode === 'depth') {
    if (!g.moved && Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < 5) return
    g.moved = true
    var point = spaceState.engine.unprojectView(ev.clientX, ev.clientY, g.planePoint || g.point)
    if (!point) return
    var x = point.x - g.point.x, y = point.y - g.point.y, z = point.z - g.point.z
    if (g.mode === 'depth') {
      var origin = g.originals[0], base = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2, z: g.plane }
      var a = spaceState.engine.project(base), b = spaceState.engine.project({ x: base.x, y: base.y, z: base.z + 100 })
      var vx = b.x - a.x, vy = b.y - a.y, length = vx * vx + vy * vy
      if (length < 4) { message('俯视时高度方向重合，请先切换斜视再拖动高度。'); return }
      z = ((ev.clientX - g.startX) * vx + (ev.clientY - g.startY) * vy) / length * 100
      x = 0; y = 0
    }
    for (var original of g.originals) {
      var target = get(original.id)
      if (!target) continue
      spaceRestoreElement(target, original)
      spaceTranslateElement(target, x, y, z)
    }
    manualDrawing(); spaceAdoptSelection()
    if (g.mode === 'depth') spaceState.workZ = g.plane + z
    spaceRequestPaint()
    return
  }
}
function spacePointerUp(ev) {
  if (!spaceState.captureResume?.recover) spaceState.captureResume = null
  if (spaceMouseNavigation(ev, false)) return
  if (spaceState.viewDrag?.pointer === ev.pointerId) { spaceEndView(); spaceRebasePointer(ev); return }
  spaceFinishPointer(ev)
}
function spaceFinishPointer(ev) {
  var g = spaceState.gesture
  if (!g || ev.pointerId !== g.pointer) return
  if (g.mode === 'select-area') { spaceFinishSelection(ev, g); return }
  if (g.mode === 'profile') { spaceFinishProfile(g); return }
  if (g.mode === 'laser') {
    var drawn = false
    for (var run of g.runs) if (run.length >= 2) {
      var stroke = spaceNewStroke(run)
      stroke.spatialInput = { version: 1, type: 'four-anchor', anchors: structuredClone(spaceState.penRig.anchors) }
      manualDrawing(); board.elements.push(stroke)
      drawn = true
    }
    if (drawn) board.spatialRig = { version: 1, anchors: structuredClone(spaceState.penRig.anchors), tip: { ...spaceState.penRig.tip } }
    spaceCommitGesture(g)
    return
  }
  spaceCommitGesture(g)
}
function spacePositionInlineEditor() {
  if (!spaceMode || !spaceState.engine || !inlineWritingOpen()) return
  var e = get(canvasDraft.target)
  if (!e) return
  var label = spaceState.engine.labelGeometry?.(e.id)
  if (label?.carrier) e = { ...e, ...label.carrier, extrusion: 0 }
  var point = spaceState.engine.project(spacePosePoint(e, { x: e.x + e.width / 2, y: e.y + e.height / 2, z: (e.z || 0) + Math.max(0, e.extrusion || 0) }))
  var host = spaceHost().getBoundingClientRect(), parent = spaceHost().parentElement.getBoundingClientRect(), panel = $('inline-writing')
  var width = Math.min(host.width - 32, Math.max(180, e.width * point.scale)), height = Math.min(host.height - 24, Math.max(70, e.height * point.scale))
  panel.style.left = host.left - parent.left + Math.max(8, Math.min(host.width - width - 8, point.x - width / 2)) + 'px'
  panel.style.top = host.top - parent.top + Math.max(8, Math.min(host.height - height - 8, point.y - height / 2)) + 'px'
  panel.style.width = width + 'px'; panel.style.height = height + 'px'
  panel.style.fontSize = Math.max(14, Math.min(32, (e.fontSize || 16) * point.scale)) + 'px'
  panel.style.lineHeight = '1.6'; panel.style.transform = 'none'; panel.style.background = 'white'; panel.style.border = '1px solid #818cf8'; panel.style.padding = '8px'
}

// Integrate through the existing commands: all edits keep the same validation,
// source mappings, immutable project versions, and undo stack.
var spaceBaseRenderScene = renderScene
renderScene = function () {
  if (!spaceMode) return spaceBaseRenderScene()
  status(); renderEditor(); spaceRequestPaint()
}
var spaceBasePositionInlineWriting = positionInlineWriting
positionInlineWriting = function () {
  if (spaceMode) return spacePositionInlineEditor()
  var panel = $('inline-writing'); panel.style.background = ''; panel.style.border = ''; panel.style.padding = ''
  return spaceBasePositionInlineWriting()
}
var spaceBaseFocusPart = typeof focusPart === 'function' ? focusPart : function () {}
focusPart = function (id) {
  if (!spaceMode) return spaceBaseFocusPart(id)
  if (select(id) === false || !get(id)) return
  spaceState.engine.sync(board, selected)
  spaceState.engine.fit(false, id)
  spaceRequestPaint()
}
var spaceBaseSetTool = setTool
setTool = function (next) {
  if (spaceInput?.busy()) spaceInput.stop(true)
  spaceCancelGesture()
  spaceEndView()
  spaceState.profileReady = false
  spaceState.placementQueue = []
  spaceState.transform = 'move'
  spaceState.engine?.preview(null)
  $('space-cursor').hidden = true
  if (spaceMode && next === 'pan') spaceState.navigation = true
  else if (spaceMode) spaceState.navigation = false
  var result = spaceBaseSetTool(next)
  if (spaceMode) { spacePreparePlacement(next); spaceRequestPaint() }
  if (spaceMode && next === 'select') spaceAdoptSelection()
  if (spaceMode && next === 'pen') { selected.clear(); readingIndex = -1; renderReading(); spaceRequestPaint() }
  return result
}
var spaceBaseInsertImages = insertBoardImages
insertBoardImages = function (images, where) {
  if (!spaceMode) return spaceBaseInsertImages(images, where)
  if (!spaceCanEdit()) return false
  if (!images.length) return false
  var inserted = images.map(function (image) { return imageAt(image, spaceState.penRig.tip, 0) }), next = structuredClone(board)
  for (var e of inserted) { e.z = spaceState.penRig.tip.z; Object.assign(e, spaceState.pose) }
  next.elements.push(...inserted)
  var errors = boardDiagnostics(next, A.organs, A.flows)
  if (errors.length) { message(errors[0].message); return false }
  setTool('image')
  spaceState.placement = inserted.shift(); spaceState.placementQueue = inserted
  spacePaint(); spaceHost().focus()
  return true
}
window.__anatomyBoard.images.insert = insertBoardImages

var spaceCanvas = spaceHost()
spaceCanvas.tabIndex = 0
spaceCanvas.addEventListener('pointerdown', spacePointerDown)
spaceCanvas.addEventListener('pointermove', spacePointerMove)
spaceCanvas.addEventListener('pointerleave', function () { $('space-cursor').hidden = true })
spaceCanvas.addEventListener('pointerup', spacePointerUp)
spaceCanvas.addEventListener('pointercancel', function (ev) { if (spaceState.viewDrag?.pointer === ev.pointerId) spaceEndView(); if (spaceState.gesture?.pointer === ev.pointerId) spaceCancelGesture() })
spaceCanvas.addEventListener('lostpointercapture', function (ev) {
  var resume = spaceState.captureResume
  spaceState.captureResume = null
  // Chromium clears capture after a click/auxclick while another button is
  // held, and may immediately clear a replacement capture too. Forward the
  // rest of this one mouse chord through document instead of cancelling it.
  if (!resume?.recover && resume?.pointer === ev.pointerId && ev.buttons && (spaceState.gesture?.pointer === ev.pointerId || spaceState.viewDrag?.pointer === ev.pointerId)) {
    spaceState.captureResume = { pointer: ev.pointerId, recover: true }
    return
  }
  if (spaceState.viewDrag?.pointer === ev.pointerId) spaceEndView()
  if (spaceState.gesture?.pointer === ev.pointerId) spaceCancelGesture()
})
spaceCanvas.addEventListener('contextmenu', function (ev) { ev.preventDefault() })
function spacePartialMouseClick(ev) {
  if (ev.type === 'auxclick') ev.preventDefault()
  if (!spaceHasMouseButtons(ev) || !ev.buttons || ev.target.closest('.space-tools')) return
  if (spaceState.captureResume?.recover) return
  var pointer = ev.pointerId ?? spaceState.gesture?.pointer ?? spaceState.viewDrag?.pointer
  if (spaceState.gesture?.pointer === pointer || spaceState.viewDrag?.pointer === pointer) spaceState.captureResume = { pointer: pointer }
}
spaceCanvas.addEventListener('auxclick', spacePartialMouseClick)
spaceCanvas.addEventListener('click', spacePartialMouseClick)
function spaceRecoverPointer(ev) {
  var resume = spaceState.captureResume
  if (!resume?.recover || resume.pointer !== ev.pointerId) return
  if (spaceState.gesture?.pointer !== ev.pointerId && spaceState.viewDrag?.pointer !== ev.pointerId) { spaceState.captureResume = null; return }
  if (ev.type === 'pointerdown') { spaceEndView(); spaceCancelGesture(); return }
  ev.preventDefault(); ev.stopImmediatePropagation()
  if (ev.type === 'pointercancel') { spaceEndView(); spaceCancelGesture(); return }
  // Keep routing until all buttons are released, including outside the
  // canvas. Blur/cancellation still ends the transaction and this fallback.
  if (ev.type === 'pointerup') spacePointerUp(ev)
  else spacePointerMove(ev)
  if (ev.buttons && (spaceState.gesture?.pointer === ev.pointerId || spaceState.viewDrag?.pointer === ev.pointerId)) spaceState.captureResume = { pointer: ev.pointerId, recover: true }
  else spaceState.captureResume = null
}
for (var pointerEvent of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) document.addEventListener(pointerEvent, spaceRecoverPointer, true)
spaceCanvas.addEventListener('dblclick', function (ev) {
  if (ev.altKey) return
  if (ev.target.closest('.space-tools')) return
  if (tool !== 'select' || spaceState.selectionMode !== 'point') return
  spaceSyncScene()
  var id = spaceState.engine.pick(ev.clientX, ev.clientY)
  if (id && spaceCanEdit() && select(id) !== false) { openPaperEditor(id); spacePositionInlineEditor() }
})
function spaceWheelPixels(ev) {
  var delta = Number(ev.deltaY)
  if (!Number.isFinite(delta) || delta === 0) return 0
  return delta * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? Math.max(1, spaceHost().getBoundingClientRect().height) : 1)
}
function spaceWheelControl(ev) {
  if (ev.target.closest?.('input,textarea,select,[contenteditable=true],.space-advanced[open] > div')) return true
  var node = ev.target
  while (node && node !== spaceHost()) {
    if (node.scrollHeight > node.clientHeight + 1 && typeof getComputedStyle === 'function' && /auto|scroll/.test(getComputedStyle(node).overflowY)) return true
    node = node.parentElement
  }
  return false
}
spaceCanvas.addEventListener('wheel', function (ev) {
  if (spaceWheelControl(ev)) return
  var delta = spaceWheelPixels(ev)
  if (!delta) return
  ev.preventDefault()
  if (spaceState.gesture?.mode === 'select-area') spaceCancelGesture()
  if (ev.altKey && spaceCarrierTool() && spaceState.penRig) {
    var direction = spaceState.engine.viewDirection(), tip = spaceState.penRig.tip
    var step = Math.max(-100, Math.min(100, delta)) * .35 / Math.max(.02, spaceState.engine.project(tip).scale)
    var next = { x: tip.x + direction.x * step, y: tip.y + direction.y * step, z: tip.z + direction.z * step }
    if (spacePositionPen(next, true) && spaceState.gesture?.planePoint) { var plane = spaceState.gesture.planePoint; spaceState.gesture.planePoint = { x: plane.x + direction.x * step, y: plane.y + direction.y * step, z: plane.z + direction.z * step } }
    return
  }
  spaceState.engine.zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * .002), ev.clientX, ev.clientY)
  spaceRebasePointer()
  spaceRequestPaint()
}, { passive: false })
spaceCanvas.addEventListener('dragover', function (ev) { if (ev.dataTransfer?.types?.includes('Files')) ev.preventDefault() })
spaceCanvas.addEventListener('drop', function (ev) { ev.preventDefault(); importBoardImages(ev.dataTransfer?.files, spacePoint(ev, spaceState.workZ)) })
window.addEventListener('blur', function () { spaceState.spaceKey = false; spaceEndView(); spaceCancelGesture() })
document.addEventListener('visibilitychange', function () { if (document.hidden) { spaceState.spaceKey = false; spaceEndView(); spaceCancelGesture() } })
window.addEventListener('resize', function () { if (spaceMode) { spaceState.engine.resize(); spaceRequestPaint() } })
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(function () { if (spaceMode) { spaceState.engine.resize(); spaceRequestPaint() } }).observe(spaceCanvas)
for (var entry of [['space-toggle', function () { setSpaceMode(!spaceMode) }], ['space-enter', function () { setSpaceMode(true) }], ['space-back', function () { setSpaceMode(false) }], ['space-grid', function () { spaceState.grid = !spaceState.grid; spacePaint() }], ['space-top', function () { spaceState.engine.fit(true); spacePaint() }], ['space-angle', function () { spaceState.engine.fit(false); spacePaint() }]]) $(entry[0]).addEventListener('click', entry[1])
$('space-depth').addEventListener('change', function (ev) { var value = Number(ev.target.value); if (Number.isFinite(value)) { if (spaceCarrierTool() && spaceState.penRig) spacePositionPen({ ...spaceState.penRig.tip, z: value }); else spaceState.workZ = Math.max(-1e7, Math.min(1e7, value)) } spacePaint() })
function spaceSetPoseField(field, value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e7 || !spaceCanEdit()) return
  if (tool === 'select' && selected.size) {
    if (!spaceState.editScene) { message('组件位置已锁定，请先点击上方解锁。'); spacePaint(); return }
    var delta = value - spaceState.pose[field]
    change(function () { manualDrawing(); for (var e of board.elements) if (selected.has(e.id)) e[field] = (e[field] || 0) + delta })
    spaceAdoptSelection()
  } else spaceState.pose[field] = value
  spacePaint()
}
function spaceSetExtrusion(value) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e7 || !spaceCanEdit()) return
  if (tool === 'select' && selected.size) {
    if (!spaceState.editScene) { message('组件位置已锁定，请先解锁。'); return }
    change(function () { manualDrawing(); for (var e of board.elements) if (selected.has(e.id) && ['rect', 'ellipse', 'diamond', 'polygon'].includes(e.type)) e.extrusion = value })
  } else if (spaceState.placement && ['rect', 'ellipse', 'diamond', 'polygon'].includes(spaceState.placement.type)) spaceState.placement.extrusion = value
  spacePaint()
}
for (var poseField of ['rotationX', 'rotationY', 'rotation']) (function (field) { $('space-' + field).addEventListener('change', function (ev) { spaceSetPoseField(field, Number(ev.target.value)) }) })(poseField)
for (var mode of ['move', 'rotate', 'extrude']) (function (mode) { $('space-' + mode).addEventListener('click', function () { spaceState.transform = mode; spacePaint(); spaceHost().focus() }) })(mode)
for (var selectionMode of ['point', 'box', 'lasso']) (function (mode) { $('space-select-' + mode).addEventListener('click', function () { spaceCancelGesture(); spaceState.selectionMode = mode; spacePaint(); spaceHost().focus() }) })(selectionMode)
$('space-extrusion').addEventListener('change', function (ev) { spaceSetExtrusion(Number(ev.target.value)) })
$('space-place').addEventListener('click', function () { spacePlaceComponent(); spaceHost().focus() })
$('space-profile-new').addEventListener('click', function () { spaceState.placement = null; spaceState.profileReady = false; spaceState.transform = 'move'; spacePaint(); spaceHost().focus() })
$('space-grid-step').addEventListener('change', function (ev) { spaceState.step = Math.max(10, Math.min(1000, Number(ev.target.value) || 100)); spacePaint() })
$('space-layer-down').addEventListener('click', function () { spaceDepth(-60) })
$('space-layer-up').addEventListener('click', function () { spaceDepth(60) })
function spacePreviewDepth() {
  if (!spaceState.editScene || !spaceCanEdit()) return
  spaceCancelGesture(); spaceEndView()
  var positions = spaceStructureLayout(board.elements)
  var preview = structuredClone(board)
  for (var e of preview.elements) if (positions.has(e.id)) {
    var pose = positions.get(e.id)
    spaceTranslateElement(e, pose.x - e.x, pose.y - e.y, pose.z - (e.z || 0))
    if (Number.isFinite(pose.width)) e.width = pose.width
    if (Number.isFinite(pose.height)) e.height = pose.height
  }
  if (JSON.stringify(preview) === JSON.stringify(board)) { message('当前关系结构无需调整。'); return }
  preview.layout = { ...(preview.layout || {}), mode: 'manual' }
  var errors = boardDiagnostics(preview, A.organs, A.flows)
  if (errors.length) { message('关系布局未应用：' + errors[0].message); return }
  spaceState.depthPreview = { base: JSON.stringify(board), board: preview }
  $('space-layer-preview-dialog').showModal()
  spacePaint()
}
function spaceFinishDepthPreview(apply) {
  var preview = spaceState.depthPreview
  if (!preview) return
  spaceState.depthPreview = null
  var dialog = $('space-layer-preview-dialog')
  if (dialog.open) dialog.close()
  if (apply && preview.base === JSON.stringify(board) && spaceMode && spaceState.editScene) change(function () { board = preview.board })
  else spaceRequestPaint()
}
$('space-layers').addEventListener('click', spacePreviewDepth)
$('space-layer-preview-apply').addEventListener('click', function () { spaceFinishDepthPreview(true) })
$('space-layer-preview-cancel').addEventListener('click', function () { spaceFinishDepthPreview(false) })
$('space-layer-preview-dialog').addEventListener('close', function () { spaceFinishDepthPreview(false) })
$('space-pen').addEventListener('click', function () { setTool('pen'); spacePaint() })
$('space-pen-down').addEventListener('click', function () { spaceState.penDown = !spaceState.penDown; spacePaint() })
$('space-edit-scene').addEventListener('click', function () { spaceCancelGesture(); spaceState.editScene = !spaceState.editScene; if (spaceState.editScene) setTool('select'); spacePaint() })
$('space-navigation').addEventListener('click', function () { spaceCancelGesture(); spaceState.navigation = !spaceState.navigation; spacePaint() })
$('space-pen-home').addEventListener('click', function () {
  spaceCancelGesture()
  var rig = spaceState.penRig
  if (rig) { var center = { x: 0, y: 0, z: 0 }; for (var anchor of rig.anchors) { center.x += anchor.x / 4; center.y += anchor.y / 4; center.z += anchor.z / 4 } spacePositionPen(center); spacePaint() }
})
// Capture before the existing footer handlers so a camera action cannot also
// execute the corresponding 2D layout command.
document.addEventListener('click', function (ev) {
  if (!spaceMode) return
  var button = ev.target.closest?.('button'), id = button?.id
  if (spaceInput?.busy()) spaceInput.stop(!!button?.hasAttribute('data-tool') || ['space-pen', 'space-back', 'space-toggle'].includes(id))
  if (spaceState.gesture) spaceCancelGesture()
  var commands = {
    fit: function () { if (tool === 'pen') spaceState.engine.fitPenRig(false); else spaceState.engine.fit(false) },
    readable: function () { spaceState.engine.fit(false, Array.from(selected)[0]) },
    'zoom-in': function () { spaceState.engine.zoom(1.2) },
    'zoom-out': function () { spaceState.engine.zoom(1 / 1.2) },
    'auto-layout': function () { $('space-layers').click() },
  }
  if (!commands[id]) return
  ev.preventDefault(); ev.stopImmediatePropagation(); commands[id](); spacePaint()
}, true)
document.addEventListener('keydown', function (ev) {
  if (!spaceMode || editingTarget(ev.target) || document.querySelector('dialog[open]')) return
  var key = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey
  if ((key === 'enter' || key === ' ') && ev.target.closest?.('button,summary')) return
  if (key === ' ') { spaceState.spaceKey = true; spaceRequestPaint(); ev.preventDefault(); return }
  if (key === 'escape') {
    ev.preventDefault()
    if (ev.repeat) return
    var hadViewDrag = !!spaceState.viewDrag
    spaceEndView()
    if (spaceInput?.busy()) { spaceInput.stop(true); spaceCancelGesture(); return }
    if (spaceState.gesture) spaceCancelGesture()
    else if (spaceState.profileReady) { spaceState.placement = null; spaceState.profileReady = false; spacePaint() }
    else if (!hadViewDrag) setSpaceMode(false)
    return
  }
  if (key === 'enter' && !mod && !ev.altKey) { ev.preventDefault(); if (!ev.repeat) { spaceInput?.stop(); spacePlaceComponent() } return }
  if (spaceInput?.keyDown(ev)) { ev.preventDefault(); return }
  if (!mod && Object.hasOwn(SPACE_TOOL_KEYS, key)) { ev.preventDefault(); setTool(SPACE_TOOL_KEYS[key]); return }
  if (spaceState.gesture) { if (mod || ['delete', 'backspace'].includes(key)) ev.preventDefault(); return }
  if (mod && key === 'a') { ev.preventDefault(); selected = new Set(board.elements.map(function (e) { return e.id })); render(); return }
  if (mod && ['z', 'y', 's', 'd'].includes(key)) {
    ev.preventDefault()
    if (key === 'z') ev.shiftKey ? redo() : undo()
    else if (key === 'y') redo()
    else if (key === 's') saveProjectVersion()
    else duplicate()
    spaceRequestPaint(); return
  }
  if (mod) return
  if (key === 'delete' || key === 'backspace') { ev.preventDefault(); if (spaceCanEdit()) remove(); return }
  var keys = { v: 'select', h: 'pan', r: 'rect', o: 'ellipse', p: 'pen', l: 'line', t: 'text', m: 'math', f: 'frame', b: 'lasso' }
  if (ev.altKey) keys = { a: 'arrow', d: 'diamond', e: 'eraser', q: 'polygon' }
  if (keys[key]) { ev.preventDefault(); setTool(keys[key]); return }
  if (key === '[' || key === ']') { ev.preventDefault(); spaceDepth(key === '[' ? -60 : 60); return }
  if (key === 'g') { spaceState.grid = !spaceState.grid; spacePaint(); return }
  if (key === 'home') { if (tool === 'pen') spaceState.engine.fitPenRig(false); else spaceState.engine.fit(false); spacePaint() }
}, true)
document.addEventListener('keyup', function (ev) { if (spaceInput?.keyUp(ev)) ev.preventDefault(); if (ev.key === ' ') { spaceState.spaceKey = false; spaceRequestPaint() } })
spaceInput = createSpaceInput({
  active: function (ev) {
    var target = ev.target || document.activeElement
    if (!spaceMode || document.hidden || editingTarget(target) || document.querySelector('dialog[open]') || graphicBusy || versionSession.busy) return false
    if (spaceState.gesture && spaceState.gesture.input !== 'keyboard') return !ev.code && !ev.key || String(ev.code || ev.key || '').startsWith('Arrow')
    return true
  },
  move: spaceKeyboardMove,
  look: function (dx, dy) { if (spaceState.gesture?.mode === 'select-area') spaceRelease(spaceState.gesture); spaceState.engine.orbit(dx, dy); spaceRebasePointer(); spaceRequestPaint() },
  onState: spaceKeyboardState,
  commit: spacePlaceComponent,
  cancel: spaceCancelGesture,
})
// Small inspection surface for integration tests and host diagnostics.
window.__anatomyBoard.space = {
  active: spaceIsActive, enter: function () { return setSpaceMode(true) }, exit: function () { return setSpaceMode(false) },
  info: function () { return spaceState.engine?.info() },
}
if (typeof location !== 'undefined' && /(^#|&)space(=|&|$)/.test(location.hash || '')) setSpaceMode(true)
