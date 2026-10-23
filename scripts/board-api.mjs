#!/usr/bin/env node
import { listVersions, saveVersion, selectVersion, selectedVersion, withVersionLock } from '../lib/versions.js'
import { MAX_BOARD_REQUEST_BYTES } from '../lib/images.js'
import { loadBody, loadOrgans, loadFlows } from '../lib/store.js'
import { renderAnatomy } from '../lib/render.js'
import { readFileSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
let input = ''
try {
  let bytes=0
  const decoder=new StringDecoder('utf8')
  for await (const chunk of process.stdin) { bytes+=chunk.length; if(bytes>MAX_BOARD_REQUEST_BYTES)throw Object.assign(Error('画板请求不能超过 12 MiB。'),{status:413,code:'version/request-limit'});input+=decoder.write(chunk) }
  input+=decoder.end()
  const { action, payload = {} } = JSON.parse(input)
  const dir = process.argv[2]
  const result = action === 'view' ? {ok:true,html:renderAnatomy(loadBody(dir),loadOrgans(dir),loadFlows(dir).flows??[])} : action === 'list' ? withVersionLock(dir,()=>listVersions(dir)) : action === 'current' ? withVersionLock(dir,()=>({...listVersions(dir),board:selectedVersion(dir)?.version.board??null})) : action === 'save' ? saveVersion(dir, payload) : action === 'select' ? selectVersion(dir, payload) : (() => { throw Error('未知版本操作') })()
  const pluginVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version
  process.stdout.write(JSON.stringify({ status: 200, result:{...result,pluginVersion} }))
} catch (error) { process.stdout.write(JSON.stringify({ status: error.status ?? 500, result: { ok: false, error: { code: error.code ?? 'version/error', message: error.message }, errors: error.errors } })) }
