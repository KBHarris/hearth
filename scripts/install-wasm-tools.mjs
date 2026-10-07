import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
// Cargo's generated lockfile has ordered name/version package entries. Reading only
// this version avoids cargo metadata's large JSON output and cross-platform downloads.
const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8')
const versions = [...new Set([...lock.matchAll(/\[\[package\]\]\r?\nname = "wasm-bindgen"\r?\nversion = "([^"]+)"/g)].map((match) => match[1]))]
if (versions.length !== 1) throw new Error('Expected one wasm-bindgen version in the lockfile')
const install = spawnSync('cargo', ['install', 'wasm-bindgen-cli', '--version', versions[0], '--locked'], { cwd: root, stdio: 'inherit' })
if (install.status !== 0) throw new Error(install.error?.message || 'wasm-bindgen-cli installation failed')
