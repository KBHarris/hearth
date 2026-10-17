import assert from 'node:assert/strict'
import { sealInvite, openInvite } from '../packages/sdk/src/short-invite.ts'

export async function verifyShortInvites({ origin, serverId, token, request, checks, sql, restart }) {
  let account
  for (const capabilities of [{ account: 'b'.repeat(64) }, { community: 'c'.repeat(64) }, { account: 'b'.repeat(64), community: 'c'.repeat(64) }]) {
    const invite = { server: origin, serverKey: serverId, ...capabilities }
    const sealed = await sealInvite(invite)
    assert.equal((await request('/api/v1/auth/invite-links', sealed.request)).status, 401)
    assert.equal((await request('/api/v1/auth/invite-links', sealed.request, token)).status, 204)
    const path = '/api/v1/invite-links/' + sealed.request.id
    const found = await request(path)
    assert.equal(found.status, 200); assert.equal(found.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await openInvite(origin, sealed.code, found.value), invite)
    assert.equal((await request('/api/v1/auth/invite-links', sealed.request, token)).status, 409)
    account ??= sealed
  }
  checks.short_invites_round_trip_all_three_scopes_with_no_plaintext_capability_on_relay = true
  assert.equal((await request('/api/v1/auth/invite-links', { ...account.request, envelope: { nonce: 'x', ciphertext: '0'.repeat(64) } }, token)).status, 400)
  assert.equal((await request('/api/v1/invite-links/' + '0'.repeat(64))).status, 404)
  await restart()
  assert.equal((await request('/api/v1/invite-links/' + account.request.id)).status, 200)
  sql(`UPDATE invite_envelopes SET expires_at=now()-interval '1 second' WHERE id='${account.request.id}'`)
  assert.equal((await request('/api/v1/invite-links/' + account.request.id)).status, 404)
  // The public endpoint only reveals ciphertext. It cannot grant server-account admission.
  assert.equal((await request('/api/v1/auth/session')).status, 401)
  checks.short_invites_are_immutable_survive_restart_and_expire_without_authentication_bypass = true
}
