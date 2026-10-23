import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export function allowedBuildFile(file) {
  if (file.includes('\\') || file.startsWith('/') || file.split('/').some(part => ['..', '.git', 'node_modules', 'target', 'dist', 'generated', 'data', 'secrets', '.ssh', '.gnupg', '.aws', '.codex', '.agents', '.release-keys'].includes(part))) return false
  if (file.split('/').some(part => part.startsWith('.env') || part === 's3.json')) return false
  if (!['.rs', '.toml', '.lock', '.json', '.mjs', '.cjs', '.ts', '.tsx', '.js', '.html', '.css', '.svg', '.sql', '.sh', '.png', '.ico', '.dockerignore'].includes(extname(file)) && !['Dockerfile', 'Caddyfile', '.dockerignore'].includes(basename(file))) return false
  return ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'package.json', 'package-lock.json', '.dockerignore'].includes(file)
    || /^(crates\/|apps\/client\/|apps\/desktop\/src-tauri\/|packages\/sdk\/|deploy\/web\/)/.test(file)
    || ['apps/desktop/package.json', 'scripts/build-auth-wasm.mjs', 'deploy/server-entrypoint.sh'].includes(file)
}

export function prepareContext(root) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', windowsHide: true })
  assert.equal(listed.status, 0, 'Cannot enumerate the source snapshot')
  const files = [...new Set(listed.stdout.split('\0').filter(Boolean))].filter(allowedBuildFile).sort()
  const directory = join(root, 'target', 'cloud-context', randomUUID())
  mkdirSync(directory, { recursive: true })
  const hashes = {}
  for (const file of files) {
    const source = resolve(root, file), destination = resolve(directory, file)
    assert.ok(!relative(directory, destination).startsWith('..'), 'Build path escaped the source snapshot')
    let parent = source
    while (parent !== resolve(root)) {
      assert.ok(!lstatSync(parent).isSymbolicLink(), 'Build inputs must not be symbolic links')
      parent = dirname(parent)
    }
    assert.ok(lstatSync(source).isFile(), 'Build input is not a regular file')
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    hashes[file] = createHash('sha256').update(readFileSync(destination)).digest('hex')
  }
  for (const required of ['Cargo.toml', 'Cargo.lock', 'package-lock.json', 'crates/hearth-server/Dockerfile', 'deploy/web/Dockerfile', 'deploy/web/Caddyfile', 'deploy/server-entrypoint.sh']) assert.ok(hashes[required], 'Required build input is missing')
  writeFileSync(join(directory, 'source-manifest.json'), JSON.stringify(hashes, null, 2) + '\n')
  return { directory, files: files.length, manifestSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex') }
}
