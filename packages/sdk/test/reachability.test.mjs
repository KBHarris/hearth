import assert from 'node:assert/strict'
import test from 'node:test'
import { createReachabilityRequest, parseReachabilityRequest, checkReachabilityRequest, verifyReachabilityReceipt } from '../src/reachability.ts'
const key = 'a'.repeat(64)
test('outside check rejects nonpublic addresses and unsafe URL components', () => {
  for (const origin of ['http://example.org', 'https://localhost', 'https://192.168.1.2', 'https://100.64.1.1', 'https://user:pass@example.org', 'https://example.org/path']) assert.throws(() => createReachabilityRequest(origin, key))
})
test('requests expire and reject unsupported fields before any fetch', async () => {
  const now = Date.now(), request = createReachabilityRequest('https://example.org', key, now)
  assert.deepEqual(parseReachabilityRequest(JSON.stringify(request), now), request)
  assert.throws(() => parseReachabilityRequest(JSON.stringify(request), now + 900_000))
  assert.throws(() => parseReachabilityRequest(JSON.stringify({ ...request, invite: 'private' }), now))
  await assert.rejects(checkReachabilityRequest(JSON.stringify(request), false), /another household/)
})
test('result is bound to the exact nonce, origin, identity and lifetime', () => {
  const now = Date.now(), request = createReachabilityRequest('https://example.org', key, now)
  const receipt = { schema: 1, kind: 'hearth-network-result', server: request.server, serverKey: key, nonce: request.nonce, checkedAt: now, outsideNetworkConfirmed: true }
  assert.deepEqual(verifyReachabilityReceipt(JSON.stringify(receipt), request, now), receipt)
  for (const change of [{ nonce: 'b'.repeat(64) }, { server: 'https://evil.test' }, { serverKey: 'b'.repeat(64) }, { checkedAt: now - 1 }, { outsideNetworkConfirmed: false }]) assert.throws(() => verifyReachabilityReceipt(JSON.stringify({ ...receipt, ...change }), request, now))
})
test('external tester uses unauthenticated discovery and rejects mismatched identity', async () => {
  const original = globalThis.fetch
  const request = createReachabilityRequest('https://example.org', key)
  let advertised = key, requests = 0
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(new Headers(options?.headers).has('Authorization'), false)
    const path = new URL(url).pathname
    const value = path === '/health' ? { status: 'ok', version: '0.1.0', protocol: 1 } : path === '/.well-known/hearth' ? { server_name: 'Fixture', server_key: advertised, protocols: [1], federation: false } : { setup_complete: true }
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const receipt = await checkReachabilityRequest(JSON.stringify(request), true)
    assert.equal(receipt.serverKey, key); assert.equal(requests, 3)
    advertised = 'b'.repeat(64)
    await assert.rejects(checkReachabilityRequest(JSON.stringify(request), true), /different Hearth server/)
  } finally { globalThis.fetch = original }
})
