import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const metadata = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: root, encoding: 'utf8' })
if (metadata.status !== 0) throw new Error(metadata.stderr || metadata.error?.message || 'cargo metadata failed')
const packages = JSON.parse(metadata.stdout).packages
const versions = [...new Set(packages.filter((entry) => entry.name === 'wasm-bindgen').map((entry) => entry.version))]
if (versions.length !== 1) throw new Error('Expected one wasm-bindgen version in the lockfile')
const install = spawnSync('cargo', ['install', 'wasm-bindgen-cli', '--version', versions[0], '--locked'], { cwd: root, stdio: 'inherit' })
if (install.status !== 0) throw new Error(install.error?.message || 'wasm-bindgen-cli installation failed')
