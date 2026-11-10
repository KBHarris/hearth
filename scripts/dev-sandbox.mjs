// UI sandbox: a disposable server (fresh database, no real accounts) plus the Vite client.
// Never points at a real host. Stop with Ctrl+C; the fixture cleans up its own data.
//   node scripts/dev-sandbox.mjs      then open http://localhost:5175
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, sep } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const port = process.env.HEARTH_DEV_CLIENT_PORT ?? '5175'
const env = { ...process.env }
if (!env.PGBIN && process.platform === 'win32') {
  // The Windows PostgreSQL installer does not add its tools to PATH.
  const base = 'C:\\Program Files\\PostgreSQL'
  const version = existsSync(base) ? readdirSync(base).filter(name => existsSync(join(base, name, 'bin', 'initdb.exe'))).sort((a, b) => Number(b) - Number(a))[0] : undefined
  if (version) env.PGBIN = join(base, version, 'bin')
}
// A hard stop (closing the preview on Windows) can leave the previous throwaway database running.
const marker = join(root, 'target/dev-sandbox-last.txt')
if (existsSync(marker)) {
  const stale = resolve(readFileSync(marker, 'utf8').trim())
  if (stale.startsWith(resolve(root, 'target', 'auth-acceptance') + sep) && existsSync(stale)) {
    spawnSync(join(env.PGBIN ?? '', 'pg_ctl'), ['-D', join(stale, 'postgres'), '-m', 'fast', 'stop'], { stdio: 'ignore', windowsHide: true, timeout: 20000 })
    rmSync(stale, { recursive: true, force: true })
  }
  rmSync(marker, { force: true })
}
// Direct Vite skips the client's predev hook, so build the current crypto engine first.
if (spawnSync(process.execPath, [join(root, 'scripts/build-auth-wasm.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true }).status !== 0) process.exit(1)

const fixture = spawn(process.execPath, ['scripts/verify-auth.mjs', '--serve', '--native-postgres', '--phase3'], {
  cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...env, HEARTH_TEST_DATABASE_URL: '', HEARTH_CLIENT_ORIGINS: `http://127.0.0.1:${port},http://localhost:${port}` },
})
let vite, output = '', stopping = false
function stop() {
  if (stopping) return
  stopping = true
  vite?.kill()
  if (fixture.exitCode === null) fixture.stdin.write('stop\n')
}
process.on('SIGINT', stop); process.on('SIGTERM', stop)
fixture.once('exit', code => { vite?.kill(); rmSync(marker, { force: true }); process.exit(stopping ? 0 : code ?? 1) })
fixture.stdout.on('data', chunk => {
  if (vite) return
  output += chunk
  const match = output.match(/Disposable owner-setup fixture: (http:\/\/127\.0\.0\.1:\d+); setup code file: (.+?)\. Type stop/)
  if (!match) return
  writeFileSync(marker, dirname(match[2]))
  console.log(`Sandbox server: ${match[1]}`)
  console.log(`Owner setup code (throwaway): ${readFileSync(match[2], 'utf8').trim()}`)
  vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js')], {
    cwd: join(root, 'apps/client'), windowsHide: true, stdio: 'inherit',
    env: { ...env, HEARTH_DEV_SERVER: match[1], HEARTH_DEV_CLIENT_PORT: port },
  })
  vite.once('exit', stop)
})
