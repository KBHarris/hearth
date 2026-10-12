import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
export async function verifyDelegation({alice,bob,carol,request,json,op,view,uploadedPackage,submitted,start,stop,healthy,checks,scanDatabase}){
  await stop();start();await healthy()
  const base='/api/v1/communities',token=alice.session.token,modToken=bob.session.token
  const community=(await request(base,{name:'Delegated moderation fixture'},token)).value,id=community.id
  const authority=json(alice.client,'sign_authority',id);assert.equal((await request(`${base}/${id}/authority`,authority,token)).status,200)
  const channel=(await request(`${base}/${id}/channels`,{name:'discussion',kind:'text',category_id:null},token)).value,cid=channel.id
  const policy=json(alice.client,'sign_policy',{authority,channel_id:cid,kind:'text',history:'none',revision:1});assert.equal((await request(`${base}/channels/${cid}/policy`,policy,token)).status,200)
  const [code,invitation]=json(alice.client,'sign_invitation',{authority,history_from:{},issued_at:Date.now()})
  assert.equal((await request(`${base}/${id}/invites`,{code,authorization:invitation,expires_in_seconds:3600,max_uses:5},token)).status,200)
  const admissions=[],packages=[]
  for(const install of [bob,carol]){
    assert.equal((await request(`${base}/join`,{code},install.session.token)).status,200);json(install.client,'pin_invitation',{authority,code,invitation})
    const record=await uploadedPackage(install);packages.push(record)
    const grant=json(alice.client,'sign_admission',{authority,account_id:install.session.account.id,identity_key:record.member.enrollment.identity_key,history_from:{},invitation})
    assert.equal((await request(`${base}/${id}/admissions`,grant,token)).status,200);admissions.push(grant)
  }
  const authorization={authority,policy,admissions,governance:undefined};json(alice.client,'authorize_channel',{id:cid,authorization})
  const claimed=(await request('/api/v1/chat/packages/claim',{device_keys:packages.map(p=>p.member.enrollment.device_key)},token)).value
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:claimed,create:true}),'commit')
  async function drain(install){for(;;){const r=await request(`/api/v1/chat/events/${install.identity.enrollment.device_key}?after=${view(install.client).last_seq}`,undefined,install.session.token);assert.equal(r.status,200);for(const e of r.value)json(install.client,'receive',e);if(r.value.length<128)break}}
  async function rotate(){const pruning=json(alice.client,'prune_channel',cid);await submitted(alice,cid,pruning??json(alice.client,'add_channel',{id:cid,packages:[],create:false}),'commit');for(const install of [alice,bob,carol])await drain(install)}
  for(const install of [alice,bob,carol])await drain(install)
  const role=randomBytes(32).toString('hex')
  let gov=json(alice.client,'sign_governance',{authority,policy:{community_id:id,revision:1,everyone:15,roles:[{id:role,name:'Moderators',permissions:256|512}],assignments:[{account_id:bob.session.account.id,role_ids:[role]}],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}})
  assert.equal((await request(`${base}/${id}/governance`,gov,token)).status,200);authorization.governance=gov;json(alice.client,'authorize_channel',{id:cid,authorization});await rotate()
  const message=json(carol.client,'send',{id:cid,content:{kind:'text',text:'HEARTH_DELEGATION_CANARY_secret',reply_to:null}});await submitted(carol,cid,message,'message');await drain(alice);await drain(bob)
  let next={...gov,revision:2,sanctions:[{account_id:carol.session.account.id,channel_id:cid,kind:'timeout',until:Date.now()+60000}],limits:[{channel_id:cid,slowmode_seconds:5,retention_days:null}]}
  assert.throws(()=>json(carol.client,'sign_governance',{authority,policy:next}))
  const moderation=json(bob.client,'sign_governance',{authority,policy:next});assert.deepEqual(moderation.delegation,gov)
  assert.equal((await request(`${base}/${id}/governance`,moderation,modToken)).status,200)
  assert.equal((await request(`${base}/${id}/governance`,moderation,modToken)).status,200)
  authorization.governance=moderation;json(alice.client,'authorize_channel',{id:cid,authorization});await rotate();gov=moderation
  const timed=json(carol.client,'send',{id:cid,content:{kind:'text',text:'cannot post during timeout',reply_to:null}})
  assert.equal((await request(`/api/v1/chat/conversations/${cid}/message`,timed,carol.session.token)).status,403);op(carol.client,'reject',timed.operation_id)
  assert.equal((await request(`${base}/channels/${cid}/roster`,undefined,carol.session.token)).status,200)
  checks.delegated_moderator_signed_timeout_and_slowmode_apply_without_owner_impersonation=true
  for(const changes of [{everyone:1023},{rules:'Hijacked rules'},{roles:[{id:role,name:'Escalated',permissions:1023}]},{limits:[{channel_id:cid,slowmode_seconds:5,retention_days:1}]},{sanctions:[{account_id:alice.session.account.id,channel_id:null,kind:'ban',until:null}]},{sanctions:[{account_id:bob.session.account.id,channel_id:null,kind:'ban',until:null}]}])assert.throws(()=>json(bob.client,'sign_governance',{authority,policy:{...gov,...changes,revision:3}}))
  checks.delegated_moderation_cannot_escalate_roles_change_rules_retention_or_target_owner_and_moderators=true
  const stale=json(bob.client,'sign_governance',{authority,policy:{...gov,revision:3,sanctions:[]}})
  const revoked=json(alice.client,'sign_governance',{authority,policy:{...gov,revision:3,roles:[],assignments:[]}})
  assert.ok(!revoked.delegation);assert.equal((await request(`${base}/${id}/governance`,revoked,token)).status,200)
  assert.equal((await request(`${base}/${id}/governance`,stale,modToken)).status,409)
  authorization.governance=revoked;json(alice.client,'authorize_channel',{id:cid,authorization});await rotate()
  assert.throws(()=>json(bob.client,'sign_governance',{authority,policy:{...revoked,revision:4,sanctions:[]}}))
  await stop();start();await healthy()
  const log=(await request(`${base}/${id}/audit`,undefined,token)).value;assert.equal(log.find(e=>e.revision===2).actor_id,bob.session.account.id)
  assert.equal((await request(`${base}/${id}/audit`,undefined,modToken)).status,403)
  const restoredRole=json(alice.client,'sign_governance',{authority,policy:{...revoked,revision:4,roles:[{id:role,name:'Moderators',permissions:256|512}],assignments:[{account_id:bob.session.account.id,role_ids:[role]}],sanctions:[]}})
  assert.equal((await request(`${base}/${id}/governance`,restoredRole,token)).status,200);authorization.governance=restoredRole;json(alice.client,'authorize_channel',{id:cid,authorization});await rotate()
  const cutoff=Date.now(),kick=json(bob.client,'sign_governance',{authority,policy:{...restoredRole,revision:5,sanctions:[{account_id:carol.session.account.id,channel_id:null,kind:'kick',until:null,kick_after:cutoff}]}})
  assert.equal((await request(`${base}/${id}/governance`,kick,modToken)).status,200);authorization.governance=kick;json(alice.client,'authorize_channel',{id:cid,authorization});await rotate()
  assert.equal((await request(`${base}/channels/${cid}/roster`,undefined,carol.session.token)).status,403)
  assert.equal((await request(`${base}/join`,{code},carol.session.token)).status,403)
  const privateMessage=json(alice.client,'send',{id:cid,content:{kind:'text',text:'HEARTH_KICK_CANARY_unavailable_during_removal',reply_to:null}});await submitted(alice,cid,privateMessage,'message');await drain(bob);await drain(carol)
  assert.ok(!view(carol.client).messages.some(m=>m.text.includes('HEARTH_KICK_CANARY')))
  checks.delegated_kick_denies_old_invites_rest_and_removes_mls_audience_before_new_messages=true
  while(Date.now()<=cutoff)await new Promise(resolve=>setTimeout(resolve,2))
  const [newCode,newInvite]=json(alice.client,'sign_invitation',{authority,history_from:{},issued_at:Date.now()})
  assert.equal((await request(`${base}/${id}/invites`,{code:newCode,authorization:newInvite,expires_in_seconds:3600,max_uses:1},token)).status,200)
  assert.equal((await request(`${base}/join`,{code:newCode},carol.session.token)).status,200)
  json(carol.client,'rejoin_invitation',{authority,code:newCode,invitation:newInvite,policy:kick})
  const rejoiningStore=op(carol.client,'seal');carol.client.openMessaging(rejoiningStore,carol.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  const newPackage=await uploadedPackage(carol),newGrant=json(alice.client,'sign_admission',{authority,account_id:carol.session.account.id,identity_key:newPackage.member.enrollment.identity_key,history_from:{},invitation:newInvite})
  assert.equal((await request(`${base}/${id}/admissions`,admissions.find(a=>a.account_id===carol.session.account.id),token)).status,403)
  assert.equal((await request(`${base}/${id}/admissions`,newGrant,token)).status,200)
  authorization.admissions=admissions.map(a=>a.account_id===carol.session.account.id?newGrant:a);json(alice.client,'authorize_channel',{id:cid,authorization})
  const rejoinClaim=(await request('/api/v1/chat/packages/claim',{device_keys:[newPackage.member.enrollment.device_key]},token)).value
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:rejoinClaim,create:false}),'commit');for(const install of [alice,bob,carol])await drain(install)
  const fresh=json(carol.client,'send',{id:cid,content:{kind:'text',text:'Fresh approved rejoin works',reply_to:null}});await submitted(carol,cid,fresh,'message');await drain(alice);await drain(bob)
  assert.ok(view(alice.client).messages.some(m=>m.text==='Fresh approved rejoin works'));assert.ok(!view(carol.client).messages.some(m=>m.text.includes('HEARTH_KICK_CANARY')))
  const oldAuthorization={...authorization,admissions};assert.throws(()=>json(carol.client,'authorize_channel',{id:cid,authorization:oldAuthorization}))
  assert.throws(()=>json(alice.client,'sign_governance',{authority,policy:{...kick,revision:6,sanctions:[]}}))
  await stop();start();await healthy();assert.equal((await request(`${base}/channels/${cid}/roster`,undefined,carol.session.token)).status,200)
  checks.kicked_member_rejoins_with_fresh_signed_invite_owner_admission_and_new_welcome_after_restart=true
  await scanDatabase('HEARTH_DELEGATION_CANARY');await scanDatabase('HEARTH_KICK_CANARY')
  checks.delegated_policy_cas_revocation_audit_and_canary_survive_restart=true
}
