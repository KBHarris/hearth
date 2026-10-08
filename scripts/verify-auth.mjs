// Disposable PostgreSQL + real HTTP server + product WASM client. No real accounts.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const reportPath = join(root, 'target/phase1-evidence/auth.json')
if (!process.argv.includes('--serve')) rmSync(reportPath, { force: true })
const id = randomUUID()
const directory = join(root, 'target/auth-acceptance', id)
mkdirSync(directory, { recursive: true })
function command(name, args, quiet = false, env = process.env) {
  const result = spawnSync(name, args, { cwd: root, env, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`${name} acceptance command failed`)
  return result.stdout?.trim()
}
command('cargo', ['build', '--locked', '-p', 'hearth-server'])
command('cargo', ['build', '--locked', '-p', 'hearth-wasm', '--features', 'auth', '--target', 'wasm32-unknown-unknown'])
command('wasm-bindgen', [join(root, 'target/wasm32-unknown-unknown/debug/hearth_wasm.wasm'), '--target', 'nodejs', '--out-dir', join(directory, 'wasm')])
const wasm = createRequire(import.meta.url)(join(directory, 'wasm/hearth_wasm.js'))
const lease = createServer()
await new Promise((resolve) => lease.listen(0, '127.0.0.1', resolve))
const port = lease.address().port
await new Promise((resolve) => lease.close(resolve))
const origin = `http://127.0.0.1:${port}`
const binary = join(root, 'target/debug', process.platform === 'win32' ? 'hearth-server.exe' : 'hearth-server')
let child
let container
let logs = ''
let databaseUrl = process.env.HEARTH_TEST_DATABASE_URL
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function start() {
  child = spawn(binary, [], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl, HEARTH_BIND: `127.0.0.1:${port}`, HEARTH_SERVER_KEY_PATH: join(directory, 'server.key'), RUST_LOG: 'info' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', (data) => { logs += data })
  child.stderr.on('data', (data) => { logs += data })
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolve) => child.once('close', resolve))
  child.kill()
  await exited
}
async function healthy() {
  for (let i = 0; i < 60; i++) {
    try { const res = await fetch(origin + '/health', { signal: AbortSignal.timeout(1000) }); if ((await res.json()).status === 'ok') return } catch { /* Starting */ }
    if (child.exitCode !== null) throw new Error('Acceptance server exited before health')
    await pause(250)
  }
  throw new Error('Acceptance server health timeout')
}
const frames = []
const checks = {}
async function request(path, body, token) {
  const options = { method: body === undefined ? 'GET' : 'POST', headers: {}, signal: AbortSignal.timeout(8000), redirect: 'error' }
  if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); frames.push(options.body) }
  if (token) options.headers.Authorization = `Bearer ${token}`
  const response = await fetch(origin + path, options)
  const text = await response.text()
  return { status: response.status, value: text ? JSON.parse(text) : null, headers: response.headers }
}
async function login(password, serverId, retainClient) {
  const client = new wasm.OpaqueAuthClient()
  try {
    const message = client.loginStart(password)
    const response = await request('/api/v1/auth/login/start', { username: 'owner', message })
    assert.equal(response.status, 200)
    const proof = client.loginFinish(password, response.value.message, 'owner', serverId)
    return { exchange_id: response.value.exchange_id, message: proof }
  } finally { if (!retainClient) client.free(); else retainClient(client) }
}
try {
  if (!databaseUrl) {
    container = `hearth-auth-${id}`
    const password = randomBytes(32).toString('hex')
    command('docker', ['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432', '-e', 'POSTGRES_USER=hearth', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=hearth', 'postgres:17-alpine'], true)
    const mapping = command('docker', ['port', container, '5432/tcp'], true)
    const databasePort = mapping.match(/:(\d+)$/)?.[1]
    assert.ok(databasePort)
    databaseUrl = `postgres://hearth:${password}@127.0.0.1:${databasePort}/hearth`
    for (let i = 0; i < 60; i++) {
      const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'hearth', '-d', 'hearth'], { stdio: 'ignore', windowsHide: true })
      if (result.status === 0) break
      await pause(250)
    }
    if (!process.argv.includes('--serve')) command('cargo', ['test', '--locked', '-p', 'hearth-server', '--test', 'auth', '--test', 'device', '--', '--ignored'], false, { ...process.env, DATABASE_URL: databaseUrl })
  }
  start()
  await healthy()
  if (process.argv.includes('--serve')) {
    console.log(`Disposable owner-setup fixture: ${origin}; setup code file: ${join(directory, 'setup.code')}. Type stop to clean up.`)
    const lines = createInterface({ input: process.stdin })
    for await (const line of lines) if (line.trim() === 'stop') { lines.close(); break }
  } else {
    const password = 'PHASE1_WASM_PASSWORD_CANARY_private_only'
    const serverId = (await request('/.well-known/hearth')).value.server_key
    const code = readFileSync(join(directory, 'setup.code'), 'utf8')
    assert.equal((await request('/api/v1/setup')).value.setup_complete, false)
    const client = new wasm.OpaqueAuthClient()
    let response
    try {
      const message = client.registrationStart(password)
      response = await request('/api/v1/auth/owner/start', { username: 'owner', message, setup_code: '0'.repeat(64) })
      assert.equal(response.status, 401)
      checks.setup_code_required = true
      response = await request('/api/v1/auth/owner/start', { username: 'owner', message, setup_code: code })
      assert.equal(response.status, 200)
      const upload = client.registrationFinish(password, response.value.message, 'owner', serverId)
      const body = { username: 'owner', message: upload, setup_code: code }
      const finishes = await Promise.all([request('/api/v1/auth/owner/finish', body), request('/api/v1/auth/owner/finish', body)])
      assert.deepEqual(finishes.map((r) => r.status).sort(), [200, 409])
      checks.one_owner_under_concurrent_claims = true
      assert.equal((await request('/api/v1/setup')).value.setup_complete, true)
      let vaultClient
      const proof = await login(password, serverId, (client) => { vaultClient = client })
      const finishesLogin = await Promise.all([request('/api/v1/auth/login/finish', proof), request('/api/v1/auth/login/finish', proof)])
      assert.deepEqual(finishesLogin.map((r) => r.status).sort(), [200, 401])
      response = finishesLogin.find((r) => r.status === 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const token = response.value.token
      const accountId = response.value.account.id
      checks.one_use_login_proof = true
      assert.equal((await request('/api/v1/auth/session', undefined, token)).status, 200)
      assert.deepEqual((await request('/api/v1/auth/identity', undefined, token)).value, { identity_key: null, devices: [] })
      const prepared = JSON.parse(vaultClient.prepareIdentity(undefined, accountId, serverId))
      const enrollment = prepared.enrollment
      assert.equal(prepared.envelope.length, 274)
      assert.equal((await request('/api/v1/auth/device/first', { ...enrollment, device_signature: '00'.repeat(64) }, token)).status, 400)
      const deviceClaims = await Promise.all([request('/api/v1/auth/device/first', enrollment, token), request('/api/v1/auth/device/first', enrollment, token)])
      assert.deepEqual(deviceClaims.map((r) => r.status), [200, 200])
      assert.equal((await request('/api/v1/auth/identity', undefined, token)).value.devices.length, 1)
      vaultClient.commitIdentity()
      assert.throws(() => vaultClient.prepareIdentity(prepared.envelope, accountId, serverId))
      vaultClient.free()
      checks.cross_signed_device_bound_to_account_and_server = true
      checks.encrypted_vault_only_client_side = true
      const pending = await login(password, serverId)
      await stop(); start(); await healthy()
      assert.equal((await request('/.well-known/hearth')).value.server_key, serverId)
      assert.equal((await request('/api/v1/auth/session', undefined, token)).status, 200)
      assert.equal((await request('/api/v1/auth/login/finish', pending)).status, 200)
      checks.credentials_pending_proofs_and_sessions_survive_restart = true
      assert.equal((await request('/api/v1/auth/identity', undefined, token)).value.identity_key, enrollment.identity_key)
      let restoredClient
      const newProof = await login(password, serverId, (client) => { restoredClient = client })
      const newSession = await request('/api/v1/auth/login/finish', newProof)
      const restored = JSON.parse(restoredClient.prepareIdentity(prepared.envelope, accountId, serverId))
      assert.deepEqual(restored.enrollment, enrollment)
      assert.equal((await request('/api/v1/auth/device/first', restored.enrollment, newSession.value.token)).status, 200)
      assert.throws(() => restoredClient.prepareIdentity('02' + prepared.envelope.slice(2), accountId, serverId))
      const otherIdentity = JSON.parse(restoredClient.prepareIdentity(undefined, accountId, serverId))
      assert.equal((await request('/api/v1/auth/device/first', otherIdentity.enrollment, newSession.value.token)).status, 409)
      restoredClient.free()
      checks.vault_unlock_after_fresh_login_and_identity_replacement_rejected = true
      assert.ok(frames.every((frame) => !frame.includes(prepared.envelope)))
      await stop()
      const setupPath = join(directory, 'opaque.setup')
      const savedPath = join(directory, 'opaque.setup.saved')
      renameSync(setupPath, savedPath)
      try {
        start()
        const exited = await Promise.race([new Promise((resolve) => child.once('exit', resolve)), pause(5000).then(() => { throw new Error('Missing-key rejection timed out') })])
        assert.equal(exited, 1)
        assert.equal(existsSync(setupPath), false)
        checks.missing_key_refuses_existing_account_startup = true
      } finally { await stop(); renameSync(savedPath, setupPath) }
      start(); await healthy()
      assert.equal((await request('/api/v1/auth/logout', {}, token)).status, 204)
      assert.equal((await request('/api/v1/auth/session', undefined, token)).status, 401)
      checks.logout_revokes_session = true
      await assert.rejects(login('wrong password', serverId))
      checks.wrong_password_rejected = true
      assert.ok(frames.every((frame) => !frame.includes(password)))
      await stop()
      assert.ok(!logs.includes(password) && !logs.includes(token) && !logs.includes(code))
      checks.no_password_on_wire_or_secrets_in_logs = true
    } finally { client.free() }
    const report = { measuredAt: new Date().toISOString(), outcome: 'pass', client: 'product WASM', server: 'native HTTP + PostgreSQL', checks }
    mkdirSync(join(root, 'target/phase1-evidence'), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  }
} finally {
  await stop()
  if (container) command('docker', ['stop', container], true)
  // Delete only secrets generated by this invocation, leaving non-secret build output.
  for (const name of ['server.key', 'opaque.setup', 'setup.code']) rmSync(join(directory, name), { force: true })
}
