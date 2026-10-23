import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBoardDemo, buildBoardDemo } from '../examples/board-demo.mjs'
import { boardDiagnostics } from '../lib/board.js'
import { surfaceErased } from '../lib/surface.js'

test('共作示例可直接生成、追溯真实源码，且拒绝覆盖人的已有画板', async t => {
  const root = mkdtempSync('/tmp/anatomy-board-example-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'anatomy-example'), board = createBoardDemo()
  assert.deepEqual(boardDiagnostics(board), [])
  const paint = board.elements.find(element => element.id === 'paint')
  assert.equal(surfaceErased(paint, [.48, .32]), true, '可观察的缺口由真实擦痕构成')
  assert.equal(surfaceErased(paint, [.2, .5]), false, '保留可继续编辑的剩余表面')
  const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
  for (const element of board.elements) for (const anchor of element.anchors || []) {
    const code = readFileSync(join(repo, anchor.file), 'utf8')
    assert.ok(new RegExp('function\\s+' + anchor.symbol + '\\s*\\(').test(code), anchor.file + ': ' + anchor.symbol)
  }
  const result = await buildBoardDemo(dir, { serve: false })
  assert.equal(result.ok, true)
  const saved = readFileSync(join(dir, 'body.json'), 'utf8')
  const restored = JSON.parse(saved).board
  assert.deepEqual(restored.elements.find(element => element.id === 'paint').erasures, paint.erasures)
  assert.ok(restored.elements.find(element => element.id === 'same-surface').anchors.every(anchor => /^[0-9a-f]{64}$/.test(anchor.sha256)))
  assert.match(readFileSync(result.file, 'utf8'), /同一处切口/)
  await assert.rejects(buildBoardDemo(dir, { serve: false }), /避免覆盖人的修改/)
  assert.equal(readFileSync(join(dir, 'body.json'), 'utf8'), saved)
})
