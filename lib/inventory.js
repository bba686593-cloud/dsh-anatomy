import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, extname } from 'node:path'

/** Explicit, bounded scan. Hidden/dependency/generated directories and symlinks are excluded. */
export function sourceInventory(repoRoot, scopes, index, limit = 3000) {
  if (!Array.isArray(scopes) || !scopes.length) throw new Error('扫描必须显式给 scope，例如 ["src", "lib"]')
  const root = realpathSync(repoRoot), files = new Set(), visited = new Set(), skipped = [], errors = []
  const extensions = new Set(['.js','.mjs','.cjs','.jsx','.ts','.tsx','.py','.pyi','.c','.h','.cpp','.hpp','.cc','.rs','.go','.java','.cs','.swift','.kt','.vue','.svelte','.sh','.sql','.json','.yaml','.yml','.toml'])
  const excluded = new Set(['node_modules','vendor','dist','build','coverage','__pycache__'])
  let truncated = false, entries = 0
  const inside = (file) => { const rel = relative(root, file); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) }
  const visit = (path, depth = 0) => {
    if (visited.has(path) || truncated) return
    visited.add(path)
    if (++entries > limit * 4 || files.size >= limit || depth > 40) { truncated = true; return }
    try {
      if (lstatSync(path).isSymbolicLink()) { skipped.push(relative(root, path)); return }
      if (!inside(realpathSync(path))) throw new Error('路径离开仓库')
      if (lstatSync(path).isDirectory()) {
        for (const entry of readdirSync(path).sort()) {
          if (entry.startsWith('.') || entry.startsWith('anatomy-') || excluded.has(entry)) continue
          visit(resolve(path, entry), depth + 1)
          if (truncated) break
        }
      } else if (extensions.has(extname(path)) && lstatSync(path).isFile()) files.add(relative(root, path).split('\\').join('/'))
    } catch (error) { errors.push({ path: relative(root, path), message: error.message }) }
  }
  for (const scope of scopes) {
    if (typeof scope !== 'string' || !scope.trim() || isAbsolute(scope) || !inside(resolve(root, scope))) throw new Error('scope 必须是仓库内相对路径')
    visit(resolve(root, scope))
  }
  const scanned = [...files].sort(), mapped = new Set(index.files.map((f) => f.file))
  const covered = scanned.filter((f) => mapped.has(f)), unmapped = scanned.filter((f) => !mapped.has(f))
  return { scope: scopes, scanned: scanned.length, mapped: covered.length, unmapped, skipped, errors, truncated,
    coverage: scanned.length && !truncated && !errors.length ? covered.length / scanned.length : null,
    note: '覆盖率只表示所给范围内扫描到的文件是否被锚点引用；不表示功能覆盖率、测试通过率或语义正确率。' }
}
