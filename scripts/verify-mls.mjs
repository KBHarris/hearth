import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target', 'mls-spike-node')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

run('cargo', ['build', '--locked', '-p', 'hearth-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'mls-spike'])
run('wasm-bindgen', [join(root, 'target', 'wasm32-unknown-unknown', 'debug', 'hearth_wasm.wasm'), '--target', 'nodejs', '--out-dir', output])
const require = createRequire(import.meta.url)
const wasm = require(join(output, 'hearth_wasm.js'))
const report = JSON.parse(wasm.mlsSpike())
assert.equal(report.members_after_join, 2)
for (const [name, value] of Object.entries(report)) {
  if (name !== 'members_after_join') assert.equal(value, true, `WASM MLS check failed: ${name}`)
}
console.log(JSON.stringify({ runtime: 'Node WebAssembly', ...report }, null, 2))
