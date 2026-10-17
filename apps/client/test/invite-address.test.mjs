import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inviteShareServer } from '../src/invite-address.ts'

test('only the selected local host supplies a public invite address', () => {
  const host = { https: true, public_address: 'chat.example.org', local_url: 'http://localhost:8080' }
  assert.equal(inviteShareServer('http://127.0.0.1:8080', host), 'https://chat.example.org')
  for (const server of ['http://localhost:8183', 'https://other.example.org']) assert.equal(inviteShareServer(server, host), server)
  for (const changed of [{ https: false }, { public_address: null }, { public_address: '127.0.0.1' }, { public_address: 'user:password@example.org' }, { local_url: 'https://other.example.org' }])
    assert.equal(inviteShareServer('http://localhost:8080', { ...host, ...changed }), 'http://localhost:8080')
})
