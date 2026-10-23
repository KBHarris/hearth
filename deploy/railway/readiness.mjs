import assert from 'node:assert/strict'

export function publicOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Provider returned an invalid public address') }
  assert.ok(url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Provider public address must be an HTTPS origin')
  return url.origin
}

export function selectDomain(value) {
  assert.ok(Array.isArray(value?.domains), 'Unexpected provider domain response')
  const generated = value.domains.filter(domain => domain?.type === 'service')
  const chosen = generated[0] ?? value.domains[0]
  if (!chosen) return null
  assert.ok(typeof chosen.domain === 'string', 'Unexpected provider domain entry')
  assert.equal(chosen.targetPort, 8080, 'Existing provider domain must target port 8080; review it before deployment')
  const host = chosen.domain
  assert.match(host, /^[a-zA-Z0-9.-]+$/, 'Invalid provider domain')
  return publicOrigin('https://' + host)
}

export function deploymentState(list, id) {
  assert.ok(Array.isArray(list), 'Unexpected provider deployment response')
  const deployment = list.find(item => item.id === id)
  assert.ok(deployment, 'Uploaded deployment is missing from the provider response')
  assert.equal(typeof deployment.status, 'string', 'Missing deployment status')
  if (['FAILED', 'CRASHED', 'REMOVED', 'SKIPPED', 'CANCELED'].includes(deployment.status)) throw new Error('Provider build or deployment failed; inspect authenticated provider logs')
  return deployment.status === 'SUCCESS'
}

export async function checkPublicReadiness(backend, website, fetcher = fetch) {
  backend = publicOrigin(backend)
  if (website) website = publicOrigin(website)
  const get = async (origin, path) => {
    const response = await fetcher(origin + path, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store' })
    assert.ok(response.ok, 'A public service is not ready')
    return response
  }
  const health = await (await get(backend, '/health')).json()
  assert.equal(health.status, 'ok', 'Backend is not healthy')
  const identity = await (await get(backend, '/.well-known/hearth')).json()
  assert.match(identity.server_key ?? '', /^[a-f0-9]{64}$/, 'Backend discovery did not provide a server identity')
  assert.ok(identity.protocols?.includes(1), 'Backend protocol is incompatible')
  const setup = await (await get(backend, '/api/v1/setup')).json()
  assert.equal(typeof setup.setup_complete, 'boolean', 'Backend setup status is invalid')
  if (website) {
    await get(website, '/web-health')
    const document = await get(website, '/')
    assert.ok(document.headers.get('content-type')?.includes('text/html'), 'Website did not serve HTML')
    assert.ok((await document.text()).includes('id="root"'), 'Website did not serve Hearth')
    const proxyIdentity = await (await get(website, '/.well-known/hearth')).json()
    assert.equal(proxyIdentity.server_key, identity.server_key, 'Website proxy connected to a different backend identity')
  }
  return { backendHealthy: true, websiteReachable: !!website, identity: identity.server_key, ownerEnrolled: setup.setup_complete, storageValidated: false, mediaValidated: false }
}
