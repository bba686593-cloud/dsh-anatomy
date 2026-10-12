import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import { scanAnchors } from '../lib/store.js'
import { evaluatePolicy } from '../lib/policy.js'
import { scanEditFiles } from '../lib/edits.js'
import { checkBody } from '../lib/check.js'

async function fixture(t, config = {}) {
  const root = mkdtempSync('/tmp/anatomy-regression-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'project'), dir = join(repo, 'anatomy-demo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  const source = join(repo, 'src', 'main.js')
  writeFileSync(source, 'export function processInput() { return 1; }\n')
  const tools = new Map()
  apply({ tools: { register(def) { tools.set(def.name, def); return () => {} } } }, { rootDir: root, autoServe: false, ...config })
  const call = (name, args = {}) => tools.get('anatomy_' + name).execute({ dir, ...args })
  assert.equal((await call('init', { repo, body: 'demo', title: '系统', oneline: '传递事实', systems: [{ id: 'a', name: '采集', alt: 0 }, { id: 'b', name: '执行', alt: 1 }] })).ok, true)
  const organs = [{ id: 'one', name: '采集', gist: '收集事实', systems: ['a'], status: 'planned' }, { id: 'two', name: '执行', gist: '执行请求', systems: ['b'], status: 'planned' }]
  const flows = [{ id: 'link', name: '事实', from: 'one', to: 'two', medium: 'data', gist: '传递事实' }]
  assert.equal((await call('scaffold', { organs, flows })).ok, true)
  const full = () => call('show', { level: 'agent' })
  return { root, repo, dir, source, organs, flows, call, full, tools }
}
function active(organ) {
  return { ...organ, status: 'active', story: '读取输入并形成处理结果', not_responsible: ['不执行后续动作'], composition: [{ name: '输入处理', role: '形成结果' }], contract: { in: ['输入'], out: ['处理结果'] }, anchors: [{ file: 'src/main.js', symbol: 'processInput' }] }
}
function writeBundle(dir, name, bundle) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'anatomy-edits-' + name + '.json')
  writeFileSync(file, JSON.stringify({ schema: 'anatomy-edits/1', body: 'demo', ...bundle }))
  return file
}
const patch = (gist) => [{ kind: 'organ', id: 'one', patch: { gist } }]

test('删除和级联删除在写文件及历史之前执行策略门禁', async (t) => {
  const { call, dir } = await fixture(t)
  await call('policy', { action: 'freeze' })
  const before = readFileSync(join(dir, 'flows.json'), 'utf8')
  const history = readFileSync(join(dir, 'history.jsonl'), 'utf8')
  for (const args of [{ kind: 'flow', id: 'link' }, { kind: 'organ', id: 'one', cascade: true }]) {
    const result = await call('remove', args)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.code === 'policy/link-a-b'))
    assert.equal(readFileSync(join(dir, 'flows.json'), 'utf8'), before)
    assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8'), history)
    assert.ok(existsSync(join(dir, 'organs', 'one.json')))
  }
  assert.equal((await call('check')).ok, true)
})

test('新包基线冲突不能用 force 绕过；无基线旧包需要显式单包导入', async (t) => {
  const { call, full, root } = await fixture(t)
  const baseHash = (await full()).anatomyHash
  assert.equal((await call('apply_edits', { edits: patch('第一版'), baseHash })).ok, true)
  const stale = await call('apply_edits', { edits: patch('旧页面覆盖'), baseHash, force: true })
  assert.equal(stale.error.code, 'anatomy/edit-conflict')
  assert.equal((await full()).organs.find((o) => o.id === 'one').gist, '第一版')
  const file = join(root, 'legacy.json')
  writeFileSync(file, JSON.stringify({ edits: patch('已核对的旧包') }))
  assert.equal((await call('apply_edits', { file })).error.code, 'anatomy/base-required')
  assert.equal((await call('apply_edits', { file, allowUnversioned: true })).ok, true)
})

test('批量修改按旧到新处理，同基线冲突包保留且整体返回失败', async (t) => {
  const { call, full, dir } = await fixture(t)
  const baseHash = (await full()).anatomyHash
  const older = writeBundle(join(dir, 'edits'), 'old', { at: '2026-09-24T00:00:00Z', baseHash, edits: patch('较早修改') })
  const newer = writeBundle(join(dir, 'edits'), 'new', { at: '2026-09-25T00:00:00Z', baseHash, edits: patch('较新修改') })
  assert.deepEqual(scanEditFiles([join(dir, 'edits')], 'demo').map((x) => x.file), [older, newer])
  const result = await call('pending_edits', { apply: true, force: true, allowUnversioned: true })
  assert.equal(result.ok, false)
  assert.equal(result.failed, 1)
  assert.equal(result.applied[0].ok, true)
  assert.equal(result.applied[1].error.code, 'anatomy/edit-conflict')
  assert.equal(existsSync(older), false)
  assert.equal(existsSync(newer), true)
  assert.equal(JSON.parse(readFileSync(join(dir, 'organs', 'one.json'))).gist, '较早修改')
})

test('发现工程根修改包后所有共读入口拒绝旧数据，诊断仍可读', async (t) => {
  const { call, full, repo } = await fixture(t)
  writeBundle(repo, 'root', { baseHash: (await full()).anatomyHash, edits: patch('新的意图') })
  for (const name of ['show', 'brief', 'digest', 'map', 'render']) {
    assert.equal((await call(name, { organ: 'one', force: true })).error.code, 'anatomy/pending-edits', name)
  }
  const snapshot = await call('show', { level: 'agent', inspectPending: true })
  assert.equal(snapshot.snapshotOnly, true)
  assert.equal(snapshot.pendingEdits.length, 1)
  assert.equal(snapshot.organs.find((o) => o.id === 'one').gist, '收集事实')
  assert.equal((await call('check')).pendingEdits.length, 1)
  assert.equal((await call('history')).pendingEdits.length, 1)
  assert.equal((await call('pending_edits', { apply: true })).ok, true)
  assert.equal((await full()).organs.find((o) => o.id === 'one').gist, '新的意图')
})

test('另一工程的包及无归属包不被自动消费；直接误导入也拒绝', async (t) => {
  const { call, full, repo } = await fixture(t)
  const hash = (await full()).anatomyHash
  const other = writeBundle(repo, 'other', { body: 'other', baseHash: hash, edits: patch('别的工程') })
  writeFileSync(join(repo, 'anatomy-edits-unbound.json'), JSON.stringify(patch('无归属')))
  assert.equal((await call('pending_edits')).pending.length, 0)
  assert.equal((await call('apply_edits', { file: other, force: true })).error.code, 'anatomy/body-mismatch')
})

test('注释与字符串残留不算符号存在，真实代码与限定名仍可识别', async (t) => {
  const { repo } = await fixture(t)
  const cases = [
    ['comment.js', '// processInput\nexport const unrelated = 1;', 'processInput', 'symbol-missing'],
    ['block.cpp', '/* Controller::detect */ int other;', 'Controller::detect', 'symbol-missing'],
    ['literal.js', 'const s = "processInput";', 'processInput', 'symbol-missing'],
    ['escape.js', 'const s = "escaped\\\" processInput";', 'processInput', 'symbol-missing'],
    ['comment.py', '# processInput\nother = 1', 'processInput', 'symbol-missing'],
    ['doc.py', '"""processInput"""\nother = 1', 'processInput', 'symbol-missing'],
    ['regex.js', 'const quote = /[\"\']/g; function processInput() {}', 'processInput', 'unreviewed'],
    ['regex-only.js', 'const r = /processInput/;', 'processInput', 'symbol-missing'],
    ['real.cpp', '// comment\nvoid Controller::detect() {}', 'Controller::detect', 'unreviewed'],
    ['real.py', 'def processInput():\n  return 1', 'processInput', 'unreviewed'],
    ['partial.js', 'function processInputLong() {}', 'processInput', 'symbol-missing'],
  ]
  for (const [file, text, symbol, expected] of cases) {
    writeFileSync(join(repo, 'src', file), text)
    assert.equal(scanAnchors(repo, [{ file: 'src/' + file, symbol }])[0].status, expected, file)
  }
})

test('属性值/配置键/散文里的名字算证据；二进制符号表不被词法过滤吞掉', async (t) => {
  const { repo } = await fixture(t)
  // 这些格式里「引号里的内容」正是要锚定的名字：launch 的参数名、JSON 的键、文档里的接口名。
  const cases = [
    ['run.launch', '<launch>\n  <!-- 注释里的 image_topic 不算 -->\n  <arg name="image_topic" default="/camera/image_raw"/>\n</launch>', 'image_topic', 'unreviewed'],
    ['note.md', '订阅 `image_topic`，细节见下。', 'image_topic', 'unreviewed'],
    ['conf.json', '{\n  "image_topic": "/camera/image_raw"\n}', 'image_topic', 'unreviewed'],
    ['run.launch', '<launch><arg name="image_topic"/></launch>', 'image_topic_missing', 'symbol-missing'],
    ['note.md', '只提到别的名字。', 'image_topic_missing', 'symbol-missing'],
  ]
  for (const [file, text, symbol, expected] of cases) {
    writeFileSync(join(repo, 'src', file), text)
    assert.equal(scanAnchors(repo, [{ file: 'src/' + file, symbol }])[0].status, expected, file + ':' + symbol)
  }
  // 二进制：符号名前面恰好有引号字节 + NUL 时，不能把后面的符号当成「未闭合字符串」整段吞掉。
  const bin = 'src/blob.bin'
  writeFileSync(join(repo, bin), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x22, 0x00, 0x5f, 0x5a, 0x4e, 0x39, 0x66, 0x6f, 0x6f, 0x45, 0x00]))
  assert.equal(scanAnchors(repo, [{ file: bin, symbol: '_ZN9fooE' }])[0].status, 'unreviewed')
  assert.equal(scanAnchors(repo, [{ file: bin, symbol: '_ZN9barE' }])[0].status, 'symbol-missing')
})

test('源码内容变化触发门禁；普通写入不能洗掉旧基线，显式复核才更新', async (t) => {
  const { call, full, organs, source, dir } = await fixture(t)
  assert.equal((await call('organ_put', { organ: active(organs[0]) })).ok, true)
  const before = JSON.parse(readFileSync(join(dir, 'organs', 'one.json')))
  assert.match(before.anchors[0].sha256, /^[0-9a-f]{64}$/)
  writeFileSync(source, 'export function processInput() { return 2; }\n')
  assert.ok((await call('check')).errors.some((e) => e.code === 'anchor/source-changed'))
  assert.equal((await call('brief', { organ: 'one' })).ok, false)
  assert.equal((await call('render')).ok, false)
  assert.equal((await call('organ_put', { organ: active(organs[0]) })).ok, false)
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'organs', 'one.json'))), before)
  assert.equal((await call('organ_put', { organ: active(organs[0]), reviewSources: true })).ok, true)
  const after = (await full()).organs.find((o) => o.id === 'one')
  assert.notEqual(after.anchors[0].sha256, before.anchors[0].sha256)
  assert.equal((await call('check')).ok, true)
  await call('render')
  const receipt = JSON.parse(readFileSync(join(dir, 'receipt.json')))
  assert.equal(receipt.sourceEvidence[0].sha256, after.anchors[0].sha256)
  const history = await call('history')
  const revision = history.revisions.find((r) => r.action === 'organ_put')
  const snapshot = JSON.parse(readFileSync(join(dir, 'history', 'rev-' + String(revision.rev).padStart(4, '0') + '.json')))
  assert.equal(snapshot.organs.find((o) => o.id === 'one').anchors[0].sha256, before.anchors[0].sha256)
})

test('未复核的旧图明确报告证据缺失；仓库外锚点、目录锚点拒绝', async (t) => {
  const { repo, root, organs, call } = await fixture(t)
  const body = (await call('show')).body
  const result = checkBody(body, [active(organs[0])], { flows: [] }, { repoRoot: repo })
  assert.ok(result.warnings.some((e) => e.code === 'anchor/unreviewed'))
  writeFileSync(join(root, 'outside.js'), 'function external() {}')
  symlinkSync(join(root, 'outside.js'), join(repo, 'src', 'external.js'))
  for (const file of ['../outside.js', join(root, 'outside.js'), 'src/external.js']) {
    assert.equal(scanAnchors(repo, [{ file }])[0].status, 'path-invalid')
  }
  assert.equal(scanAnchors(repo, [{ file: 'src' }])[0].status, 'file-unreadable')
})

test('缺成分或契约阻止已落地声明，计划态不受影响', async (t) => {
  const { organs, call } = await fixture(t)
  for (const field of ['composition', 'contract']) {
    const organ = active(organs[0]); delete organ[field]
    const result = await call('organ_put', { organ })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.code === 'organ/' + field + '-missing'))
  }
  assert.equal((await call('organ_put', { organ: organs[0] })).ok, true)
})

test('同层和字数只提醒，严格模式保留源码和结构门禁', async (t) => {
  const { organs, call } = await fixture(t)
  const body = (await call('show')).body
  body.oneline = '说明'.repeat(50)
  body.systems.forEach((s) => { s.alt = 0.5 })
  organs[0].gist = '说明'.repeat(40)
  const result = checkBody(body, organs, { flows: [] })
  assert.equal(result.ok, true)
  for (const code of ['system/alt-tie', 'organ/gist-long', 'body/oneline-long']) assert.ok(result.warnings.some((w) => w.code === code))
})

test('双向跨层连接违反任一单向分层规则，同层双向仍有效', async (t) => {
  const { organs, flows, call } = await fixture(t)
  const body = (await call('show')).body
  for (const direction of ['up', 'down']) {
    const policy = { rules: [{ id: 'layers', type: 'layer-direction', direction }] }
    assert.equal(evaluatePolicy(policy, { body, organs, flows: [{ ...flows[0], direction: 'two-way' }] }).length, 1)
    assert.equal(evaluatePolicy(policy, { body, organs, flows }).length, direction === 'up' ? 0 : 1)
  }
  body.systems[1].alt = 0
  assert.equal(evaluatePolicy({ rules: [{ id: 'layers', type: 'layer-direction', direction: 'up' }] }, { body, organs, flows: [{ ...flows[0], direction: 'two-way' }] }).length, 0)
})

test('局部修改包有非法条目时整包拒绝，不提交合法子集', async (t) => {
  const { full, call } = await fixture(t)
  const before = await full()
  const result = await call('apply_edits', { baseHash: before.anatomyHash, edits: [...patch('不该落盘'), { kind: 'organ', id: 'missing', patch: { gist: '不存在' } }] })
  assert.equal(result.error.code, 'anatomy/invalid-edits')
  assert.equal((await full()).anatomyHash, before.anatomyHash)
})

test('单次 strict=true 能覆盖宽松插件配置', async (t) => {
  const { call, organs } = await fixture(t, { strict: false })
  const organ = { ...organs[0], status: 'active' }
  assert.equal((await call('organ_put', { organ })).ok, true)
  assert.equal((await call('check', { strict: true })).ok, false)
})
