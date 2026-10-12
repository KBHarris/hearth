// Disposable product WASM, native PostgreSQL and shared REST/gateway authorization.
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
export async function verifyGovernance({alice,bob,carol,request,json:cryptoJson,op,view,uploadedPackage,submitted,start,stop,healthy,checks,scanDatabase,retentionFixture,storage}) {
  let stage='setup'
  const json=(...args)=>{try{return cryptoJson(...args)}catch(error){throw new Error(`Phase 3 ${stage}: ${args[1]} failed`,{cause:error})}}
  const mark=name=>{checks[name]=true;console.log(`Governance check passed: ${name}`)}
  await stop();start();await healthy()
  const base='/api/v1/communities', token=alice.session.token, account=bob.session.account.id
  const community=(await request(base,{name:'Governance fixture'},token)).value
  const authority=json(alice.client,'sign_authority',community.id)
  assert.equal((await request(`${base}/${community.id}/authority`,authority,token)).status,200)
  const channel=(await request(`${base}/${community.id}/channels`,{name:'private-room',kind:'text',category_id:null},token)).value
  const id=channel.id,policy=json(alice.client,'sign_policy',{authority,channel_id:id,kind:'text',history:'none',revision:1})
  assert.equal((await request(`${base}/channels/${id}/policy`,policy,token)).status,200)
  json(alice.client,'authorize_channel',{id,authorization:{authority,policy,admissions:[]}})
  await submitted(alice,id,json(alice.client,'add_channel',{id,packages:[],create:true}),'commit')
  const [code,certificate]=json(alice.client,'sign_invitation',{authority,history_from:{[id]:view(alice.client).groups.find(g=>g.id===id).epoch},issued_at:Date.now()})
  const inviteResult=await request(`${base}/${community.id}/invites`,{code,authorization:certificate,expires_in_seconds:3600,max_uses:2},token);assert.equal(inviteResult.status,200);const invitation=inviteResult.value
  assert.equal((await request(`${base}/join`,{code:invitation.code},bob.session.token)).status,200)
  const admission=json(alice.client,'sign_admission',{authority,account_id:account,identity_key:bob.identity.enrollment.identity_key,invitation:certificate})
  assert.equal((await request(`${base}/${community.id}/admissions`,admission,token)).status,200)
  const authorization={authority,policy,admissions:[admission]}
  json(alice.client,'authorize_channel',{id,authorization})
  const packageRecord=await uploadedPackage(bob)
  const claim=await request('/api/v1/chat/packages/claim',{device_keys:[packageRecord.member.enrollment.device_key]},token)
  assert.equal(claim.status,200)
  await submitted(alice,id,json(alice.client,'add_channel',{id,packages:claim.value,create:false}),'commit')
  async function drain(install){for(;;){const result=await request(`/api/v1/chat/events/${install.identity.enrollment.device_key}?after=${view(install.client).last_seq}`,undefined,install.session.token);assert.equal(result.status,200);for(const event of result.value)json(install.client,'receive',event);if(result.value.length<128)break}}
  await drain(alice);await drain(bob)
  let governance={community_id:community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
  const revision=async changes=>{governance=json(alice.client,'sign_governance',{authority,policy:{...governance,...changes,revision:governance.revision+1}});assert.equal((await request(`${base}/${community.id}/governance`,governance,token)).status,200);authorization.governance=governance;json(alice.client,'authorize_channel',{id,authorization});return governance}
  const rotate=async()=>{await submitted(alice,id,json(alice.client,'add_channel',{id,packages:[],create:false}),'commit');await drain(alice);await drain(bob)}
  stage='role grant'
  const role=randomBytes(32).toString('hex')
  await revision({roles:[{id:role,name:'Pinners',permissions:16}],assignments:[{account_id:account,role_ids:[role]}]});await rotate()
  const first=json(alice.client,'send',{id,content:{kind:'text',text:'HEARTH_GOVERNANCE_CANARY_encrypted',reply_to:null}})
  await submitted(alice,id,first,'message');await drain(bob)
  await submitted(bob,id,json(bob.client,'send',{id,content:{kind:'pin',id:first.operation_id,active:true}}),'message');await drain(alice)
  assert.ok(view(alice.client).messages.find(m=>m.id===first.operation_id).pinned)
  mark('governance_role_grants_pin_permission_in_product_crypto_and_http')
  assert.equal((await request(`${base}/${community.id}/governance`,governance,bob.session.token)).status,403)
  assert.equal((await request(`${base}/${community.id}/governance`,{...governance,everyone:1023,revision:governance.revision+1},token)).status,400)
  const foreign=json(alice.client,'sign_governance',{authority,policy:{...governance,revision:governance.revision+1,overrides:[{channel_id:randomBytes(32).toString('hex'),kind:'everyone',target_id:'',allow:0,deny:1}]}})
  assert.equal((await request(`${base}/${community.id}/governance`,foreign,token)).status,400)
  assert.equal((await request(`${base}/${community.id}/governance`,governance,token)).status,200)
  assert.equal((await request(`${base}/${community.id}/audit`,undefined,bob.session.token)).status,403)
  const log=await request(`${base}/${community.id}/audit`,undefined,token)
  assert.equal(log.status,200);assert.equal(log.value.length,1);assert.equal(log.value[0].revision,1);assert.ok(!JSON.stringify(log.value).includes('encrypted'))
  mark('governance_owner_signature_cas_scope_and_content_free_audit')
  const inflight=json(bob.client,'send',{id,content:{kind:'text',text:'valid before the role change',reply_to:null}});await submitted(bob,id,inflight,'message')
  stage='member override'
  const stale=governance
  const queued=json(bob.client,'send',{id,content:{kind:'text',text:'rejected stale grant',reply_to:null}})
  await revision({overrides:[{channel_id:id,kind:'member',target_id:account,allow:0,deny:2|4|8}]})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,queued,bob.session.token)).status,403);op(bob.client,'reject',queued.operation_id)
  await rotate()
  assert.ok(view(alice.client).messages.some(m=>m.id===inflight.operation_id))
  assert.throws(()=>json(bob.client,'send',{id,content:{kind:'text',text:'denied by signed override',reply_to:null}}))
  assert.throws(()=>json(alice.client,'authorize_channel',{id,authorization:{...authorization,governance:stale}}))
  assert.throws(()=>json(alice.client,'authorize_channel',{id,authorization:{...authorization,governance:undefined}}))
  mark('governance_member_override_rejects_stale_send_and_client_rollback')
  stage='slowmode'
  await revision({overrides:[],limits:[{channel_id:id,slowmode_seconds:60,retention_days:null}]});await rotate()
  const post=inflight // The last accepted send also counts when slow mode is enabled.
  const fast=json(bob.client,'send',{id,content:{kind:'text',text:'too fast',reply_to:null}})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,fast,bob.session.token)).status,429);op(bob.client,'reject',fast.operation_id)
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,post,bob.session.token)).status,204)
  mark('governance_slowmode_is_serialized_and_idempotent_retries_remain_allowed')
  stage='timeout'
  await revision({limits:[],sanctions:[{account_id:account,channel_id:null,kind:'timeout',until:Date.now()+60000}]});await rotate()
  const timed=json(bob.client,'send',{id,content:{kind:'text',text:'timeout prevents delivery',reply_to:null}})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,timed,bob.session.token)).status,403);op(bob.client,'reject',timed.operation_id)
  assert.equal((await request(`${base}/channels/${id}/roster`,undefined,bob.session.token)).status,200)
  mark('governance_timeout_preserves_read_access_and_blocks_posting')
  stage='rules screening'
  await revision({sanctions:[],rules:'Be kind. No spam.',screening:true});await rotate()
  assert.equal((await request(`${base}/channels/${id}/roster`,undefined,bob.session.token)).value.rules_accepted,false)
  const screened=json(bob.client,'send',{id,content:{kind:'text',text:'must accept rules first',reply_to:null}})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,screened,bob.session.token)).status,403);op(bob.client,'reject',screened.operation_id)
  const digest=rules=>createHash('sha256').update(rules).digest('hex')
  assert.equal((await request(`${base}/${community.id}/rules/accept`,{digest:digest('stale rules')},bob.session.token)).status,409)
  assert.equal((await request(`${base}/${community.id}/rules/accept`,{digest:digest(governance.rules)},carol.session.token)).status,403)
  assert.equal((await request(`${base}/${community.id}/rules/accept`,{digest:digest(governance.rules)},bob.session.token)).value.rules_accepted,true)
  const consent=json(bob.client,'send',{id,content:{kind:'text',text:'accepted community rules',reply_to:null}});await submitted(bob,id,consent,'message');await drain(alice)
  await stop();start();await healthy()
  assert.equal((await request(`${base}/${community.id}/governance`,undefined,bob.session.token)).value.rules_accepted,true)
  mark('rules_screening_preserves_read_access_requires_matching_consent_and_survives_restart')
  await revision({rules:'Be kind. No spam. No harassment.'});await rotate()
  assert.equal((await request(`${base}/${community.id}/governance`,undefined,bob.session.token)).value.rules_accepted,false)
  assert.equal((await request(`${base}/${community.id}/rules/accept`,{digest:digest('Be kind. No spam.')},bob.session.token)).status,409)
  await revision({screening:false});await rotate()
  mark('changed_signed_rules_invalidate_prior_acceptance')
  stage='retention'
  const archivePolicy=json(alice.client,'sign_policy',{authority,channel_id:id,kind:'text',history:'full',revision:2})
  assert.equal((await request(`${base}/channels/${id}/policy`,archivePolicy,token)).status,200)
  authorization.policy=archivePolicy;json(alice.client,'authorize_channel',{id,authorization});await rotate()
  await revision({limits:[{channel_id:id,slowmode_seconds:0,retention_days:1}]});await rotate()
  const expired=json(alice.client,'send',{id,content:{kind:'text',text:'retention expiry ciphertext fixture',reply_to:null}});await submitted(alice,id,expired,'message')
  const fresh=json(alice.client,'send',{id,content:{kind:'text',text:'fresh retained ciphertext fixture',reply_to:null}});await submitted(alice,id,fresh,'message')
  assert.equal((await retentionFixture(expired.operation_id)).archives,1)
  await retentionFixture(expired.operation_id,true)
  const history=(await request(`/api/v1/chat/conversations/${id}/history?after=0&device=${alice.identity.enrollment.device_key}`,undefined,token)).value.items
  assert.ok(!history.some(m=>m.operation_id===expired.operation_id));assert.ok(history.some(m=>m.operation_id===fresh.operation_id))
  const retainedBacklog=(await request(`/api/v1/chat/events/${bob.identity.enrollment.device_key}?after=${view(bob.client).last_seq}`,undefined,bob.session.token)).value
  assert.ok(!retainedBacklog.some(e=>e.data.kind==='message'&&e.data.upload.operation_id===expired.operation_id))
  await stop();start();await healthy()
  let cleaned=false
  for(let i=0;i<40;i++){const counts=await retentionFixture(expired.operation_id);if(counts.messages===0&&counts.archives===0&&counts.operations===1&&counts.redactions>0){cleaned=true;break}await new Promise(r=>setTimeout(r,100))}
  assert.ok(cleaned,'Expiry must remove actual stored ciphertext, retaining replay digests and cursors')
  assert.equal((await retentionFixture(fresh.operation_id)).archives,1)
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,expired,token)).status,204)
  assert.equal((await retentionFixture(expired.operation_id)).archives,0)
  await drain(alice);await drain(bob)
  mark('retention_expiry_removes_database_ciphertext_preserves_fresh_history_and_retry_digests')
  if(storage){
    stage='physical S3 retention'
    const blob=randomBytes(32).toString('hex'),ciphertext=randomBytes(100),device_key=alice.identity.enrollment.device_key
    const lease=await request(`/api/v1/blobs/${id}`,{id:blob,digest:createHash('sha256').update(ciphertext).digest('hex'),cipher_bytes:ciphertext.length,device_key},token)
    assert.equal(lease.status,200)
    assert.ok((await fetch(lease.value.url,{method:'PUT',body:ciphertext,headers:{'Content-Type':'application/octet-stream','Content-Length':String(ciphertext.length)}})).ok)
    assert.equal((await request(`/api/v1/blobs/${id}/${blob}/complete`,{device:device_key},token)).status,204)
    const download=await request(`/api/v1/blobs/${id}/${blob}?device=${device_key}`,undefined,token);assert.equal(download.status,200)
    assert.equal((await fetch(download.value.url)).status,200)
    await retentionFixture(blob,true,true)
    assert.equal((await request(`/api/v1/blobs/${id}/${blob}?device=${device_key}`,undefined,token)).status,410)
    await stop();start();await healthy()
    let removed=false
    for(let i=0;i<100;i++){if((await retentionFixture(blob,false,true)).blobs===0){removed=true;break}await new Promise(r=>setTimeout(r,100))}
    assert.ok(removed,'Physical storage deletion must complete before forgetting the blob ID')
    assert.equal((await fetch(download.value.url)).status,404)
    mark('retention_expiry_physically_deletes_private_s3_object_before_database_index')
  }
  stage='read revocation'
  const guarded=json(alice.client,'send',{id,content:{kind:'text',text:'wait for removal',reply_to:null}});op(alice.client,'reject',guarded.operation_id)
  await revision({sanctions:[],overrides:[{channel_id:id,kind:'member',target_id:account,allow:0,deny:1}]})
  assert.throws(()=>json(alice.client,'send',{id,content:{kind:'text',text:'wait for policy epoch',reply_to:null}}))
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,guarded,token)).status,409)
  assert.equal((await request(`${base}/channels/${id}/roster`,undefined,bob.session.token)).status,403)
  assert.equal((await request(`/api/v1/chat/conversations/${id}/history?after=0&device=${bob.identity.enrollment.device_key}`,undefined,bob.session.token)).status,403)
  assert.ok(!(await request(`${base}/${community.id}`,undefined,bob.session.token)).value.channels.some(c=>c.id===id))
  assert.ok(!(await request('/api/v1/chat/conversations',undefined,bob.session.token)).value.some(c=>c.id===id))
  assert.equal((await request(`/api/v1/blobs/${id}`,{id:randomBytes(32).toString('hex'),digest:randomBytes(32).toString('hex'),cipher_bytes:100,device_key:bob.identity.enrollment.device_key},bob.session.token)).status,403)
  const removal=json(alice.client,'prune_channel',id);assert.ok(removal);assert.ok(!removal.members.some(m=>m.account_id===account));await submitted(alice,id,removal,'commit');await drain(alice)
  const secret=json(alice.client,'send',{id,content:{kind:'text',text:'after-revocation secret',reply_to:null}});await submitted(alice,id,secret,'message')
  const backlog=(await request(`/api/v1/chat/events/${bob.identity.enrollment.device_key}?after=${view(bob.client).last_seq}`,undefined,bob.session.token)).value
  assert.ok(backlog.filter(e=>e.conversation_id===id).every(e=>e.data.kind==='redacted'))
  for(const e of backlog)json(bob.client,'receive',e)
  assert.ok(!view(bob.client).messages.some(m=>m.id===secret.operation_id))
  // A malicious host cannot add the excluded, previously admitted account to the new epoch.
  const deniedPackage=await uploadedPackage(bob),deniedClaim=await request('/api/v1/chat/packages/claim',{device_keys:[deniedPackage.member.enrollment.device_key]},token)
  assert.equal(deniedClaim.status,200);assert.throws(()=>json(alice.client,'add_channel',{id,packages:deniedClaim.value,create:false}))
  mark('governance_read_revocation_blocks_rest_blobs_backlog_and_rotates_mls_audience')
  await stop();start();await healthy()
  assert.equal((await request(`${base}/channels/${id}/roster`,undefined,bob.session.token)).status,403)
  assert.equal((await request(`${base}/${community.id}/governance`,undefined,token)).value.governance.revision,governance.revision)
  mark('governance_permissions_and_audit_survive_server_restart')
  await scanDatabase('HEARTH_GOVERNANCE_CANARY_encrypted')
  mark('governance_message_canary_absent_from_host')
}
