import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sealInvite, openInvite } from '../src/short-invite.ts'
import { createShortInvite, resolveSetupTarget, resolveInviteCode, normalizeInviteCode, setupTarget } from '../src/index.ts'

const base = { server: 'https://chat.example.org', serverKey: 'a'.repeat(64) }
const variants = [{ ...base, account: 'b'.repeat(64) }, { ...base, community: 'c'.repeat(64) }, { ...base, account: 'b'.repeat(64), community: 'c'.repeat(64) }]

test('32 readable characters encrypt server, community and combined capabilities without exposing them to the relay', async () => {
  for (const invite of variants) {
    const first = await sealInvite(invite), second = await sealInvite(invite)
    assert.match(first.code, /^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    assert.equal(normalizeInviteCode(first.code).length, 32)
    assert.notEqual(first.code, second.code)
    assert.deepEqual(await openInvite(base.server, first.code.toLowerCase(), first.request.envelope), invite)
    assert.deepEqual(await openInvite(base.server, normalizeInviteCode(first.code), first.request.envelope), invite)
    const wire = JSON.stringify(first.request)
    for (const secret of [first.code, normalizeInviteCode(first.code), invite.account, invite.community].filter(Boolean)) assert.ok(!wire.includes(secret))
    const url = new URL(first.link)
    assert.equal(url.search, '')
    assert.ok(!first.link.includes(base.serverKey))
  }
})

test('tampering, another code and a different origin cannot decrypt or redirect an invite', async () => {
  const sealed = await sealInvite(variants[2]), other = await sealInvite(variants[2])
  const envelope = sealed.request.envelope
  for (const [server, code, altered] of [
    [base.server, other.code, envelope], ['https://other.example.org', sealed.code, envelope],
    [base.server, sealed.code, { ...envelope, nonce: '00'.repeat(12) }],
    [base.server, sealed.code, { ...envelope, ciphertext: (envelope.ciphertext.startsWith('00') ? '01' : '00') + envelope.ciphertext.slice(2) }],
    [base.server, sealed.code, { ...envelope, ciphertext: envelope.ciphertext.slice(2) }],
  ]) await assert.rejects(openInvite(server, code, altered), error => !error.message.includes(sealed.code))
})

test('share and resolve send only a hash and encrypted envelope; old invites remain compatible', async () => {
  const original = globalThis.fetch
  const stored = new Map(), calls = []
  globalThis.fetch = async (input, init) => {
    calls.push([String(input), init])
    const url = new URL(input)
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); stored.set(body.id, body.envelope)
      assert.equal(init.headers.Authorization, 'Bearer fixture-token')
      return new Response(null, { status: 204 })
    }
    assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error')
    assert.equal(init.headers, undefined)
    return Response.json(stored.get(url.pathname.split('/').at(-1)))
  }
  try {
    const shared = await createShortInvite(variants[2], 'fixture-token')
    assert.deepEqual(await resolveSetupTarget(shared.link), { server: base.server, invite: variants[2] })
    assert.deepEqual(await resolveInviteCode(base.server, shared.code), variants[2])
    assert.equal(calls.length, 3)
    const requests = calls.map(([url, init]) => url + (init.body ?? '')).join('')
    for (const secret of [shared.code, normalizeInviteCode(shared.code), variants[2].account, variants[2].community]) assert.ok(!requests.includes(secret))
    const controller = new AbortController(); controller.abort()
    await assert.rejects(resolveSetupTarget(shared.link, { signal: controller.signal }))
    assert.equal(calls.length, 3)
  } finally { globalThis.fetch = original }
})

test('malformed links and bare codes never leak to DNS; errors do not echo capabilities', async () => {
  const sealed = await sealInvite(variants[2]), original = globalThis.fetch
  globalThis.fetch = () => { throw new Error('Must not contact the network') }
  try {
    for (const value of [sealed.code, normalizeInviteCode(sealed.code)]) assert.throws(() => setupTarget(value), error => error.kind === 'invalid_url')
    for (const value of [sealed.link + '&code=' + sealed.code, sealed.link + '&setup=secret', sealed.link.replace('/#', '/?code=secret#'), sealed.link.replace('code=', 'key=')])
      await assert.rejects(resolveSetupTarget(value), error => error.kind === 'invalid_url' && !error.message.includes(sealed.code))
  } finally { globalThis.fetch = original }
})

test('local hosting seals a public-address code without sending credentials to that public address', async () => {
  const original = globalThis.fetch, stored = new Map(), calls = []
  let key = base.serverKey
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); calls.push({ url, init })
    if (url.pathname === '/.well-known/hearth') {
      assert.equal(url.origin, 'http://localhost:8080'); assert.equal(init.headers, undefined)
      return Response.json({ server_name: 'Fixture', server_key: key, protocols: [1], federation: false })
    }
    if (init.method === 'POST') {
      assert.equal(url.origin, 'http://localhost:8080'); assert.equal(init.headers.Authorization, 'Bearer local-token')
      const body = JSON.parse(init.body); stored.set(body.id, body.envelope); return new Response(null, { status: 204 })
    }
    assert.equal(url.origin, base.server); assert.equal(init.headers, undefined)
    return Response.json(stored.get(url.pathname.split('/').at(-1)))
  }
  try {
    const shared = await createShortInvite(variants[2], 'local-token', { relayServer: 'http://localhost:8080' })
    assert.deepEqual(await resolveInviteCode(base.server, shared.code), variants[2])
    const count = calls.length; key = 'd'.repeat(64)
    await assert.rejects(createShortInvite(variants[2], 'local-token', { relayServer: 'http://localhost:8080' }), /identity changed/)
    assert.equal(calls.length, count + 1); assert.equal(calls.at(-1).url.pathname, '/.well-known/hearth')
  } finally { globalThis.fetch = original }
})
