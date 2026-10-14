#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRecognitionRequest, readRecognitionRequest, updateRecognitionRequest } from '../lib/recognition.js'
let input = ''
try {
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 6_000_000) throw Error('识别请求过大。') }
  const { action, payload = {} } = JSON.parse(input), dir = process.argv[2]
  let result
  if (action === 'create') {
    result = createRecognitionRequest(dir, payload)
    if (process.env.ANATOMY_RECOGNITION_AGENT_CONFIG) {
      const worker = spawn(process.execPath, [fileURLToPath(new URL('./recognition-worker.mjs', import.meta.url)), dir, result.request.id], { detached: true, stdio: 'ignore', windowsHide: true })
      worker.unref()
    }
  } else if (action === 'read') result = readRecognitionRequest(dir, payload.id)
  else if (action === 'cancel') result = updateRecognitionRequest(dir, { ...payload, action })
  else throw Object.assign(Error('未知的识别操作。'), { status: 400 })
  process.stdout.write(JSON.stringify({ status: 200, result }))
} catch (error) { process.stdout.write(JSON.stringify({ status: error.status || 400, result: { ok: false, error: { message: error.message } } })) }
