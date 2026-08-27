// Starts Vite, then launches Electron pointed at it. No concurrently/wait-on needed.
import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import electron from 'electron'

const server = await createServer()
await server.listen()
const url = server.resolvedUrls.local[0]
console.log('vite ready at', url)

const env = { ...process.env, VITE_DEV_URL: url }
// VS Code / JetBrains integrated terminals set this, which would boot Electron as plain Node.
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(electron, ['.'], { stdio: 'inherit', env })
child.on('close', async () => {
  await server.close()
  process.exit(0)
})
