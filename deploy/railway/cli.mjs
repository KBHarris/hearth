// Official release archives. Digests checked against GitHub release v5.71.0 on 2026-10-20.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const version = '5.71.0'
export const root = fileURLToPath(new URL('../../', import.meta.url))
const platforms = {
  win32_x64: ['x86_64-pc-windows-gnu', 'cdce88c5a2dd7e67d43816d2f09793c66bc73ad2d9d4d32eeee99242fc7bf8e9'],
  win32_arm64: ['aarch64-pc-windows-msvc', '8432874e9d6a38fc83b77b471f16f1cc86a3dc298e8493d5a4196ef06bc5447a'],
  darwin_x64: ['x86_64-apple-darwin', '1b41dd77292657c80ae3dfccbe7653bbb40b7cdc95a8f4b06c2c1f0c2a009919'],
  darwin_arm64: ['aarch64-apple-darwin', '350748f2edf41f46b22c5d66cea4294d660e764804e252ddba08a27b19cd0bd1'],
  linux_x64: ['x86_64-unknown-linux-musl', '2e682fd2ddf8d6fdf9e46d9d99d99646ff0022a6abb0c2bca93011348a269fb9'],
  linux_arm64: ['aarch64-unknown-linux-musl', 'd160ad2a029eaac4b4c85012adb67c1f5709ba81f7320edb5a27be928211d638'],
}
export async function cliBinary() {
  const entry = platforms[`${process.platform}_${process.arch}`]
  assert.ok(entry, 'Unsupported Railway CLI platform')
  const [target, digest] = entry
  const directory = join(root, 'target', 'native-tools', 'railway', version, target)
  mkdirSync(directory, { recursive: true })
  const archive = join(directory, 'railway.tar.gz')
  if (!existsSync(archive)) {
    const response = await fetch(`https://github.com/railwayapp/cli/releases/download/v${version}/railway-v${version}-${target}.tar.gz`, { signal: AbortSignal.timeout(60_000) })
    assert.ok(response.ok, 'Official Railway CLI download failed')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, 'Railway CLI download checksum mismatch')
    writeFileSync(archive + '.tmp', bytes, { mode: 0o600 })
    renameSync(archive + '.tmp', archive)
  }
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), digest, 'Cached Railway CLI checksum mismatch')
  const executable = process.platform === 'win32' ? 'railway.exe' : 'railway'
  const extracted = spawnSync('tar', ['-xf', archive, '-C', directory, executable], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  assert.equal(extracted.status, 0, 'Railway CLI extraction failed')
  const binary = join(directory, executable)
  if (process.platform !== 'win32') chmodSync(binary, 0o700)
  return binary
}

export async function runCli(args, { capture = false, input, timeout = 120_000 } = {}) {
  const binary = await cliBinary()
  const result = spawnSync(binary, args, { cwd: root, encoding: 'utf8', input, stdio: capture ? 'pipe' : 'inherit', windowsHide: true, timeout })
  if (result.error || result.status !== 0) throw new Error(`Railway ${args[0]} failed; check your login, selected environment and provider status`)
  return result.stdout?.trim()
}
