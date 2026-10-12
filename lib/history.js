// 修订历史：每次写入前留一份完整快照，任何一次改动都能回退。
//
// 为什么用"完整快照 + JSONL 索引"而不是增量 diff：
//   解剖体很小（几十个器官、几十条血脉，几十 KB），完整快照实现简单、恢复可靠、
//   出事时不需要按顺序重放；用条数上限控制体积就够了。
//
// 人改的、AI 改的，都记在同一本账上——actor 字段区分来源，回退时不问是谁改的。

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { anatomyFingerprint } from './store.js'

export const SNAPSHOT_SCHEMA = 'anatomy-snapshot/1'
export const HISTORY_DIR = 'history'
export const HISTORY_LOG = 'history.jsonl'
export const MAX_SNAPSHOTS = 30

/** 读索引（一行一条修订），坏行跳过而不是整个炸掉。 */
export function readHistory(dir) {
  const file = join(dir, HISTORY_LOG)
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (text === '') continue
    try {
      out.push(JSON.parse(text))
    } catch {
      /* 索引坏行不影响快照文件本身，跳过 */
    }
  }
  return out
}

export function nextRev(dir) {
  const list = readHistory(dir)
  return (list.length === 0 ? 0 : list[list.length - 1].rev) + 1
}

/**
 * 记一次修订。state 是"改动之前"的完整状态——回退到这一版就等于回到动手之前。
 * meta: { action, actor, summary }
 */
export function recordRevision(dir, state, meta = {}) {
  const rev = nextRev(dir)
  const at = new Date().toISOString()
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    rev,
    at,
    action: meta.action ?? 'write',
    actor: meta.actor ?? 'ai',
    summary: meta.summary ?? '',
    anatomyHash: anatomyFingerprint(state.body, state.organs, state.flows),
    body: state.body,
    organs: state.organs,
    flows: state.flows,
    policy: state.policy ?? null,
  }
  const snapshotDir = join(dir, HISTORY_DIR)
  mkdirSync(snapshotDir, { recursive: true })
  writeFileSync(join(snapshotDir, snapshotFileName(rev)), JSON.stringify(snapshot, null, 2) + '\n', 'utf8')
  appendFileSync(join(dir, HISTORY_LOG), JSON.stringify({
    rev,
    at,
    action: snapshot.action,
    actor: snapshot.actor,
    summary: snapshot.summary,
    anatomyHash: snapshot.anatomyHash,
    counts: { organs: state.organs.length, flows: state.flows.length },
  }) + '\n', 'utf8')
  pruneHistory(dir)
  return { rev, at, anatomyHash: snapshot.anatomyHash }
}

export function snapshotFileName(rev) {
  return 'rev-' + String(rev).padStart(4, '0') + '.json'
}

export function loadSnapshot(dir, rev) {
  const file = join(dir, HISTORY_DIR, snapshotFileName(rev))
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** 最近的修订（倒序），limit 默认 20。 */
export function listHistory(dir, limit = 20) {
  const list = readHistory(dir)
  const tail = list.slice(-Math.max(1, limit))
  return tail.reverse()
}

/** 只保留最近 MAX_SNAPSHOTS 份快照；索引不删（它是账本，很小）。 */
export function pruneHistory(dir) {
  const snapshotDir = join(dir, HISTORY_DIR)
  if (!existsSync(snapshotDir)) return
  const files = readdirSync(snapshotDir).filter((n) => /^rev-\d+\.json$/.test(n)).sort()
  for (const name of files.slice(0, Math.max(0, files.length - MAX_SNAPSHOTS))) {
    rmSync(join(snapshotDir, name))
  }
}
