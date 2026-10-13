import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { localToWorld, worldToLocal, resizeHandles, resizeElement, movePolygonVertex, rotateElement, cutPolyline, erasePen, drawingClientSource } from '../lib/drawing.js'
import { boardDiagnostics } from '../lib/board.js'

const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-8, message + ': ' + actual + ' ≈ ' + expected)
const pointNear = (actual, expected) => { near(actual.x, expected[0]); near(actual.y, expected[1]) }
const worldPoints = e => e.points.map(([x, y]) => localToWorld(e, { x: e.x + x * e.width, y: e.y + y * e.height }))
const metadata = () => ({
  text: '处理输入并描述边界', math: 'y = x', mathExpressions: [{ id: 'constraint', value: 'x ≥ 0', evidence: { preserve: true } }],
  implementation: { language: 'JavaScript', code: 'return input;', unknown: { preserve: true } },
  anchors: [{ file: 'src/input.js', sha256: 'a'.repeat(64), extra: { preserve: true } }], targets: [{ kind: 'organ', id: 'input' }],
  extension: { nested: ['保留', 2] }, stroke: '#1e293b', strokeWidth: 3, fill: 'none'
})
const box = () => ({ id: 'part', type: 'rect', x: 6, y: 18, width: 8, height: 4, rotation: 90, ...metadata() })

test('局部与世界坐标互为逆变换，8个缩放手柄均在实际旋转边界', () => {
  const e = box(), before = JSON.stringify(e), handles = resizeHandles(e)
  assert.deepEqual(handles.map(h => h.handle), ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'])
  pointNear(handles[0], [12, 16]); pointNear(handles[4], [8, 24])
  const p = { x: 7, y: 19 }, world = localToWorld(e, p), back = worldToLocal(e, world)
  pointNear(back, [p.x, p.y]); assert.equal(JSON.stringify(e), before)
})

test('旋转缩放跨轴保持相反锚点，非对称多边形顶点随几何反射而非漂移', () => {
  const e = { ...box(), type: 'polygon', points: [[0, 0], [1, 1], [.25, .4]] }, before = JSON.stringify(e)
  const resized = resizeElement(e, 'se', { x: 9, y: 10 })
  near(resized.x, 7.5); near(resized.y, 11.5); near(resized.width, 6); near(resized.height, 3)
  assert.equal(resized.rotation, 90)
  const points = worldPoints(resized)
  pointNear(points[0], [12, 16]); pointNear(points[1], [9, 10]); pointNear(points[2], [10.8, 14.5])
  for (const key of Object.keys(metadata())) assert.deepEqual(resized[key], e[key], key)
  assert.equal(JSON.stringify(e), before)
})

test('比例缩放使用最近比例射线，中心缩放锁中心，禁止翻面时尺寸仍有效', () => {
  const e = box(), fixed = { x: 12, y: 16 }
  // Local pointer displacement (-6, 4) from the fixed corner.
  const resized = resizeElement(e, 'se', { x: fixed.x - 4, y: fixed.y - 6 }, { keepAspect: true })
  near(resized.width, 6.4); near(resized.height, 3.2)
  near(resized.x + resized.width / 2, 10.4); near(resized.y + resized.height / 2, 12.8)
  const centered = resizeElement(e, 'se', { x: 7, y: 26 }, { fromCenter: true })
  near(centered.x + centered.width / 2, 10); near(centered.y + centered.height / 2, 20)
  near(centered.width, 12); near(centered.height, 6)
  const clamped = resizeElement(e, 'se', { x: 9, y: 10 }, { allowFlip: false, minSize: 2 })
  near(clamped.width, 2); near(clamped.height, 3)
  pointNear(resizeHandles(clamped)[0], [12, 16])
})

test('8方向缩放的对侧锚点均固定，边手柄不改变另一轴', () => {
  const e = box(), handles = resizeHandles(e), opposite = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' }
  for (const h of handles) {
    const center = { x: 10, y: 20 }, pointer = { x: center.x + (h.x - center.x) * 1.5, y: center.y + (h.y - center.y) * 1.5 }
    const resized = resizeElement(e, h.handle, pointer), fixed = handles.find(a => a.handle === opposite[h.handle]), after = resizeHandles(resized).find(a => a.handle === opposite[h.handle])
    pointNear(after, [fixed.x, fixed.y])
    if (['n', 's'].includes(h.handle)) near(resized.width, e.width)
    if (['e', 'w'].includes(h.handle)) near(resized.height, e.height)
  }
})

test('多边形单顶点重建包围盒后其他世界顶点不动，旋转与映射完整保留', () => {
  const e = { id: 'triangle', type: 'polygon', x: 0, y: 0, width: 4, height: 2, rotation: 90, points: [[0, 0], [1, 0], [0, 1]], ...metadata() }
  const before = JSON.stringify(e), moved = movePolygonVertex(e, 0, { x: 7, y: -5 }), points = worldPoints(moved)
  near(moved.x, 0); near(moved.y, -4); near(moved.width, 8); near(moved.height, 6)
  pointNear(points[0], [7, -5]); pointNear(points[1], [3, 3]); pointNear(points[2], [1, -1])
  for (const key of Object.keys(metadata())) assert.deepEqual(moved[key], e[key], key)
  assert.equal(JSON.stringify(e), before)
})

test('多边形顶点拖成共线仍保持正包围盒与有限归一化坐标', () => {
  const e = { id: 'triangle', type: 'polygon', x: 0, y: 0, width: 4, height: 2, rotation: 90, points: [[0, 1], [0, 0], [1, 0]] }
  const moved = movePolygonVertex(e, 0, { x: 3, y: 1 })
  assert.ok(moved.width > 0 && moved.height > 0)
  assert.ok(moved.points.flat().every(Number.isFinite))
  worldPoints(moved).forEach((p, i) => pointNear(p, [[3, 1], [3, -1], [3, 3]][i]))
  assert.deepEqual(boardDiagnostics({ version: 1, elements: [moved] }), [])
})

test('旋转支持初始指针偏移、跨正负180度和角度吸附，中心与映射不变', () => {
  const e = { ...box(), rotation: 25 }, before = JSON.stringify(e)
  const turned = rotateElement(e, { x: 20, y: 20 }, { start: { x: 10, y: 10 }, snap: 15 })
  assert.equal(turned.rotation, 120)
  for (const key of ['x', 'y', 'width', 'height', ...Object.keys(metadata())]) assert.deepEqual(turned[key], e[key], key)
  const anglePoint = angle => ({ x: 10 + Math.cos(angle * Math.PI / 180) * 10, y: 20 + Math.sin(angle * Math.PI / 180) * 10 })
  const crossing = rotateElement({ ...e, rotation: 0 }, anglePoint(-179), { start: anglePoint(179) })
  near(crossing.rotation, 2)
  assert.deepEqual(rotateElement(e, { x: 10, y: 20 }), e)
  assert.equal(JSON.stringify(e), before)
})

test('圆橡皮精确切到两个采样顶点之间，完全擦除与相切分别返回空和原曲线', () => {
  const cut = cutPolyline([[-100, 0], [100, 0]], { x: 0, y: 0, radius: 10 })
  assert.equal(cut.changed, true); assert.equal(cut.fragments.length, 2)
  pointNear(cut.fragments[0][0], [-100, 0]); pointNear(cut.fragments[0][1], [-10, 0])
  pointNear(cut.fragments[1][0], [10, 0]); pointNear(cut.fragments[1][1], [100, 0])
  const full = cutPolyline([[-1, 0], [1, 0]], { x: 0, y: 0, radius: 2 })
  assert.equal(full.changed, true); assert.deepEqual(full.fragments, [])
  const tangent = cutPolyline([[-3, 1], [3, 1]], { x: 0, y: 0, radius: 1 })
  assert.equal(tangent.changed, false); assert.equal(tangent.fragments.length, 1)
})

test('高速橡皮按整段圆头扫掠切开，圆帽命中和零长度扫掠都正确', () => {
  const cap = cutPolyline([[1.6, -3], [1.6, 3]], { from: { x: -1, y: 0 }, x: 1, y: 0, radius: 1 })
  assert.equal(cap.fragments.length, 2)
  pointNear(cap.fragments[0].at(-1), [1.6, -.8]); pointNear(cap.fragments[1][0], [1.6, .8])
  const fast = cutPolyline([[0, -100], [0, 100]], { from: { x: -100, y: 0 }, x: 100, y: 0, radius: 2 })
  pointNear(fast.fragments[0].at(-1), [0, -2]); pointNear(fast.fragments[1][0], [0, 2])
  const dot = cutPolyline([[0, 0], [0, 0]], { x: 0, y: 0, radius: 1 })
  assert.equal(dot.changed, true); assert.deepEqual(dot.fragments, [])
})

test('回折笔迹按原路径参数切开，不因世界端点重合而穿过已擦除区域连接', () => {
  const result = cutPolyline([[-3, 0], [0, 0], [3, 0], [0, 0], [-3, 0]], { x: 0, y: 0, radius: 1 })
  assert.equal(result.fragments.length, 3)
  assert.deepEqual(result.fragments.map(fragment => fragment.map(p => [p.x, p.y])), [[[-3, 0], [-1, 0]], [[1, 0], [3, 0], [1, 0]], [[-1, 0], [-3, 0]]])
})

test('旋转笔迹切片保留第一id与全部源码映射，其他片标记同一来源并去掉旧整笔识别证据', () => {
  const e = { id: 'ink', type: 'pen', x: -4, y: -1, width: 8, height: 2, rotation: 45, points: [[0, .5], [1, .5]], ...metadata(), handwriting: { mode: 'text', strokes: [[[0, 0], [100, 100]]] }, mathHandwriting: { reviewed: true } }
  const before = JSON.stringify(e), s = 1 / Math.sqrt(2)
  const result = erasePen(e, { from: { x: s, y: -s }, x: -s, y: s, radius: 1 }, () => 'fragment-2')
  assert.equal(result.changed, true); assert.equal(result.fragments.length, 2)
  assert.deepEqual(result.fragments.map(f => f.id), ['ink', 'fragment-2'])
  result.fragments.forEach(fragment => {
    assert.equal(fragment.fragmentOf, 'ink'); assert.equal(fragment.handwriting, undefined); assert.equal(fragment.mathHandwriting, undefined)
    for (const key of Object.keys(metadata())) assert.deepEqual(fragment[key], e[key], key)
  })
  pointNear(worldPoints(result.fragments[0]).at(-1), [-s, -s]); pointNear(worldPoints(result.fragments[1])[0], [s, s])
  assert.deepEqual(boardDiagnostics({ version: 1, elements: result.fragments }, [{ id: 'input' }]), [])
  assert.equal(JSON.stringify(e), before)
})

test('无命中不重写笔迹包围盒和证据，再擦片段沿用原来源，非法新id不污染原对象', () => {
  const e = { id: 'piece', fragmentOf: 'original', type: 'pen', x: -3, y: -.5, width: 6, height: 1, rotation: 0, points: [[0, .5], [1, .5]], ...metadata(), handwriting: { keep: true } }
  const missed = erasePen(e, { x: 0, y: 10, radius: 1 })
  assert.equal(missed.changed, false); assert.deepEqual(missed.fragments, [e]); assert.notEqual(missed.fragments[0], e)
  const before = JSON.stringify(e), cut = erasePen(e, { x: 0, y: 0, radius: 1 }, () => 'next')
  assert.ok(cut.fragments.every(f => f.fragmentOf === 'original'))
  assert.throws(() => erasePen(e, { x: 0, y: 0, radius: 1 }, () => e.id), /唯一/)
  assert.equal(JSON.stringify(e), before)
})

test('合法原笔迹显示的pen切开后失效旧识别和显示引用，每个剩片仍通过完整画板校验', () => {
  const ink = value => ({ mode: 'math', strokes: [[[10, 10], [100, 100]]], reviewedValue: value, candidate: { text: value, extension: { preserve: true } } })
  const e = {
    id: 'ink-display', type: 'pen', x: -3, y: -.5, width: 6, height: 1, rotation: 0, points: [[0, .5], [1, .5]], ...metadata(),
    mathDisplay: 'ink', mathHandwriting: ink('y = x'),
    recognition: { mode: 'math', text: 'y = x', reviewed: true, stale: false, extension: { preserve: true }, rawElements: [{ id: 'source', points: [[0, 0], [1, 1]] }] },
    mathExpressions: [
      { id: 'raw-extra', value: 'x ≥ 0', display: 'ink', handwriting: ink('x ≥ 0'), extension: { preserve: true } },
      { id: 'typeset-extra', value: 'z = y', display: 'typeset', handwriting: ink('z = y'), extension: { preserve: true } }
    ]
  }
  const diagnostics = elements => boardDiagnostics({ version: 1, elements }, [{ id: 'input' }])
  assert.deepEqual(diagnostics([e]), [])
  const before = JSON.stringify(e), cut = erasePen(e, { x: 0, y: 0, radius: 1 }, () => 'ink-remainder')
  assert.equal(cut.fragments.length, 2)
  for (const fragment of cut.fragments) {
    assert.equal(fragment.mathDisplay, undefined)
    assert.equal(fragment.handwriting, undefined)
    assert.equal(fragment.mathHandwriting, undefined)
    assert.deepEqual(fragment.recognition, { ...e.recognition, stale: true })
    assert.equal(fragment.mathExpressions[0].display, undefined)
    assert.deepEqual(fragment.mathExpressions[0].handwriting, e.mathExpressions[0].handwriting)
    assert.deepEqual(fragment.mathExpressions[0].extension, e.mathExpressions[0].extension)
    assert.deepEqual(fragment.mathExpressions[1], e.mathExpressions[1])
    for (const key of ['implementation', 'anchors', 'targets', 'extension']) assert.deepEqual(fragment[key], e[key])
  }
  assert.deepEqual(diagnostics(cut.fragments), [])
  assert.equal(JSON.stringify(e), before)
  const missed = erasePen(e, { x: 0, y: 10, radius: 1 })
  assert.equal(missed.changed, false); assert.deepEqual(missed.fragments[0], e)
})

test('纯绘图helpers在浏览器源码中自包含，非法坐标不能产生NaN几何', () => {
  const e = box(), context = { structuredClone, e }
  vm.runInNewContext(drawingClientSource() + '; output=resizeElement(e,"se",{x:8,y:28});', context)
  near(context.output.width, 12); near(context.output.height, 4)
  assert.throws(() => resizeElement(e, 'none', { x: 0, y: 0 }), /手柄/)
  assert.throws(() => movePolygonVertex({ ...e, type: 'polygon', points: [[0, 0], [1, 0], [0, 1]] }, 3, { x: 0, y: 0 }), /顶点/)
  assert.throws(() => rotateElement(e, { x: NaN, y: 0 }), /有限/)
  assert.throws(() => cutPolyline([[0, 0], [1, 1]], { x: 0, y: 0, radius: 0 }), /半径/)
})
