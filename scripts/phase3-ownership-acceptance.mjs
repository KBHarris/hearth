// Real HTTP + product WASM, isolated community and signed root continuity.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
export async function verifyOwnership({alice,bob,carol,request,json,op,view,uploadedPackage,submitted,start,stop,healthy,checks,scanDatabase}){
  await stop();start();await healthy()
  const base='/api/v1/communities',token=alice.session.token,newToken=bob.session.token
  const community=(await request(base,{name:'Ownership fixture'},token)).value,id=community.id
  const authority=json(alice.client,'sign_authority',id)
  assert.equal((await request(`${base}/${id}/authority`,authority,token)).status,200)
  const channel=(await request(`${base}/${id}/channels`,{name:'notices',kind:'announcement',category_id:null},token)).value,cid=channel.id
  const policy=json(alice.client,'sign_policy',{authority,channel_id:cid,kind:'announcement',history:'full',revision:1})
  assert.equal((await request(`${base}/channels/${cid}/policy`,policy,token)).status,200)
  const [code,invitation]=json(alice.client,'sign_invitation',{authority,history_from:{},issued_at:Date.now()})
  const invite=(await request(`${base}/${id}/invites`,{code,authorization:invitation,expires_in_seconds:3600,max_uses:5},token)).value
  assert.equal((await request(`${base}/join`,{code:invite.code},newToken)).status,200)
  json(bob.client,'pin_invitation',{authority,code,invitation})
  const packageRecord=await uploadedPackage(bob),successor=packageRecord.member
  const grant=json(alice.client,'sign_admission',{authority,account_id:successor.account_id,identity_key:successor.enrollment.identity_key,history_from:{},invitation})
  assert.equal((await request(`${base}/${id}/admissions`,grant,token)).status,200)
  let gov={community_id:id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
  const auth={authority,policy,admissions:[grant],governance:undefined}
  json(alice.client,'authorize_channel',{id:cid,authorization:auth})
  const claimed=(await request('/api/v1/chat/packages/claim',{device_keys:[successor.enrollment.device_key]},token)).value
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:claimed,create:true}),'commit')
  async function drain(install){for(;;){const r=await request(`/api/v1/chat/events/${install.identity.enrollment.device_key}?after=${view(install.client).last_seq}`,undefined,install.session.token);assert.equal(r.status,200);for(const e of r.value)json(install.client,'receive',e);if(r.value.length<128)break}}
  await drain(alice);await drain(bob)
  async function offer(){const state=(await request(`${base}/${id}/ownership`,undefined,token)).value;const value=json(alice.client,'offer_ownership',{authority,successor,endorsed:state.endorsed});assert.equal((await request(`${base}/${id}/ownership`,value,token)).status,200);return value}
  let proposed=await offer()
  assert.equal((await request(`${base}/${id}/ownership`,{...proposed,endorsed:[]},token)).status,400)
  assert.equal((await request(`${base}/${id}/ownership`,proposed,newToken)).status,403)
  assert.equal((await request(`${base}/${id}/ownership`,undefined,carol.session.token)).status,403)
  checks.ownership_offer_requires_current_owner_approved_successor_and_membership=true
  assert.equal((await request(`${base}/${id}/ownership/cancel`,{})).status,401)
  assert.equal((await request(`${base}/${id}/ownership/cancel`,{},newToken)).status,403)
  assert.equal((await request(`${base}/${id}/ownership/cancel`,{},token)).status,204)
  const canceled=json(bob.client,'accept_ownership',{offer:proposed,policy:{...gov,revision:1}})
  assert.equal((await request(`${base}/${id}/ownership/accept`,canceled,newToken)).status,409)
  json(bob.client,'verify_authority',authority)
  proposed=await offer()
  const oldPolicyAttack=json(alice.client,'sign_policy',{authority,channel_id:cid,kind:'announcement',history:'none',revision:2})
  // Changes after the offer make its signed endorsement set stale.
  gov=json(alice.client,'sign_governance',{authority,policy:{...gov,revision:1,rules:'Existing rules retained',roles:[{id:randomBytes(32).toString('hex'),name:'Moderator',permissions:256}],assignments:[]}})
  gov=json(alice.client,'sign_governance',{authority,policy:{...gov,assignments:[{account_id:successor.account_id,role_ids:[gov.roles[0].id]}]}})
  assert.equal((await request(`${base}/${id}/governance`,gov,token)).status,200)
  auth.governance=gov;json(alice.client,'authorize_channel',{id:cid,authorization:auth})
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:[],create:false}),'commit');await drain(alice);await drain(bob)
  const stale=json(bob.client,'accept_ownership',{offer:proposed,policy:{...gov,revision:2}})
  assert.equal((await request(`${base}/${id}/ownership/accept`,stale,newToken)).status,409)
  checks.ownership_canceled_and_stale_offers_cannot_change_root=true
  gov=json(bob.client,'sign_governance',{authority,policy:{...gov,revision:2,limits:[{channel_id:cid,slowmode_seconds:1,retention_days:null}]}})
  assert.ok(gov.moderator_admission)
  assert.equal((await request(`${base}/${id}/governance`,gov,newToken)).status,200)
  auth.governance=gov;json(alice.client,'authorize_channel',{id:cid,authorization:auth})
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:[],create:false}),'commit');await drain(alice);await drain(bob)
  proposed=await offer()
  const before=json(alice.client,'send',{id:cid,content:{kind:'text',text:'HEARTH_OWNERSHIP_CANARY_before',reply_to:null}})
  await submitted(alice,cid,before,'message')
  const acceptance=json(bob.client,'accept_ownership',{offer:proposed,policy:{...gov,revision:gov.revision+1}})
  const server=(await request('/.well-known/hearth')).value.server_key
  bob.client.openMessaging(op(bob.client,'seal'),bob.session.account.id,server)
  assert.deepEqual(json(bob.client,'accept_ownership',{offer:proposed,policy:{...gov,revision:gov.revision+1}}),acceptance)
  const changed={...acceptance,authority:{...acceptance.authority,signature:'00'.repeat(64)}}
  assert.equal((await request(`${base}/${id}/ownership/accept`,changed,newToken)).status,400)
  assert.equal((await request(`${base}/${id}/ownership/accept`,acceptance,token)).status,403)
  assert.equal((await request(`${base}/${id}/ownership/accept`,acceptance,newToken)).status,200)
  assert.equal((await request(`${base}/${id}/ownership/accept`,acceptance,newToken)).status,200)
  checks.ownership_joint_acceptance_is_signed_atomic_idempotent_and_sealed_restart_safe=true
  assert.equal((await request(`${base}/${id}`,undefined,newToken)).value.community.owner_id,successor.account_id)
  const transferred={authority:acceptance.authority,policy,admissions:[grant,acceptance.former_owner],governance:acceptance.governance}
  json(alice.client,'authorize_channel',{id:cid,authorization:transferred});json(bob.client,'authorize_channel',{id:cid,authorization:transferred})
  assert.throws(()=>json(alice.client,'verify_authority',authority))
  assert.throws(()=>json(bob.client,'verify_authority',authority))
  assert.equal((await request(`${base}/channels/${cid}/policy`,oldPolicyAttack,token)).status,403)
  assert.throws(()=>json(bob.client,'authorize_channel',{id:cid,authorization:{...transferred,policy:oldPolicyAttack}}))
  assert.equal((await request(`${base}/join`,{code:invite.code},carol.session.token)).status,403)
  checks.ownership_former_owner_privileges_and_unused_invites_are_revoked=true
  await drain(bob);assert.ok(view(bob.client).messages.some(m=>m.id===before.operation_id))
  const rotate=json(bob.client,'add_channel',{id:cid,packages:[],create:false});await submitted(bob,cid,rotate,'commit');await drain(alice);await drain(bob)
  assert.throws(()=>json(alice.client,'send',{id:cid,content:{kind:'text',text:'former owner cannot publish',reply_to:null}}))
  const after=json(bob.client,'send',{id:cid,content:{kind:'text',text:'HEARTH_OWNERSHIP_CANARY_after',reply_to:null}});await submitted(bob,cid,after,'message');await drain(alice)
  assert.ok(view(alice.client).messages.some(m=>m.id===after.operation_id))
  const freshPolicy=json(bob.client,'sign_policy',{authority:acceptance.authority,channel_id:cid,kind:'announcement',history:'full',revision:2})
  assert.equal((await request(`${base}/channels/${cid}/policy`,freshPolicy,newToken)).status,200)
  checks.ownership_historical_queued_message_and_successor_mls_rotation_preserve_access=true
  await stop();start();await healthy()
  assert.equal((await request(`${base}/${id}/ownership`,undefined,newToken)).value.authority.owner.account_id,successor.account_id)
  const audit=(await request(`${base}/${id}/audit`,undefined,newToken)).value
  assert.equal(audit[0].action,'ownership_transfer');assert.equal(audit[0].revision,acceptance.governance.revision)
  assert.equal((await request(`${base}/${id}/audit`,undefined,token)).status,403)
  const current=(await request(`${base}/${id}/ownership`,undefined,newToken)).value
  const returned=json(bob.client,'offer_ownership',{authority:acceptance.authority,successor:authority.owner,endorsed:current.endorsed})
  assert.equal((await request(`${base}/${id}/ownership`,returned,newToken)).status,200)
  const back=json(alice.client,'accept_ownership',{offer:returned,policy:{...acceptance.governance,revision:acceptance.governance.revision+1}})
  assert.equal((await request(`${base}/${id}/ownership/accept`,back,token)).status,200)
  const restoredRoster=(await request(`${base}/channels/${cid}/roster`,undefined,newToken)).value
  assert.deepEqual(restoredRoster.admissions.find(a=>a.account_id===successor.account_id),grant,'A former owner must retain the original invitation-bound admission')
  const returnedAuth={authority:restoredRoster.authority,policy:restoredRoster.policy,admissions:restoredRoster.admissions,governance:restoredRoster.governance}
  json(bob.client,'authorize_channel',{id:cid,authorization:returnedAuth});json(alice.client,'authorize_channel',{id:cid,authorization:returnedAuth})
  const returnRotation=json(alice.client,'add_channel',{id:cid,packages:[],create:false});await submitted(alice,cid,returnRotation,'commit');await drain(alice);await drain(bob)
  checks.ownership_transfer_back_preserves_invitation_binding_and_monotonic_root_lineage=true
  await scanDatabase('HEARTH_OWNERSHIP_CANARY')
  checks.ownership_transfer_and_content_free_audit_survive_server_restart=true
}
