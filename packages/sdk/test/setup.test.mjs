import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addressScope, createHearthInvite, parseHearthInvite, setupTarget } from '../src/index.ts'

const invite = { server: 'https://chat.example.org', serverKey: 'a'.repeat(64), account: 'b'.repeat(64), community: 'c'.repeat(64) }

test('one invite carries the server identity and both admission capabilities only in its fragment', () => {
  const link = createHearthInvite(invite)
  assert.deepEqual(parseHearthInvite(link), invite)
  const url = new URL(link)
  assert.equal(url.search, '')
  assert.equal(url.pathname, '/')
  assert.ok(!link.split('#')[0].includes(invite.account))
  assert.deepEqual(setupTarget(link), { server: invite.server, invite })
  assert.deepEqual(parseHearthInvite(createHearthInvite({ ...invite, account: undefined })), { server: invite.server, serverKey: invite.serverKey, community: invite.community })
})

test('invalid or ambiguous invites are rejected without repeating capabilities in error messages', () => {
  const link = createHearthInvite(invite)
  for (const value of [
    link + '&account=' + 'd'.repeat(64), link + '&extra=1', link.replace('v=1', 'v=2'),
    link.replace('key=' + invite.serverKey, 'key=short'), link.replace('account=' + invite.account, 'account='),
    link.replace('hearth://join/', 'hearth://elsewhere/'), link.replace('/#', '/?account=' + invite.account + '#'),
    link.replace('/#', '/path#'), link.replace('join/', 'name:password@join/'),
    link.replace('https%3A%2F%2Fchat.example.org', 'http%3A%2F%2Fchat.example.org'),
    link.replace('https%3A%2F%2Fchat.example.org', 'https%3A%2F%2Fchat.example.org%2Fapi'),
    'hearth://join/#v=1&server=https://chat.example.org&key=' + invite.serverKey,
    link + 'x'.repeat(2049),
  ]) {
    assert.throws(() => parseHearthInvite(value), error => !error.message.includes(invite.account) && !error.message.includes(invite.community))
  }
})

test('invite parsing never treats account or community codes as an owner bootstrap capability', () => {
  const link = createHearthInvite(invite)
  assert.throws(() => parseHearthInvite(link + '&setup=' + 'd'.repeat(64)))
  assert.throws(() => createHearthInvite({ server: invite.server, serverKey: invite.serverKey }))
})

test('plain server addresses continue to use HTTPS and localhost stays available', () => {
  assert.deepEqual(setupTarget(' chat.example.org '), { server: invite.server, invite: null })
  assert.deepEqual(setupTarget('localhost:8080'), { server: 'http://localhost:8080', invite: null })
  assert.throws(() => setupTarget('http://192.168.1.2'))
  assert.throws(() => setupTarget('https://name:password@chat.example.org'))
  for (const code of [invite.account, invite.community.toUpperCase()]) {
    assert.throws(() => setupTarget(code), error => error.kind === 'invalid_url' && !error.message.includes(code))
  }
})

test('readiness distinguishes local, private and shared addressing without asserting outside reachability', () => {
  for (const host of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'https://127.0.0.2', 'https://[::ffff:127.0.0.1]']) assert.equal(addressScope(host), 'loopback')
  for (const host of ['https://10.0.0.2', 'https://192.168.1.2', 'https://172.31.1.2', 'https://169.254.1.1', 'https://[fd12::1]', 'https://[fe80::1]', 'https://hearth.local.', 'https://[::]', 'https://[::ffff:192.168.1.1]']) assert.equal(addressScope(host), 'private')
  for (const host of ['https://100.64.0.1', 'https://100.127.255.254']) assert.equal(addressScope(host), 'shared')
  for (const host of ['https://100.63.0.1', 'https://100.128.0.1', 'https://172.32.1.2', invite.server]) assert.equal(addressScope(host), 'public')
})
