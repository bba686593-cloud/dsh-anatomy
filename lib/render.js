import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anatomyFingerprint } from './store.js'
import { boardFor } from './board.js'
import { autoLayout } from './layout.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * 客户端资源按需读取，用 mtime 当缓存键。
 *
 * 为什么不在模块加载时读死：
 *   ① 插件升级（改了 board-client.js / board.html）后，已经载入内存的旧资源会一直被沿用，
 *      直到宿主重启为止——明明同步了新版本，看到的却还是旧界面；
 *   ② 任何一个资源缺失都会让本模块 import 失败，插件其余工具跟着一起挂掉，
 *      而报错信息还指不到是哪个文件。
 * 现在：每次渲染比对 mtime，文件没动就复用，动了立刻生效；缺失时给出指名道姓的错误。
 */
const PARTS = ['board.html', 'board-space-input.js', 'board-space-renderer.js', 'vendor/three-space.js', 'board-space-client.js', 'board-space-recognition.js', 'board-space.js', 'board-client.js', 'board-drawing-client.js', 'board-graphics-client.js', 'drawing.js', 'board-math-client.js', 'board-versions-client.js', 'board-edit-client.js', 'board-paper-client.js', 'board-image-client.js', 'board-reading-client.js', 'layout.js', 'board.js', 'images.js', 'reading.js', 'math.js', 'semantics.js', 'surface.js', 'vendor/katex.cjs', 'vendor/mathjax-tex-svg.js']
let kit = null

function stampOf() {
  return PARTS.map((name) => {
    try { return name + ':' + statSync(join(here, name)).mtimeMs } catch { return name + ':missing' }
  }).join('|')
}

function readPart(name) {
  try {
    return readFileSync(join(here, name), 'utf8')
  } catch (error) {
    throw Error('画板资源读不到：' + name + '（' + String(error?.message ?? error) + '）；插件安装可能不完整。')
  }
}

function loadKit() {
  const stamps = stampOf()
  if (kit !== null && kit.stamps === stamps) return kit
  const strip = (name) => readPart(name).replace(/^import .*$/gm, '').replace(/^export /gm, '')
  kit = {
    stamps,
    template: readPart('board.html'),
    shared: strip('surface.js') + '\n' + strip('semantics.js') + '\n' + strip('images.js') + '\n' + strip('layout.js') + '\n' + strip('board.js') + '\n' + strip('drawing.js') + '\n' + strip('board-space.js'),
    reading: strip('reading.js'),
    math: strip('math.js'),
    katex: readPart('vendor/katex.cjs'),
    mathjax: readPart('vendor/mathjax-tex-svg.js').replace(/<\/script/gi, '<\\/script'),
    three: readPart('vendor/three-space.js').replace(/<\/script/gi, '<\\/script'),
    extensions: readPart('board-math-client.js')+'\n'+readPart('board-edit-client.js')+'\n'+readPart('board-paper-client.js')+'\n'+readPart('board-image-client.js')+'\n'+readPart('board-reading-client.js')+'\n'+readPart('board-versions-client.js')+'\n'+readPart('board-drawing-client.js')+'\n'+readPart('board-graphics-client.js')+'\n'+readPart('board-space-renderer.js')+'\n'+readPart('board-space-input.js')+'\n'+readPart('board-space-client.js')+'\n'+readPart('board-space-recognition.js'),
    client: readPart('board-client.js'),
  }
  return kit
}

export function renderAnatomy(body, organs, flows, options = {}) {
  const parts = loadKit()
  const rawBoard=boardFor(body,organs,flows)
  const clientVersion=JSON.parse(readFileSync(join(here,'../package.json'),'utf8')).version
  const payload = { clientVersion, body, organs, flows, board: rawBoard.layout?.mode==='manual'?rawBoard:autoLayout(rawBoard), anatomyHash: anatomyFingerprint(body, organs, flows), implementation: options.implementation ?? null, banner: options.banner ?? null }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  if (!parts.template.includes('/*__CLIENT__*/')) throw Error('画板模板缺少 /*__CLIENT__*/ 占位符，board.html 可能被改坏了。')
  if (!parts.client.includes('__PAYLOAD__')) throw Error('画板客户端缺少 __PAYLOAD__ 占位符，board-client.js 可能被改坏了。')
  const svgRenderer='if(document.head && document.createElementNS){window.MathJax={startup:{typeset:false},svg:{fontCache:"local"},options:{enableMenu:false}};\n'+parts.mathjax+';\n}\n'
  return parts.template.replace('<head>', '<head>\n<meta name="anatomy-plugin-version" content="'+clientVersion+'">').replace('/*__CLIENT__*/', () => parts.three + ';\n' + parts.katex + ';\n' + svgRenderer + parts.shared + '\n' + parts.reading + '\n' + parts.math + '\n' + parts.client.replace('__PAYLOAD__', () => json) + '\n' + parts.extensions)
}

export function writeAnatomyHtml(dir, html, outFile = 'anatomy.html') {
  const file = join(dir, outFile)
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html, 'utf8')
  return file
}
