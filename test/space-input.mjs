import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/board-space-input.js', import.meta.url), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should equal ${b}`)
function runtime(options = {}) {
  const pending = new Map(), moves = [], looks = [], states = [], actions = []
  let nextId = 0
  const context = vm.createContext({
    Set, Number, Math,
    requestAnimationFrame(fn) { pending.set(++nextId, fn); return nextId },
    cancelAnimationFrame(id) { pending.delete(id) },
  })
  vm.runInContext(source, context)
  const input = context.createSpaceInput({
    move: (axes, dt) => moves.push({ ...plain(axes), dt }),
    look: (x, y) => looks.push([x, y]),
    onState: (...args) => states.push(args),
    commit: () => actions.push('commit'), cancel: () => actions.push('cancel'),
    ...options,
  })
  const event = (code, extra = {}) => ({ code, key: code, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra })
  return {
    input, moves, looks, states, actions, pending,
    down: (code, extra) => input.keyDown(event(code, extra)),
    up: (code, extra) => input.keyUp(event(code, extra)),
    frame(time) { const current = [...pending.values()]; pending.clear(); current.forEach(fn => fn(time)) },
  }
}

test('holds advance once per RAF and one transaction spans simultaneous movement keys', () => {
  const r = runtime()
  assert.equal(r.down('KeyW'), true)
  assert.equal(r.down('KeyD'), true)
  r.down('KeyW', { repeat: true })
  assert.equal(r.pending.size, 1)
  assert.deepEqual(r.states, [['start', 'move']])
  r.frame(100); r.frame(120)
  assert.equal(r.moves.length, 1)
  near(r.moves[0].right, Math.SQRT1_2); near(r.moves[0].forward, Math.SQRT1_2)
  near(r.moves[0].dt, 0.02)
  r.up('KeyW')
  assert.equal(r.input.busy(), true)
  r.frame(140)
  near(r.moves[1].right, 1); near(r.moves[1].forward, 0)
  r.up('KeyD')
  assert.equal(r.input.busy(), false)
  assert.equal(r.pending.size, 0)
  assert.deepEqual(r.states, [['start', 'move'], ['end', 'move']])
})

test('3D diagonals normalize, opposite keys cancel, and rotation remains independent', () => {
  const r = runtime()
  for (const code of ['KeyW', 'KeyD', 'KeyE', 'KeyX']) r.down(code)
  r.frame(0); r.frame(10)
  const m = r.moves[0]
  near(Math.hypot(m.right, m.forward, m.up), 1)
  near(m.up, 1 / Math.sqrt(3)); assert.equal(m.rotate, 1)
  for (const code of ['KeyS', 'KeyA', 'KeyQ', 'KeyZ']) r.down(code)
  r.frame(20)
  assert.equal(r.moves.length, 1, 'fully opposing keys do not create idle updates')
})

test('all three rotation axes hold continuously and opposite pairs cancel independently', () => {
  const r = runtime()
  for (const code of ['KeyI', 'KeyJ', 'KeyX']) assert.equal(r.down(code), true)
  r.frame(0); r.frame(20); r.frame(40)
  assert.equal(r.moves.length, 2)
  assert.deepEqual(r.moves[0], { right: 0, forward: 0, up: 0, rotate: 1, rotateX: 1, rotateY: 1, fast: false, dt: .02 })
  assert.deepEqual(r.states, [['start', 'move']])
  for (const code of ['KeyK', 'KeyU', 'KeyZ']) r.down(code)
  r.frame(60)
  assert.equal(r.moves.length, 2, 'opposing rotations do not emit idle updates')
  for (const code of ['KeyI', 'KeyJ', 'KeyX']) r.up(code)
  r.frame(80)
  assert.deepEqual(r.moves.at(-1), { right: 0, forward: 0, up: 0, rotate: -1, rotateX: -1, rotateY: -1, fast: false, dt: .02 })
  for (const code of ['KeyK', 'KeyU', 'KeyZ']) r.up(code)
  assert.deepEqual(r.states, [['start', 'move'], ['end', 'move']])
  assert.equal(r.pending.size, 0)
})

test('three-axis rotation never changes diagonal translation normalization or Shift state', () => {
  const r = runtime()
  for (const code of ['KeyW', 'KeyD', 'KeyE', 'KeyI', 'KeyJ', 'KeyX']) r.down(code, { shiftKey: true })
  r.frame(0); r.frame(16)
  const m = r.moves[0]
  near(Math.hypot(m.right, m.forward, m.up), 1)
  near(m.right, 1 / Math.sqrt(3))
  assert.equal(m.rotate, 1); assert.equal(m.rotateX, 1); assert.equal(m.rotateY, 1)
  assert.equal(m.fast, true)
  r.up('ShiftLeft'); r.frame(32)
  assert.equal(r.moves.at(-1).fast, false)
})

test('rotation keys support event.key fallback and preserve editor and modifier shortcuts', () => {
  for (const [key, axis, direction] of [['I', 'rotateX', 1], ['k', 'rotateX', -1], ['J', 'rotateY', 1], ['u', 'rotateY', -1]]) {
    const r = runtime({ active: event => !event.editing })
    assert.equal(r.input.keyDown({ key }), true)
    r.frame(0); r.frame(16)
    assert.equal(r.moves[0][axis], direction)
    r.input.stop()
    for (const extra of [{ editing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      assert.equal(r.input.keyDown({ key, ...extra }), false)
      assert.equal(r.input.busy(), false)
    }
  }
})

test('Shift changes speed immediately while a movement key stays held', () => {
  const r = runtime()
  r.down('KeyW'); r.frame(0); r.frame(16)
  assert.equal(r.moves.at(-1).fast, false)
  assert.equal(r.down('ShiftLeft', { shiftKey: true }), false)
  r.frame(32)
  assert.equal(r.moves.at(-1).fast, true)
  r.up('ShiftLeft'); r.frame(48)
  assert.equal(r.moves.at(-1).fast, false)
  assert.deepEqual(r.states, [['start', 'move']])
})

test('camera arrows use smooth normalized deltas and independent lifecycle', () => {
  const r = runtime()
  r.down('ArrowRight'); r.down('ArrowUp'); r.frame(0); r.frame(50)
  assert.equal(r.moves.length, 0)
  near(Math.hypot(...r.looks[0]), 21)
  assert.ok(r.looks[0][0] > 0 && r.looks[0][1] < 0)
  r.down('KeyW'); r.up('KeyW')
  assert.deepEqual(r.states, [['start', 'look'], ['start', 'move'], ['end', 'move']])
  r.up('ArrowRight'); r.up('ArrowUp')
  assert.deepEqual(r.states.at(-1), ['end', 'look'])
})

test('paused and backwards RAF timestamps never jump or reverse movement', () => {
  const r = runtime()
  r.down('KeyW'); r.frame(0); r.frame(10000); r.frame(9990)
  assert.equal(r.moves.length, 1)
  near(r.moves[0].dt, 0.05)
  r.up('KeyW'); r.down('KeyW'); r.frame(20000)
  assert.equal(r.moves.length, 1, 'new holds establish a fresh time origin')
})

test('Enter commits once, Escape cancels once, and both clear all pending movement', () => {
  const r = runtime()
  r.down('KeyW'); r.down('Enter'); r.down('Enter', { repeat: true })
  assert.deepEqual(r.actions, ['commit'])
  assert.deepEqual(r.states, [['start', 'move'], ['end', 'move']])
  r.down('KeyE'); r.down('ArrowLeft'); r.down('Escape'); r.down('Escape', { repeat: true })
  assert.deepEqual(r.actions, ['commit', 'cancel'])
  assert.deepEqual(r.states.slice(-2), [['cancel', 'move'], ['cancel', 'look']])
  assert.equal(r.pending.size, 0)
  assert.deepEqual(plain(r.input.pressed()), [])
})

test('inactive editors, dialogs, composition, and reserved modifiers clear previous holds', () => {
  for (const extra of [{ editing: true }, { dialog: true }, { isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    const r = runtime({ active: event => !event.editing && !event.dialog })
    r.down('KeyW')
    assert.equal(r.down('KeyD', extra), false)
    assert.equal(r.input.busy(), false)
    assert.equal(r.pending.size, 0)
    assert.deepEqual(r.states, [['start', 'move'], ['end', 'move']])
    assert.equal(r.up('KeyW', extra), false)
    r.frame(100)
    assert.equal(r.moves.length, 0)
  }
})

test('inactive keyup also clears another held key, while ordinary keyup preserves it', () => {
  const r = runtime({ active: event => !event.editing })
  r.down('KeyW'); r.down('KeyE')
  assert.equal(r.up('KeyE'), true)
  assert.deepEqual(plain(r.input.pressed()), ['KeyW'])
  assert.equal(r.up('KeyW', { editing: true }), false)
  assert.equal(r.input.busy(), false)
  assert.deepEqual(r.states.at(-1), ['end', 'move'])
})

test('programmatic focus or visibility changes stop holds without another keyboard event', () => {
  let active = true
  const r = runtime({ active: () => active })
  r.down('KeyW'); r.down('ArrowRight'); r.frame(0); r.frame(16)
  assert.equal(r.moves.length, 1)
  assert.equal(r.looks.length, 1)
  active = false
  r.frame(32)
  assert.equal(r.moves.length, 1)
  assert.equal(r.looks.length, 1)
  assert.equal(r.input.busy(), false)
  assert.equal(r.pending.size, 0)
  assert.deepEqual(r.states.slice(-2), [['end', 'move'], ['end', 'look']])
  active = true
  r.frame(48)
  assert.equal(r.moves.length, 1, 'focus returning cannot resume a stale hold')
})

test('stop is idempotent, clears acceleration, and cancels its RAF', () => {
  const r = runtime()
  r.down('KeyW', { shiftKey: true }); r.down('ArrowLeft')
  r.input.stop(true); r.input.stop(true)
  assert.deepEqual(r.states, [['start', 'move'], ['start', 'look'], ['cancel', 'move'], ['cancel', 'look']])
  assert.equal(r.pending.size, 0)
  r.down('KeyW'); r.frame(0); r.frame(16)
  assert.equal(r.moves.at(-1).fast, false)
})

test('key fallback supports synthetic events and returned pressed keys are snapshots', () => {
  const r = runtime()
  assert.equal(r.input.keyDown({ key: 'W' }), true)
  const snapshot = r.input.pressed(); snapshot.length = 0
  assert.equal(r.input.busy(), true)
  assert.equal(r.input.keyUp({ key: 'w' }), true)
  assert.equal(r.input.busy(), false)
  assert.equal(r.down('KeyP'), false)
  assert.deepEqual(r.actions, [])
})
