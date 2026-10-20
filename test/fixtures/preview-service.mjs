// Lightweight protocol peer for lifecycle tests; no recognition model involved.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
const args = process.argv.slice(2)
const value = flag => args[args.indexOf(flag) + 1]
const boardFile = value('--file'), instanceId = value('--instance-id'), state = value('--state-file')
const ocrError = process.env.ANATOMY_TEST_OCR_ERROR || null
const server = createServer((req, res) => {
  if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({service:'anatomy-handwriting',protocol:2,capabilities:["project-versions"],boardFile,instanceId,pid:process.pid,ready:!ocrError,error:ocrError})) }
  else if (req.url === '/anatomy.html') res.end(readFileSync(boardFile))
  else { res.statusCode = 404; res.end() }
})
server.on('error', error => { if(error.code === 'EADDRINUSE' && args.includes('--fallback-port')) server.listen(0, '127.0.0.1'); else throw error })
server.on('listening', () => { writeFileSync(state + '.tmp', JSON.stringify({port:server.address().port,boardFile,instanceId,pid:process.pid})); renameSync(state + '.tmp', state) })
server.listen(Number(value('--port')), '127.0.0.1')
