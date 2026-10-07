// Local Phase 0 bootstrap: generates configuration, never creates product accounts.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const deploy = fileURLToPath(new URL('./', import.meta.url))
export function initializeConfig(directory) {
  const config = join(directory, '.env')
  let created = false
  if (!existsSync(config)) {
    const text = readFileSync(join(directory, '.env.example'), 'utf8').replace('POSTGRES_PASSWORD=change-me', `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`)
    try {
      writeFileSync(config, text, { flag: 'wx', mode: 0o600 })
      created = true
    } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const text = readFileSync(config, 'utf8')
  if ((text.match(/^POSTGRES_PASSWORD=/gm) ?? []).length !== 1) throw new Error('Use exactly one POSTGRES_PASSWORD entry; existing configuration was preserved.')
  const password = text.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]?.trim()
  if (!password || password === 'change-me' || password.length < 32 || !/^[a-zA-Z0-9_-]+$/.test(password)) {
    throw new Error('Existing deploy/.env needs a URL-safe random POSTGRES_PASSWORD of at least 32 characters. It was preserved; never rotate a running database password casually.')
  }
  const port = Number(text.match(/^HEARTH_PORT=(.+)$/m)?.[1]?.trim() ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HEARTH_PORT must be a valid TCP port')
  return { port, created }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => !['--init-only', '--podman'].includes(arg))) throw new Error('Usage: node deploy/setup.mjs [--init-only] [--podman]')
  const { port, created } = initializeConfig(deploy)
  if (created) console.log('Created deploy/.env with a random database password. Secrets are not printed.')
  if (args.includes('--init-only')) {
    console.log('Configuration ready. Existing configuration was preserved.')
  } else {
    const engine = args.includes('--podman') ? 'podman' : 'docker'
    const result = spawnSync(engine, ['compose', '-f', join(deploy, 'compose.yaml'), 'up', '-d', '--build', '--wait'], { cwd: deploy, stdio: 'inherit', windowsHide: true })
    if (result.error) throw new Error(`${engine} with Compose must be installed and running`)
    if (result.status !== 0) throw new Error('Stack startup failed. Existing volumes and configuration were preserved; inspect the Compose status.')
    const origin = `http://127.0.0.1:${port}`
    const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(8000) })
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Stack is running but Hearth health did not pass')
    console.log(`Hearth is healthy at ${origin}. Phase 0 supports discovery only; owner accounts arrive in Phase 1.`)
  }
}
