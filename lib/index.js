import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerAnatomyTools } from './tools.js'

/** 版本只认 package.json，免得日志里养一个会过期的硬编码版本号。 */
const pluginVersion = (() => {
  try { return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version ?? '?' } catch { return '?' }
})()

/** 插件身份：与 cordis.patch.yml 的 name 一致。 */
export const name = '@dsh-external/dsh-anatomy'

/** 需要 tools（注册工具）与 skills（注册 authoring 技能）两个服务。 */
export const inject = ['tools', 'skills']

/**
 * 配置就地归一化。
 *
 * 这里刻意不导出 `Config`：cordis 的 resolveConfig 只在插件导出 Config 时
 * 才走 `Config['~standard'].validate()`，不导出即原样透传配置对象。
 * 少一个 schema 依赖、少一层版本耦合，缺省即约定。
 */
export function normalizeConfig(input) {
  const raw = input ?? {}
  const rootDir = typeof raw.rootDir === 'string' && raw.rootDir.trim() !== '' ? raw.rootDir : '.'
  const lang = raw.lang === 'en' ? 'en' : 'zh'
  const digestFile = typeof raw.digestFile === 'string' && raw.digestFile.trim() !== '' ? raw.digestFile : 'DIGEST.md'
  // strict：共读质量类问题（缺一句话、没写边界、锚点漂移、叙述混进实现…）也算 error
  const strict = raw.strict !== false
  return { rootDir, lang, digestFile, strict, autoServe: raw.autoServe !== false, autoOpen: raw.autoOpen !== false, pythonPath: typeof raw.pythonPath === 'string' && raw.pythonPath.trim() ? raw.pythonPath : 'python3' }
}

export function apply(ctx, config) {
  const env = normalizeConfig(config)
  const toolCount = registerAnatomyTools(ctx, env)
  const skillName = registerAuthoringSkill(ctx)
  const message =
    '[anatomy] dsh-anatomy ' + pluginVersion + ' 已加载：' +
    toolCount +
    ' 个 anatomy_* 工具' +
    (skillName === null ? '（技能未注册）' : ' + ' + skillName + ' 技能') +
    '（rootDir=' +
    env.rootDir +
    '，lang=' +
    env.lang +
    '，strict=' +
    (env.strict ? 'on' : 'off') +
    '）'
  ctx.logger?.info?.(message)
}

/**
 * 注册 authoring 技能：技能正文就是 skills/anatomy-authoring/SKILL.md 的 body，
 * description 取 frontmatter 的 description 字段。
 */
function registerAuthoringSkill(ctx) {
  const skills = ctx.skills
  if (skills === undefined || typeof skills.register !== 'function') {
    ctx.logger?.warn?.('[anatomy] skills 服务不可用，anatomy-authoring 技能未注册')
    return null
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const skillDir = join(here, '..', 'skills', 'anatomy-authoring')
    const parsed = splitSkillMarkdown(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'))
    if (parsed === null) {
      ctx.logger?.warn?.('[anatomy] SKILL.md 缺少 description frontmatter，技能未注册')
      return null
    }
    const dispose = skills.register({
      name: 'anatomy-authoring',
      description: parsed.description,
      content: parsed.body,
      provider: 'anatomy-plugin',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: skillDir },
      invocation: { modelInvocable: true, userInvocable: true },
    })
    if (typeof ctx.effect === 'function') ctx.effect(() => dispose, '[anatomy] skill anatomy-authoring')
    return 'anatomy-authoring'
  } catch (error) {
    ctx.logger?.warn?.('[anatomy] 技能注册失败：' + String(error))
    return null
  }
}

/** 极简 SKILL.md 拆分：--- 包住的 frontmatter（只取 description）+ 正文。 */
function splitSkillMarkdown(raw) {
  const lines = String(raw).split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return null
  const front = lines.slice(1, end).join('\n')
  const match = /^description:\s*(.+)$/m.exec(front)
  if (match === null) return null
  const description = match[1].trim().replace(/^["']|["']$/g, '')
  if (description === '') return null
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { description, body }
}
