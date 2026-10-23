import test from 'node:test'
import assert from 'node:assert/strict'
import { appendSurfaceErasure, surfaceErased, surfaceErasureDiagnostics, MAX_SURFACE_ERASURE_POINTS } from '../lib/surface.js'
import { boardDiagnostics, elementProgram, moveElements } from '../lib/board.js'

const card = () => ({ id: 'part', type: 'rect', x: 20, y: 30, width: 200, height: 100, text: '部位说明', anchors: [{ file: 'src/part.js' }], implementation: { note: '保留关联' } })

test('surface erasure follows the whole capsule and remains independent of paint order', () => {
  const e = card()
  appendSurfaceErasure(e, { points: [[.1, .5], [.9, .5]], radius: [.1, .2] })
  assert.equal(surfaceErased(e, [.5, .5]), true)
  assert.equal(surfaceErased(e, [.1, .68]), true)
  assert.equal(surfaceErased(e, [.5, .75]), false)
  assert.equal(surfaceErased(e, [.5, .5], 'label'), false)
  assert.equal(surfaceErased(card(), [.5, .5]), false, 'new paint does not inherit earlier holes')
})

test('3D eraser removes a local volume while planar strokes cut through depth', () => {
  const e = card()
  appendSurfaceErasure(e, { points: [[.5, .5, 1]], radius: [.1, .2, .1] })
  assert.equal(surfaceErased(e, [.5, .5, .95]), true)
  assert.equal(surfaceErased(e, [.5, .5, .2]), false)
  appendSurfaceErasure(e, { points: [[.2, .2]], radius: [.05, .05] })
  assert.equal(surfaceErased(e, [.2, .2, 100]), true)
})

test('local holes survive moving, resizing and mapping extraction without replacing a part', () => {
  const e = card(), original = structuredClone(e)
  appendSurfaceErasure(e, { points: [[.5, .5]], radius: [.1, .2] })
  const board = { version: 1, elements: [e] }
  moveElements(board, new Set([e.id]), 70, 80); e.width *= 2; e.rotation = 35
  assert.equal(e.id, original.id); assert.equal(e.text, original.text)
  assert.deepEqual(e.anchors, original.anchors); assert.deepEqual(e.implementation, original.implementation)
  assert.equal(surfaceErased(e, [.5, .5]), true)
  assert.deepEqual(elementProgram(e).erasures, e.erasures)
  assert.deepEqual(boardDiagnostics(board), [])
})

test('formula surface changes invalidate the old review and keep the original pixels', () => {
  const e = { ...card(), image: { src: 'original' }, formulaGraphic: { semanticStatus: 'reviewed', currentMath: 'x', review: { visualHash: 'old' }, edits: [] } }
  appendSurfaceErasure(e, { points: [[.5, .5]], radius: [.1, .1] })
  assert.equal(e.formulaGraphic.semanticStatus, 'needs-review')
  assert.equal(e.formulaGraphic.currentMath, null); assert.equal(e.formulaGraphic.review, undefined)
  assert.equal(e.formulaGraphic.edits.length, 1); assert.equal(e.image.src, 'original')
})

test('erasure validation rejects invalid geometry before changing the document', () => {
  for (const stroke of [{ points: [[.5, .5]], radius: [0, .1] }, { points: [[.5, .5, 0]], radius: [.1, .1] }, { points: [[NaN, .5]], radius: [.1, .1] }, { surface: 'other', points: [[.5, .5]], radius: [.1, .1] }]) {
    const e = card(); assert.throws(() => appendSurfaceErasure(e, stroke)); assert.equal(e.erasures, undefined)
    assert.ok(surfaceErasureDiagnostics({ erasures: [stroke] }).length)
  }
  const e = card()
  e.erasures = [{ surface: 'body', points: Array.from({ length: MAX_SURFACE_ERASURE_POINTS }, () => [.1, .1]), radius: [.01, .01] }]
  const before = JSON.stringify(e)
  assert.throws(() => appendSurfaceErasure(e, { points: [[.7, .7]], radius: [.01, .01] }))
  assert.equal(JSON.stringify(e), before)
})
