// A reviewable spatial board bound to this plugin's actual source files.
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { apply } from '../lib/index.js'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = resolve(process.argv[2] || join(repo, 'anatomy-laser-preview'))
if (existsSync(join(dir, 'body.json'))) throw Error('示例目录已有画板，请传入一个新目录，避免覆盖。')
const tools = new Map()
apply({ tools: { register(d) { tools.set(d.name, d) } } }, { rootDir: repo, autoOpen: false })
async function call(name, args = {}) {
  const result = await tools.get('anatomy_' + name).execute({ dir, repoRoot: repo, ...args })
  if (!result.ok) throw Error(JSON.stringify(result))
  return result
}
await call('init', { body: 'webgl-preview', title: 'Anatomy · 四角激光空间笔', oneline: '固定四角，只移动笔尖，在三维空间中留下轨迹。' })
const node = (id, x, y, z, text, fill, file, symbol, note) => ({
  id, type: 'rect', x, y, z, width: 300, height: 165, text, fill, stroke: '#64748b', strokeWidth: 2, fontSize: 24,
  anchors: [{ file, symbol, role: 'implementation', reason: note }], implementation: { language: 'JavaScript', note },
})
const nodes = [
  node('intent', 0, 0, 0, '工程意图\n图形 · 说明 · 数学', '#eef2ff', 'lib/board.js', 'boardDiagnostics', '检查图元与表达，保留程序映射。'),
  node('model', 480, 0, 100, '统一几何\n平面位置与空间高度', '#eff6ff', 'lib/board-space.js', 'spaceScene', '同一坐标模型处理图元、笔迹与连接。'),
  node('gpu', 960, 0, 220, '空间呈现\n深度遮挡与准确选中', '#ecfdf5', 'lib/board-space-renderer.js', 'createSpaceRenderer', 'GPU 绘制和真实几何拾取。'),
  node('edit', 0, 420, 100, '直接编辑\n拖动 · 绘制 · 撤销', '#faf5ff', 'lib/board-space-client.js', 'spaceCommitGesture', '一次手势形成一次可撤销修改，取消时回滚。'),
  node('version', 480, 420, 220, '项目版本\n保存意图，保留历史', '#fffbeb', 'lib/board-versions-client.js', 'saveProjectVersion', '修改通过同一服务写入不可变项目版本。'),
  node('service', 960, 420, 0, '共同打开\n网页与桌面使用同一画板', '#fff1f2', 'lib/preview.js', 'ensureBoardService', '桌面入口复用画板服务，不再独立覆盖工程。'),
]
const edge = (id, from, to, text) => ({ id, type: 'arrow', from, to, x: 0, y: 0, width: 1, height: 1, text, fontSize: 18, stroke: '#64748b', strokeWidth: 2 })
await call('board', { board: { version: 1, layout: { mode: 'manual' }, elements: [
  ...nodes, edge('intent-model', 'intent', 'model', '同一份图元'), edge('model-gpu', 'model', 'gpu', '投影与拾取'),
  edge('intent-edit', 'intent', 'edit', '人的修改'), edge('edit-version', 'edit', 'version', '确认后保存'),
  edge('version-service', 'version', 'service', '读取选定版本'), edge('service-gpu', 'service', 'gpu', '同一界面'),
] } })
const result = await call('render', { open: false })
console.log(JSON.stringify({ dir, file: result.file, url: result.url ? result.url + '#space' : null, service: result.service }, null, 2))
