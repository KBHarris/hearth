import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { hearthProject } from '../../.railway/railway.ts'
import { allowedBuildFile } from '../railway/context.mjs'
import { deploymentId } from '../railway/deploy.mjs'
import { checkPublicReadiness, deploymentState, publicOrigin, selectDomain } from '../railway/readiness.mjs'
import { validateSettings } from '../railway/settings.mjs'

const settings = JSON.parse(readFileSync(new URL('../../.railway/hearth.json', import.meta.url), 'utf8'))

test('cloud graph supports desktop-only and web modes with private database references and durable keys', () => {
  for (const web of [true, false]) {
    const graph = hearthProject({ ...settings, web })
    const byName = new Map(graph.resources.map(resource => [resource.name, resource]))
    assert.equal(byName.has('web'), web)
    const backend = byName.get('hearth')
    assert.equal(backend.source.rootDirectory, '/')
    assert.equal(backend.build.dockerfilePath, 'crates/hearth-server/Dockerfile')
    assert.equal(backend.deploy.healthcheckPath, '/health')
    assert.equal(backend.variables.HEARTH_BIND.value, '[::]:8080')
    assert.equal(backend.volumeAttachments['server-data'].mountPath, '/var/lib/hearth')
    assert.equal(backend.variables.DATABASE_URL.resource, 'database.postgres')
    assert.equal(backend.variables.HEARTH_S3_SECRET_KEY.resource, 'bucket.attachments')
    assert.equal(backend.variables.HEARTH_S3_BUCKET.output, 'BUCKET')
    assert.equal(backend.variables.HEARTH_S3_CREATE_BUCKET.value, 'false')
    assert.equal(backend.variables.HEARTH_FEDERATION.value, 'false')
    assert.equal(backend.variables.HEARTH_CLIENT_ORIGINS.value.includes('web.RAILWAY_PUBLIC_DOMAIN'), web)
    assert.deepEqual(byName.get('postgres').networking, { tcpProxies: {}, serviceDomains: {}, customDomains: {} })
    assert.match(byName.get('postgres').source.image, /@sha256:[a-f0-9]{64}$/)
    assert.equal(byName.get('server-data').config.sizeMB, 1024)
    const serialized = JSON.stringify(graph)
    assert.ok(!serialized.includes('http://localhost') && !serialized.includes('http://127.0.0.1'))
  }
})

test('cloud settings reject accidental secrets, ambiguous mode and inexact browser origins', () => {
  for (const override of [{ token: 'secret-canary' }, { web: 'false' }, { bucketRegion: 'typo' }, { volumeSizeMB: 0 }, { extraClientOrigins: ['*'] }, { extraClientOrigins: ['http://public.example.org'] }, { extraClientOrigins: ['https://public.example.org/path'] }, { extraClientOrigins: ['https://user:password@example.org'] }]) {
    assert.throws(() => validateSettings({ ...settings, ...override }))
  }
  assert.deepEqual(validateSettings({ ...settings, extraClientOrigins: ['https://web.example.org'] }).extraClientOrigins, ['https://web.example.org'])
})

test('build snapshot excludes credentials, generated outputs, unrelated files and traversal', () => {
  for (const file of ['.aws/credentials', 'deploy/.env', 'apps/client/.env.production', 'crates/hearth-server/s3.json', 'crates/hearth-server/data/server.key', 'apps/client/secrets/provider.json', 'apps/client/local.pem', 'apps/desktop/src-tauri/target/secret', 'apps/client/src/crypto/generated/hearth_wasm.js', 'apps/client/../../.release-keys/key', 'docs/private.md', 'target/private.json', 'crates/link/../secret']) assert.equal(allowedBuildFile(file), false, file)
  for (const file of ['Cargo.lock', 'crates/hearth-server/src/main.rs', 'apps/client/src/App.tsx', 'apps/desktop/src-tauri/Cargo.toml', 'packages/sdk/src/index.ts', 'deploy/web/Dockerfile.dockerignore', 'deploy/web/Caddyfile', 'scripts/build-auth-wasm.mjs']) assert.equal(allowedBuildFile(file), true, file)
})

test('provider domain reuse validates protocol and target port', () => {
  assert.equal(selectDomain({ domains: [] }), null)
  assert.equal(selectDomain({ domains: [{ type: 'service', domain: 'hearth.up.railway.app', targetPort: 8080 }] }), 'https://hearth.up.railway.app')
  assert.throws(() => selectDomain({ domains: [{ domain: 'hearth.up.railway.app', targetPort: 3000 }] }))
  for (const origin of ['http://example.org', 'https://user:secret@example.org', 'https://example.org/path', 'https://example.org?token=x', 'https://example.org#capability']) assert.throws(() => publicOrigin(origin))
})

test('deployment readiness follows the uploaded deployment ID and rejects failure', () => {
  assert.equal(deploymentId('{"stage":"upload"}\n{"deploymentId":"test-build-1","logsUrl":"https://provider.example"}\n'), 'test-build-1')
  assert.throws(() => deploymentId('{"status":"success"}'))
  assert.equal(deploymentState([{ id: 'old', status: 'SUCCESS' }, { id: 'new', status: 'BUILDING' }], 'new'), false)
  assert.equal(deploymentState([{ id: 'new', status: 'SUCCESS' }], 'new'), true)
  assert.throws(() => deploymentState([{ id: 'old', status: 'SUCCESS' }], 'new'))
  for (const status of ['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED', 'CANCELED']) assert.throws(() => deploymentState([{ id: 'new', status }], 'new'))
})

function responses(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.credentials, 'omit')
    assert.equal(options.redirect, 'error')
    const path = new URL(url).pathname
    if (path === '/health') return Response.json(overrides.health ?? { status: 'ok' })
    if (path === '/api/v1/setup') return Response.json({ setup_complete: false })
    if (path === '/.well-known/hearth') return Response.json({ server_key: url.startsWith('https://web.') ? overrides.proxyKey ?? 'a'.repeat(64) : 'a'.repeat(64), protocols: [1] })
    if (path === '/web-health') return new Response('ok')
    return new Response('<div id="root"></div>', { headers: { 'content-type': 'text/html' } })
  }
}

test('public readiness binds the web proxy to the backend and keeps storage/media separate', async () => {
  const result = await checkPublicReadiness('https://api.example.org', 'https://web.example.org', responses())
  assert.equal(result.backendHealthy, true)
  assert.equal(result.websiteReachable, true)
  assert.equal(result.ownerEnrolled, false)
  assert.equal(result.storageValidated, false)
  assert.equal(result.mediaValidated, false)
  await assert.rejects(checkPublicReadiness('https://api.example.org', 'https://web.example.org', responses({ proxyKey: 'b'.repeat(64) })))
  await assert.rejects(checkPublicReadiness('https://api.example.org', null, responses({ health: { status: 'degraded' } })))
})
