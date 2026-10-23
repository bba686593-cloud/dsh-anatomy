// Explain one real engineering detail with a working drawing, rather than a
// second picture of the tool's modules. All marks remain ordinary editable parts.
import { existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../lib/index.js'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (file, symbol, reason) => ({ file, symbol, role: 'implementation', reason })
const mapped = (anchors, note) => ({ anchors, implementation: { language: 'JavaScript', note } })
const text = (id, x, y, width, height, content, extra = {}) => ({
  id, type: 'text', x, y, width, height, text: content,
  fontSize: 19, fill: 'none', stroke: '#334155', ...extra,
})
const ink = (id, x, y, width, height, points, color, extra = {}) => ({
  id, type: 'pen', x, y, width, height, points, text: '',
  fill: 'none', stroke: color, strokeWidth: 4, ...extra,
})

export function createBoardDemo() {
  return {
    version: 1,
    layout: { mode: 'manual' },
    reading: {
      summary: '用一处真实可编辑的擦痕解释工程细节：看见什么、为什么还能选中、同一处改动如何进入三维。读者可以直接在旁边补充需求，也可以圈改这幅图；这份导读只安排观察角度。',
      steps: [
        { element: 'paint', title: '先在画面上试', description: '蓝色轮廓真的带有局部擦痕。缺口里露出下面的橙色笔迹；选择、移动或继续擦改，观察两者如何变化。' },
        { element: 'local-coordinates', title: '解释擦痕为什么跟着走', description: '擦痕保存在图元自己的相对坐标中，移动或缩放图元时不会留下一块固定在屏幕上的白色遮挡。' },
        { element: 'same-surface', title: '核对另一种视角', description: '切到三维观察同一个带拉伸的轮廓，再回到二维。显示与选择都读取同一份擦痕，旁边的程序映射给出实现依据。' },
        { element: 'open-question', title: '由人接着改', description: '示例问题尚未提出实现方案。在空白处画出希望的变化，或圈住现有缺口补充约束，再交给 AI 对照工程继续。' },
      ],
    },
    elements: [
      text('title', 48, 24, 1170, 58, '从一处擦痕，读懂画板如何工作', { fontSize: 32, stroke: '#0f172a' }),
      text('subtitle', 50, 92, 1110, 68, '这是一张可继续工作的画板。先看和试，再按需要展开解释；图解、数学和人的补充都留在同一个地方。', { fontSize: 20, stroke: '#64748b' }),

      text('drawing-caption', 66, 180, 490, 40, '可操作的局部示例', { fontSize: 22, stroke: '#0f172a' }),
      ink('underlying-ink', 90, 315, 465, 102,
        [[0, .7], [.1, .33], [.22, .6], [.34, .15], [.47, .5], [.61, .06], [.75, .4], [.88, .2], [1, .36]], '#f59e0b', {
          strokeWidth: 12, sourceTitle: '下面的一笔，也能从缺口选中',
          ...mapped([source('lib/board-client.js', 'hitStackAt', '二维命中跳过擦除的表面，继续寻找下面的图元。')], '这条示例笔迹独立保留，蓝色轮廓的缺口不会形成一块挡住它的白色图元。'),
        }),
      {
        id: 'paint', type: 'polygon', x: 84, y: 242, width: 450, height: 242,
        z: 55, extrusion: 48,
        points: [[0, .26], [.13, .03], [.39, 0], [.61, .12], [.84, .04], [1, .3], [.94, .7], [.78, 1], [.53, .88], [.3, .99], [.08, .78]],
        text: '', sourceTitle: '带真实擦痕的蓝色轮廓', fill: '#6366f1', stroke: '#4338ca', strokeWidth: 3,
        erasures: [{ surface: 'body', points: [[.52, -.08], [.48, .32], [.6, .63], [.56, 1.08]], radius: [.08, .15] }],
        ...mapped([
          source('lib/board-drawing-client.js', 'applyElementErasureSvg', '二维显示用局部遮罩擦去轮廓，而不是画白色盖板。'),
          source('lib/board-space-renderer.js', 'applyErasures', '三维材质读取相同的局部擦痕。'),
        ], '这是画板中的真实多边形与擦痕数据，能继续移动、旋转、拉伸和擦除；轮廓并不代表某个模块。'),
      },
      text('gap-label', 70, 513, 505, 84, '缺口是真的空了。\n橙线属于另一笔；蓝色轮廓的原形和源码关联仍然保留。', { fontSize: 19 }),
      ink('gap-emphasis', 281, 276, 122, 194,
        [[.56, 0], [.91, .12], [1, .4], [.88, .79], [.63, 1], [.18, .94], [0, .7], [.03, .34], [.21, .05]], '#e11d48', {
          strokeWidth: 3, sourceTitle: '观察缺口的圈注：可擦掉或重画',
        }),

      text('coordinate-caption', 655, 190, 532, 42, '为什么移动后，擦痕还跟着它？', { fontSize: 23, stroke: '#0f172a' }),
      {
        id: 'local-coordinates', type: 'math', x: 654, y: 249, width: 548, height: 130,
        text: '以图元左上角为原点，用宽与高换算相对位置；先转回图元自己的方向。',
        math: 'u = (x − x₀) / w,  v = (y − y₀) / h',
        fill: 'none', stroke: '#4338ca', fontSize: 21,
        ...mapped([
          source('lib/board-drawing-client.js', 'drawingSurfacePoint', '将画板坐标转回图元局部方向并归一化。'),
          source('lib/surface.js', 'surfaceErased', '按擦痕半径计算当前位置是否落在局部擦除路径内。'),
        ], '数学关系解释二维位置换算；三维拾取另将交点变换到图元局部空间，不把屏幕坐标当作三维坐标。'),
      },
      text('same-surface', 655, 413, 548, 133, '换到三维，观察同一处切口\n\n这里的蓝色轮廓已有真实拉伸深度。切到三维旋转它，显示与命中都会避开擦掉的部分。', {
        ...mapped([
          source('lib/board-space-renderer.js', 'normalizedErasurePoint', '将三维表面交点换算成相对局部坐标。'),
          source('lib/board-space-renderer.js', 'erasedHit', '选取时排除擦痕内的表面交点。'),
          source('lib/board.js', 'elementProgram', '把原始图元、擦痕、程序映射一起交给 AI，不把原文冒充当前擦后画面。'),
        ], '显示、命中与程序反查共用图元数据。三维切口与二维缺口属于同一对象。'),
      }),

      ink('observation-divider', 58, 624, 1140, 8, [[0, .7], [.2, .2], [.46, .45], [.72, .15], [1, .5]], '#cbd5e1', { strokeWidth: 2 }),
      text('open-question', 66, 674, 477, 141, '接下来，由你改变这张图\n\n示例问题：希望只留下轮廓的一部分，还是想挪开它看清下面？在这里画出希望的样子，或直接圈改左边。', { fontSize: 21, stroke: '#0f172a' }),
      text('open-space', 664, 675, 527, 58, '这一块留给你的草图、截图或补充条件。', { fontSize: 20, stroke: '#94a3b8' }),
      text('continue', 66, 860, 1124, 80, '把修改保存成项目版本，并选为要交给 AI 的版本。AI 先读完整画面与源码依据，再围绕你的改动继续解释或实现。', {
        fontSize: 18, stroke: '#64748b',
        ...mapped([source('lib/versions.js', 'selectedVersion', '读取页面选定的完整版本及其选择修订，保留人提供的绘图基线。')], '画板是后续沟通的共同上下文；保存一张图不等于业务代码已经实现。'),
      }),
    ],
  }
}

export async function buildBoardDemo(dir, { serve = true } = {}) {
  dir = resolve(dir)
  if (existsSync(join(dir, 'body.json'))) throw Error('示例目录已有画板，请传入一个新目录，避免覆盖人的修改。')
  const tools = new Map()
  apply({ tools: { register(definition) { tools.set(definition.name, definition) } } }, { rootDir: repo, autoOpen: false, autoServe: serve })
  const call = async (name, args = {}) => {
    const result = await tools.get('anatomy_' + name).execute({ dir, repoRoot: repo, ...args })
    if (!result.ok) throw Error(JSON.stringify(result, null, 2))
    return result
  }
  await call('init', { body: 'freeboard', title: '在画面上理解，在画面上接着做', oneline: '围绕实际工程细节，和 AI 在同一张画板上观察、圈改和继续实现。' })
  await call('board', { board: createBoardDemo() })
  await call('map', { write: true })
  await call('digest', { write: true })
  return call('render', { serve, open: false })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const result = await buildBoardDemo(args.find(arg => arg !== '--static') || join(repo, 'anatomy-freeboard'), { serve: !args.includes('--static') })
  console.log(result.url || result.file)
}
