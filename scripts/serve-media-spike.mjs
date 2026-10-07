// Isolated loopback fixture. No production server, device capture, or persistent accounts.
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'
import { AccessToken } from 'livekit-server-sdk'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function startMediaFixture({ nativeBinary, hearthOrigin } = {}) {
  const fixture = join(root, 'target', 'media-spike')
  const name = `hearth-media-spike-${randomUUID().slice(0, 8)}`
  const apiKey = 'hearth-media-spike'
  const secret = randomBytes(32).toString('hex')
  const image = 'livekit/livekit-server:v1.13.8'
  const config = `port: 17880
bind_addresses: ["${nativeBinary ? '127.0.0.1' : '0.0.0.0'}"]
rtc:
  tcp_port: 17881
  udp_port: 17882
  use_external_ip: false
  node_ip: 127.0.0.1
  enable_loopback_candidate: true
keys:
  ${apiKey}: ${secret}
logging:
  level: error
`
  mkdirSync(fixture, { recursive: true })
  const configPath = join(fixture, `${name}.yaml`)
  writeFileSync(configPath, config, { mode: 0o600 })

  function docker(args, quiet = false) {
    const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(quiet ? result.stderr.trim() : `Docker exited with ${result.status}`)
  }

  let started = false
  let vite
  let native
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    try {
      await vite?.close()
    } finally {
      try {
        if (native) {
        if (native.exitCode === null && native.signalCode === null) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Native test SFU did not stop')), 5000)
            native.once('exit', () => { clearTimeout(timer); resolve() })
            native.kill()
          })
        }
        }
        else if (started) docker(['stop', name], true)
      } finally {
        rmSync(configPath, { force: true })
      }
    }
  }
  try {
    if (nativeBinary) {
      native = spawn(nativeBinary, ['--config', configPath], { cwd: root, stdio: 'ignore', windowsHide: true })
      let spawnError
      native.on('error', (error) => { spawnError = error })
      await new Promise((resolve, reject) => {
        native.once('spawn', resolve)
        native.once('error', reject)
      })
      if (spawnError) throw spawnError
    } else docker(['run', '--rm', '-d', '--name', name,
      '-p', '127.0.0.1:17880:17880', '-p', '127.0.0.1:17881:17881', '-p', '127.0.0.1:17882:17882/udp',
      '--mount', `type=bind,source=${configPath},target=/etc/livekit.yaml,readonly`,
      image, '--config', '/etc/livekit.yaml'], true)
    started = true
    let healthy = false
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch('http://127.0.0.1:17880', { signal: AbortSignal.timeout(1000) })
        if (response.ok) { healthy = true; break }
      } catch { /* Still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!healthy) throw new Error('Loopback LiveKit fixture did not become ready')

    vite = await createServer({
      root: join(root, 'spikes', 'media'),
      configFile: false,
      server: { host: '127.0.0.1', port: 5174, strictPort: true },
      plugins: [{
        name: 'loopback-media-fixture',
        configureServer(server) {
          server.middlewares.use('/__media/bootstrap', async (request, response) => {
            const origins = ['http://127.0.0.1:5174', 'http://tauri.localhost', 'tauri://localhost']
            if (request.method !== 'GET' || request.headers.origin && !origins.includes(request.headers.origin)) {
              response.writeHead(403); response.end(); return
            }
            if (request.headers.origin) response.setHeader('Access-Control-Allow-Origin', request.headers.origin)
            response.setHeader('Vary', 'Origin')
            const room = `media-spike-${randomUUID()}`
            const tokens = {}
            for (const identity of ['publisher', 'receiver', 'wrong-key']) {
              const token = new AccessToken(apiKey, secret, { identity, ttl: '5m' })
              token.addGrant({ roomJoin: true, room, canPublish: identity === 'publisher', canSubscribe: identity !== 'publisher', canPublishData: false })
              tokens[identity] = await token.toJwt()
            }
            response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            response.end(JSON.stringify({ url: 'ws://127.0.0.1:17880', tokens, serverVersion: '1.13.8', hearthOrigin }))
          })
        },
      }],
    })
    await vite.listen()
    return { stop, name, url: 'http://127.0.0.1:5174/' }
  } catch (error) {
    await stop()
    throw error
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const fixture = await startMediaFixture()
  function requestStop() {
    void fixture.stop().then(() => process.exit(0), () => {
      console.error(`Fixture cleanup failed; inspect test container ${fixture.name}.`)
      process.exit(1)
    })
  }
  process.once('SIGINT', requestStop)
  process.once('SIGTERM', requestStop)
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.trim() === 'stop') requestStop()
  })
  console.log(`Media spike: ${fixture.url} — synthetic media only; type stop + Enter to clean up (or Ctrl+C).`)
  console.log(`Test container: ${fixture.name}`)
}
