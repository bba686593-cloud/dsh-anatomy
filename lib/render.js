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
const PARTS = ['board.html', 'board-client.js', 'board-math-client.js', 'board-versions-client.js', 'layout.js', 'board.js', 'reading.js', 'math.js', 'semantics.js', 'vendor/katex.cjs']
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
    shared: strip('semantics.js') + '\n' + strip('layout.js') + '\n' + strip('board.js'),
    reading: strip('reading.js'),
    math: strip('math.js'),
    katex: readPart('vendor/katex.cjs'),
    extensions: readPart('board-math-client.js')+'\n'+readPart('board-versions-client.js'),
    client: readPart('board-client.js'),
  }
  return kit
}

export function renderAnatomy(body, organs, flows, options = {}) {
  const parts = loadKit()
  const rawBoard=boardFor(body,organs,flows)
  const payload = { body, organs, flows, board: rawBoard.layout?.mode==='manual'?rawBoard:autoLayout(rawBoard), anatomyHash: anatomyFingerprint(body, organs, flows), implementation: options.implementation ?? null, banner: options.banner ?? null }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c')
  if (!parts.template.includes('/*__CLIENT__*/')) throw Error('画板模板缺少 /*__CLIENT__*/ 占位符，board.html 可能被改坏了。')
  if (!parts.client.includes('__PAYLOAD__')) throw Error('画板客户端缺少 __PAYLOAD__ 占位符，board-client.js 可能被改坏了。')
  return parts.template.replace('/*__CLIENT__*/', () => parts.katex + ';\n' + parts.shared + '\n' + parts.reading + '\n' + parts.math + '\n' + parts.client.replace('__PAYLOAD__', () => json) + '\n' + parts.extensions)
}

export function writeAnatomyHtml(dir, html, outFile = 'anatomy.html') {
  const file = join(dir, outFile)
  if (!existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html, 'utf8')
  return file
}
