import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target', 'opaque-spike-node')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}
run('cargo', ['build', '--locked', '-p', 'hearth-server', '--bin', 'opaque-spike-server', '--features', 'opaque-spike'])
run('cargo', ['build', '--locked', '-p', 'hearth-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'opaque-spike'])
run('wasm-bindgen', [join(root, 'target', 'wasm32-unknown-unknown', 'debug', 'hearth_wasm.wasm'), '--target', 'nodejs', '--out-dir', output])

const wasm = createRequire(import.meta.url)(join(output, 'hearth_wasm.js'))
const binary = join(root, 'target', 'debug', process.platform === 'win32' ? 'opaque-spike-server.exe' : 'opaque-spike-server')
const server = spawn(binary, [], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] })
const lines = createInterface({ input: server.stdout })
const iterator = lines[Symbol.asyncIterator]()
const frames = []
const password = 'HEARTH_OPAQUE_PRIVATE_PASSWORD_CANARY'
const canary = Buffer.from(password)
let spawnError
server.on('error', (error) => { spawnError = error })

async function rpc(op, payload = {}) {
  if (spawnError) throw spawnError
  if (payload.message) frames.push(Buffer.from(payload.message, 'hex'))
  server.stdin.write(JSON.stringify({ op, ...payload }) + '\n')
  let timer
  try {
    const next = await Promise.race([
      iterator.next(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Rust OPAQUE test process timed out')), 10000) }),
    ])
    assert.equal(next.done, false, 'Rust OPAQUE test process exited early')
    const response = JSON.parse(next.value)
    if (response.result?.message) frames.push(Buffer.from(response.result.message, 'hex'))
    return response
  } finally { clearTimeout(timer) }
}

async function login(client, secret = password, knownUser = true) {
  const message = client.loginStart(secret)
  const response = await rpc('login_start', { message, known_user: knownUser })
  assert.equal(response.ok, true)
  return { response: response.result.message, finish: () => JSON.parse(client.loginFinish(secret, response.result.message)) }
}

const client = new wasm.OpaqueSpikeClient()
const started = performance.now()
try {
  const request = client.registrationStart(password)
  const registration = await rpc('register_start', { message: request })
  assert.equal(registration.ok, true)
  const upload = client.registrationFinish(password, registration.result.message)
  assert.equal((await rpc('register_finish', { message: upload })).result.registered, true)
  assert.equal((await rpc('record_check')).result.password_canary_absent, true)

  const first = (await login(client)).finish()
  assert.equal(first.export_key_matches, true)
  assert.equal(first.server_key_matches, true)
  assert.equal((await rpc('login_finish', { message: first.message, session_tag: first.session_tag })).result.session_matches, true)
  assert.throws(() => client.loginFinish(password, '00'), 'WASM client state is single-use')
  assert.equal((await rpc('login_finish', { message: first.message, session_tag: first.session_tag })).ok, false)

  const second = (await login(client)).finish()
  assert.notEqual(first.session_tag, second.session_tag, 'Each login must negotiate a fresh session')
  assert.equal((await rpc('login_finish', { message: second.message, session_tag: second.session_tag })).result.session_matches, true)
  assert.throws((await login(client, 'wrong-password')).finish, 'Wrong passwords must fail')
  assert.throws((await login(client, password, false)).finish, 'Unknown users receive a dummy response but cannot log in')

  const tamperAttempt = await login(client)
  const tampered = Buffer.from(tamperAttempt.response, 'hex')
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => client.loginFinish(password, tampered.toString('hex')), 'Modified server responses must fail')
  const forged = (await login(client)).finish()
  const forgedFinalization = Buffer.from(forged.message, 'hex')
  forgedFinalization[forgedFinalization.length - 1] ^= 1
  assert.equal((await rpc('login_finish', { message: forgedFinalization.toString('hex'), session_tag: forged.session_tag })).ok, false)
  assert.equal((await rpc('login_finish', { message: forged.message, session_tag: forged.session_tag })).ok, false, 'Rejected finalization must consume server state')
  const recovered = (await login(client)).finish()
  assert.equal((await rpc('login_finish', { message: recovered.message, session_tag: recovered.session_tag })).result.session_matches, true)
  assert.equal(frames.every((frame) => !frame.includes(canary)), true)

  console.log(JSON.stringify({
    runtime: 'WASM client + separate native Rust process',
    registration_and_login: true,
    session_keys_match: true,
    export_key_matches: true,
    server_key_matches: true,
    fresh_sessions: true,
    wrong_password_rejected: true,
    unknown_user_rejected: true,
    tampering_rejected: true,
    replay_rejected: true,
    fresh_login_after_rejection: true,
    password_canary_absent_from_wire_and_record: true,
    scenario_ms: Math.round(performance.now() - started),
  }, null, 2))
} finally {
  client.free()
  lines.close()
  server.stdin.end()
  server.kill()
}
