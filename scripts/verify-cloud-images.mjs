// Production images on an isolated Docker network, database and server volume.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const root = fileURLToPath(new URL('../', import.meta.url))
// Keep every Docker DNS label, including restore suffixes, below 63 bytes.
const name = 'hearth-cloud-test-' + randomUUID().slice(0, 12)
const network = name, volume = name + '-data', emptyVolume = name + '-empty', restoreVolume = name + '-restored-data'
const server = name + '-server', web = name + '-web', db = name + '-db', broken = name + '-broken'
const restoredDb = name + '-restored-db', restoredServer = name + '-restored-server'
const serverImage = process.env.HEARTH_CLOUD_SERVER_IMAGE ?? 'hearth-phase4-server:local'
const webImage = process.env.HEARTH_CLOUD_WEB_IMAGE ?? 'hearth-phase4-web:local'
const postgresImage = 'ghcr.io/railwayapp-templates/postgres-ssl:18@sha256:fcc6686a3f4f1962fe4ed77a15884553b7bd611ae1cea3204687968c5c09d517'
const password = randomBytes(32).toString('hex')
const accountPassword = randomBytes(24).toString('hex')
let driver, setupCode
const checks = {}
const created = []
const reportPath = join(root, 'target', 'cloud-images-evidence', 'result.json')
rmSync(reportPath, { force: true })
function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
  if (!allowFailure) assert.ok(!result.error && result.status === 0, 'Isolated cloud-image fixture command failed: ' + args[0])
  return allowFailure ? result : (args[0] === 'logs' ? result.stdout + result.stderr : result.stdout).trim()
}
function dockerBytes(args, input) {
  const result = spawnSync('docker', args, { input, windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })
  assert.ok(!result.error && result.status === 0, 'Isolated restore fixture command failed: ' + args[0])
  return result.stdout
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(origin, path = '/health') {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const res = await fetch(origin + path, { signal: AbortSignal.timeout(1000) }); if (res.ok) return } catch { /* Starting */ }
    await pause(250)
  }
  throw new Error('Isolated cloud image never became ready')
}
try {
  docker(['network', 'create', network]); created.push(['network', network])
  for (const item of [volume, emptyVolume, restoreVolume]) { docker(['volume', 'create', item]); created.push(['volume', item]) }
  docker(['run', '-d', '--name', db, '--network', network, '-e', 'PGDATA=/var/lib/postgresql/data/pgdata', '-e', 'POSTGRES_USER=hearth', '-e', 'POSTGRES_DB=hearth', '-e', `POSTGRES_PASSWORD=${password}`, postgresImage]); created.push(['container', db])
  docker(['run', '-d', '--name', web, '--network', network, '-p', '127.0.0.1::8080', '-e', `HEARTH_BACKEND_UPSTREAM=${server}:8080`, webImage]); created.push(['container', web])
  const port = docker(['port', web, '8080/tcp']).match(/:(\d+)$/)?.[1]
  assert.ok(port)
  const origin = 'http://127.0.0.1:' + port
  await waitFor(origin, '/web-health')
  let databaseReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(docker(['inspect', db, '--format', '{{.State.Running}}']), 'true', 'Disposable PostgreSQL exited before readiness')
    if (docker(['exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'hearth', '-d', 'hearth'], true).status === 0) { databaseReady = true; break }
    await pause(250)
  }
  assert.ok(databaseReady, 'Disposable PostgreSQL never became ready')
  const databaseUrl = `postgres://hearth:${password}@${db}:5432/hearth`
  docker(['run', '-d', '--name', server, '--network', network, '-v', `${volume}:/var/lib/hearth`, '-e', `DATABASE_URL=${databaseUrl}`, '-e', 'HEARTH_BIND=[::]:8080', '-e', `HEARTH_CLIENT_ORIGINS=${origin}`, '-e', 'HEARTH_SERVER_NAME=cloud-image-fixture', serverImage]); created.push(['container', server])
  await waitFor(origin)
  const identity = await (await fetch(origin + '/.well-known/hearth')).json()
  assert.match(identity.server_key, /^[a-f0-9]{64}$/)
  assert.notEqual(docker(['exec', server, 'awk', '/^Uid:/ {print $2}', '/proc/1/status']), '0')
  assert.notEqual(docker(['exec', web, 'awk', '/^Uid:/ {print $2}', '/proc/1/status']), '0')
  for (const file of ['server.key', 'opaque.setup', 'setup.code']) assert.equal(docker(['exec', server, 'stat', '-c', '%a', '/var/lib/hearth/' + file]), '600')
  const identities = docker(['exec', server, 'sha256sum', '/var/lib/hearth/server.key', '/var/lib/hearth/opaque.setup', '/var/lib/hearth/setup.code'])
  checks.root_owned_volume_initializes_and_server_runs_unprivileged_with_private_keys = true
  const rootResponse = await fetch(origin + '/')
  const html = await rootResponse.text()
  assert.match(rootResponse.headers.get('content-security-policy'), /wasm-unsafe-eval/)
  assert.match(rootResponse.headers.get('content-security-policy'), /worker-src 'self'/)
  assert.equal(rootResponse.headers.get('cache-control'), 'no-store')
  assert.equal(rootResponse.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(rootResponse.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(!rootResponse.headers.has('server'))
  assert.match(await (await fetch(origin + '/community/deep-link')).text(), /id="root"/)
  checks.static_html_deep_links_and_security_headers_pass = true
  const files = docker(['exec', web, 'find', '/srv/assets', '-maxdepth', '1', '-type', 'f']).split(/\r?\n/).map(path => path.replace('/srv', ''))
  const worker = files.find(path => /\/worker-.*\.js$/.test(path)), wasm = files.find(path => path.endsWith('.wasm'))
  assert.ok(worker && wasm)
  for (const [file, mime] of [[worker, /javascript/], [wasm, /application\/wasm/]]) {
    const response = await fetch(origin + file)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), mime)
    assert.match(response.headers.get('cache-control'), /immutable/)
  }
  assert.equal((await fetch(origin + '/assets/old-build-missing.js')).status, 404)
  assert.equal((await fetch(origin + '/api/v1/not-an-endpoint')).status, 404)
  assert.equal((await fetch(origin + '/hearth-push.js')).headers.get('cache-control'), 'no-store')
  assert.ok(!html.includes('localhost:8080') && !html.includes('127.0.0.1:8080'))
  checks.worker_wasm_mime_asset_cache_missing_asset_and_api_fallback_pass = true
  setupCode = docker(['exec', server, 'hearth-server', '--setup-code'])
  assert.match(setupCode, /^[a-f0-9]{64}$/)
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new', '--window-size=1000,900')).build()
  await driver.manage().setTimeouts({ script: 60_000 })
  await driver.get(origin)
  await driver.wait(async () => (await driver.findElements(By.css('.guided-setup'))).length > 0, 20_000)
  const browser = await driver.executeAsyncScript(function (workerUrl, password, setupCode, expectedKey, done) {
    const worker = new Worker(workerUrl, { type: 'module' })
    let sequence = 0
    const pending = new Map()
    worker.onmessage = ({ data }) => { const request = pending.get(data.id); if (request) { pending.delete(data.id); data.error ? request.reject(new Error('crypto')) : request.resolve(data.result) } }
    worker.onerror = () => { for (const request of pending.values()) request.reject(new Error('worker')); pending.clear() }
    const rpc = (operation, password = '', response, username, serverId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ id, operation, password, response, username, serverId }) })
    const post = async (path, body, token) => {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('http-' + response.status)
      return response.status === 204 ? null : response.json()
    }
    let stage = 'start'
    ;(async () => {
      const key = (await (await fetch('/.well-known/hearth')).json()).server_key
      if (key !== expectedKey) throw new Error('identity')
      stage = 'register'
      const message = await rpc('registrationStart', password)
      const registration = await post('/api/v1/auth/owner/start', { username: 'cloud_owner', message, setup_code: setupCode })
      const upload = await rpc('registrationFinish', password, registration.message, 'cloud_owner', key)
      await post('/api/v1/auth/owner/finish', { username: 'cloud_owner', message: upload, setup_code: setupCode })
      stage = 'login'
      const start = await post('/api/v1/auth/login/start', { username: 'cloud_owner', message: await rpc('loginStart', password) })
      const session = await post('/api/v1/auth/login/finish', { exchange_id: start.exchange_id, message: await rpc('loginFinish', password, start.message, 'cloud_owner', key) })
      const prepared = JSON.parse(await rpc('prepareIdentity', '', undefined, session.account.id, key))
      await post('/api/v1/auth/device/first', prepared.enrollment, session.token)
      await rpc('commitIdentity')
      stage = 'gateway'
      await new Promise((resolve, reject) => {
        const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/gateway')
        const timer = setTimeout(() => { socket.close(); reject(new Error('gateway-timeout')) }, 10_000)
        socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.op === 'challenge') { clearTimeout(timer); socket.close(); resolve() } }
        socket.onerror = () => { clearTimeout(timer); reject(new Error('gateway')) }
      })
      window.__cloudFixtureToken = session.token
      window.__cloudFixtureIdentity = prepared.enrollment.identity_key
      worker.terminate()
      done({ ok: true, privateWorkerRegistrationAndLogin: true, deviceEnrollment: true, gatewayUpgrade: true })
    })().catch(() => { worker.terminate(); done({ ok: false, stage }) })
  }, worker, accountPassword, setupCode, identity.server_key)
  assert.equal(browser.ok, true, 'Production browser crypto/proxy failed at ' + browser.stage)
  checks.production_chromium_worker_opaque_owner_login_device_and_websocket_upgrade_pass = true
  docker(['restart', server])
  await waitFor(origin)
  assert.equal((await (await fetch(origin + '/.well-known/hearth')).json()).server_key, identity.server_key)
  assert.equal(docker(['exec', server, 'sha256sum', '/var/lib/hearth/server.key', '/var/lib/hearth/opaque.setup', '/var/lib/hearth/setup.code']), identities)
  assert.equal(await driver.executeAsyncScript(done => fetch('/api/v1/auth/session', { headers: { Authorization: 'Bearer ' + window.__cloudFixtureToken } }).then(response => done(response.ok)).catch(() => done(false))), true)
  checks.restart_preserves_keys_accounts_and_authenticated_browser_session = true
  // Stop writes and copy the database plus matching identity files into fresh
  // isolated resources. Backup bytes stay in fixture memory and are zeroed.
  docker(['stop', server])
  assert.ok((await fetch(origin + '/health?capability=' + setupCode)).status >= 500)
  assert.ok(!docker(['logs', web]).includes(setupCode), 'Proxy failure logged a capability from the request URI')
  const databaseBackup = dockerBytes(['exec', db, 'pg_dump', '-U', 'hearth', '-d', 'hearth', '--format=custom'])
  const identityBackup = dockerBytes(['run', '--rm', '--network', 'none', '--entrypoint', 'tar', '-v', `${volume}:/data:ro`, serverImage, '-C', '/data', '-cf', '-', 'server.key', 'opaque.setup', 'setup.code'])
  try {
    docker(['run', '-d', '--name', restoredDb, '--network', network, '-e', 'PGDATA=/var/lib/postgresql/data/pgdata', '-e', 'POSTGRES_USER=hearth', '-e', 'POSTGRES_DB=hearth', '-e', `POSTGRES_PASSWORD=${password}`, postgresImage]); created.push(['container', restoredDb])
    let ready = false
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(docker(['inspect', restoredDb, '--format', '{{.State.Running}}']), 'true')
      if (docker(['exec', restoredDb, 'pg_isready', '-h', '127.0.0.1', '-U', 'hearth', '-d', 'hearth'], true).status === 0) { ready = true; break }
      await pause(250)
    }
    assert.ok(ready, 'Fresh restore database did not start')
    dockerBytes(['exec', '-i', restoredDb, 'pg_restore', '-U', 'hearth', '-d', 'hearth', '--exit-on-error'], databaseBackup)
    dockerBytes(['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'tar', '-v', `${restoreVolume}:/var/lib/hearth`, serverImage, '-C', '/var/lib/hearth', '-xf', '-'], identityBackup)
  } finally { databaseBackup.fill(0); identityBackup.fill(0) }
  docker(['run', '-d', '--name', restoredServer, '--network', network, '-v', `${restoreVolume}:/var/lib/hearth`, '-e', `DATABASE_URL=postgres://hearth:${password}@${restoredDb}:5432/hearth`, '-e', 'HEARTH_BIND=[::]:8080', '-e', `HEARTH_CLIENT_ORIGINS=${origin}`, '-e', 'HEARTH_SERVER_NAME=cloud-image-fixture', serverImage]); created.push(['container', restoredServer])
  docker(['rm', '-f', '-v', web])
  docker(['run', '-d', '--name', web, '--network', network, '-p', `127.0.0.1:${port}:8080`, '-e', `HEARTH_BACKEND_UPSTREAM=${restoredServer}:8080`, webImage])
  await waitFor(origin)
  assert.equal((await (await fetch(origin + '/.well-known/hearth')).json()).server_key, identity.server_key)
  assert.equal(docker(['exec', restoredServer, 'sha256sum', '/var/lib/hearth/server.key', '/var/lib/hearth/opaque.setup', '/var/lib/hearth/setup.code']), identities)
  const restored = await driver.executeAsyncScript(done => {
    const headers = { Authorization: 'Bearer ' + window.__cloudFixtureToken }
    Promise.all([fetch('/api/v1/auth/session', { headers }), fetch('/api/v1/auth/identity', { headers })]).then(async ([session, identity]) => {
      const value = await identity.json()
      done(session.ok && identity.ok && value.identity_key === window.__cloudFixtureIdentity && value.devices.length === 1)
    }).catch(() => done(false))
  })
  assert.equal(restored, true)
  checks.fresh_database_and_matching_key_volume_restore_preserve_identity_device_and_session = true
  docker(['run', '-d', '--name', broken, '--network', network, '-v', `${emptyVolume}:/var/lib/hearth`, '-e', `DATABASE_URL=${databaseUrl}`, serverImage]); created.push(['container', broken])
  assert.equal(docker(['wait', broken]), '1')
  assert.match(docker(['logs', broken]), /authentication keys are missing/)
  checks.existing_database_without_matching_server_keys_fails_closed = true
  const logs = docker(['logs', server]) + docker(['logs', restoredServer]) + docker(['logs', web])
  for (const secret of [password, accountPassword, setupCode]) assert.ok(!logs.includes(secret), 'A fixture secret entered image logs')
  checks.operator_bootstrap_and_password_canaries_absent_from_logs = true
  const directory = join(root, 'target', 'cloud-images-evidence')
  mkdirSync(directory, { recursive: true })
  const report = { measuredAt: new Date().toISOString(), outcome: 'pass', scope: 'Local Linux Docker images and headless Chromium; not Railway/network/media acceptance', serverImage: docker(['image', 'inspect', serverImage, '--format', '{{.Id}}']), webImage: docker(['image', 'inspect', webImage, '--format', '{{.Id}}']), checks, railwayValidated: false, mediaValidated: false }
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  for (const [kind, item] of created) {
    if (kind !== 'container') continue
    const result = docker(['logs', '--tail', '12', item], true)
    let diagnostics = result.stdout + result.stderr
    for (const secret of [password, accountPassword, setupCode].filter(Boolean)) diagnostics = diagnostics.split(secret).join('[redacted]')
    diagnostics = diagnostics.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]').replace(/[a-f0-9]{48,}/g, '[redacted]')
    console.error(item + ':\n' + diagnostics)
  }
  throw error
} finally {
  await driver?.quit().catch(() => {})
  for (const [kind, item] of created.reverse()) {
    assert.ok(item.startsWith('hearth-cloud-test-'))
    docker(kind === 'container' ? ['rm', '-f', '-v', item] : [kind, 'rm', item], true)
  }
}
