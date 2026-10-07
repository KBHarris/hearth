// Official, pinned test server; verify the release checksum before extraction.
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = '1.13.8'
const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch]
if (!arch || !['win32', 'linux'].includes(process.platform)) throw new Error('Use Docker or a source-built LiveKit on this platform')
const platform = process.platform === 'win32' ? 'windows' : 'linux'
const extension = platform === 'windows' ? 'zip' : 'tar.gz'
const asset = `livekit_${version}_${platform}_${arch}.${extension}`
const base = `https://github.com/livekit/livekit/releases/download/v${version}`
const output = join(root, 'target', 'livekit-spike')
mkdirSync(output, { recursive: true })
async function download(name) {
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Official release download returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const archive = await download(asset)
const checksums = (await download('checksums.txt')).toString('utf8')
const expected = checksums.split(/\r?\n/).find((line) => line.trim().endsWith(` ${asset}`))?.split(/\s+/)[0]
if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error('LiveKit release checksum mismatch')
const path = join(output, asset)
writeFileSync(path, archive)
// bsdtar on Windows supports zip as well as tar.gz; no shell interpolation.
const result = spawnSync('tar', ['-xf', path, '-C', output], { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
if (result.status !== 0) throw new Error('Official LiveKit archive extraction failed')
const binary = join(output, platform === 'windows' ? 'livekit-server.exe' : 'livekit-server')
if (readFileSync(binary).length === 0) throw new Error('Extracted LiveKit binary missing')
console.log(`LiveKit ${version}, verified SHA-256. LIVEKIT_BINARY=${binary}`)
