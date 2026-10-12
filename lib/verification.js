import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { anatomyFingerprint, collectAnchors, scanAnchors } from './store.js'
import { intentRules, compareMeasurement } from './semantics.js'

export function verificationContext(body, organs, flows, repoRoot) {
  const rules = intentRules(organs, flows)
  const anchors = collectAnchors(organs, flows, body.board).map(x => x.anchor)
  const sources = repoRoot ? scanAnchors(repoRoot, anchors) : []
  const files = [...new Map(sources.filter(x => x.sha256).map(x => [x.anchor.file, {file:x.anchor.file,sha256:x.sha256}])).values()].sort((a,b) => a.file.localeCompare(b.file))
  const sourceReady = !!repoRoot && files.length > 0 && sources.length === anchors.length && sources.every(x => ['ok','unreviewed'].includes(x.status))
  return { modelHash: anatomyFingerprint(body,organs,flows), sourceHash: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files, sourceReady, rules }
}
export function evaluateVerification(context, report) {
  const current = !!report && report.modelHash === context.modelHash && report.sourceHash === context.sourceHash
  const measurements = Array.isArray(report?.measurements) ? report.measurements : []
  const methodReady = typeof report?.method === 'string' && !!report.method.trim() && typeof report?.observedAt === 'string' && Number.isFinite(Date.parse(report.observedAt)) && Date.parse(report.observedAt) <= Date.now() + 60000
  const checks = context.rules.map(rule => {
    const values = measurements.filter(m => m?.rule === rule.key)
    const measurement = values[0]
    const bound = rule.anchors.some(a => context.files.some(f => f.file === a.file && a.role !== 'test' && a.role !== 'docs')) && rule.anchors.some(a => a.role === 'test' && context.files.some(f => f.file === a.file))
    let status = 'pending'
    if (report && !current) status = 'stale'
    else if (current && context.sourceReady && bound && methodReady && values.length === 1 && measurement.unit === rule.unit && Number.isFinite(measurement.value)) status = compareMeasurement(rule,measurement.value) ? 'pass' : 'fail'
    return { rule:rule.key, statement:rule.statement, target:rule.target, formula:rule.metric+' '+rule.relation+' '+rule.limit+' '+rule.unit, status, ...(measurement ? {observed:measurement.value} : {}), bound }
  })
  const status = !checks.length ? 'unconfigured' : checks.some(c => c.status === 'fail') ? 'fail' : checks.every(c => c.status === 'pass') ? 'pass' : checks.some(c => c.status === 'stale') ? 'stale' : 'pending'
  return { ok:status === 'pass', status, modelHash:context.modelHash, sourceHash:context.sourceHash, checks,
    note:'只核验所提供测量报告中的数值约束、版本和文件绑定；不执行报告中的命令，也不把任意自然语言或数学公式宣称为已证明。' }
}
export function readVerification(dir, context) {
  let report = null
  if (existsSync(join(dir,'verification.json'))) {
    try { report = JSON.parse(readFileSync(join(dir,'verification.json'),'utf8')) } catch { /* unreadable evidence is pending */ }
  }
  return evaluateVerification(context,report)
}
