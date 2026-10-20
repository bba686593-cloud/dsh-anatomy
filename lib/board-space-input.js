// Browser-independent keyboard state. The board controller owns event routing,
// focus/visibility checks, undo transactions, and the meaning of each movement.
// active(event) also runs on every frame with {}: use document.activeElement
// when event.target is absent so programmatic focus changes stop held keys.
function createSpaceInput(options) {
  options = options || {}
  var keys = new Set(), fast = false, frame = null, previousTime = null
  var moving = false, looking = false
  var motionKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyI', 'KeyK', 'KeyJ', 'KeyU']
  var lookKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
  var fallbackCodes = { w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', q: 'KeyQ', e: 'KeyE', z: 'KeyZ', x: 'KeyX', i: 'KeyI', k: 'KeyK', j: 'KeyJ', u: 'KeyU', Escape: 'Escape', Esc: 'Escape', Enter: 'Enter', Shift: 'ShiftLeft', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown' }

  function codeFor(event) { return event.code || fallbackCodes[event.key] || fallbackCodes[String(event.key || '').toLowerCase()] || '' }
  function hasAny(group) { return group.some(function (code) { return keys.has(code) }) }
  function state(kind, inputKind) { if (options.onState) options.onState(kind, inputKind) }
  function updateStates() {
    var nextMoving = hasAny(motionKeys), nextLooking = hasAny(lookKeys)
    if (moving !== nextMoving) { moving = nextMoving; state(moving ? 'start' : 'end', 'move') }
    if (looking !== nextLooking) { looking = nextLooking; state(looking ? 'start' : 'end', 'look') }
  }
  function stop(cancel) {
    var wasMoving = moving, wasLooking = looking
    keys.clear(); fast = false; moving = false; looking = false; previousTime = null
    if (frame !== null) { cancelAnimationFrame(frame); frame = null }
    if (wasMoving) state(cancel ? 'cancel' : 'end', 'move')
    if (wasLooking) state(cancel ? 'cancel' : 'end', 'look')
  }
  function allowed(event) {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || (options.active && !options.active(event))) {
      // A focus change or a reserved shortcut must also finish an earlier hold.
      // Its eventual keyup may be delivered to another editor or dialog.
      stop(false)
      return false
    }
    return true
  }
  function axis(positive, negative) { return Number(keys.has(positive)) - Number(keys.has(negative)) }
  function schedule() {
    if (frame === null && keys.size) frame = requestAnimationFrame(tick)
  }
  function tick(time) {
    frame = null
    if (!keys.size) { previousTime = null; return }
    if (options.active && !options.active({})) { stop(false); return }
    var dt = previousTime === null || !Number.isFinite(time) ? 0 : Math.max(0, Math.min(0.05, (time - previousTime) / 1000))
    previousTime = Number.isFinite(time) ? time : null
    if (dt > 0 && moving && options.move) {
      var right = axis('KeyD', 'KeyA'), forward = axis('KeyW', 'KeyS'), up = axis('KeyE', 'KeyQ')
      var length = Math.hypot(right, forward, up)
      if (length > 1) { right /= length; forward /= length; up /= length }
      var rotate = axis('KeyX', 'KeyZ'), rotateX = axis('KeyI', 'KeyK'), rotateY = axis('KeyJ', 'KeyU')
      if (length || rotate || rotateX || rotateY) options.move({ right: right, forward: forward, up: up, rotate: rotate, rotateX: rotateX, rotateY: rotateY, fast: fast }, dt)
    }
    if (dt > 0 && looking && options.look) {
      var x = axis('ArrowRight', 'ArrowLeft'), y = axis('ArrowDown', 'ArrowUp')
      var lookLength = Math.hypot(x, y)
      if (lookLength > 1) { x /= lookLength; y /= lookLength }
      if (lookLength) options.look(x * 420 * dt, y * 420 * dt)
    }
    schedule()
  }
  function keyDown(event) {
    if (!allowed(event)) return false
    var code = codeFor(event)
    fast = !!event.shiftKey || code === 'ShiftLeft' || code === 'ShiftRight'
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (!event.repeat) { stop(false); if (options.commit) options.commit() }
      return true
    }
    if (code === 'Escape') {
      if (!event.repeat) { stop(true); if (options.cancel) options.cancel() }
      return true
    }
    if (!motionKeys.includes(code) && !lookKeys.includes(code)) return false
    keys.add(code); updateStates(); schedule()
    return true
  }
  function keyUp(event) {
    if (!allowed(event)) return false
    var code = codeFor(event), handled = keys.delete(code)
    fast = !!event.shiftKey
    updateStates()
    if (!keys.size) {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null }
      previousTime = null
    }
    return handled
  }
  return { keyDown: keyDown, keyUp: keyUp, stop: stop, busy: function () { return keys.size > 0 }, pressed: function () { return Array.from(keys) } }
}
