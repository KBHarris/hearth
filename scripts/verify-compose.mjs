// Fresh non-production project only; cleanup never targets the normal Hearth stack.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join,resolve } from 'node:path'
import {initializeStorage} from '../deploy/setup.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const project = `hearth-phase0-${randomUUID().slice(0, 8)}`
const directory = join(root, 'target', 'compose-spike')
mkdirSync(directory, { recursive: true })
const fixtureDirectory=join(directory,project)
mkdirSync(fixtureDirectory,{recursive:true})
const envFile = join(fixtureDirectory, '.env')
writeFileSync(envFile, `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nHEARTH_PORT=18088\nHEARTH_HOST=127.0.0.1\nHEARTH_SERVER_NAME=Phase0Fixture\nHEARTH_S3_PORT=18333\nHEARTH_S3_PUBLIC_ENDPOINT=http://127.0.0.1:18333\nHEARTH_S3_CONFIG_PATH=${join(fixtureDirectory,'s3.json').replaceAll('\\','/')}\n`, { mode: 0o600 })
initializeStorage(fixtureDirectory)
const args = ['compose', '--project-name', project, '--env-file', envFile, '-f', join(root, 'deploy', 'compose.yaml')]
function compose(extra, quiet = false) {
  const result = spawnSync('docker', [...args, ...extra], { cwd: root, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Compose fixture ${extra[0]} failed`)
  return result.stdout
}
async function json(path) {
  const response = await fetch('http://127.0.0.1:18088' + path, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.ok, true)
  return response.json()
}
try {
  compose(['up', '-d', '--build', '--wait', '--wait-timeout', '120'])
  assert.equal((await json('/health')).status, 'ok')
  assert.equal((await json('/api/v1/setup')).setup_complete, false)
  const key = (await json('/.well-known/hearth')).server_key
  assert.match(key, /^[a-f0-9]{64}$/)
  compose(['restart', 'server'])
  let healthy = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await json('/health')).status === 'ok') { healthy = true; break } } catch { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.equal(healthy, true, 'Restart did not recover health')
  assert.equal((await json('/.well-known/hearth')).server_key, key)
  if (process.argv.includes('--desktop')) {
    const result = spawnSync(process.execPath, ['scripts/verify-desktop-webview.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, HEARTH_SPIKE_ORIGIN: 'http://127.0.0.1:18088' } })
    if (result.error) throw result.error
    assert.equal(result.status, 0, 'Native webview acceptance failed')
  }
  console.log(JSON.stringify({ runtime: 'Fresh Docker Compose project', healthy: true, setup_incomplete: true, restart_key_persistence: true, desktop_checked: process.argv.includes('--desktop') }))
} finally {
  try { compose(['down', '--volumes', '--remove-orphans']) }
  finally { rmSync(envFile, { force: true });rmSync(join(fixtureDirectory,'s3.json'),{force:true});assert.equal(resolve(fixtureDirectory),resolve(root,'target','compose-spike',project));assert.match(project,/^hearth-phase0-[a-f0-9-]+$/);rmSync(fixtureDirectory,{force:true,recursive:true}) }
}
