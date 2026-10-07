import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const binary = join(root, 'target', 'debug', process.platform === 'win32' ? 'hearth-desktop.exe' : 'hearth-desktop')
const result = spawnSync(binary, ['--mls-spike'], { cwd: root, encoding: 'utf8' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(result.stderr || `Desktop MLS check exited with ${result.status}`)
const report = JSON.parse(result.stdout)
assert.equal(report.members_after_join, 2)
for (const [name, value] of Object.entries(report)) {
  if (name !== 'members_after_join') assert.equal(value, true, `Desktop MLS check failed: ${name}`)
}
console.log(JSON.stringify({ runtime: `Tauri executable (${process.platform}, headless)`, ...report }, null, 2))
