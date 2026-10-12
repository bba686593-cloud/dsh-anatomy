// 人保存下来的修改包（anatomy-edits-*.json）的发现与归档。
//
// 为什么要扫多个目录：静态 HTML 没法直接写进工程目录，人点「保存」时浏览器要么让他选路径，
// 要么落到下载目录。与其要求人"必须放对位置"，不如让 AI 侧主动去找——找到就提醒、能落地就落地。
// 落地之后文件会被归档到 edits/applied/，既是凭据，也避免同一个包被重复应用。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const EDIT_FILE_PATTERN = /^anatomy-edits.*\.json$/i

/** 默认扫描位置：解剖体的 edits/ 与自身、工程根目录，最后兜底看下载目录。 */
export function editSearchDirs(anatomyDir, rootDir, repoRoot) {
  const dirs = [join(anatomyDir, 'edits'), anatomyDir]
  if (repoRoot) dirs.push(repoRoot, join(repoRoot, 'edits'))
  if (rootDir) dirs.push(rootDir, join(rootDir, 'edits'))
  const home = process.env.HOME
  if (home) dirs.push(join(home, 'Downloads'))
  return [...new Set(dirs.filter((d) => typeof d === 'string' && d !== '').map((d) => resolve(d)))]
}

/**
 * 扫描修改包。bodySlug 给了就只保留对得上的（包里有 body 字段时）。
 * 返回按导出时间正序的清单；冲突由应用端的 baseHash 门禁处理。
 */
export function scanEditFiles(dirs, bodySlug = null) {
  const out = []
  const seen = new Set()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!EDIT_FILE_PATTERN.test(name)) continue
      const file = join(dir, name)
      if (seen.has(file)) continue
      seen.add(file)
      let bundle = null
      try {
        bundle = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        continue    // 坏文件跳过，不影响别的包
      }
      const isArray = Array.isArray(bundle)
      const edits = isArray ? bundle : bundle?.edits
      if (!Array.isArray(edits) || edits.length === 0) continue
      const slug = isArray ? null : (bundle.body ?? null)
      if (bodySlug && slug !== bodySlug) continue // 无归属的旧包只能显式导入，不能跨工程自动应用
      out.push({
        file,
        at: isArray ? null : (bundle.at ?? null),
        actor: (isArray ? null : bundle.actor) ?? 'human',
        body: slug,
        count: edits.length,
        bundle: isArray ? { edits } : bundle,
      })
    }
  }
  out.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')) || a.file.localeCompare(b.file))
  return out
}

/** 落地后归档：拷进 edits/applied/ 再删原文件（跨文件系统也安全）。 */
export function archiveEditFile(anatomyDir, file) {
  const target = join(anatomyDir, 'edits', 'applied')
  try {
    mkdirSync(target, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const base = file.split('/').pop().replace(/\.json$/i, '')
    const dest = join(target, base + '.' + stamp + '.json')
    writeFileSync(dest, readFileSync(file, 'utf8'), 'utf8')
    rmSync(file)
    return dest
  } catch {
    return null
  }
}
