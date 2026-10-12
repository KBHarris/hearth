import assert from 'node:assert/strict'
export async function verifyDeletion({wasm,clients,unlock,alice,request,json,op,view,uploadedPackage,submitted,login,serverId,connect,until,start,stop,healthy,checks,inspectDeleted,scanDatabase,storage,retentionFixture}){
  await stop();start();await healthy()
  const secret='HEARTH_DELETION_FIXTURE_PASSWORD_private_only',reg=new wasm.OpaqueAuthClient();clients.push(reg)
  const first=await request('/api/v1/auth/register/start',{username:'departure',message:reg.registrationStart(secret),invite_code:null});assert.equal(first.status,200)
  assert.equal((await request('/api/v1/auth/register/finish',{username:'departure',message:reg.registrationFinish(secret,first.value.message,'departure',serverId),invite_code:null})).status,200)
  const departed=await unlock('departure',secret),token=departed.session.token,base='/api/v1/communities'
  const community=(await request(base,{name:'Disposable account departure'},token)).value,id=community.id
  const root=json(departed.client,'sign_authority',id);assert.equal((await request(`${base}/${id}/authority`,root,token)).status,200)
  const channel=(await request(`${base}/${id}/channels`,{name:'departure',kind:'text',category_id:null},token)).value,cid=channel.id
  const policy=json(departed.client,'sign_policy',{authority:root,channel_id:cid,kind:'text',history:'full',revision:1});assert.equal((await request(`${base}/channels/${cid}/policy`,policy,token)).status,200)
  const [code,invitation]=json(departed.client,'sign_invitation',{authority:root,history_from:{},issued_at:Date.now()});assert.equal((await request(`${base}/${id}/invites`,{code,authorization:invitation,max_uses:1,expires_in_seconds:3600},token)).status,200)
  assert.equal((await request(`${base}/join`,{code},alice.session.token)).status,200);json(alice.client,'pin_invitation',{authority:root,code,invitation})
  const packageRecord=await uploadedPackage(alice),grant=json(departed.client,'sign_admission',{authority:root,account_id:alice.session.account.id,identity_key:packageRecord.member.enrollment.identity_key,invitation,history_from:{}})
  assert.equal((await request(`${base}/${id}/admissions`,grant,token)).status,200)
  let authorization={authority:root,policy,admissions:[grant]};json(departed.client,'authorize_channel',{id:cid,authorization})
  const claim=(await request('/api/v1/chat/packages/claim',{device_keys:[packageRecord.member.enrollment.device_key]},token)).value
  await submitted(departed,cid,json(departed.client,'add_channel',{id:cid,packages:claim,create:true}),'commit')
  async function drain(install){for(;;){const r=await request(`/api/v1/chat/events/${install.identity.enrollment.device_key}?after=${view(install.client).last_seq}`,undefined,install.session.token);assert.equal(r.status,200);for(const event of r.value)json(install.client,'receive',event);if(r.value.length<128)break}}
  await drain(departed);await drain(alice)
  const own=json(departed.client,'send',{id:cid,content:{kind:'text',text:'HEARTH_DEPARTURE_CANARY_removed_author_ciphertext',reply_to:null}});await submitted(departed,cid,own,'message');await drain(alice)
  let blob,blobDownload
  if(storage){
    const file=json(departed.client,'prepare_file',{id:cid,name:'disposable.txt',mime:'text/plain',plaintext:Buffer.from('HEARTH_DEPARTURE_CANARY_encrypted_file').toString('hex')})
    blob=file.file.id
    const body={id:blob,device_key:departed.identity.enrollment.device_key,cipher_bytes:file.file.cipher_bytes,digest:file.file.digest}
    const reservation=await request(`/api/v1/blobs/${cid}`,body,token);assert.equal(reservation.status,200)
    assert.equal((await fetch(reservation.value.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from(file.ciphertext,'hex')})).status,200)
    assert.equal((await request(`/api/v1/blobs/${cid}/${blob}/complete`,{device:departed.identity.enrollment.device_key},token)).status,204)
    const download=await request(`/api/v1/blobs/${cid}/${blob}?device=${alice.identity.enrollment.device_key}`,undefined,alice.session.token);assert.equal(download.status,200);blobDownload=download.value.url
  }
  const proof=json(departed.client,'sign_departure'),erase='/api/v1/auth/account/delete'
  assert.equal((await request(erase,{...proof,signature:'00'.repeat(64)},token)).status,400)
  assert.equal((await request(erase,proof)).status,401)
  assert.equal((await request(erase,proof,alice.session.token)).status,403)
  assert.equal((await request(erase,proof,token)).status,409)
  assert.equal((await request(erase,json(alice.client,'sign_departure'),alice.session.token)).status,409)
  const state=(await request(`${base}/${id}/ownership`,undefined,token)).value,offer=json(departed.client,'offer_ownership',{authority:root,successor:packageRecord.member,endorsed:state.endorsed})
  assert.equal((await request(`${base}/${id}/ownership`,offer,token)).status,200)
  const accepted=json(alice.client,'accept_ownership',{offer,policy:{community_id:id,revision:1,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:root.owner,signature:''}})
  assert.equal((await request(`${base}/${id}/ownership/accept`,accepted,alice.session.token)).status,200)
  authorization={authority:accepted.authority,policy,admissions:[grant,accepted.former_owner],governance:accepted.governance};json(alice.client,'authorize_channel',{id:cid,authorization});json(departed.client,'authorize_channel',{id:cid,authorization})
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:[],create:false}),'commit');await drain(alice);await drain(departed)
  const retained=json(alice.client,'send',{id:cid,content:{kind:'text',text:'Another author retains their records',reply_to:null}});await submitted(alice,cid,retained,'message')
  checks.account_deletion_requires_signature_session_and_transferred_community_ownership=true
  let linkedClient;const loginProof=await login(secret,serverId,c=>{linkedClient=c},'departure');clients.push(linkedClient)
  const linkedSession=(await request('/api/v1/auth/login/finish',loginProof)).value
  const kit=departed.client.exportRecovery('HEARTH_DEPARTURE_RECOVERY_private_fixture',departed.session.account.id,serverId)
  const linkedIdentity=JSON.parse(linkedClient.restoreIdentity(kit,'HEARTH_DEPARTURE_RECOVERY_private_fixture',departed.session.account.id,serverId));assert.equal((await request('/api/v1/auth/device/restore',{enrollment:linkedIdentity.enrollment,link_id:null},linkedSession.token)).status,200);linkedClient.commitIdentity();linkedClient.openMessaging(undefined,departed.session.account.id,serverId)
  const second={client:linkedClient,session:linkedSession,identity:linkedIdentity};await uploadedPackage(second)
  const pendingLogin=await login(secret,serverId,null,'departure'),gateway=await connect(departed),linkedGateway=await connect(second)
  const disk=op(departed.client,'seal');departed.client.openMessaging(disk,departed.session.account.id,serverId);assert.deepEqual(json(departed.client,'sign_departure'),proof)
  const results=await Promise.all([request(erase,proof,token),request(erase,proof,token)]);assert.ok(results.every(r=>r.status===204))
  await until(()=>gateway.socket.readyState===WebSocket.CLOSED&&linkedGateway.socket.readyState===WebSocket.CLOSED)
  assert.equal((await request('/api/v1/auth/session',undefined,token)).status,401);assert.equal((await request('/api/v1/auth/session',undefined,linkedSession.token)).status,401)
  assert.equal((await request('/api/v1/auth/login/finish',pendingLogin)).status,401);await assert.rejects(login(secret,serverId,null,'departure'))
  assert.equal((await request('/api/v1/auth/account/export',undefined,token)).status,401)
  const deletion=await inspectDeleted(departed.session.account.id);assert.ok(Object.values(deletion).every(v=>v===true))
  checks.account_deletion_erases_credentials_archives_and_queues_revokes_linked_devices_and_fences_writes=true
  const roster=(await request(`${base}/channels/${cid}/roster`,undefined,alice.session.token)).value;assert.deepEqual(roster.departures,[proof]);authorization={authority:roster.authority,policy:roster.policy,admissions:roster.admissions,governance:roster.governance,departures:roster.departures};json(alice.client,'authorize_channel',{id:cid,authorization})
  assert.throws(()=>json(alice.client,'send',{id:cid,content:{kind:'text',text:'must remove deleted device first',reply_to:null}}))
  const removal=json(alice.client,'prune_channel',cid);assert.ok(removal&&!removal.members.some(m=>m.account_id===departed.session.account.id));await submitted(alice,cid,removal,'commit');await drain(alice)
  const newMessage=json(alice.client,'send',{id:cid,content:{kind:'text',text:'Publishing resumes after signed account departure',reply_to:null}});await submitted(alice,cid,newMessage,'message')
  assert.throws(()=>json(alice.client,'authorize_channel',{id:cid,authorization:{...authorization,departures:[]}}))
  if(blob){
    assert.equal((await request(`/api/v1/blobs/${cid}/${blob}?device=${alice.identity.enrollment.device_key}`,undefined,alice.session.token)).status,410)
    await retentionFixture(blob,true,'erasure');await stop();start();await healthy()
    for(let i=0;i<100&&(await retentionFixture(blob,false,true)).blobs>0;i++)await new Promise(r=>setTimeout(r,100))
    assert.equal((await retentionFixture(blob,false,true)).blobs,0)
    assert.equal((await fetch(blobDownload)).status,404)
    checks.account_deletion_removes_private_storage_after_upload_leases_expire=true
  }
  await stop();start();await healthy();assert.equal((await request(erase,proof)).status,204)
  assert.equal((await request(`${base}/channels/${cid}/roster`,undefined,token)).status,401)
  const archive=(await request(`/api/v1/chat/conversations/${cid}/history?device=${alice.identity.enrollment.device_key}&after=0`,undefined,alice.session.token)).value.items
  assert.ok(!archive.some(m=>m.operation_id===own.operation_id));assert.ok(archive.some(m=>m.operation_id===retained.operation_id))
  await scanDatabase('HEARTH_DEPARTURE_CANARY')
  checks.signed_account_departure_prunes_mls_preserves_other_authors_and_idempotent_retry_after_restart=true
}
