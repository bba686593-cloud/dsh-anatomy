import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { mappingIndex, impactOf, scenarioDiagnostics } from '../lib/mapping.js'
import { sourceInventory } from '../lib/inventory.js'
import { humanMap, agentDigest, briefOrgan } from '../lib/digest.js'

const scenario = { id: 'request', name: '处理一条请求', trigger: '用户提交请求', outcome: '用户得到结果', steps: [
  { organ: 'entry', action: '接收请求' }, { organ: 'work', flow: 'request', action: '形成结果' }, { organ: 'reply', flow: 'result', action: '返回结果' },
], acceptance: ['请求与结果可以对应'] }
const body = { title: '示例服务', oneline: '处理请求并返回结果', systems: [{ id: 'core', name: '处理' }], media: [{ id: 'data', name: '数据' }], scenarios: [scenario] }
const organs = [
  { id: 'entry', name: '请求入口', systems: ['core'], status: 'active', gist: '接收请求', story: '接收用户提交的内容', contract: { in: ['用户请求'], out: ['待处理请求'] }, not_responsible: ['不计算结果'], observables: ['请求能被接收'],
    anchors: [{ file: 'src/entry.js', symbol: 'entry', role: 'interface', reason: '接收用户请求', sha256: 'abc' }, { file: 'test/entry.js', role: 'test', reason: '验证入口边界' }],
    composition: [{ name: '请求转换', role: '转换输入', anchor: { file: 'src/shared.js', symbol: 'parse', reason: '解析输入' } }] },
  { id: 'work', name: '结果处理', systems: ['core'], status: 'planned', gist: '形成结果', contract: { in: ['待处理请求'], out: ['结果'], invariants: ['同一请求只处理一次'] }, not_responsible: ['不发送结果'], anchors: [{ file: 'src/work.js' }] },
  { id: 'reply', name: '结果返回', systems: ['core'], status: 'active', gist: '返回结果', not_responsible: ['不修改结果'], anchors: [{ file: 'src/reply.js' }] },
  { id: 'aux', name: '辅助处理', systems: ['core'], status: 'planned', gist: '共享转换能力', anchors: [{ file: 'src/shared.js', symbol: 'other', reason: '共用转换模块' }] },
]
const flows = [
  { id: 'request', name: '请求', from: 'entry', to: 'work', medium: 'data', gist: '交付待处理请求', anchors: [{ file: 'src/channel.js', role: 'interface', reason: '传输请求' }] },
  { id: 'result', name: '结果', from: 'work', to: 'reply', medium: 'data', gist: '交付结果' },
]

test('多对多反查包含部件、流、用途、说明和测试，缺口不伪装覆盖', () => {
  const index = mappingIndex(body, organs, flows)
  const shared = index.files.find((x) => x.file === 'src/shared.js')
  assert.equal(shared.refs.length, 2)
  assert.equal(shared.refs[0].part, '请求转换')
  assert.equal(index.files.find((x) => x.file === 'src/channel.js').refs[0].kind, 'flow')
  assert.deepEqual(index.gaps.noTestEvidence, ['reply'])
  assert.ok(index.gaps.unexplainedLinks.some((x) => x.file === 'src/work.js'))
})

test('影响按流向、有界深度、共享实现关系推导并给出路径', () => {
  const result = impactOf(body, organs, flows, { files: ['src/entry.js'], depth: 1 })
  assert.deepEqual(new Set(result.affected.map((x) => x.id)), new Set(['entry', 'work', 'aux']))
  assert.equal(result.affected.find((x) => x.id === 'work').path[0].kind, 'flow')
  assert.equal(result.affected.find((x) => x.id === 'aux').path[0].kind, 'shared-file')
  assert.equal(result.scenarios[0].id, 'request')
  const deep = impactOf(body, organs, flows, { organs: ['entry'], depth: 2 })
  assert.equal(deep.affected.find((x) => x.id === 'reply').distance, 2)
  assert.equal(impactOf(body, organs, flows, { organs: ['reply'] }).affected.length, 1)
  assert.deepEqual(impactOf(body, organs, flows, { files: ['unknown.js'] }).unknownFiles, ['unknown.js'])
  assert.deepEqual(new Set(impactOf(body, organs, flows, { files: ['src/channel.js'], depth: 0 }).roots), new Set(['entry', 'work']))
})

test('双向、构成和回路不丢关系也不无限扩张，共用测试不算实现依赖', () => {
  const list = structuredClone(organs)
  list[1].parent = 'entry'
  list[2].anchors.push({ file: 'test/entry.js', role: 'test' })
  const edges = [...flows.map((f) => ({ ...f, direction: 'two-way' })), { id: 'loop', from: 'reply', to: 'entry' }]
  const result = impactOf(body, list, edges, { organs: ['reply'], depth: 5 })
  assert.equal(new Set(result.affected.map((x) => x.id)).size, result.affected.length)
  assert.ok(result.affected.some((x) => x.id === 'entry'))
  assert.equal(impactOf(body, list, [], { organs: ['reply'] }).affected.length, 1)
})

test('业务场景校验真实顺序与方向，拒绝悬空、倒流和无动作步骤', () => {
  assert.deepEqual(scenarioDiagnostics(body, organs, flows), [])
  const reversed = { ...body, scenarios: [{ ...scenario, steps: [{ organ: 'reply', action: '开始' }, { organ: 'work', flow: 'result', action: '继续' }] }] }
  assert.ok(scenarioDiagnostics(reversed, organs, flows).some((x) => x.code === 'scenario/disconnected'))
  assert.deepEqual(scenarioDiagnostics(reversed, organs, flows.map((f) => ({ ...f, direction: 'two-way' }))), [])
  assert.ok(scenarioDiagnostics(body, organs.filter((o) => o.id !== 'work'), flows).some((x) => x.code === 'scenario/step'))
  assert.ok(scenarioDiagnostics({ ...body, scenarios: [scenario, scenario] }, organs, flows).some((x) => x.code === 'scenario/id'))
  assert.ok(scenarioDiagnostics({ ...body, scenarios: 'bad' }, organs, flows).some((x) => x.code === 'scenario/shape'))
})

test('人读和机读共用场景、边界与验收，术前摘要列文件和缺测试证据', () => {
  const human = humanMap(body, organs, flows), machine = agentDigest(body, organs, flows)
  for (const text of [human, machine]) {
    assert.ok(text.includes('处理一条请求'))
    assert.ok(text.includes('请求与结果可以对应'))
    assert.ok(text.includes('不计算结果'))
  }
  assert.ok(human.includes('设计态'))
  assert.ok(!human.includes('src/entry.js'))
  assert.ok(machine.includes('src/entry.js') && machine.includes('接收用户请求'))
  const brief = briefOrgan(body, organs, flows, 'entry')
  assert.ok(brief.includes('共享 src/shared.js'))
  assert.ok(brief.includes('test/entry.js'))
  assert.ok(brief.includes('未关联测试证据：reply'))
  assert.ok(brief.includes('请求与结果可以对应'))
})

test('扫描仅在显式范围内，排除依赖和软链接，部分扫描不报完整覆盖率', (t) => {
  const repo = mkdtempSync('/tmp/anatomy-inventory-'); t.after(() => rmSync(repo, { recursive: true, force: true }))
  mkdirSync(join(repo, 'src', 'node_modules'), { recursive: true })
  writeFileSync(join(repo, 'src', 'entry.js'), '')
  writeFileSync(join(repo, 'src', 'missing.py'), '')
  writeFileSync(join(repo, 'src', 'node_modules', 'skip.js'), '')
  symlinkSync('/tmp', join(repo, 'src', 'outside'))
  const index = mappingIndex(body, organs, flows)
  const result = sourceInventory(repo, ['src'], index)
  assert.equal(result.scanned, 2)
  assert.equal(result.coverage, 0.5)
  assert.deepEqual(result.unmapped, ['src/missing.py'])
  assert.ok(result.skipped.includes('src/outside'))
  assert.throws(() => sourceInventory(repo, ['../'], index))
  assert.throws(() => sourceInventory(repo, [], index))
  assert.equal(sourceInventory(repo, ['src'], index, 1).coverage, null)
  assert.equal(sourceInventory(repo, ['nonexistent'], index).coverage, null)
})

test('工具场景写入、批量场景校验、反查和删除引用门禁形成闭环', async (t) => {
  const root = mkdtempSync('/tmp/anatomy-coread-'); t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'a.js'), 'export function start() {}')
  const tools = new Map(); apply({ tools: { register(d) { tools.set(d.name, d); return () => {} } } }, { rootDir: root, autoServe: false })
  const dir = join(root, 'anatomy-demo'), call = (name, args = {}) => tools.get('anatomy_' + name).execute({ dir, ...args })
  assert.equal((await call('init', { repo: root, body: 'demo', title: '演示', oneline: '处理请求', systems: body.systems })).ok, true)
  const units = organs.slice(0, 3).map((o) => ({ ...o, status: 'planned', composition: [], anchors: [{ file: 'src/a.js', symbol: 'start', reason: '演示入口' }] }))
  const links = flows.map((f) => ({ ...f, anchors: [] }))
  assert.equal((await call('scaffold', { organs: units, flows: links, scenarios: [scenario] })).ok, true)
  assert.equal((await call('show')).body.scenarios.length, 1)
  assert.equal((await call('mapping', { files: ['src/a.js'], scope: ['src'] })).inventory.coverage, 1)
  const impact = await call('impact', { files: ['src/a.js'] })
  assert.equal(impact.roots.length, 3)
  assert.equal(impact.scenarios[0].id, 'request')
  const before = readFileSync(join(dir, 'body.json'), 'utf8')
  const bad = await call('scenario_put', { scenario: { ...scenario, steps: [{ organ: 'missing', action: '错误' }] } })
  assert.equal(bad.ok, false)
  assert.equal(readFileSync(join(dir, 'body.json'), 'utf8'), before)
  assert.equal((await call('remove', { kind: 'flow', id: 'request' })).ok, false)
  assert.equal((await call('scenario_put', { remove: 'request' })).ok, true)
  assert.equal((await call('remove', { kind: 'flow', id: 'request' })).ok, true)
  assert.equal((await call('scaffold', { scenarios: [scenario] })).ok, false)
})
