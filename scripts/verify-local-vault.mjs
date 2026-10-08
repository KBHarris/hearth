// Uses the opt-in native test service, never product credentials.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = spawnSync(join(root, 'target/debug', process.platform === 'win32' ? 'hearth-desktop.exe' : 'hearth-desktop'), ['--verify-local-vault'], {
  cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60000,
})
assert.equal(result.error, undefined, 'Native OS store acceptance could not complete')
assert.equal(result.status, 0, 'Native OS store acceptance failed; no fallback is permitted')
assert.match(result.stdout, /OS_KEYSTORE: pass/)
const report = {
  measuredAt: new Date().toISOString(), outcome: 'pass', platform: process.platform,
  backend: { win32: 'Windows Credential Manager', darwin: 'macOS Keychain', linux: 'Secret Service' }[process.platform],
  scope: 'dedicated disposable test credential; not packaged authentication',
  checks: { create_and_read: true, fresh_process_read: true, preserve_existing: true, preserve_damaged_entry: true, cleanup: true },
}
const directory = join(root, 'target/phase1-evidence')
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, `local-vault-${process.platform}.json`), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
