// GPU scene backend. This file is inlined in the board's existing browser scope.
// Public coordinates stay identical to paper: x right, y down, z up.
function createSpaceRenderer(host, options) {
  options = options || {}
  var T = globalThis.AnatomyThree
  if (!T || !T.WebGLRenderer) throw Error('立体绘图引擎未加载')
  var disposed = false, dirty = true, width = 1, height = 1
  var scene = new T.Scene(), content = new T.Group(), decoration = new T.Group()
  scene.background = new T.Color('#f6f8fc')
  scene.add(content, decoration)
  var camera = new T.PerspectiveCamera(42, 1, 0.1, 1000000)
  camera.up.set(0, 0, 1)
  var target = new T.Vector3(), distance = 1800, yaw = -0.62, pitch = 1.05
  var renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' })
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1))
  renderer.outputColorSpace = T.SRGBColorSpace
  var canvas = renderer.domElement
  canvas.className = 'space-gpu-canvas'
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
  canvas.setAttribute('aria-label', '三维工程画板')
  host.appendChild(canvas)
  var records = new Map(), textures = new Map(), textureBytes = 0, tick = 0
  var textureBudget = 64 * 1024 * 1024, textureDensity = 2, pickables = [], bounds = new T.Box3()
  var raycaster = new T.Raycaster(), vector = new T.Vector3(), ndc = new T.Vector2()
  var selectedIds = new Set(), grid = null, previewObject = null, workZ = 0
  var previousGrid = '', previewSignature = '', hasFitted = false, imageJobs = 0, epoch = 0
  var penRig = { visible: false, drawing: false, tip: { x: 0, y: 0, z: 0 }, anchors: [], lengths: [] }
  var penRigObject = null, penRigParts = null, penRigSignature = '', penRigTextures = []
  var placementRecord = null, placementState = null, placementSignature = ''
  var manipulatorState = null, manipulatorObject = null, manipulatorHits = [], manipulatorSignature = ''

  function number(value, fallback) { return Number.isFinite(value) ? value : (fallback || 0) }
  function world(point) { return new T.Vector3(number(point.x), -number(point.y), number(point.z)) }
  function poseGroup(group, element) {
    group.position.set(number(element.x) + number(element.width) / 2, -number(element.y) - number(element.height) / 2, number(element.z))
    group.rotation.set(-number(element.rotationX) * Math.PI / 180, number(element.rotationY) * Math.PI / 180, -number(element.rotation) * Math.PI / 180, 'ZYX')
  }
  function invalidate() { if (disposed) return; dirty = true; if (options.onInvalidate) options.onInvalidate() }
  function updateCamera() {
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y - Math.cos(yaw) * Math.cos(pitch) * distance, target.z + Math.sin(pitch) * distance)
    camera.near = Math.max(0.01, distance / 10000)
    camera.far = Math.max(100000, distance * 100, bounds.isEmpty() ? 0 : bounds.getSize(vector).length() * 20)
    camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
    centerGrid()
    updatePenRigPresentation()
    updateManipulatorPresentation()
    invalidate()
  }
  function removeObject(object) {
    if (!object) return
    if (object.parent) object.parent.remove(object)
    object.traverse(function (node) {
      if (node.geometry) node.geometry.dispose()
      if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(function (material) { material.dispose() })
    })
  }
  function pruneTextures(force) {
    var unused = Array.from(textures.values()).filter(function (entry) { return !entry.refs }).sort(function (a, b) { return a.used - b.used })
    unused.forEach(function (entry) {
      if (!force && textureBytes <= textureBudget && textures.size <= 160) return
      textures.delete(entry.key); textureBytes -= entry.bytes; entry.dead = true
      entry.texture.dispose(); entry.canvas.width = entry.canvas.height = 1; entry.alpha = null
    })
  }
  function releaseRecord(record) {
    removeObject(record.group)
    if (record.texture) { record.texture.refs--; record.texture.used = ++tick }
  }
  function material(color, extra) {
    return new T.MeshBasicMaterial(Object.assign({ color: color || '#334155', side: T.DoubleSide, forceSinglePass: true, transparent: true, depthTest: true, depthWrite: true }, extra || {}))
  }
  function tag(object, record, alpha) {
    object.userData.spaceId = record.id
    if (alpha) object.userData.alpha = alpha
    record.hits.push(object)
    return object
  }
  function line(points, color, dashed) {
    var geometry = new T.BufferGeometry().setFromPoints(points)
    var style = dashed ? new T.LineDashedMaterial({ color: color, dashSize: 8, gapSize: 5, transparent: true, depthTest: true }) : new T.LineBasicMaterial({ color: color, transparent: true, depthTest: true })
    var object = new T.Line(geometry, style)
    if (dashed) object.computeLineDistances()
    return object
  }
  // Curves use piecewise linear interpolation, preserving original handwriting.
  function polylineCurve(points) {
    var lengths = [0], total = 0
    for (var index = 1; index < points.length; index++) { total += points[index].distanceTo(points[index - 1]); lengths.push(total) }
    var curve = new T.Curve()
    curve.getPoint = function (t, out) {
      out = out || new T.Vector3()
      if (!total) return out.copy(points[0])
      var wanted = Math.max(0, Math.min(1, t)) * total, lo = 1, hi = points.length - 1
      while (lo < hi) { var mid = (lo + hi) >> 1; if (lengths[mid] < wanted) lo = mid + 1; else hi = mid }
      var start = lengths[lo - 1], part = (wanted - start) / Math.max(1e-9, lengths[lo] - start)
      return out.copy(points[lo - 1]).lerp(points[lo], part)
    }
    return curve
  }
  function stroke(record, points, color, strokeWidth, dashed) {
    if (points.length < 2) return
    var object = line(points, color, dashed)
    object.userData.spaceStrokeWidth = strokeWidth
    record.group.add(tag(object, record))
    if (strokeWidth > 1.2 && !dashed && ['pen', 'line', 'arrow'].indexOf(record.kind) >= 0) {
      var segments = Math.min(2048, Math.max(2, points.length * 2))
      var tube = new T.Mesh(new T.TubeGeometry(polylineCurve(points), segments, strokeWidth / 2, 5, false), material(color))
      record.group.add(tube)
    }
  }
  function localOutline(element, w, h) {
    var points = [], type = element.type
    if (['rect', 'ellipse', 'diamond', 'polygon'].indexOf(type) >= 0) {
      var profile = Object.assign({ x: 0, y: 0, width: w, height: h }, element), cx = number(profile.x) + number(profile.width) / 2, cy = number(profile.y) + number(profile.height) / 2
      points = spaceShapeOutline(profile).map(function (p) { return new T.Vector3(p.x - cx, cy - p.y, 0) })
      if (points.length) points.push(points[0].clone())
      return points
    }
    return [[-w / 2, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2, -h / 2], [-w / 2, h / 2]].map(function (p) { return new T.Vector3(p[0], p[1], 0) })
  }
  function validInk(handwriting) {
    if (typeof validMathInk === 'function') return validMathInk(handwriting)
    var strokes = handwriting && handwriting.strokes
    return handwriting && handwriting.mode === 'math' && Array.isArray(strokes) && strokes.length > 0 && strokes.length <= 200 && strokes.every(function (stroke) {
      return Array.isArray(stroke) && stroke.length > 0 && stroke.length <= 1500 && stroke.every(function (point) {
        return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && point[0] >= 0 && point[0] <= 1000 && point[1] >= 0 && point[1] <= 420
      })
    }) && strokes.reduce(function (count, stroke) { return count + stroke.length }, 0) <= 20000
  }
  function formulasFor(element) {
    var entries = typeof elementMathEntries === 'function' ? elementMathEntries(element) : (element.math ? [{ id: 'primary', value: element.math }] : []).concat((element.mathExpressions || []).map(function (entry) { return { id: entry.id, value: entry.value || entry.math || '' } }))
    return entries.map(function (entry) {
      var source = typeof inkExpression === 'function' ? inkExpression(element, entry.id) : entry.id === 'primary' ? { handwriting: validInk(element.mathHandwriting) ? element.mathHandwriting : element.handwriting } : (element.mathExpressions || []).find(function (value) { return value.id === entry.id })
      var display = entry.id === 'primary' ? element.mathDisplay : source && source.display
      return { id: entry.id, value: entry.value, display: display || 'typeset', handwriting: display === 'ink' && source ? source.handwriting : null }
    })
  }
  function rasterInk(handwriting) {
    if (!validInk(handwriting)) return null
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    handwriting.strokes.forEach(function (stroke) { stroke.forEach(function (point) { left = Math.min(left, point[0]); top = Math.min(top, point[1]); right = Math.max(right, point[0]); bottom = Math.max(bottom, point[1]) }) })
    left -= 5; top -= 5
    var w = Math.max(10, right - left + 5), h = Math.max(10, bottom - top + 5), raster = document.createElement('canvas')
    var scale = Math.min(2, 2048 / Math.max(w, h))
    raster.width = Math.ceil(w * scale); raster.height = Math.ceil(h * scale)
    var context = raster.getContext('2d', { willReadFrequently: true })
    context.scale(raster.width / w, raster.height / h); context.translate(-left, -top)
    context.strokeStyle = context.fillStyle = '#24334e'; context.lineWidth = 4; context.lineCap = context.lineJoin = 'round'
    handwriting.strokes.forEach(function (stroke) {
      context.beginPath()
      if (stroke.length === 1) { context.arc(stroke[0][0], stroke[0][1], 2, 0, Math.PI * 2); context.fill() }
      else { stroke.forEach(function (point, index) { if (!index) context.moveTo(point[0], point[1]); else context.lineTo(point[0], point[1]) }); context.stroke() }
    })
    return raster
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image()
      image.onload = function () { resolve(image) }; image.onerror = function () { reject(Error('图片无法读取')) }
      image.src = src
    })
  }
  function alphaMask(entry) {
    var mask = document.createElement('canvas'), scale = Math.min(1, 384 / Math.max(entry.canvas.width, entry.canvas.height))
    mask.width = Math.max(1, Math.round(entry.canvas.width * scale)); mask.height = Math.max(1, Math.round(entry.canvas.height * scale))
    var context = mask.getContext('2d', { willReadFrequently: true })
    context.drawImage(entry.canvas, 0, 0, mask.width, mask.height)
    try { entry.alpha = { width: mask.width, height: mask.height, data: context.getImageData(0, 0, mask.width, mask.height).data } } catch (_) { entry.alpha = null }
    mask.width = mask.height = 1
  }
  function wrap(context, value, maxWidth) {
    var lines = []
    String(value || '').split('\n').forEach(function (paragraph) {
      var run = ''
      Array.from(paragraph).forEach(function (character) {
        if (run && context.measureText(run + character).width > maxWidth) { lines.push(run); run = '' }
        run += character
      })
      lines.push(run)
    })
    return lines
  }
  function acquireTexture(element, w, h) {
    // A content key deliberately excludes position/rotation: dragging never redraws textures.
    var scale = Math.min(textureDensity, 2048 / Math.max(w, h), Math.sqrt(2097152 / Math.max(1, w * h)))
    var key = JSON.stringify([scale, w, h, element.type, element.text, element.fontSize, element.textAlign, element.image, element.formulaGraphic && true, formulasFor(element), element.mathDisplay, element.handwriting, element.mathHandwriting])
    var cached = textures.get(key)
    if (cached) { cached.refs++; cached.used = ++tick; return cached }
    var raster = document.createElement('canvas')
    raster.width = Math.max(1, Math.ceil(w * scale)); raster.height = Math.max(1, Math.ceil(h * scale))
    var texture = new T.CanvasTexture(raster)
    texture.colorSpace = T.SRGBColorSpace; texture.generateMipmaps = true
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
    var entry = { key: key, refs: 1, used: ++tick, texture: texture, canvas: raster, alpha: null, dead: false, bytes: raster.width * raster.height * 12 + key.length * 2 }
    textures.set(key, entry); textureBytes += entry.bytes
    var snapshot = JSON.parse(JSON.stringify(element)), formulaList = formulasFor(snapshot)
    var text = String(snapshot.text || (!snapshot.formulaGraphic && snapshot.type === 'image' && snapshot.image ? snapshot.image.alt || '' : ''))
    var font = Math.max(8, number(snapshot.fontSize, snapshot.type === 'math' ? 24 : 16))
    var image = null, imageError = false, formulaImages = [], formulaErrors = [], hasImage = snapshot.type === 'image' && snapshot.image && /^data:image\/(png|jpeg|webp);/i.test(snapshot.image.src || '')
    function paint() {
      if (entry.dead || disposed) return
      var context = raster.getContext('2d', { willReadFrequently: true }); context.clearRect(0, 0, raster.width, raster.height)
      context.save(); context.scale(raster.width / w, raster.height / h)
      context.fillStyle = '#24334e'; context.font = font + 'px "Noto Sans CJK SC", system-ui, sans-serif'
      context.textBaseline = 'top'
      var inset = ['text', 'math', 'image'].indexOf(snapshot.type) >= 0 ? 0 : Math.min(14, w * 0.07)
      var available = Math.max(1, w - inset * 2), top = inset
      if (hasImage) {
        var caption = snapshot.formulaGraphic ? 0 : Math.min(110, Math.max(38, h * 0.22))
        var imageHeight = Math.max(1, h - caption)
        if (image) {
          var fit = Math.min(w / image.width, imageHeight / image.height), dw = snapshot.formulaGraphic ? w : image.width * fit, dh = snapshot.formulaGraphic ? imageHeight : image.height * fit
          context.drawImage(image, (w - dw) / 2, (imageHeight - dh) / 2, dw, dh)
        } else {
          context.fillStyle = '#e2e8f0'; context.fillRect(0, 0, w, imageHeight)
          context.fillStyle = imageError ? '#b91c1c' : '#64748b'; context.fillText(imageError ? '图片读取失败' : '图片加载中…', 8, 8, Math.max(1, w - 16))
        }
        top = imageHeight + 8; inset = snapshot.formulaGraphic ? 0 : 8; available = Math.max(1, w - inset * 2)
      }
      var lines = text ? wrap(context, text, available) : [], lineHeight = font * 1.5
      var formulaHeight = formulaList.length ? Math.min(h * 0.55, Math.max(font * 1.8, h - top - lines.length * lineHeight - 8)) : 0
      var centered = ['rect', 'ellipse', 'diamond', 'polygon'].indexOf(snapshot.type) >= 0
      if (centered) top = Math.max(inset, (h - lines.length * lineHeight - formulaHeight) / 2)
      var align = snapshot.textAlign || (centered ? 'center' : 'left')
      context.textAlign = align === 'right' || align === 'end' ? 'right' : align === 'center' ? 'center' : 'left'
      var tx = context.textAlign === 'center' ? w / 2 : context.textAlign === 'right' ? w - inset : inset
      context.fillStyle = '#24334e'
      lines.forEach(function (value) { if (top + font <= h) context.fillText(value, tx, top, available); top += lineHeight })
      formulaList.forEach(function (_, index) {
        var item = formulaImages[index], rowHeight = Math.max(1, Math.min((h - top) / Math.max(1, formulaList.length - index), formulaHeight / Math.max(1, formulaList.length)))
        if (item && rowHeight > 1) {
          var fit = Math.min(available / item.width, rowHeight / item.height), dw = item.width * fit, dh = item.height * fit
          context.drawImage(item, (w - dw) / 2, top, dw, dh)
        } else if (formulaErrors[index] && rowHeight >= 12) {
          context.fillStyle = '#b91c1c'; context.textAlign = 'left'; context.font = Math.min(font, rowHeight - 1) + 'px system-ui, sans-serif'
          context.fillText(formulaErrors[index] === 'ink' ? '原笔迹暂不可用' : '公式图形暂不可用', inset, top, available)
        }
        top += rowHeight
      })
      context.restore(); texture.needsUpdate = true; alphaMask(entry); invalidate()
    }
    var jobs = []
    if (hasImage) jobs.push(loadImage(snapshot.image.src).then(function (loaded) { image = loaded }).catch(function () { imageError = true }))
    formulaList.forEach(function (formula, index) {
      if (formula.display === 'ink') { formulaImages[index] = rasterInk(formula.handwriting); if (!formulaImages[index]) formulaErrors[index] = 'ink' }
      else if (typeof rasterFormula === 'function') jobs.push(Promise.resolve().then(function () { return rasterFormula(formula.value, { fontSize: Math.max(font, 24) }) }).then(function (result) { return loadImage(result.src) }).then(function (loaded) { formulaImages[index] = loaded }).catch(function () { formulaErrors[index] = true }))
      else formulaErrors[index] = true
    })
    paint()
    if (jobs.length) {
      imageJobs += jobs.length
      Promise.all(jobs.map(function (job) { return job.catch(function () {}).finally(function () { imageJobs-- }) })).then(paint)
    }
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(paint)
    pruneTextures(false)
    return entry
  }
  function addSelection(record, element, w, h) {
    if (record.placement || !selectedIds.has(record.id)) return
    var outline = line(localOutline({ type: 'rect' }, w + 10, h + 10), '#6366f1', true)
    outline.position.z = Math.max(0, ['rect', 'ellipse', 'diamond', 'polygon'].indexOf(element.type) >= 0 ? number(element.extrusion) : 0) + 0.8
    outline.userData.selection = true; record.group.add(outline)
  }
  function buildRecord(element, linkGeometry, parent, isPlacement) {
    var id = element.id, type = element.type, w = Math.max(1, Math.abs(number(element.width, 1))), h = Math.max(1, Math.abs(number(element.height, 1)))
    var group = new T.Group(), record = { id: id, kind: type, group: group, hits: [], texture: null, signature: '', placement: !!isPlacement }
    var selected = !isPlacement && selectedIds.has(id)
    var color = element.stroke || '#334155', sw = Math.max(0.5, number(element.strokeWidth, 2))
    if (type === 'line' || type === 'arrow') {
      var edge = linkGeometry || spaceLinks([element])[0], a = world(edge.a), b = world(edge.b)
      stroke(record, [a, b], selected ? '#6366f1' : color, sw)
      if (type === 'arrow' && a.distanceTo(b) > 0.1) {
        var size = Math.min(a.distanceTo(b) * 0.22, Math.max(12, sw * 5)), direction = b.clone().sub(a).normalize()
        var cone = new T.Mesh(new T.ConeGeometry(size * 0.34, size, 10), material(color))
        cone.position.copy(b).addScaledVector(direction, -size / 2); cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction)
        group.add(tag(cone, record))
      }
      if (element.text || formulasFor(element).length) {
        var lw = Math.min(280, Math.max(100, String(element.text || '').length * 10)), lh = formulasFor(element).length ? 100 : 42
        record.texture = acquireTexture(Object.assign({}, element, { type: 'text' }), lw, lh)
        var label = new T.Mesh(new T.PlaneGeometry(lw, lh), material('#ffffff', { map: record.texture.texture, transparent: true, alphaTest: 0.02 }))
        label.position.copy(a).lerp(b, 0.5); label.position.z += 2
        group.add(tag(label, record, record.texture))
      }
    } else if (type === 'pen') {
      var rawPoints = spaceStrokePoints(element)
      var cx = number(element.x) + number(element.width) / 2, cy = number(element.y) + number(element.height) / 2
      var points = rawPoints.map(function (p) { return new T.Vector3(p.x - cx, cy - p.y, p.z - number(element.z)) })
      poseGroup(group, element)
      if (points.length === 1) points.push(points[0].clone().add(new T.Vector3(0.01, 0, 0)))
      stroke(record, points, selected ? '#6366f1' : color, sw)
    } else {
      poseGroup(group, element)
      var outline = localOutline(element, w, h), depth = ['rect', 'ellipse', 'diamond', 'polygon'].indexOf(type) >= 0 ? number(element.extrusion) : 0
      if (['text', 'math', 'image'].indexOf(type) < 0) {
        if (type !== 'frame' && (depth || element.fill && element.fill !== 'none' && element.fill !== 'transparent')) {
          var shape = new T.Shape(); outline.forEach(function (p, i) { if (!i) shape.moveTo(p.x, p.y); else shape.lineTo(p.x, p.y) })
          var fill = element.fill && element.fill !== 'none' && element.fill !== 'transparent' ? element.fill : '#dbeafe'
          var geometry = depth ? new T.ExtrudeGeometry(shape, { depth: Math.abs(depth), bevelEnabled: false, steps: 1 }) : new T.ShapeGeometry(shape)
          if (depth < 0) geometry.translate(0, 0, depth)
          var fillMesh = new T.Mesh(geometry, depth ? [material(fill), material(new T.Color(fill).multiplyScalar(0.78))] : material(fill))
          group.add(tag(fillMesh, record))
        }
        stroke(record, outline, color, sw, type === 'frame')
        if (depth) {
          stroke(record, outline.map(function (p) { return new T.Vector3(p.x, p.y, depth) }), color, sw)
          var edgePoints = [], stride = type === 'ellipse' ? Math.max(1, Math.floor((outline.length - 1) / 8)) : 1
          for (var edge = 0; edge < outline.length - 1; edge += stride) edgePoints.push(outline[edge].clone(), new T.Vector3(outline[edge].x, outline[edge].y, depth))
          group.add(tag(new T.LineSegments(new T.BufferGeometry().setFromPoints(edgePoints), new T.LineBasicMaterial({ color: color, transparent: true })), record))
        }
        if (!depth && ['rect', 'ellipse', 'diamond', 'polygon', 'frame'].indexOf(type) >= 0 && (!element.fill || element.fill === 'none' || element.fill === 'transparent' || type === 'frame')) {
          var hitShape = new T.Shape(); outline.forEach(function (p, i) { if (!i) hitShape.moveTo(p.x, p.y); else hitShape.lineTo(p.x, p.y) })
          var hitSurface = new T.Mesh(new T.ShapeGeometry(hitShape), material('#ffffff'))
          // A wireframe component still has a selectable interior. Keep its
          // exact profile as a ray target without painting an opaque card.
          hitSurface.visible = false; group.add(tag(hitSurface, record))
        }
      }
      if (element.text || formulasFor(element).length || type === 'image') {
        record.texture = acquireTexture(element, w, h)
        var mesh = new T.Mesh(new T.PlaneGeometry(w, h), material('#ffffff', { map: record.texture.texture, transparent: true, alphaTest: 0.02, depthWrite: true }))
        mesh.position.z = Math.max(0, depth); group.add(tag(mesh, record, record.texture))
      }
      addSelection(record, element, w, h)
    }
    if (parent) parent.add(group)
    else content.add(group)
    return record
  }
  // Placement is a separate scene decoration. It uses the same shape and
  // texture builder as saved elements, but never changes document bounds or
  // hit targets. Keep its geometry at the origin so movement and rotation do
  // not rebuild meshes or re-rasterize text, images or formulas every frame.
  function setPlacement(element) {
    if (disposed) return
    if (!element) {
      if (!placementRecord) return
      releaseRecord(placementRecord); placementRecord = null; placementState = null; placementSignature = ''
      pruneTextures(false); invalidate(); return
    }
    var appearance = {}
    Object.keys(element).sort().forEach(function (key) { if (['id', 'x', 'y', 'z', 'rotationX', 'rotationY', 'rotation'].indexOf(key) < 0) appearance[key] = element[key] })
    if (Number.isFinite(element.endZ)) appearance.endZ = element.endZ - number(element.z)
    var signature = JSON.stringify([appearance, textureDensity])
    var next = { id: element.id, type: element.type, x: number(element.x), y: number(element.y), z: number(element.z), rotation: number(element.rotation), rotationX: number(element.rotationX), rotationY: number(element.rotationY), extrusion: number(element.extrusion) }
    var changed = signature !== placementSignature || !placementState || Object.keys(next).some(function (key) { return next[key] !== placementState[key] })
    if (!changed) return
    if (!placementRecord || signature !== placementSignature) {
      if (placementRecord) releaseRecord(placementRecord)
      var local = Object.assign({}, appearance, { id: element.id, x: -number(element.width) / 2, y: -number(element.height) / 2, z: 0, rotation: 0 })
      // Placement connectors are not yet attached to document nodes.
      delete local.from; delete local.to
      placementRecord = buildRecord(local, null, decoration, true)
      placementRecord.group.name = 'space-component-placement'
      placementRecord.group.traverse(function (node) {
        node.renderOrder = 18
        if (node.material) (Array.isArray(node.material) ? node.material : [node.material]).forEach(function (style) {
          style.transparent = true; style.opacity *= 0.62; style.depthWrite = false
        })
      })
      placementSignature = signature
      pruneTextures(false)
    }
    placementState = next
    poseGroup(placementRecord.group, Object.assign({}, element, next))
    placementRecord.group.updateMatrixWorld(true)
    invalidate()
  }
  function sync(board, selected) {
    if (disposed) return
    var elements = Array.isArray(board && board.elements) ? board.elements : [], byId = new Map(), nextSelected = new Set(selected || []), changed = false
    var links = new Map()
    spaceLinks(elements).forEach(function (edge) { links.set(edge.id, edge) })
    elements.forEach(function (element) { if (element && typeof element.id === 'string') byId.set(element.id, element) })
    selectedIds = nextSelected
    // Keep large documents inside a texel budget. Quantized levels avoid
    // re-rasterizing every card on each insertion; camera movement never does.
    var area = 0
    byId.forEach(function (element) {
      if (!element.text && !element.math && !(element.mathExpressions && element.mathExpressions.length) && element.type !== 'image') return
      area += Math.max(1, Math.abs(number(element.width, 160) * number(element.height, 90)))
    })
    var desired = Math.min(2, Math.sqrt(4194304 / Math.max(1, area)))
    textureDensity = Math.min(2, Math.max(0.125, Math.pow(Math.SQRT2, Math.floor(Math.log(desired) / Math.log(Math.SQRT2) + 1e-9))))
    records.forEach(function (record, id) { if (!byId.has(id)) { releaseRecord(record); records.delete(id); changed = true } })
    var elementOrder = 0
    function orderRecord(record, order) {
      var layer = (order + 1) / (byId.size + 1)
      if (record.order === order && record.layer === layer) return
      record.order = order; record.layer = layer
      // Stay below decoration render orders while giving equal-depth cards
      // the same front/back order as their document array. Setting the mesh
      // order avoids overriding nested decoration group ordering.
      var nodes = []
      record.group.traverse(function (node) { if (node.geometry) nodes.push(node) })
      nodes.forEach(function (node, index) { node.renderOrder = (order + (index + 1) / (nodes.length + 1)) / (byId.size + 1) })
      changed = true
    }
    byId.forEach(function (element, id) {
      var order = elementOrder++
      var related = element.type === 'line' || element.type === 'arrow' ? [byId.get(element.from), byId.get(element.to)].map(function (node) { return node ? [node.x, node.y, node.z, node.width, node.height, node.rotation, node.rotationX, node.rotationY, node.extrusion] : null }) : null
      var surface = element.text || element.math || element.mathExpressions && element.mathExpressions.length || element.type === 'image'
      var signature = JSON.stringify([element, related, nextSelected.has(id), surface ? textureDensity : 0])
      var old = records.get(id)
      if (old && old.signature === signature) { orderRecord(old, order); return }
      var geometrySignature = null
      if (element.type !== 'pen' && element.type !== 'line' && element.type !== 'arrow') {
        var geometryElement = Object.assign({}, element)
        for (var field of ['x', 'y', 'z', 'rotationX', 'rotationY', 'rotation']) delete geometryElement[field]
        geometrySignature = JSON.stringify([geometryElement, nextSelected.has(id), surface ? textureDensity : 0])
      }
      if (old && geometrySignature && old.geometrySignature === geometrySignature) {
        poseGroup(old.group, element); old.signature = signature; orderRecord(old, order); changed = true; return
      }
      if (old) releaseRecord(old)
      var record = buildRecord(element, links.get(id)); record.signature = signature; record.geometrySignature = geometrySignature; orderRecord(record, order); records.set(id, record); changed = true
    })
    if (changed) {
      pickables = []; records.forEach(function (record) { pickables.push.apply(pickables, record.hits) })
      content.updateMatrixWorld(true); bounds.setFromObject(content)
      pruneTextures(false); epoch++; invalidate()
    }
    if (!hasFitted) { hasFitted = true; fit(false) }
  }
  function resize() {
    if (disposed) return
    var rect = host.getBoundingClientRect(), nextWidth = Math.max(1, Math.round(rect.width)), nextHeight = Math.max(1, Math.round(rect.height))
    var ratio = Math.min(2, globalThis.devicePixelRatio || 1)
    if (nextWidth === width && nextHeight === height && renderer.getPixelRatio() === ratio) return
    width = nextWidth; height = nextHeight; renderer.setPixelRatio(ratio); renderer.setSize(width, height, false)
    camera.aspect = width / height; camera.updateProjectionMatrix(); updatePenRigPresentation(); updateManipulatorPresentation(); invalidate()
  }
  function draw() { if (!disposed && dirty) { resize(); renderer.render(scene, camera); dirty = false } }
  function captureRecognition(options) {
    if (disposed) throw Error('三维视图已关闭，请重新打开后识别。')
    var polygon = options && options.region
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 10000 || polygon.some(function (p) { return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x), Math.abs(p.y)) > 1e7 })) throw Error('识别区域需要至少三个有效屏幕坐标点。')
    var rect = host.getBoundingClientRect()
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1 || rect.width > 8192 || rect.height > 8192 || rect.width * rect.height > 16777216 || canvas.width < 1 || canvas.height < 1 || canvas.width > 16384 || canvas.height > 16384 || canvas.width * canvas.height > 67108864) throw Error('三维识别视口尺寸无效或过大，请缩小窗口后重试。')
    if (Math.round(rect.width) !== width || Math.round(rect.height) !== height) throw Error('三维视口尺寸已变化，请重新准备识别区域。')
    var xs = polygon.map(function (p) { return p.x }), ys = polygon.map(function (p) { return p.y })
    var left = Math.max(0, Math.min.apply(Math, xs)), top = Math.max(0, Math.min.apply(Math, ys)), right = Math.min(width, Math.max.apply(Math, xs)), bottom = Math.min(height, Math.max.apply(Math, ys))
    if (!(right > left) || !(bottom > top)) throw Error('识别区域没有落在当前三维视口内。')
    if (right - left < 1 || bottom - top < 1) throw Error('识别区域过小，请重新圈选。')
    var captureBounds = { x: left, y: top, width: right - left, height: bottom - top }, scale = Math.min(900 / captureBounds.width, 320 / captureBounds.height)
    var output = document.createElement('canvas'); output.width = 1000; output.height = 420
    var context = output.getContext('2d')
    if (!context) throw Error('无法创建识别预览，请重试。')
    var oldBackground = scene.background, oldDecoration = decoration.visible, selections = []
    try {
      scene.background = new T.Color('#ffffff'); decoration.visible = false
      content.traverse(function (node) { if (node.userData.selection) { selections.push({ node: node, visible: node.visible }); node.visible = false } })
      // The default WebGL buffer is transient. Render and copy it synchronously
      // before returning to the browser, including when the normal scene is idle.
      renderer.render(scene, camera)
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height)
      context.save(); context.translate(50, 50); context.scale(scale, scale); context.translate(-left, -top)
      context.beginPath(); context.moveTo(polygon[0].x, polygon[0].y)
      for (var i = 1; i < polygon.length; i++) context.lineTo(polygon[i].x, polygon[i].y)
      context.closePath(); context.clip('evenodd')
      context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height)
      context.restore()
      return { src: output.toDataURL('image/png'), bounds: captureBounds }
    } finally {
      scene.background = oldBackground; decoration.visible = oldDecoration
      selections.forEach(function (entry) { entry.node.visible = entry.visible })
      invalidate()
    }
  }
  function frameBox(box, top, margins) {
    if (box.isEmpty()) { target.set(0, 0, 0); distance = 1600 }
    else {
      box.getCenter(target)
      var radius = Math.max(80, box.getSize(new T.Vector3()).length() / 2)
      var halfFov = camera.fov * Math.PI / 360, horizontal = Math.atan(Math.tan(halfFov) * camera.aspect)
      if (margins) {
        horizontal = Math.atan(Math.tan(halfFov) * Math.max(1, width - margins.left - margins.right) / height)
        halfFov = Math.atan(Math.tan(halfFov) * Math.max(1, height - margins.top - margins.bottom) / height)
      }
      distance = radius / Math.sin(Math.min(halfFov, horizontal)) * (margins ? 1.06 : 1.14)
    }
    if (top) { yaw = 0; pitch = Math.PI / 2 - 0.0001 }
    else { yaw = -0.62; pitch = 1.05 }
    updateCamera()
    if (margins) {
      // Center the whole rig in the unobstructed rectangle, leaving room for
      // the toolbar above and controls below. This runs only on explicit fit.
      var units = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, height)
      var right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      target.addScaledVector(right, (margins.right - margins.left) / 2 * units).addScaledVector(up, (margins.top - margins.bottom) / 2 * units)
      updateCamera()
    }
  }
  function fit(top, id) {
    if (disposed) return
    resize()
    frameBox(id && records.has(id) ? new T.Box3().setFromObject(records.get(id).group) : bounds, top)
  }
  function fitPenRig(top) {
    if (disposed) return
    resize()
    var box = new T.Box3(), points = [], hostRect = host.getBoundingClientRect(), tools = host.querySelector('.space-tools')
    function include(point, padding) { points.push({ point: point, padding: padding }); box.expandByPoint(point) }
    content.updateMatrixWorld(true)
    // Fit the displayed geometry itself. A union box invents empty corners
    // around diagonal links and the four anchors, shrinking the entire page.
    records.forEach(function (record) {
      record.hits.forEach(function (object) {
        var position = object.geometry && object.geometry.getAttribute('position')
        if (!position) return
        for (var index = 0; index < position.count; index++) include(new T.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld), 4)
      })
    })
    if (penRig.anchors.length === 4) {
      penRig.anchors.forEach(function (anchor) { include(world(anchor), 24) })
      include(world(penRig.tip), 48)
    }
    var side = Math.max(36, Math.min(90, width * 0.08)), toolsBottom = tools && tools.getClientRects().length ? tools.getBoundingClientRect().bottom - hostRect.top + 24 : 0
    var margins = { left: side, right: side, top: Math.min(height * 0.3, Math.max(72, height * 0.12, toolsBottom)), bottom: Math.min(height * 0.3, Math.max(96, height * 0.16)) }
    frameBox(box, top, margins)
    if (!points.length) return
    var origin = target.clone(), right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), forward = camera.getWorldDirection(new T.Vector3())
    var focal = height / (2 * Math.tan(camera.fov * Math.PI / 360)), nearest = Infinity
    var samples = points.map(function (entry) {
      var offset = entry.point.clone().sub(origin), padding = Math.min(entry.padding, (width - margins.left - margins.right) * 0.12, (height - margins.top - margins.bottom) * 0.12)
      var sample = { x: offset.dot(right), y: offset.dot(up), depth: offset.dot(forward), left: (margins.left + padding - width / 2) / focal, right: (width / 2 - margins.right - padding) / focal, bottom: (margins.bottom + padding - height / 2) / focal, top: (height / 2 - margins.top - padding) / focal }
      nearest = Math.min(nearest, sample.depth)
      return sample
    })
    function feasible(candidate) {
      var left = -Infinity, right = Infinity, bottom = -Infinity, top = Infinity
      for (var index = 0; index < samples.length; index++) {
        var sample = samples[index], depth = candidate + sample.depth
        if (depth <= 0.1) return null
        left = Math.max(left, sample.x - sample.right * depth); right = Math.min(right, sample.x - sample.left * depth)
        bottom = Math.max(bottom, sample.y - sample.top * depth); top = Math.min(top, sample.y - sample.bottom * depth)
        if (left > right || bottom > top) return null
      }
      return { x: (left + right) / 2, y: (bottom + top) / 2 }
    }
    // At a fixed view direction each projected point gives an interval of
    // allowed camera offsets. Their intersection determines whether this
    // distance fits, including screen-space room for the pen and labels.
    var low = Math.max(8, -nearest + 0.11), high = Math.max(low * 1.01, distance)
    while (!feasible(high) && high < 1e12) high *= 2
    for (var iteration = 0; iteration < 44; iteration++) {
      var middle = (low + high) / 2
      if (feasible(middle)) high = middle
      else low = middle
    }
    distance = high * 1.005
    var offset = feasible(distance)
    if (offset) target.copy(origin).addScaledVector(right, offset.x).addScaledVector(up, offset.y)
    updateCamera()
  }
  function orbit(dx, dy) { yaw -= number(dx) * 0.006; pitch = Math.max(-Math.PI / 2 + 0.005, Math.min(Math.PI / 2 - 0.005, pitch + number(dy) * 0.006)); updateCamera() }
  function pan(dx, dy) {
    camera.updateMatrixWorld(true)
    var units = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, height)
    var right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    target.addScaledVector(right, -number(dx) * units).addScaledVector(up, number(dy) * units); updateCamera()
  }
  function setRay(clientX, clientY) {
    var rect = host.getBoundingClientRect()
    ndc.set((clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, -(clientY - rect.top) / Math.max(1, rect.height) * 2 + 1)
    camera.updateMatrixWorld(true); raycaster.setFromCamera(ndc, camera)
  }
  function unproject(clientX, clientY, z) {
    if (disposed) return null
    setRay(clientX, clientY)
    var plane = new T.Plane(new T.Vector3(0, 0, 1), -number(z)), point = new T.Vector3()
    if (!raycaster.ray.intersectPlane(plane, point)) return null
    return { x: point.x, y: -point.y, z: point.z }
  }
  function unprojectPlane(clientX, clientY, config) {
    if (disposed || !config || !config.point || !config.normal) return null
    var normal = world(config.normal)
    if (normal.lengthSq() < 1e-18) return null
    setRay(clientX, clientY)
    var plane = new T.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), world(config.point)), point = new T.Vector3()
    if (!raycaster.ray.intersectPlane(plane, point)) return null
    return { x: point.x, y: -point.y, z: point.z }
  }
  // A fixed view-facing plane lets a pointer move the tip without moving the
  // camera or changing the drawing plane. The controller supplies depth.
  function unprojectView(clientX, clientY, throughPoint) {
    if (disposed || !throughPoint) return null
    setRay(clientX, clientY)
    var normal = camera.getWorldDirection(new T.Vector3()), point = new T.Vector3()
    var plane = new T.Plane().setFromNormalAndCoplanarPoint(normal, world(throughPoint))
    if (!raycaster.ray.intersectPlane(plane, point)) return null
    return { x: point.x, y: -point.y, z: point.z }
  }
  function viewDirection() {
    var direction = camera.getWorldDirection(new T.Vector3())
    return { x: direction.x, y: -direction.y, z: direction.z }
  }
  function zoom(factor, clientX, clientY) {
    factor = Math.max(0.1, Math.min(10, number(factor, 1)))
    // Anchor on a fixed plane parallel to the viewport. A horizontal work
    // plane becomes nearly parallel to the ray when viewing from its edge.
    var plane = { x: target.x, y: -target.y, z: target.z }
    var anchor = Number.isFinite(clientX) && Number.isFinite(clientY) ? unprojectView(clientX, clientY, plane) : null
    distance = Math.max(8, Math.min(1000000, distance / factor)); updateCamera()
    var after = anchor ? unprojectView(clientX, clientY, plane) : null
    if (after) { target.add(world(anchor).sub(world(after))); updateCamera() }
  }
  function project(point) {
    vector.copy(world(point)).applyMatrix4(camera.matrixWorldInverse)
    var depth = -vector.z, scale = height / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.0001, depth))
    vector.copy(world(point)).project(camera)
    return { x: (vector.x + 1) * width / 2, y: (1 - vector.y) * height / 2, depth: depth, scale: scale }
  }
  function pick(clientX, clientY) {
    if (disposed) return null
    setRay(clientX, clientY)
    raycaster.params.Line.threshold = Math.max(0.5, distance * 2 * Math.tan(camera.fov * Math.PI / 360) / height * 5)
    var hits = raycaster.intersectObjects(pickables, false), chosen = null, nearestDistance = null
    for (var index = 0; index < hits.length; index++) {
      var hit = hits[index], entry = hit.object.userData.alpha
      if (nearestDistance !== null && hit.distance - nearestDistance > 1e-4) break
      if (entry && entry.alpha && hit.uv) {
        var mask = entry.alpha, x = Math.max(0, Math.min(mask.width - 1, Math.floor(hit.uv.x * mask.width))), y = Math.max(0, Math.min(mask.height - 1, Math.floor((1 - hit.uv.y) * mask.height)))
        if (mask.data[(y * mask.width + x) * 4 + 3] < 8) continue
      }
      var id = hit.object.userData.spaceId, record = records.get(id)
      if (!record) continue
      if (nearestDistance === null) nearestDistance = hit.distance
      // A frame's invisible interior acts as a container background. Give a
      // component on the same surface priority while leaving empty areas of
      // the frame selectable and preserving genuine depth occlusion.
      var isFrame = record.kind === 'frame', chosenFrame = chosen && chosen.kind === 'frame'
      if (!chosen || chosenFrame && !isFrame || chosenFrame === isFrame && record.order > chosen.order) chosen = record
    }
    return chosen ? chosen.id : null
  }
  function pickRegion(region) {
    if (disposed || !Array.isArray(region) || region.length < 3 || region.length > 10000 || region.some(function (p) { return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x), Math.abs(p.y)) > 1e7 })) return []
    resize(); content.updateMatrixWorld(true)
    var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    region.forEach(function (p) { left = Math.min(left, p.x); top = Math.min(top, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y) })
    if (right < 0 || bottom < 0 || left > width || top > height || right - left < 0.01 || bottom - top < 0.01) return []
    // Bucket polygon edges by screen Y. Long handwriting and complex lasso
    // paths then test nearby edges instead of every pair of source vertices.
    var rows = Array.from({ length: 64 }, function () { return [] }), rowSize = Math.max(1, (bottom - top) / rows.length)
    var rowAt = function (y) { return Math.max(0, Math.min(rows.length - 1, Math.floor((y - top) / rowSize))) }
    region.forEach(function (a, index) {
      var b = region[(index + 1) % region.length], edge = { a: a, b: b, left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
      for (var i = rowAt(edge.top); i <= rowAt(edge.bottom); i++) rows[i].push(edge)
    })
    function pointDistance(p, a, b) {
      var dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
    }
    function inside(p, polygon) {
      var result = false, edges = polygon ? null : rows[rowAt(p.y)]
      if (!polygon && (p.x < left || p.x > right || p.y < top || p.y > bottom)) return false
      var count = polygon ? polygon.length : edges.length
      for (var i = 0; i < count; i++) {
        var a = polygon ? polygon[i] : edges[i].a, b = polygon ? polygon[(i + 1) % count] : edges[i].b
        if (pointDistance(p, a, b) < 1e-7) return true
        if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y)) result = !result
      }
      return result
    }
    function crosses(a, b, c, d) {
      var dx = b.x - a.x, dy = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = dx * sy - dy * sx
      if (Math.abs(den) < 1e-9) return Math.min(pointDistance(a, c, d), pointDistance(b, c, d), pointDistance(c, a, b), pointDistance(d, a, b)) < 1e-7
      var qx = c.x - a.x, qy = c.y - a.y, t = (qx * sy - qy * sx) / den, u = (qx * dy - qy * dx) / den
      return t >= 0 && t <= 1 && u >= 0 && u <= 1
    }
    function intersects(points, radius) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      points.forEach(function (p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) })
      radius = radius || 0
      if (maxX + radius < left || minX - radius > right || maxY + radius < top || minY - radius > bottom) return false
      if (points.some(function (p) { return inside(p) })) return true
      if (points.length > 2 && inside(region[0], points)) return true
      var seen = new Set(), count = points.length > 2 ? points.length : 1
      for (var row = rowAt(minY - radius); row <= rowAt(maxY + radius); row++) for (var edge of rows[row]) {
        if (seen.has(edge)) continue
        seen.add(edge)
        if (edge.right < minX - radius || edge.left > maxX + radius || edge.bottom < minY - radius || edge.top > maxY + radius) continue
        for (var i = 0; i < count; i++) {
          var a = points[i], b = points[(i + 1) % points.length]
          if (crosses(a, b, edge.a, edge.b) || radius && Math.min(pointDistance(a, edge.a, edge.b), pointDistance(b, edge.a, edge.b), pointDistance(edge.a, a, b), pointDistance(edge.b, a, b)) <= radius) return true
        }
      }
      return false
    }
    var planes = [function (p) { return p.w + p.x }, function (p) { return p.w - p.x }, function (p) { return p.w + p.y }, function (p) { return p.w - p.y }, function (p) { return p.w + p.z }, function (p) { return p.w - p.z }]
    function interpolate(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t } }
    function clipPoint(x, y, z, matrix) {
      var e = matrix.elements
      return { x: e[0] * x + e[4] * y + e[8] * z + e[12], y: e[1] * x + e[5] * y + e[9] * z + e[13], z: e[2] * x + e[6] * y + e[10] * z + e[14], w: e[3] * x + e[7] * y + e[11] * z + e[15] }
    }
    function clipped(points, segment) {
      for (var plane of planes) {
        if (segment) {
          var a = points[0], b = points[1], da = plane(a), db = plane(b)
          if (da < 0 && db < 0) return []
          if (da < 0 || db < 0) { var q = interpolate(a, b, da / (da - db)); points[da < 0 ? 0 : 1] = q }
        } else {
          var next = []
          for (var i = 0; i < points.length; i++) {
            var a = points[i], b = points[(i + 1) % points.length], da = plane(a), db = plane(b)
            if (da >= 0) next.push(a)
            if ((da < 0) !== (db < 0)) next.push(interpolate(a, b, da / (da - db)))
          }
          points = next
          if (points.length < 3) return []
        }
      }
      return points.map(function (p) { return { x: (p.x / p.w + 1) * width / 2, y: (1 - p.y / p.w) * height / 2, depth: p.w } })
    }
    function alphaRuns(mask) {
      if (mask.regions) return mask.regions
      var result = [], previous = new Map()
      for (var y = 0; y < mask.height; y++) {
        var active = new Map(), x = 0
        while (x < mask.width) {
          while (x < mask.width && mask.data[(y * mask.width + x) * 4 + 3] < 8) x++
          var start = x
          while (x < mask.width && mask.data[(y * mask.width + x) * 4 + 3] >= 8) x++
          if (x === start) continue
          var key = start + ':' + x, run = previous.get(key)
          if (run) run.bottom = y + 1
          else { run = { left: start, right: x, top: y, bottom: y + 1 }; result.push(run) }
          active.set(key, run)
        }
        previous = active
      }
      mask.regions = result; return result
    }
    var viewProjection = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse), found = []
    function hitObject(object) {
      if (!object.visible || !object.geometry || object.userData.selection) return false
      var materials = Array.isArray(object.material) ? object.material : [object.material]
      if (!materials.some(function (m) { return m && m.visible && m.opacity !== 0 })) return false
      var geometry = object.geometry, position = geometry.attributes.position, matrix = viewProjection.clone().multiply(object.matrixWorld), entry = object.userData.alpha
      if (!position) return false
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      var box = geometry.boundingBox, corners = []
      for (var x of [box.min.x, box.max.x]) for (var y of [box.min.y, box.max.y]) for (var z of [box.min.z, box.max.z]) corners.push(clipPoint(x, y, z, matrix))
      if (planes.some(function (plane) { return corners.every(function (p) { return plane(p) < 0 }) })) return false
      // A projected box is only a conservative rejection. Final hits always
      // use the source triangles/segments or nontransparent texture pixels.
      if (corners.every(function (p) { return p.w > camera.near })) {
        var xs = corners.map(function (p) { return (p.x / p.w + 1) * width / 2 }), ys = corners.map(function (p) { return (1 - p.y / p.w) * height / 2 })
        var margin = object.isLine ? Math.max(1.5, number(object.userData.spaceStrokeWidth, 1) * height * camera.projectionMatrix.elements[5] / Math.min.apply(Math, corners.map(function (p) { return p.w })) / 4) : 0
        if (Math.max.apply(Math, xs) + margin < left || Math.min.apply(Math, xs) - margin > right || Math.max.apply(Math, ys) + margin < top || Math.min.apply(Math, ys) - margin > bottom) return false
      }
      function vertex(index) { return clipPoint(position.getX(index), position.getY(index), position.getZ(index), matrix) }
      if (entry && entry.alpha && geometry.type === 'PlaneGeometry') {
        var mask = entry.alpha, w = geometry.parameters.width, h = geometry.parameters.height
        for (var run of alphaRuns(mask)) {
          var x0 = (run.left / mask.width - .5) * w, x1 = (run.right / mask.width - .5) * w, y0 = (.5 - run.top / mask.height) * h, y1 = (.5 - run.bottom / mask.height) * h
          var quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(function (p) { return clipPoint(p[0], p[1], 0, matrix) })
          var visible = clipped(quad, false)
          if (visible.length && intersects(visible)) return true
        }
        return false
      }
      var index = geometry.index, total = index ? index.count : position.count, start = geometry.drawRange.start || 0, end = Math.min(total, start + geometry.drawRange.count)
      function at(i) { return vertex(index ? index.getX(i) : i) }
      if (object.isLine) {
        for (var i = start, step = object.isLineSegments ? 2 : 1; i + 1 < end; i += step) {
          var a = at(i), b = at(i + 1), line = clipped([a, b], true)
          var pixels = line.length ? Math.max(1.5, number(object.userData.spaceStrokeWidth, 1) * height * camera.projectionMatrix.elements[5] / Math.max(camera.near, Math.min(line[0].depth, line[1].depth)) / 4) : 0
          if (line.length && intersects(line, pixels)) return true
        }
      } else if (object.isMesh) {
        for (var i = start; i + 2 < end; i += 3) {
          var triangle = clipped([at(i), at(i + 1), at(i + 2)], false)
          if (triangle.length && intersects(triangle)) return true
        }
      }
      return false
    }
    records.forEach(function (record) {
      // Invisible click-only interiors and all decoration/placement objects
      // stay out of area selection; a frame is selected by its actual border.
      if (record.group.visible && record.hits.some(hitObject)) found.push(record)
    })
    return found.sort(function (a, b) { return a.order - b.order }).map(function (record) { return record.id })
  }
  function centerGrid() {
    if (!grid) return
    var step = grid.userData.step
    grid.position.set(Math.round(target.x / step) * step, Math.round(target.y / step) * step, 0)
  }
  function setPlane(z, visible, step) {
    workZ = number(z); step = Math.max(10, number(step, 100))
    var signature = [workZ, !!visible, step].join('|')
    if (signature === previousGrid) return
    previousGrid = signature; removeObject(grid); grid = null
    if (visible) {
      var points = [], extent = step * 30
      for (var index = -30; index <= 30; index++) {
        var offset = index * step
        points.push(new T.Vector3(-extent, offset, workZ - 0.4), new T.Vector3(extent, offset, workZ - 0.4), new T.Vector3(offset, -extent, workZ - 0.4), new T.Vector3(offset, extent, workZ - 0.4))
      }
      grid = new T.LineSegments(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: '#cad3e3', transparent: true, opacity: 0.6, depthWrite: false }))
      grid.userData.step = step; decoration.add(grid); centerGrid()
    }
    invalidate()
  }
  function preview(points, closed) {
    var signature = JSON.stringify([points || null, !!closed])
    if (signature === previewSignature) return
    previewSignature = signature
    removeObject(previewObject); previewObject = null
    if (points && points.length) {
      var vertices = points.map(world)
      if (closed && vertices.length > 1) vertices.push(vertices[0].clone())
      previewObject = line(vertices, '#6366f1', true); decoration.add(previewObject)
    }
    invalidate()
  }
  function buildManipulator(mode) {
    removeObject(manipulatorObject); manipulatorHits = []
    manipulatorObject = new T.Group(); manipulatorObject.name = 'space-manipulator'; decoration.add(manipulatorObject)
    var axes = [{ axis: 'x', direction: new T.Vector3(1, 0, 0), color: '#ef4444' }, { axis: 'y', direction: new T.Vector3(0, -1, 0), color: '#22c55e' }, { axis: 'z', direction: new T.Vector3(0, 0, 1), color: '#3b82f6' }]
    axes.forEach(function (axis) {
      if (mode === 'extrude' && axis.axis !== 'z') return
      function addHandle(object) {
        object.userData.manipulatorAxis = axis.axis; object.renderOrder = 50; object.frustumCulled = false
        manipulatorObject.add(object); manipulatorHits.push(object)
      }
      var style = function () { return material(axis.color, { depthTest: false, depthWrite: false }) }
      if (mode === 'rotate') {
        var ring = new T.Mesh(new T.TorusGeometry(64, 2.6, 8, 96), style())
        ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), axis.direction)
        addHandle(ring)
      } else {
        var shaft = new T.Mesh(new T.CylinderGeometry(1.7, 1.7, 60, 10), style())
        shaft.position.copy(axis.direction).multiplyScalar(42); shaft.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.direction)
        addHandle(shaft)
        var head = new T.Mesh(new T.ConeGeometry(5.5, 16, 12), style())
        head.position.copy(axis.direction).multiplyScalar(76); head.quaternion.copy(shaft.quaternion)
        addHandle(head)
      }
    })
  }
  function updateManipulatorPresentation() {
    if (!manipulatorObject || !manipulatorState) return
    var point = world(manipulatorState.center)
    manipulatorObject.position.copy(point)
    manipulatorObject.scale.setScalar(penUnits(point) * manipulatorState.size / 84)
    if (manipulatorState.mode === 'extrude') manipulatorObject.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), world(manipulatorState.normal).normalize())
    else manipulatorObject.rotation.set(0, 0, 0)
    manipulatorObject.updateMatrixWorld(true)
  }
  function setManipulator(config) {
    if (disposed) return
    if (!config) {
      if (!manipulatorObject) return
      removeObject(manipulatorObject); manipulatorObject = null; manipulatorState = null; manipulatorHits = []; manipulatorSignature = ''; invalidate(); return
    }
    var normal = world(config.normal || { x: 0, y: 0, z: 1 })
    if (normal.lengthSq() < 1e-18) normal.set(0, 0, 1)
    normal.normalize()
    var next = { center: { x: number(config.center && config.center.x), y: number(config.center && config.center.y), z: number(config.center && config.center.z) }, mode: ['move', 'rotate', 'extrude'].indexOf(config.mode) >= 0 ? config.mode : 'move', size: Math.max(24, Math.min(240, number(config.size, 84))), normal: { x: normal.x, y: -normal.y, z: normal.z } }
    var signature = JSON.stringify(next)
    if (signature === manipulatorSignature) return
    if (!manipulatorObject || !manipulatorState || manipulatorState.mode !== next.mode) buildManipulator(next.mode)
    manipulatorState = next; manipulatorSignature = signature; updateManipulatorPresentation(); invalidate()
  }
  function pickManipulator(clientX, clientY) {
    if (disposed || !manipulatorObject || !manipulatorState || project(manipulatorState.center).depth <= 0) return null
    setRay(clientX, clientY); manipulatorObject.updateMatrixWorld(true)
    var hits = raycaster.intersectObjects(manipulatorHits, false)
    return hits.length ? { mode: manipulatorState.mode, axis: hits[0].object.userData.manipulatorAxis } : null
  }
  function penTexture(label) {
    var raster = document.createElement('canvas'), size = label ? 64 : 128
    raster.width = raster.height = size
    var context = raster.getContext('2d')
    if (label) {
      context.fillStyle = '#ecfeff'; context.beginPath(); context.arc(32, 32, 29, 0, Math.PI * 2); context.fill()
      context.strokeStyle = '#45b9d2'; context.lineWidth = 3; context.stroke()
      context.fillStyle = '#155e75'; context.font = 'bold 36px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, 32, 33)
    } else {
      var glow = context.createRadialGradient(64, 64, 0, 64, 64, 64)
      glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(0.12, 'rgba(140,245,255,.9)'); glow.addColorStop(0.35, 'rgba(55,211,255,.28)'); glow.addColorStop(1, 'rgba(55,211,255,0)')
      context.fillStyle = glow; context.fillRect(0, 0, size, size)
    }
    var texture = new T.CanvasTexture(raster); texture.colorSpace = T.SRGBColorSpace
    penRigTextures.push(texture)
    return texture
  }
  function buildPenRig() {
    if (penRigObject || disposed) return
    penRigObject = new T.Group(); penRigObject.name = 'four-anchor-space-pen'; decoration.add(penRigObject)
    var colors = ['#29b8d2', '#59c5ee', '#9f95f2', '#bb8fe5'], positions = new Float32Array(24), vertexColors = new Float32Array(24)
    colors.forEach(function (color, index) { var value = new T.Color(color); for (var end = 0; end < 2; end++) { vertexColors[(index * 2 + end) * 3] = value.r; vertexColors[(index * 2 + end) * 3 + 1] = value.g; vertexColors[(index * 2 + end) * 3 + 2] = value.b } })
    var beamGeometry = new T.BufferGeometry()
    beamGeometry.setAttribute('position', new T.BufferAttribute(positions, 3)); beamGeometry.setAttribute('color', new T.BufferAttribute(vertexColors, 3))
    // A translucent core keeps the laser readable on the light paper; its
    // additive pass and wide faint envelope supply the optical glow.
    var beams = new T.LineSegments(beamGeometry, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthTest: false, depthWrite: false }))
    var beamLight = new T.LineSegments(beamGeometry, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }))
    beamLight.frustumCulled = false; beamLight.renderOrder = 32; penRigObject.add(beamLight)
    beams.frustumCulled = false; beams.renderOrder = 31; penRigObject.add(beams)
    var glowTexture = penTexture(), anchorParts = [], beamGlows = []
    colors.forEach(function (color, index) {
      var glow = new T.Mesh(new T.CylinderGeometry(1, 1, 1, 6, 1, true), material(color, { transparent: true, opacity: 0.09, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }))
      glow.frustumCulled = false; glow.renderOrder = 30; penRigObject.add(glow); beamGlows.push(glow)
      var anchor = new T.Group(), core = new T.Mesh(new T.SphereGeometry(2.5, 12, 8), material(color, { depthTest: false, depthWrite: false }))
      var ring = new T.Mesh(new T.TorusGeometry(6, 0.65, 5, 28), material(color, { transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }))
      var halo = new T.Sprite(new T.SpriteMaterial({ map: glowTexture, color: color, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }))
      halo.scale.set(25, 25, 1); anchor.add(core, ring, halo); anchor.renderOrder = core.renderOrder = ring.renderOrder = halo.renderOrder = 32
      var label = new T.Sprite(new T.SpriteMaterial({ map: penTexture('ABCD'[index]), transparent: true, depthTest: false, depthWrite: false }))
      label.renderOrder = 33; penRigObject.add(anchor, label); anchorParts.push({ group: anchor, ring: ring, label: label })
    })
    var tip = new T.Group(), tipCore = new T.Mesh(new T.SphereGeometry(3.2, 16, 12), material('#e9ffff', { depthTest: false, depthWrite: false }))
    var tipRing = new T.Mesh(new T.TorusGeometry(10, 0.9, 6, 40), material('#08b6d5', { transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }))
    var tipHalo = new T.Sprite(new T.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0.78, depthTest: false, depthWrite: false, blending: T.AdditiveBlending }))
    tipHalo.scale.set(49, 49, 1)
    // The short stylus has a physical shaft and a luminous nib, distinct from
    // selection arrows. Its world orientation stays fixed while orbiting.
    var shaftDirection = new T.Vector3(0.33, -0.22, 1).normalize()
    var shaft = new T.Mesh(new T.CylinderGeometry(2.5, 1.7, 37, 12), material('#22586e', { depthTest: false, depthWrite: false }))
    shaft.position.copy(shaftDirection).multiplyScalar(25); shaft.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), shaftDirection)
    var nib = new T.Mesh(new T.ConeGeometry(2.2, 9, 12), material('#53e2f4', { depthTest: false, depthWrite: false }))
    nib.position.copy(shaftDirection).multiplyScalar(5); nib.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), shaftDirection)
    var cap = new T.Mesh(new T.SphereGeometry(2.6, 12, 8), material('#8ce8f5', { depthTest: false, depthWrite: false }))
    cap.position.copy(shaftDirection).multiplyScalar(44)
    tip.add(shaft, nib, cap, tipHalo, tipRing, tipCore); tip.traverse(function (part) { part.renderOrder = 35 }); penRigObject.add(tip)
    penRigParts = { beams: beams, beamGlows: beamGlows, anchors: anchorParts, tip: tip, tipRing: tipRing, tipHalo: tipHalo, tipCore: tipCore }
  }
  function penUnits(point) {
    var p = point.clone().applyMatrix4(camera.matrixWorldInverse)
    return Math.max(0.001, -p.z) * 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, height)
  }
  function updatePenRigPresentation() {
    if (!penRigObject || !penRigParts) return
    penRigObject.visible = penRig.visible
    if (!penRig.visible) return
    var tip = world(penRig.tip), scale = penUnits(tip), right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    penRigParts.tip.position.copy(tip); penRigParts.tip.scale.setScalar(scale); penRigParts.tipRing.quaternion.copy(camera.quaternion)
    penRigParts.tipRing.material.color.set(penRig.drawing ? '#ec4a9b' : '#08b6d5')
    penRigParts.beams.material.opacity = penRig.drawing ? 0.9 : 0.72
    penRigParts.tipCore.material.color.set(penRig.drawing ? '#fff0fa' : '#e9ffff'); penRigParts.tipHalo.material.opacity = penRig.drawing ? 1 : 0.78
    penRigParts.anchors.forEach(function (part, index) {
      var anchor = world(penRig.anchors[index]), unit = penUnits(anchor), glow = penRigParts.beamGlows[index], delta = tip.clone().sub(anchor), length = delta.length()
      part.group.position.copy(anchor); part.group.scale.setScalar(unit); part.ring.quaternion.copy(camera.quaternion)
      part.label.position.copy(anchor).addScaledVector(right, unit * 13).addScaledVector(up, unit * 13); part.label.scale.set(17 * unit, 17 * unit, 1)
      glow.position.copy(anchor).lerp(tip, 0.5); glow.scale.set((unit + scale) * 1.25, Math.max(0.001, length), (unit + scale) * 1.25)
      if (length > 0.0001) glow.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize())
      glow.visible = length > 0.0001
    })
  }
  function setPenRig(value) {
    if (disposed) return
    value = value || {}
    function point(p) { return { x: number(p && p.x), y: number(p && p.y), z: number(p && p.z) } }
    var anchors = Array.isArray(value.anchors) && value.anchors.length === 4 ? value.anchors.map(point) : penRig.anchors
    var next = { visible: (value.visible == null ? penRig.visible : !!value.visible) && anchors.length === 4, drawing: value.drawing == null ? penRig.drawing : !!value.drawing, tip: value.tip ? point(value.tip) : penRig.tip, anchors: anchors }
    var signature = JSON.stringify(next)
    if (signature === penRigSignature) return
    penRigSignature = signature; next.lengths = anchors.map(function (anchor) { return world(anchor).distanceTo(world(next.tip)) }); penRig = next
    if (next.visible) buildPenRig()
    if (penRigParts && anchors.length === 4) {
      var positions = penRigParts.beams.geometry.getAttribute('position')
      anchors.forEach(function (anchor, index) { var a = world(anchor), b = world(next.tip); positions.setXYZ(index * 2, a.x, a.y, a.z); positions.setXYZ(index * 2 + 1, b.x, b.y, b.z) })
      positions.needsUpdate = true
    }
    updatePenRigPresentation(); invalidate()
  }
  function pickPen(clientX, clientY) {
    if (disposed || !penRig.visible) return null
    var position = project(penRig.tip), rect = host.getBoundingClientRect()
    if (position.depth <= 0 || position.x < -20 || position.y < -20 || position.x > width + 20 || position.y > height + 20) return null
    var dx = clientX - rect.left - position.x * rect.width / width, dy = clientY - rect.top - position.y * rect.height / height, pixels = Math.hypot(dx, dy)
    return pixels <= 20 ? { tip: Object.assign({}, penRig.tip), distance: pixels } : null
  }
  function penRigInfo() {
    function copy(p) { return { x: p.x, y: p.y, z: p.z } }
    function native(p) { return { x: p.x, y: -p.y, z: p.z } }
    return { visible: penRig.visible, drawing: penRig.drawing, tip: copy(penRig.tip), anchors: penRig.anchors.map(copy), lengths: penRig.lengths.slice(), world: { tip: native(penRig.tip), anchors: penRig.anchors.map(native) } }
  }
  function manipulatorInfo() {
    return manipulatorState ? { center: Object.assign({}, manipulatorState.center), mode: manipulatorState.mode, size: manipulatorState.size, normal: Object.assign({}, manipulatorState.normal) } : null
  }
  function onLost(event) { event.preventDefault(); if (options.onContextLost) options.onContextLost(Error('三维绘图上下文已丢失，请切回平面后重试')) }
  canvas.addEventListener('webglcontextlost', onLost)
  resize(); updateCamera()
  return {
    canvas: canvas, camera: camera, sync: sync, draw: draw, resize: resize, captureRecognition: captureRecognition, fit: fit, fitPenRig: fitPenRig, orbit: orbit, pan: pan, zoom: zoom,
    project: project, unproject: unproject, unprojectPlane: unprojectPlane, unprojectView: unprojectView, viewDirection: viewDirection, pick: pick, pickRegion: pickRegion, pickPen: pickPen, pickManipulator: pickManipulator, setPlane: setPlane, preview: preview, setPenRig: setPenRig, setPlacement: setPlacement, setManipulator: setManipulator,
    info: function () { return { engine: 'three-webgl', elements: records.size, textures: textures.size, textureBytes: textureBytes, textureDensity: textureDensity, gridCenter: grid ? { x: grid.position.x, y: -grid.position.y, z: workZ } : null, gridStep: grid ? grid.userData.step : null, pendingImages: imageJobs, revision: epoch, drawCalls: renderer.info.render.calls, geometries: renderer.info.memory.geometries, distance: distance, yaw: yaw, pitch: pitch, target: { x: target.x, y: -target.y, z: target.z }, penRig: penRigInfo(), placement: placementState ? Object.assign({}, placementState) : null, manipulator: manipulatorInfo() } },
    dispose: function () {
      if (disposed) return
      disposed = true; canvas.removeEventListener('webglcontextlost', onLost)
      records.forEach(releaseRecord); records.clear(); pickables = []
      if (placementRecord) { releaseRecord(placementRecord); placementRecord = null; placementState = null }
      manipulatorState = null; manipulatorObject = null; manipulatorHits = []
      pruneTextures(true)
      removeObject(decoration); penRigTextures.forEach(function (texture) { texture.dispose() }); penRigTextures = []; renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    }
  }
}
