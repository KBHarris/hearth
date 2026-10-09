// Real authenticated HTTP and PostgreSQL. Accounts/databases are disposable fixtures.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

export async function verifyCommunities({wasm,request,login,serverId,owner,memberPassword,checks,start,stop,healthy,expireInvite}) {
  // Begin a new request-budget window after the dense encrypted-DM scenario.
  await stop();start();await healthy()
  const base='/api/v1/communities/'
  const directory=base.slice(0,-1)
  const bob=await request('/api/v1/auth/login/finish',await login(memberPassword,serverId,null,'bob'))
  assert.equal(bob.status,200)
  const settings=(await request('/api/v1/auth/admin/settings',undefined,owner)).value
  assert.equal((await request('/api/v1/auth/admin/settings',{...settings,registration_mode:'invite'},owner)).status,200)
  const invitation=await request('/api/v1/auth/admin/invite',{},owner)
  assert.equal(invitation.status,200)
  const secret='HEARTH_COMMUNITY_THIRD_ACCOUNT_private_fixture'
  const client=new wasm.OpaqueAuthClient()
  let carol
  try {
    const registration=await request('/api/v1/auth/register/start',{username:'dora',message:client.registrationStart(secret),invite_code:invitation.value.code})
    assert.equal(registration.status,200)
    assert.equal((await request('/api/v1/auth/register/finish',{username:'dora',message:client.registrationFinish(secret,registration.value.message,'dora',serverId),invite_code:invitation.value.code})).status,200)
    carol=await request('/api/v1/auth/login/finish',await login(secret,serverId,null,'dora'))
    assert.equal(carol.status,200)
  } finally {client.free();assert.equal((await request('/api/v1/auth/admin/settings',settings,owner)).status,200)}
  assert.equal((await request(directory)).status,401)
  assert.equal((await request(directory,{name:'No session'})).status,401)
  const created=await request(directory,{name:'Community fixture 🦀'},owner)
  assert.equal(created.status,200)
  assert.equal(created.headers.get('cache-control'),'no-store')
  const community=created.value
  assert.equal((await request(base+community.id,undefined,bob.value.token)).status,403)
  assert.deepEqual((await request(directory,undefined,bob.value.token)).value,[])
  assert.equal((await request(base+community.id,undefined,'0'.repeat(64))).status,401)
  assert.equal((await request(directory,{name:'Hidden content',message:'plaintext is forbidden'},owner)).status,422)
  checks.community_directory_requires_membership=true

  const category=await request(base+community.id+'/categories',{name:'General'},owner)
  assert.equal(category.status,200)
  for(const kind of ['text','announcement']) {
    const channel=await request(base+community.id+'/channels',{name:kind,category_id:category.value.id,kind},owner)
    assert.equal(channel.status,200)
    assert.equal(channel.value.kind,kind)
  }
  const other=(await request(directory,{name:'Other community'},owner)).value
  assert.equal((await request(base+other.id+'/channels',{name:'wrong-category',category_id:category.value.id,kind:'text'},owner)).status,400)
  assert.equal((await request(base+community.id+'/categories',{name:'Bad\nname'},owner)).status,400)
  assert.equal((await request(base+community.id+'/channels',{name:'a'.repeat(81),category_id:null,kind:'text'},owner)).status,400)
  checks.community_category_scope_and_channel_types=true
  const bobOwned=await request(directory,{name:'Member-owned community'},bob.value.token)
  assert.equal(bobOwned.status,200)
  assert.equal(bobOwned.value.owner_id,bob.value.account.id)
  assert.equal((await request(base+bobOwned.value.id,undefined,owner)).status,403)
  assert.equal((await request(base+bobOwned.value.id+'/invites',{expires_in_seconds:3600,max_uses:1},owner)).status,403)
  checks.community_server_owner_has_no_implicit_access=true

  const one=await request(base+community.id+'/invites',{expires_in_seconds:3600,max_uses:1},owner)
  assert.equal(one.status,200)
  const races=await Promise.all([bob,carol].map(account=>request(base+'join',{code:one.value.code},account.value.token)))
  assert.deepEqual(races.map(r=>r.status).sort(),[200,403])
  const winner=[bob,carol][races.findIndex(r=>r.status===200)], loser=[bob,carol][races.findIndex(r=>r.status===403)]
  assert.equal((await request(base+'join',{code:one.value.code},winner.value.token)).status,200)
  assert.equal((await request(base+'join',{code:one.value.code},loser.value.token)).status,403)
  assert.equal((await request(base+community.id,undefined,loser.value.token)).status,403)
  checks.community_single_use_invite_serializes_competing_accounts=true

  for(const suffix of ['categories','channels','invites']) {
    const body=suffix==='categories'?{name:'No permission'}:suffix==='channels'?{name:'No permission',category_id:null,kind:'text'}:{expires_in_seconds:3600,max_uses:1}
    assert.equal((await request(base+community.id+'/'+suffix,body,winner.value.token)).status,403)
  }
  assert.equal((await request(base+community.id+'/invites',{expires_in_seconds:59,max_uses:1},owner)).status,400)
  assert.equal((await request(base+community.id+'/invites',{expires_in_seconds:3600,max_uses:0},owner)).status,400)
  const expired=await request(base+community.id+'/invites',{expires_in_seconds:60,max_uses:1},owner)
  assert.equal(expired.status,200)
  await expireInvite(createHash('sha256').update(expired.value.code).digest('hex'))
  assert.equal((await request(base+'join',{code:expired.value.code},loser.value.token)).status,403)
  assert.equal((await request(base+'join',{code:'0'.repeat(64)},loser.value.token)).status,403)
  checks.community_owner_controls_and_expired_invite_rejection=true

  const multiple=await request(base+community.id+'/invites',{expires_in_seconds:3600,max_uses:1},owner)
  assert.equal(multiple.status,200)
  // Retry by an existing member must not spend the only available use.
  assert.equal((await request(base+'join',{code:multiple.value.code},winner.value.token)).status,200)
  assert.equal((await request(base+'join',{code:multiple.value.code},loser.value.token)).status,200)
  const twoUses=await request(base+other.id+'/invites',{expires_in_seconds:3600,max_uses:2},owner)
  assert.equal(twoUses.status,200)
  assert.equal((await request(base+'join',{code:twoUses.value.code},bob.value.token)).status,200)
  assert.equal((await request(base+'join',{code:twoUses.value.code},bob.value.token)).status,200)
  assert.equal((await request(base+'join',{code:twoUses.value.code},carol.value.token)).status,200)
  checks.community_multi_use_invites_do_not_charge_existing_members=true
  const before=(await request(base+community.id,undefined,loser.value.token)).value
  assert.equal(before.channels.length,2)
  await stop();start();await healthy()
  assert.deepEqual((await request(base+community.id,undefined,loser.value.token)).value,before)
  assert.equal((await request(directory,undefined,loser.value.token)).value[0].id,community.id)
  assert.equal((await request('/api/v1/auth/logout',{},loser.value.token)).status,204)
  assert.equal((await request(base+community.id,undefined,loser.value.token)).status,401)
  checks.community_structure_and_membership_survive_restart=true
}
