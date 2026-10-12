import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { renderAnatomy } from '../lib/render.js'

const fixture = () => ({
  version: 1, layout: { mode: 'manual' },
  elements: [{
    id: 'input', type: 'rect', x: 0, y: 0, width: 280, height: 140,
    text: '核对当前输入。', math: 'y = f(x)',
    implementation: { language: 'JavaScript', code: 'return input;', extension: { keep: true } },
    anchors: [{ file: 'src/input.js', sha256: 'a'.repeat(64) }]
  }],
  reading: { summary: '将输入整理为结果。', steps: [{ element: 'input', title: '理解输入', description: '核对当前输入范围。' }] }
})

// Run the same generated inline client through its DOM listeners. Requests
// remain pending while the test exercises ordinary canvas/guide editing.
function runtime(fetch) {
  const nodes = new Map(), storage = new Map()
  const node = id => {
    if (nodes.has(id)) return nodes.get(id)
    const listeners = {}
    const value = {
      id, value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, attributes: {}, listeners,
      hidden: false, open: false,
      classList: { add() {}, remove() {}, toggle() { return true } },
      setAttribute(key, next) { this.attributes[key] = next },
      getAttribute(key) { return this.attributes[key] },
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn) },
      querySelector() { return null }, querySelectorAll() { return [] },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 } },
      setPointerCapture() {}, showModal() { this.open = true },
      close() { this.open = false; for (const fn of listeners.close || []) fn({ target: this }) },
      focus() {}, select() {}, click() {}, appendChild() {}, remove() {}, contains() { return false }
    }
    nodes.set(id, value)
    return value
  }
  const document = {
    compatMode: 'CSS1Compat', getElementById: node, querySelectorAll: () => [], querySelector: () => null,
    body: node('body'), addEventListener() {}, createElement: () => node('download')
  }
  const context = {
    document, window: { addEventListener() {} }, fetch,
    localStorage: { setItem(key, value) { storage.set(key, value) }, getItem(key) { return storage.get(key) }, removeItem(key) { storage.delete(key) } },
    structuredClone, Blob, URL, AbortController, setTimeout: () => 0, clearTimeout() {}
  }
  const html = renderAnatomy({ slug: 'version-races', title: '版本等待回归', board: fixture() }, [], [])
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], context)
  const api = context.window.__anatomyBoard
  const fire = (id, type, event = {}) => { for (const fn of node(id).listeners[type] || []) fn(event) }
  return {
    api, node, storage, fire,
    text(value, confirm = true) {
      api.canvas.openTextEditor('input'); node('canvas-text-input').value = value
      fire('canvas-text-input', 'input', { target: node('canvas-text-input') })
      if (confirm) assert.equal(api.canvas.confirm(), true)
    },
    guide(action) {
      fire('reading-content', 'click', { target: { closest(selector) { return selector === '[data-guide-action]' ? { dataset: { guideAction: action } } : null } } })
    }
  }
}

function versionService() {
  const current = fixture(), older = fixture(); older.elements[0].text = '历史版本的输入说明。'
  let selected = { id: 'current', revision: 'revision-current' }, selectedBoard = current, count = 0
  const posts = [], waits = new Map()
  const result = board => ({ ok: true, selected: { ...selected }, versions: [
    { id: 'current', label: '当前版本', createdAt: '2026-10-12T00:00:00Z' },
    { id: 'older', label: '历史版本', createdAt: '2026-10-11T00:00:00Z' },
    ...count ? [{ id: 'saved-' + count, label: '保存修改', createdAt: '2026-10-12T01:00:00Z' }] : []
  ], ...(board ? { board: structuredClone(board) } : {}) })
  const response = value => ({ ok: true, json: async () => value })
  const fetch = async (path, options = {}) => {
    if (options.method !== 'POST') return response(result(path === '/api/versions/current' ? selectedBoard : null))
    const payload = JSON.parse(options.body); posts.push({ path, payload })
    assert.equal(payload.expectedSelection, selected.revision)
    const complete = () => {
      if (path === '/api/versions/select') { selected = { id: payload.id, revision: 'revision-older' }; selectedBoard = older }
      else { count++; selected = { id: 'saved-' + count, revision: 'revision-saved-' + count }; selectedBoard = payload.board }
      return response(result(selectedBoard))
    }
    const wait = waits.get(path)
    if (!wait) return complete()
    waits.delete(path)
    return new Promise(resolve => { wait.release = () => resolve(complete()); wait.started() })
  }
  return {
    fetch, posts, get selected() { return selected },
    hold(path) {
      let started; const pending = new Promise(resolve => { started = resolve })
      const wait = { started, release: null }; waits.set(path, wait)
      return { pending, release() { assert.ok(wait.release, 'request must have started'); wait.release() } }
    }
  }
}

async function setup() {
  const service = versionService(), r = runtime(service.fetch)
  await r.api.versions.refresh(true)
  r.node('version-list').value = 'older'
  return { r, service }
}

function assertDraftStored(r, text) {
  const saved = [...r.storage.entries()].find(([key]) => !key.endsWith(':canvas-editor') && !key.endsWith(':reading-editor') && !key.endsWith(':handwriting'))
  assert.ok(saved, 'changed canvas must remain cached')
  assert.equal(JSON.parse(saved[1]).elements[0].text, text)
  assert.equal(r.api.board.elements[0].implementation.code, 'return input;')
  assert.equal(r.api.board.elements[0].anchors[0].sha256, 'a'.repeat(64))
}

test('历史选择等待期间确认文字保留，页面选择与后续保存修订一致', async () => {
  const { r, service } = await setup(), wait = service.hold('/api/versions/select')
  const choosing = r.api.versions.choose(); await wait.pending
  r.text('等待切换时确认的新说明。')
  wait.release(); await choosing
  assert.equal(r.api.board.elements[0].text, '等待切换时确认的新说明。')
  assert.equal(service.selected.id, 'older')
  assert.match(r.node('version-current').textContent, /历史版本/)
  assertDraftStored(r, '等待切换时确认的新说明。')
  assert.equal(await r.api.versions.save(), true)
  const saved = service.posts.at(-1).payload
  assert.equal(saved.expectedSelection, 'revision-older')
  assert.equal(saved.board.elements[0].text, '等待切换时确认的新说明。')
  assert.equal(service.selected.id, 'saved-1')
})

test('历史选择等待期间未确认文字草稿保留，可确认并针对选定版继续保存', async () => {
  const { r, service } = await setup(), wait = service.hold('/api/versions/select')
  const choosing = r.api.versions.choose(); await wait.pending
  r.text('尚未确认的新输入约束。', false)
  wait.release(); await choosing
  assert.equal(service.selected.id, 'older')
  assert.equal(r.api.board.elements[0].text, '核对当前输入。')
  assert.equal(r.api.canvas.draft.value, '尚未确认的新输入约束。')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')))
  assert.equal(await r.api.versions.save(), false)
  assert.equal(r.api.canvas.confirm(), true)
  assertDraftStored(r, '尚未确认的新输入约束。')
  assert.equal(await r.api.versions.save(), true)
  assert.equal(service.posts.at(-1).payload.expectedSelection, 'revision-older')
  assert.equal(service.posts.at(-1).payload.board.elements[0].text, '尚未确认的新输入约束。')
})

test('自动保存等待期间新确认修改停止历史切换，两份意图都保留', async () => {
  const { r, service } = await setup()
  r.text('先保存的第一份意图。')
  const wait = service.hold('/api/versions'), choosing = r.api.versions.choose(); await wait.pending
  r.text('等待保存时确认的第二份意图。')
  wait.release(); await choosing
  assert.equal(service.posts.some(post => post.path === '/api/versions/select'), false)
  assert.equal(service.selected.id, 'saved-1')
  assert.equal(service.posts[0].payload.board.elements[0].text, '先保存的第一份意图。')
  assert.equal(r.api.board.elements[0].text, '等待保存时确认的第二份意图。')
  assertDraftStored(r, '等待保存时确认的第二份意图。')
  assert.equal(await r.api.versions.save(), true)
  assert.equal(service.posts.at(-1).payload.expectedSelection, 'revision-saved-1')
  assert.equal(service.posts.at(-1).payload.board.elements[0].text, '等待保存时确认的第二份意图。')
  assert.equal(service.selected.id, 'saved-2')
})

test('自动保存等待期间未确认文字阻止切换，草稿确认后可以继续保存', async () => {
  const { r, service } = await setup()
  r.text('自动保存的已确认意图。')
  const wait = service.hold('/api/versions'), choosing = r.api.versions.choose(); await wait.pending
  r.text('自动保存等待时留下的草稿。', false)
  wait.release(); await choosing
  assert.equal(service.posts.some(post => post.path === '/api/versions/select'), false)
  assert.equal(service.selected.id, 'saved-1')
  assert.equal(r.api.canvas.draft.value, '自动保存等待时留下的草稿。')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':canvas-editor')))
  assert.equal(r.api.canvas.confirm(), true)
  assert.equal(await r.api.versions.save(), true)
  assert.equal(service.posts.at(-1).payload.expectedSelection, 'revision-saved-1')
  assert.equal(service.posts.at(-1).payload.board.elements[0].text, '自动保存等待时留下的草稿。')
})

test('历史选择等待期间独立导读草稿保留，确认后保存新的阅读约束', async () => {
  const { r, service } = await setup(), wait = service.hold('/api/versions/select')
  const choosing = r.api.versions.choose(); await wait.pending
  r.fire('open-reading', 'click'); r.guide('edit')
  r.fire('reading-content', 'input', { target: { dataset: { guideField: 'steps.0.description' }, value: '等待期间补充的阅读范围。' } })
  wait.release(); await choosing
  assert.equal(service.selected.id, 'older')
  assert.ok([...r.storage.keys()].some(key => key.endsWith(':reading-editor')))
  assert.equal(r.api.board.reading.steps[0].description, '核对当前输入范围。')
  assert.equal(await r.api.versions.save(), false)
  r.guide('confirm')
  assert.equal(r.api.board.reading.steps[0].description, '等待期间补充的阅读范围。')
  assert.equal(await r.api.versions.save(), true)
  assert.equal(service.posts.at(-1).payload.expectedSelection, 'revision-older')
  assert.equal(service.posts.at(-1).payload.board.reading.steps[0].description, '等待期间补充的阅读范围。')
})
