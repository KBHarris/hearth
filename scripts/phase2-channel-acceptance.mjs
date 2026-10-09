// Product MLS/WASM, authenticated HTTP, and ordered device delivery; disposable fixtures only.
import assert from 'node:assert/strict'

export async function verifyChannels({alice,bob,carol,linked,dmId,request,json,op,view,uploadedPackage,submitted,connect,until,pause,sockets,start,stop,healthy,checks,wire,scanDatabase}) {
  for(const socket of sockets)socket.close()
  await pause(200);await stop();start();await healthy()
  const gateways=await Promise.all([alice,bob,carol].map(connect))
  const ready=predicate=>until(()=>{for(const gateway of gateways)gateway.check();return predicate()})
  const base='/api/v1/communities'
  const create=await request(base,{name:'Encrypted channel fixture'},alice.session.token)
  assert.equal(create.status,200)
  const community=create.value
  async function channel(kind) {
    const result=await request(`${base}/${community.id}/channels`,{name:kind,kind,category_id:null},alice.session.token)
    assert.equal(result.status,200);return result.value.id
  }
  const id=await channel('text')
  const news=await channel('announcement')
  const roster=token=>request(`${base}/channels/${id}/roster`,undefined,token)
  assert.equal((await roster(bob.session.token)).status,403)
  assert.equal((await roster(alice.session.token)).headers.get('cache-control'),'no-store')
  const solo=json(alice.client,'add_channel',{id,packages:[],create:true})
  assert.equal(solo.welcomes.length,0)
  await submitted(alice,id,solo,'commit')
  assert.equal((await request(`/api/v1/chat/conversations/${id}/commit`,solo,alice.session.token)).status,204)
  const before='HEARTH_CHANNEL_CANARY_before_join_private_content'
  const first=json(alice.client,'send',{id,content:{kind:'text',text:before,reply_to:null}})
  await submitted(alice,id,first,'message')
  await ready(()=>view(alice.client).messages.some(m=>m.id===first.operation_id))
  checks.channel_solo_initialization_and_commit_replay=true

  const outsiderPackage=await uploadedPackage(carol)
  const outsiderClaim=await request('/api/v1/chat/packages/claim',{device_keys:[outsiderPackage.member.enrollment.device_key]},alice.session.token)
  assert.equal(outsiderClaim.status,200)
  const unauthorized=json(alice.client,'add_channel',{id,packages:outsiderClaim.value,create:false})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/commit`,unauthorized,alice.session.token)).status,403)
  op(alice.client,'reject',unauthorized.operation_id)
  assert.ok(!(await request('/api/v1/chat/conversations',undefined,carol.session.token)).value.some(c=>c.id===id))
  const forged=json(carol.client,'add_channel',{id,packages:[],create:true})
  assert.equal((await request(`/api/v1/chat/conversations/${id}/commit`,forged,carol.session.token)).status,403)
  op(carol.client,'reject',forged.operation_id)
  const dmExpansion=json(alice.client,'add_channel',{id:dmId,packages:outsiderClaim.value,create:false})
  assert.equal((await request(`/api/v1/chat/conversations/${dmId}/commit`,dmExpansion,alice.session.token)).status,403)
  op(alice.client,'reject',dmExpansion.operation_id)
  checks.channel_nonmembers_cannot_read_roster_or_join_mls_and_dm_audience_stays_fixed=true

  const invite=await request(`${base}/${community.id}/invites`,{expires_in_seconds:3600,max_uses:2},alice.session.token)
  assert.equal(invite.status,200)
  assert.equal((await request(`${base}/join`,{code:invite.value.code},bob.session.token)).status,200)
  const visible=(await request('/api/v1/chat/conversations',undefined,bob.session.token)).value.find(c=>c.id===id)
  assert.equal(visible.channel_id,id)
  assert.ok(!visible.accounts.includes(bob.session.account.id))
  assert.equal((await roster(bob.session.token)).value.people.length,2)
  async function add(install,channelId=id) {
    const p=await uploadedPackage(install)
    const claimed=await request('/api/v1/chat/packages/claim',{device_keys:[p.member.enrollment.device_key]},alice.session.token)
    assert.equal(claimed.status,200)
    await submitted(alice,channelId,json(alice.client,'add_channel',{id:channelId,packages:claimed.value,create:false}),'commit')
    await ready(()=>{
      const epoch=view(alice.client).groups.find(g=>g.id===channelId).epoch
      return view(install.client).groups.some(g=>g.id===channelId && g.epoch===epoch) &&
        [bob,carol,linked].every(i=>view(i.client).groups.filter(g=>g.id===channelId).every(g=>g.epoch===epoch))
    })
  }
  await add(bob)
  assert.ok(!view(bob.client).messages.some(m=>m.conversation_id===id))
  const reply=json(bob.client,'send',{id,content:{kind:'text',text:before+' after join',reply_to:null}})
  await submitted(bob,id,reply,'message')
  await ready(()=>view(alice.client).messages.some(m=>m.id===reply.operation_id))
  checks.channel_invite_member_receives_new_epoch_without_prejoin_history=true

  assert.equal((await request(`${base}/join`,{code:invite.value.code},carol.session.token)).status,200)
  const stale=json(bob.client,'send',{id,content:{kind:'text',text:'Queued before the new epoch',reply_to:null}})
  await add(carol)
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,stale,bob.session.token)).status,409)
  op(bob.client,'reject',stale.operation_id)
  assert.ok(!view(bob.client).messages.some(m=>m.id===stale.operation_id))
  checks.channel_stale_epoch_upload_rejected_without_accepting_local_content=true
  const linkedGateway=await connect(linked);gateways.push(linkedGateway)
  await add(linked)
  assert.ok(!view(carol.client).messages.some(m=>m.conversation_id===id))
  assert.ok(!view(linked.client).messages.some(m=>m.conversation_id===id))
  const shared=json(carol.client,'send',{id,content:{kind:'text',text:before+' three accounts',reply_to:reply.operation_id}})
  await submitted(carol,id,shared,'message')
  await ready(()=>[alice,bob,linked].every(i=>view(i.client).messages.some(m=>m.id===shared.operation_id)))
  checks.channel_later_account_and_linked_device_rekey_preserves_existing_members=true

  const b=await uploadedPackage(bob)
  const newsClaim=await request('/api/v1/chat/packages/claim',{device_keys:[b.member.enrollment.device_key]},alice.session.token)
  assert.equal(newsClaim.status,200)
  await submitted(alice,news,json(alice.client,'add_channel',{id:news,packages:newsClaim.value,create:true}),'commit')
  await ready(()=>view(bob.client).groups.some(g=>g.id===news))
  const announcement=json(alice.client,'send',{id:news,content:{kind:'text',text:before+' announcement',reply_to:null}})
  await submitted(alice,news,announcement,'message')
  await ready(()=>view(bob.client).messages.some(m=>m.id===announcement.operation_id))
  for(const content of [
    {kind:'text',text:'Member must not publish',reply_to:null},
    {kind:'typing',active:true},
    {kind:'edit',id:announcement.operation_id,text:'Member must not edit'},
    {kind:'delete',id:announcement.operation_id}
  ]) {
    const upload=json(bob.client,'send',{id:news,content})
    assert.equal((await request(`/api/v1/chat/conversations/${news}/message`,upload,bob.session.token)).status,403)
    op(bob.client,'reject',upload.operation_id)
    assert.equal(view(bob.client).pending.length,0)
  }
  const edited=json(alice.client,'send',{id:news,content:{kind:'edit',id:announcement.operation_id,text:before+' owner edit'}})
  await submitted(alice,news,edited,'message')
  await ready(()=>view(bob.client).messages.find(m=>m.id===announcement.operation_id)?.edited)
  checks.channel_announcements_encrypt_for_members_and_reject_member_send_typing_edit_delete=true

  for(const gateway of gateways)gateway.socket.close()
  await Promise.all(gateways.map(g=>g.drain()));await pause(200)
  const disk=op(bob.client,'seal')
  const offline=json(alice.client,'send',{id,content:{kind:'text',text:before+' offline restart',reply_to:null}})
  await submitted(alice,id,offline,'message')
  await stop();start();await healthy()
  bob.client.openMessaging(disk,bob.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  const resumed=await connect(bob)
  await until(()=>{resumed.check();return view(bob.client).messages.some(m=>m.id===offline.operation_id)})
  assert.ok(!view(bob.client).messages.some(m=>m.id===first.operation_id))
  assert.equal((await request(`/api/v1/chat/conversations/${id}/message`,offline,alice.session.token)).status,204)
  resumed.socket.close();await resumed.drain()
  checks.channel_sealed_store_and_offline_delivery_survive_server_restart=true
  assert.ok(wire.every(frame=>!frame.includes(before)))
  for(const install of [alice,bob,carol,linked])assert.ok(!Buffer.from(op(install.client,'seal'),'hex').includes(Buffer.from(before)))
  await scanDatabase(before)
  checks.channel_content_absent_from_server_database_logs_gateway_and_sealed_store=true
}
