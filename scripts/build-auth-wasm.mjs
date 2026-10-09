import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'apps/client/src/crypto/generated')
if (process.env.HEARTH_PREBUILT_WASM === '1') {
  for (const file of ['hearth_wasm.js', 'hearth_wasm.d.ts', 'hearth_wasm_bg.wasm']) {
    if (!existsSync(join(output, file))) throw new Error('Missing current-run auth WASM artifact')
  }
} else {
  for (const [command, args] of [
    ['cargo', ['build', '--locked', '--release', '-p', 'hearth-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'auth']],
    ['wasm-bindgen', [join(root, 'target/wasm32-unknown-unknown/release/hearth_wasm.wasm'), '--target', 'web', '--out-dir', output]],
  ]) {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error(`${command} failed; install the wasm32 target and run npm run spike:tools`)
  }
}
