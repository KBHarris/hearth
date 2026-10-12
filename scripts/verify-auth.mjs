// Disposable PostgreSQL + real HTTP server + product WASM client. No real accounts.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join, delimiter, resolve } from 'node:path'
import { verifyMessaging } from './phase1-messaging-acceptance.mjs'
import { verifyCommunities } from './phase2-community-acceptance.mjs'
import {blobFixture} from './blob-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
if(process.env.PGBIN)process.env.PATH=process.env.PGBIN+delimiter+process.env.PATH
const reportPath = join(root, process.argv.includes('--phase3')?'target/phase3-evidence/auth.json':'target/phase1-evidence/auth.json')
if (!process.argv.includes('--serve') && !process.argv.includes('--desktop')) rmSync(reportPath, { force: true })
if(process.argv.includes('--desktop'))rmSync(join(root,'target/phase1-evidence',`packaged-${process.platform}.json`),{force:true})
const id = randomUUID()
const directory = join(root, 'target/auth-acceptance', id)
mkdirSync(directory, { recursive: true })
function command(name, args, quiet = false, env = process.env) {
  // Windows postgres inherits pipe handles from pg_ctl. Even after pg_ctl exits,
  // spawnSync then waits for EOF until the background database stops. Its own
  // startup log supplies diagnostics; it must not inherit Node's capture pipes.
  const stdio=quiet?(process.platform==='win32'&&name==='pg_ctl'?'ignore':'pipe'):'inherit'
  const result = spawnSync(name, args, { cwd: root, env, encoding: 'utf8', stdio, windowsHide: true, maxBuffer:64*1024*1024 })
  if (result.error || result.status !== 0) throw new Error(`${name} acceptance command failed`)
  return result.stdout?.trim()
}
// Isolated CI can reuse its normal Cargo cache; local Phase 3 keeps preview builds separate.
const serverTarget=process.env.HEARTH_TEST_TARGET_DIR ?? (process.argv.includes('--phase3')?'target/phase3-build':'target')
command('cargo', ['build', '--locked', '-p', 'hearth-server', '--target-dir', serverTarget])
let wasm
let legacyWasm
if(!process.argv.includes('--desktop') && !process.argv.includes('--serve')) {
  command('cargo', ['build', '--locked', '--release', '-p', 'hearth-wasm', '--features', 'auth', '--target', 'wasm32-unknown-unknown'])
  command('wasm-bindgen', [join(root, 'target/wasm32-unknown-unknown/release/hearth_wasm.wasm'), '--target', 'nodejs', '--out-dir', join(directory, 'wasm')])
  wasm = createRequire(import.meta.url)(join(directory, 'wasm/hearth_wasm.js'))
  // Existing credentials/vaults must remain readable when switching build profiles.
  command('cargo', ['build', '--locked', '-p', 'hearth-wasm', '--features', 'auth', '--target', 'wasm32-unknown-unknown'])
  command('wasm-bindgen', [join(root, 'target/wasm32-unknown-unknown/debug/hearth_wasm.wasm'), '--target', 'nodejs', '--out-dir', join(directory, 'wasm-legacy-debug')])
  legacyWasm = createRequire(import.meta.url)(join(directory, 'wasm-legacy-debug/hearth_wasm.js'))
}
const lease = createServer()
await new Promise((resolve) => lease.listen(0, '127.0.0.1', resolve))
const port = lease.address().port
await new Promise((resolve) => lease.close(resolve))
const origin = `http://127.0.0.1:${port}`
const compiledBinary = join(root, serverTarget, 'debug', process.platform === 'win32' ? 'hearth-server.exe' : 'hearth-server')
const binary = process.argv.includes('--serve') ? join(directory, process.platform === 'win32' ? 'hearth-server.exe' : 'hearth-server') : compiledBinary
if(process.argv.includes('--serve'))copyFileSync(compiledBinary,binary)
let child
let container
let postgresDirectory
let postgresStarted=false
let logs = ''
let databaseUrl = process.env.HEARTH_TEST_DATABASE_URL
let storage
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function start() {
  child = spawn(binary, [], { cwd: root, env: { ...process.env, ...storage?.env, DATABASE_URL: databaseUrl, HEARTH_BIND: `127.0.0.1:${port}`, HEARTH_SERVER_KEY_PATH: join(directory, 'server.key'), RUST_LOG: 'info' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
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
    if (child.exitCode !== null) {
      // First startup precedes credentials. Keep migration diagnostics, redact bootstrap IDs/URLs.
      const diagnostic=frames.length===0?logs.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL]').replace(/[a-f0-9]{64,}/gi,'[redacted ID]').slice(-4000):''
      throw new Error(`Acceptance server exited before health${diagnostic?'\n'+diagnostic:''}`)
    }
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
  return { status: response.status, value: text && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null, headers: response.headers }
}
async function login(password, serverId, retainClient, username = 'owner', implementation = wasm) {
  const client = new implementation.OpaqueAuthClient()
  try {
    const message = client.loginStart(password)
    const response = await request('/api/v1/auth/login/start', { username, message })
    assert.equal(response.status, 200)
    const proof = client.loginFinish(password, response.value.message, username, serverId)
    return { exchange_id: response.value.exchange_id, message: proof }
  } finally { if (!retainClient) client.free(); else retainClient(client) }
}
try {
  if(process.argv.includes('--storage'))storage=await blobFixture(directory)
  if (!databaseUrl && process.argv.includes('--native-postgres')) {
    postgresDirectory=join(directory,'postgres')
    command('initdb',['-D',postgresDirectory,'--username=hearth','--auth=trust','--encoding=UTF8','--no-locale'],true)
    const dbLease=createServer();await new Promise(resolve=>dbLease.listen(0,'127.0.0.1',resolve))
    const dbPort=dbLease.address().port;await new Promise(resolve=>dbLease.close(resolve))
    // Debian's default socket directory belongs to the postgres OS user. This
    // fixture uses only loopback TCP and must not depend on system directories.
    const postgresLog=join(directory,'postgres.log')
    try {
      command('pg_ctl',['-D',postgresDirectory,'-l',postgresLog,'-o',`-h 127.0.0.1 -p ${dbPort} -c unix_socket_directories=`,'-w','start'],true)
    } catch (error) {
      const status=spawnSync('pg_ctl',['-D',postgresDirectory,'status'],{cwd:root,stdio:'ignore',windowsHide:true,timeout:10000})
      postgresStarted=status.status===0
      // Startup precedes accounts or application secrets; preserve its diagnostic.
      throw new Error(`PostgreSQL fixture startup failed:\n${existsSync(postgresLog)?readFileSync(postgresLog,'utf8'):'No startup log was created.'}`,{cause:error})
    }
    postgresStarted=true
    command('createdb',['-h','127.0.0.1','-p',String(dbPort),'-U','hearth','hearth'],true)
    databaseUrl=`postgres://hearth@127.0.0.1:${dbPort}/hearth`
  }
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
    if (!process.argv.includes('--serve')) command('cargo', ['test', '--locked', '-p', 'hearth-server', '--test', 'auth', '--test', 'device', '--test', 'delivery', '--', '--ignored'], false, { ...process.env, DATABASE_URL: databaseUrl })
  }
  start()
  await healthy()
  if (process.argv.includes('--serve')) {
    console.log(`Disposable owner-setup fixture: ${origin}; setup code file: ${join(directory, 'setup.code')}. Type stop to clean up.`)
    const lines = createInterface({ input: process.stdin })
    for await (const line of lines) if (line.trim() === 'stop') { lines.close(); break }
  } else if (process.argv.includes('--desktop')) {
    const configPath=join(directory,'webview-fixture.json')
    writeFileSync(configPath,JSON.stringify({origin,serverKey:(await request('/.well-known/hearth')).value.server_key,setupCode:readFileSync(join(directory,'setup.code'),'utf8').trim(),storage:!!storage}),{mode:0o600})
    let native
    try {
      native=spawn(join(root,'target/debug',process.platform==='win32'?'hearth-desktop.exe':'hearth-desktop'),['--phase1-acceptance'],{cwd:root,env:{...process.env,HEARTH_PHASE1_FIXTURE_PATH:configPath},windowsHide:true,stdio:['ignore','pipe','pipe']})
      let stdout='';native.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>100000)native.kill()})
      // SDK errors can contain operational details; capture but never print them.
      native.stderr.on('data',()=>{})
      const code=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{native.kill();reject(new Error('Packaged client acceptance timed out'))},190000)
        native.once('error',error=>{clearTimeout(timer);reject(error)})
        native.once('exit',code=>{clearTimeout(timer);resolve(code)})
      })
      const line=stdout.split(/\r?\n/).find(line=>line.startsWith('HEARTH_PHASE1_REPORT='))
      assert.ok(line,'Packaged client did not return its sanitized report')
      const report=JSON.parse(line.slice('HEARTH_PHASE1_REPORT='.length))
      const output=join(root,'target/phase1-evidence',`packaged-${process.platform}.json`)
      const dump=container?command('docker',['exec',container,'pg_dump','-U','hearth','-d','hearth','--data-only'],true):(()=>{const db=new URL(databaseUrl);return command('pg_dump',['--data-only','--no-owner'],true,{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)})})()
      const canary='HEARTH_PACKAGED_MESSAGE_CANARY_private_content'
      report.checks.server_database_and_logs_exclude_packaged_message_canary=!dump.includes(canary) && !logs.includes(canary)
      if(storage)storage.scan(canary)
      mkdirSync(join(root,'target/phase1-evidence'),{recursive:true})
      writeFileSync(output,JSON.stringify({measuredAt:new Date().toISOString(),runtime:`Tauri system webview (${process.platform})`,...report},null,2)+'\n')
      console.log(JSON.stringify(report,null,2))
      assert.equal(code,0);assert.equal(report.outcome,'pass');assert.ok(Object.values(report.checks).every(value=>value===true))
    } finally {native?.kill();rmSync(configPath,{force:true})}
  } else {
    const password = 'PHASE1_WASM_PASSWORD_CANARY_private_only'
    const serverId = (await request('/.well-known/hearth')).value.server_key
    const code = readFileSync(join(directory, 'setup.code'), 'utf8')
    assert.equal((await request('/api/v1/setup')).value.setup_complete, false)
    const client = new legacyWasm.OpaqueAuthClient()
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
      const proof = await login(password, serverId, (client) => { vaultClient = client }, 'owner', legacyWasm)
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
      const recoveryPhrase = 'HEARTH_RECOVERY_PHRASE_CANARY_private_only'
      const recoveryKit = vaultClient.exportRecovery(recoveryPhrase,accountId,serverId)
      const linkOffer = JSON.parse(vaultClient.linkOffer(accountId,serverId))
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
      checks.optimized_client_unlocks_debug_build_credentials_and_vault = true
      assert.equal((await request('/api/v1/auth/device/first', restored.enrollment, newSession.value.token)).status, 200)
      assert.throws(() => restoredClient.prepareIdentity('02' + prepared.envelope.slice(2), accountId, serverId))
      const otherIdentity = JSON.parse(restoredClient.prepareIdentity(undefined, accountId, serverId))
      assert.equal((await request('/api/v1/auth/device/first', otherIdentity.enrollment, newSession.value.token)).status, 409)
      restoredClient.free()
      checks.vault_unlock_after_fresh_login_and_identity_replacement_rejected = true
      await stop();start();await healthy()
      const offered = { id:linkOffer.id,device_key:linkOffer.device_key,envelope:linkOffer.envelope,signature:linkOffer.signature }
      assert.equal((await request('/api/v1/auth/device/link',offered,token)).status,200)
      assert.equal((await request(`/api/v1/auth/device/link/${linkOffer.id}`)).status,401)
      const received = await request(`/api/v1/auth/device/link/${linkOffer.id}`,undefined,token)
      assert.equal(received.status,200)
      let recoveryClient
      const recoveryProof = await login(password,serverId,client => {recoveryClient = client})
      const recoverySession = await request('/api/v1/auth/login/finish',recoveryProof)
      assert.equal(recoverySession.status,200)
      assert.throws(() => recoveryClient.restoreIdentity(recoveryKit,'incorrect recovery passphrase',accountId,serverId))
      const recovered = JSON.parse(recoveryClient.restoreIdentity(recoveryKit,recoveryPhrase,accountId,serverId))
      assert.equal(recovered.enrollment.identity_key,enrollment.identity_key)
      assert.notEqual(recovered.enrollment.device_key,enrollment.device_key)
      assert.equal((await request('/api/v1/auth/device/restore',{enrollment:recovered.enrollment,link_id:null},recoverySession.value.token)).status,200)
      recoveryClient.commitIdentity();recoveryClient.free()
      let linkClient
      const linkingProof = await login(password,serverId,client => {linkClient = client})
      const linkingSession = await request('/api/v1/auth/login/finish',linkingProof)
      assert.equal(linkingSession.status,200)
      assert.equal(linkClient.linkId(linkOffer.code),linkOffer.id)
      const linked = JSON.parse(linkClient.restoreIdentity(received.value.envelope,linkOffer.code,accountId,serverId))
      const linkingBody = {enrollment:linked.enrollment,link_id:linkOffer.id}
      assert.equal((await request('/api/v1/auth/device/restore',linkingBody,linkingSession.value.token)).status,200)
      assert.equal((await request('/api/v1/auth/device/restore',linkingBody,linkingSession.value.token)).status,200)
      assert.equal((await request(`/api/v1/auth/device/link/${linkOffer.id}`,undefined,token)).status,404)
      assert.equal((await request('/api/v1/auth/identity',undefined,token)).value.devices.length,3)
      linkClient.commitIdentity();linkClient.free()
      assert.ok(frames.every(frame => !frame.includes(recoveryPhrase) && !frame.includes(linkOffer.code)))
      checks.recovery_kit_restores_identity_with_fresh_device = true
      checks.approved_device_link_delivers_identity_once = true
      await stop();start();await healthy()
      assert.equal((await request('/api/v1/auth/admin/settings')).status,401)
      assert.equal((await request('/api/v1/auth/registration')).value.registration_mode,'invite')
      const memberPassword = 'HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only'
      const member = new wasm.OpaqueAuthClient()
      try {
        const memberRequest = member.registrationStart(memberPassword)
        assert.equal((await request('/api/v1/auth/register/start',{username:'bob',message:memberRequest,invite_code:null})).status,403)
        const invited = await request('/api/v1/auth/admin/invite',{},token)
        assert.equal(invited.status,200)
        const registration = await request('/api/v1/auth/register/start',{username:'bob',message:memberRequest,invite_code:invited.value.code})
        assert.equal(registration.status,200)
        const upload = member.registrationFinish(memberPassword,registration.value.message,'bob',serverId)
        const claims = await Promise.all([request('/api/v1/auth/register/finish',{username:'bob',message:upload,invite_code:invited.value.code}),request('/api/v1/auth/register/finish',{username:'bob',message:upload,invite_code:invited.value.code})])
        assert.deepEqual(claims.map(result=>result.status).sort(),[200,403])
        assert.equal(claims.find(result=>result.status===200).value.owner,false)
        const memberProof = await login(memberPassword,serverId,null,'bob')
        const memberSession = await request('/api/v1/auth/login/finish',memberProof)
        assert.equal(memberSession.status,200)
        assert.equal((await request('/api/v1/auth/admin/invite',{},memberSession.value.token)).status,403)
        assert.equal((await request('/api/v1/auth/admin/settings',undefined,memberSession.value.token)).status,403)
        const settings = {server_name:'Hearth acceptance',registration_mode:'closed'}
        assert.equal((await request('/api/v1/auth/admin/settings',settings,memberSession.value.token)).status,403)
        assert.equal((await request('/api/v1/auth/admin/settings',settings,token)).status,200)
        assert.equal((await request('/.well-known/hearth')).value.server_name,settings.server_name)
        assert.equal((await request('/api/v1/auth/register/start',{username:'carol',message:memberRequest,invite_code:invited.value.code})).status,403)
        await stop();start();await healthy()
        assert.equal((await request('/api/v1/auth/registration')).value.registration_mode,'closed')
        assert.ok(frames.every(frame=>!frame.includes(memberPassword)))
      } finally {member.free()}
      checks.single_use_invite_creates_second_account = true
      checks.owner_only_registration_settings_survive_restart = true
      await verifyMessaging({wasm,request,login,origin,serverId,owner:token,password,prepared,linked,start,stop,healthy,checks,storage,
        retentionFixture:async (operation,age=false,blob=false)=>{
          assert.match(operation,/^[a-f0-9]{64}$/)
          const sql=blob?(age?`UPDATE encrypted_blobs SET created_at=now()-interval '2 days' WHERE id='${operation}'`:`SELECT json_build_object('blobs',(SELECT count(*) FROM encrypted_blobs WHERE id='${operation}'))`):(age?`UPDATE delivery_operations SET created_at=now()-interval '2 days' WHERE operation_id='${operation}'; UPDATE delivery_events SET created_at=now()-interval '2 days' WHERE operation_id='${operation}'`:`SELECT json_build_object('messages',(SELECT count(*) FROM delivery_events WHERE operation_id='${operation}' AND data->>'kind'='message'),'archives',(SELECT count(*) FROM channel_archives WHERE operation_id='${operation}'),'operations',(SELECT count(*) FROM delivery_operations WHERE operation_id='${operation}'),'redactions',(SELECT count(*) FROM delivery_events WHERE operation_id='${operation}' AND data->>'kind'='redacted'))`);
          const dbContainer=container ?? process.env.HEARTH_TEST_POSTGRES_CONTAINER
          let output
          if(dbContainer)output=command('docker',['exec',dbContainer,'psql','-U','hearth','-d','hearth','-v','ON_ERROR_STOP=1','-t','-A','-c',sql],true)
          else {const db=new URL(databaseUrl);output=command('psql',['-v','ON_ERROR_STOP=1','-t','-A','-c',sql],true,{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)})}
          return age?undefined:JSON.parse(output)
        },
        scanDatabase:async canary=>{
          const dumpContainer=container ?? process.env.HEARTH_TEST_POSTGRES_CONTAINER
          if (dumpContainer) {
            const dump=command('docker',['exec',dumpContainer,'pg_dump','-U','hearth','-d','hearth','--data-only'],true)
            assert.ok(!dump.includes(canary))
          } else {
            const db=new URL(databaseUrl)
            const dump=command('pg_dump',['--data-only','--no-owner'],true,{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)})
            assert.ok(!dump.includes(canary))
          }
          assert.ok(!logs.includes(canary))
        }})
      assert.ok(frames.every((frame) => !frame.includes(prepared.envelope)))
      await verifyCommunities({wasm,request,login,serverId,owner:token,memberPassword,checks,start,stop,healthy,
        expireInvite:async digest=>{
          assert.match(digest,/^[a-f0-9]{64}$/)
          const sql=`UPDATE community_invites SET expires_at=clock_timestamp()-interval '1 second' WHERE code_hash=decode('${digest}','hex')`
          const dbContainer=container ?? process.env.HEARTH_TEST_POSTGRES_CONTAINER
          if(dbContainer)command('docker',['exec',dbContainer,'psql','-U','hearth','-d','hearth','-v','ON_ERROR_STOP=1','-c',sql],true)
          else {
            const db=new URL(databaseUrl)
            command('psql',['-v','ON_ERROR_STOP=1','-c',sql],true,{...process.env,PGHOST:db.hostname,PGPORT:db.port,PGUSER:decodeURIComponent(db.username),PGPASSWORD:decodeURIComponent(db.password),PGDATABASE:db.pathname.slice(1)})
          }
        }})
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
      assert.ok(frames.every((frame) => !frame.includes(password) && !frame.includes('HEARTH_COMMUNITY_THIRD_ACCOUNT_private_fixture')))
      await stop()
      assert.ok(!logs.includes(password) && !logs.includes(token) && !logs.includes(code))
      checks.no_password_on_wire_or_secrets_in_logs = true
    } finally { client.free() }
    const report = { measuredAt: new Date().toISOString(), outcome: 'pass', client: 'product WASM', server: 'native HTTP + PostgreSQL', checks }
    mkdirSync(join(root, process.argv.includes('--phase3')?'target/phase3-evidence':'target/phase1-evidence'), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
  }
} finally {
  await stop()
  storage?.close()
  if (container) command('docker', ['stop', container], true)
  if(postgresDirectory){
    if(postgresStarted)command('pg_ctl',['-D',postgresDirectory,'-m','fast','-w','stop'],true)
    assert.equal(resolve(postgresDirectory),resolve(root,'target/auth-acceptance',id,'postgres'))
    rmSync(postgresDirectory,{recursive:true,force:true})
  }
  // Delete only secrets generated by this invocation, leaving non-secret build output.
  for (const name of ['server.key', 'opaque.setup', 'setup.code']) rmSync(join(directory, name), { force: true })
}
