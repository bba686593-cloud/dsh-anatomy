// A real mapping of this plugin. Writes a new anatomy directory, never rewrites an existing one.
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'
import { boardFor } from '../lib/board.js'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2), staticOnly = args.includes('--static')
const dir = resolve(args.find(arg => arg !== '--static') || join(repo, 'anatomy-coread-demo'))
const tools = new Map()
apply({ tools: { register(def) { tools.set(def.name, def); return () => {} } } }, { rootDir: repo, autoServe: !staticOnly, autoOpen: !staticOnly })
async function call(name, args = {}) {
  const result = await tools.get('anatomy_' + name).execute({ dir, repoRoot: repo, ...args })
  if (!result.ok) throw new Error(JSON.stringify(result, null, 2))
  return result
}
const initialized = await call('init', { body: 'coread-demo', title: 'Anatomy 如何把工程讲清楚', oneline: '从读取工程事实，到检查、反查和人机共同阅读。', systems: [
  { id: 'input', name: '接入与存档', gist: '接住请求并读取工程事实', alt: 0 },
  { id: 'reason', name: '检查与解释', gist: '检查证据并说明工程关系', alt: 0.5 },
  { id: 'delivery', name: '共同阅读', gist: '把同一份事实交给人和 AI', alt: 1 },
] })
const anchor = (file, symbol, role, reason) => ({ file, ...(symbol ? { symbol } : {}), role, reason })
const unit = (id, name, gist, system, inputs, outputs, boundary, code, symbol, reason, test) => ({
  id, name, gist, systems: [system], status: 'active', story: gist + '。只依据已声明的数据处理；证据不足时让读者看见缺口。',
  composition: [{ name, role: reason, anchor: anchor(code, symbol, 'implementation', reason) }],
  contract: { in: inputs, out: outputs, invariants: ['保留工程事实与诊断，不把推断说成已验证结果'] },
  not_responsible: [boundary], observables: ['运行对应测试，核对结果和拒绝路径'],
  anchors: [anchor(code, symbol, 'implementation', reason), anchor(test, null, 'test', '覆盖该职责的行为与边界')],
})
const organs = [
  unit('entry', '请求接入', '把用户或 AI 的请求送到对应操作', 'input', ['读取、修改或交付请求'], ['带参数的操作'], '不推测未声明的业务语义', 'lib/tools.js', 'registerAnatomyTools', '注册操作并协调读取、校验与交付', 'test/e2e.mjs'),
  unit('state', '工程事实', '读取职责、关系和源码定位', 'input', ['解剖体目录'], ['结构快照'], '不决定职责划分是否合理', 'lib/store.js', 'loadBody', '读取随工程保存的事实', 'test/regressions.mjs'),
  unit('check', '证据检查', '检查结构、场景连通和源码变化', 'reason', ['结构快照和源码根'], ['诊断与证据状态'], '不证明业务实现正确', 'lib/check.js', 'checkBody', '执行交付和写入前的检查', 'test/regressions.mjs'),
  unit('mapping', '工程反查', '从文件找到职责并解释可能受影响的范围', 'reason', ['已声明的文件与职责关系'], ['文件索引和复核候选'], '不把推导候选当成真实调用图', 'lib/mapping.js', 'impactOf', '按流向、构成和共享文件给出影响依据', 'test/co-reading.mjs'),
  unit('reader', '人机说明', '用同一份事实解释业务场景和改动范围', 'delivery', ['职责、场景和映射'], ['人读地图与 AI 术前说明'], '不自动执行验证命令', 'lib/digest.js', 'briefOrgan', '整理边界、上下游、文件和验收线索', 'test/co-reading.mjs'),
  unit('chart', '共读界面', '让人沿场景逐步理解并修改共同意图', 'delivery', ['结构快照与场景'], ['可交互图和带版本的修改包'], '不在浏览器里直接改业务代码', 'lib/render.js', 'renderAnatomy', '生成包含数据和交互脚本的独立图', 'test/render-smoke.mjs'),
]
organs.find((o) => o.id === 'chart').anchors.push(anchor('lib/chart-client.js', 'scenarioReading', 'interface', '场景导航、行为摘要和完整工程编辑'))
const link = (id, from, to, gist) => ({ id, name: gist, from, to, medium: 'data', gist, vessel: '工具协调下的内存数据交接', payload: [{ name: '结构数据', role: gist }] })
const flows = [link('load', 'entry', 'state', '确定要读取的工程'), link('inspect', 'state', 'check', '交付待核对的结构事实'), link('explain', 'check', 'mapping', '检查后解释工程关系'), link('brief', 'mapping', 'reader', '把映射依据写进改动说明'), link('view', 'check', 'chart', '把可交付的事实展示给读者')]
flows.forEach((flow,i)=>{flow.timing={latencyMs:[1,3,2,4,8][i],basis:'estimated',method:'为共读示例设定的估计值，并非性能测量'};})
organs.find(o=>o.id==='mapping').math='受影响集合＝沿数据方向可达的职责集合 ∪ 共享实现所关联的职责集合。'
organs.find(o=>o.id==='mapping').rules=[{id:'response-time',statement:'工程反查应及时返回',metric:'响应耗时',relation:'≤',limit:20,unit:'毫秒'}]
organs.find(o=>o.id==='mapping').anchors.push(anchor('lib/semantics.js','temporalModel','implementation','以有向传递耗时计算路程'))
organs.find(o=>o.id==='check').anchors.push(anchor('lib/verification.js','evaluateVerification','implementation','根据版本和测量证据核验上层数值意图'))
// This particular example chooses a structural map. Clearing only the local
// fallback input requests that view explicitly; init itself stays a blank canvas.
const board = boardFor({ ...initialized.body, board: undefined }, organs, flows)
await call('scaffold', { organs, flows, board, scenarios: [
  { id: 'change', name: '准备修改一个工程文件', trigger: 'AI 收到改动需求', steps: [
    { organ: 'entry', action: '确定目标工程与读取请求' },
    { organ: 'state', flow: 'load', action: '读取职责、关系和定位' },
    { organ: 'check', flow: 'inspect', action: '核对结构与源码证据' },
    { organ: 'mapping', flow: 'explain', action: '找到文件所属职责与复核候选' },
    { organ: 'reader', flow: 'brief', action: '对照边界、场景与验证线索再修改' },
  ], outcome: '人和 AI 知道为什么改、可能影响谁、改完怎么验证', acceptance: ['影响候选附有流向或共享文件依据', '未关联测试的职责被明确指出'] },
  { id: 'read', name: '把工程讲给人听', trigger: '维护者需要理解或纠正工程说明', steps: [
    { organ: 'entry', action: '请求生成共读图' }, { organ: 'state', flow: 'load', action: '读取同一份事实' },
    { organ: 'check', flow: 'inspect', action: '拒绝带结构错误的数据' }, { organ: 'chart', flow: 'view', action: '沿场景阅读并把修正导出给 AI' },
  ], outcome: '读者理解业务过程，修正以版本化修改包进入工程', acceptance: ['点击步骤能跳到负责的职责', '修改包带有页面基线版本'] },
] })
await call('map', { write: true })
await call('digest', { write: true })
const result = await call('render')
console.log(result.file)
