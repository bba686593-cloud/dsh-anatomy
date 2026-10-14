// Optional configured executor. A browser can never choose the executable.
import { join } from 'node:path'
import { createAgentRecognitionRunner, loadAgentRecognitionConfig } from './recognition-agent.mjs'
import { readRecognitionRequest, recognitionJobDirectory, updateRecognitionRequest } from '../lib/recognition.js'
const [dir, id] = process.argv.slice(2)
let request, timer, claimed = false
try {
  request = readRecognitionRequest(dir, id).request
  const configPath = process.env.ANATOMY_RECOGNITION_AGENT_CONFIG
  const config = await loadAgentRecognitionConfig(configPath)
  updateRecognitionRequest(dir, { id, action: 'claim', imageHash: request.imageHash })
  claimed = true
  const controller = new AbortController(), jobDir = recognitionJobDirectory(dir, id)
  timer = setInterval(() => {
    try { if (!['pending', 'processing'].includes(readRecognitionRequest(dir, id).request.status)) controller.abort() } catch { controller.abort() }
  }, 500)
  const result = await createAgentRecognitionRunner({ config })({ jobDir, imagePath: join(jobDir, 'input.png'), mode: request.mode, signal: controller.signal })
  updateRecognitionRequest(dir, { id, action: 'complete', imageHash: request.imageHash, ...result })
} catch (error) {
  if (request && (claimed || request.status === 'pending')) { try { updateRecognitionRequest(dir, { id, action: 'fail', imageHash: request.imageHash, expectedStatus: claimed ? 'processing' : 'pending', error: error.message }) } catch {} }
} finally { clearInterval(timer) }
