// Official actionlint v1.7.12 archives; pinned release SHA-256 values.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url)), version = '1.7.12'
const hashes = {
  darwin_amd64: '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  darwin_arm64: 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  linux_amd64: '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  linux_arm64: '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  windows_amd64: '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
  windows_arm64: 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
}
const platform = process.platform === 'win32' ? 'windows' : process.platform
const arch = process.arch === 'x64' ? 'amd64' : process.arch
const key = `${platform}_${arch}`
assert.ok(hashes[key], `Unsupported actionlint platform: ${key}`)
const directory = join(root, 'target/native-tools/actionlint', version, key)
mkdirSync(directory, {recursive: true})
const name = `actionlint_${version}_${key}.${platform === 'windows' ? 'zip' : 'tar.gz'}`
const archive = join(directory, name)
if (!existsSync(archive)) {
  const response = await fetch(`https://github.com/rhysd/actionlint/releases/download/v${version}/${name}`, {signal: AbortSignal.timeout(30000)})
  assert.ok(response.ok, `actionlint download failed: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hashes[key], 'actionlint download checksum mismatch')
  writeFileSync(archive, bytes)
}
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), hashes[key], 'Cached actionlint archive checksum mismatch')
const executable = platform === 'windows' ? 'actionlint.exe' : 'actionlint'
const extracted = spawnSync('tar', ['-xf', archive, '-C', directory, executable], {encoding: 'utf8', windowsHide: true, timeout: 30000})
if (extracted.error) throw extracted.error
assert.equal(extracted.status, 0, extracted.stderr)
const binary = join(directory, executable)
if (platform !== 'windows') chmodSync(binary, 0o700)
const result = spawnSync(binary, ['-color'], {cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000})
if (result.error) throw result.error
assert.equal(result.status, 0, 'Workflow validation failed')
