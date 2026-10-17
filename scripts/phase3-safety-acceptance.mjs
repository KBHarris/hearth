import assert from 'node:assert/strict'
export async function verifySafety({alice,bob,dmId,request,json,op,login,serverId,connect,until,start,stop,healthy,checks}){
  const blocks='/api/v1/auth/blocks',bans='/api/v1/auth/admin/bans',token=alice.session.token,bid=bob.session.account.id
  const push='/api/v1/auth/push',disable=push+'/disable'
  for(const path of ['/api/v1/auth/session','/api/v1/auth/identity',blocks,bans,'/api/v1/auth/admin/settings','/api/v1/auth/account/export','/api/v1/chat/conversations',`/api/v1/chat/people/owner`,`/api/v1/chat/accounts/${alice.session.account.id}`,`/api/v1/chat/packages/${alice.identity.enrollment.device_key}`,`/api/v1/chat/events/${alice.identity.enrollment.device_key}?after=0`])assert.equal((await request(path)).status,401,path)
  for(const [path,body] of [[blocks,{account_id:bid,active:false}],[bans,{account_id:bid,active:false}],['/api/v1/auth/logout',{}],['/api/v1/auth/admin/invite',{}],['/api/v1/auth/admin/settings',{server_name:'unauthenticated fixture',registration_mode:'closed'}],['/api/v1/communities',{name:'must not create'}],['/api/v1/communities/join',{code:'f'.repeat(64)}]])assert.equal((await request(path,body)).status,401,path)
  for(const path of [`/api/v1/chat/people/owner`,`/api/v1/chat/accounts/${alice.session.account.id}`,`/api/v1/chat/packages/${alice.identity.enrollment.device_key}`])assert.equal((await request(path,undefined,token)).status,200,path)
  checks.permission_matrix_account_directory_admin_and_community_entry_require_sessions=true

  assert.equal((await request(push)).status,401)
  const config=(await request(push,undefined,token)).value;assert.equal(Buffer.from(config.public_key,'base64url').length,65)
  const sub={device_key:alice.identity.enrollment.device_key,endpoint:'https://fcm.googleapis.com/wp/hearth-disposable-fixture',p256dh:'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',auth:'BTBZMqHH6r4Tts7J_aSIgg'}
  for(const endpoint of ['http://fcm.googleapis.com/wp/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/wp/a','https://user@fcm.googleapis.com/wp/a'])assert.equal((await request(push,{...sub,endpoint},token)).status,400)
  assert.equal((await request(push,{...sub,p256dh:'invalid'},token)).status,400)
  assert.equal((await request(push,sub)).status,401)
  assert.equal((await request(disable,{device_key:sub.device_key,endpoint:sub.endpoint})).status,401)
  assert.equal((await request(disable,{device_key:sub.device_key,endpoint:sub.endpoint},bob.session.token)).status,403)
  assert.equal((await request(push,sub,bob.session.token)).status,403)
  assert.equal((await request(push,sub,token)).status,204)
  assert.equal((await request(push,sub,token)).status,204)
  assert.equal((await request(push,{...sub,device_key:bob.identity.enrollment.device_key},bob.session.token)).status,409)
  await stop();start();await healthy();assert.deepEqual((await request(push,undefined,token)).value,config)
  assert.equal((await request(disable,{device_key:sub.device_key,endpoint:sub.endpoint},token)).status,204)
  checks.opt_in_web_push_validates_provider_keys_device_ownership_and_stable_vapid_identity=true
  assert.equal((await request('/api/v1/auth/account/export')).status,401)
  assert.equal((await request('/api/v1/auth/account/export?after=invalid',undefined,token)).status,400)
  let after='',seen=new Set(),pages=0
  for(;;){const r=await request('/api/v1/auth/account/export?after='+encodeURIComponent(after),undefined,token);assert.equal(r.status,200);assert.equal(r.value.account.id,alice.session.account.id);assert.ok(r.value.records.length<=32)
    for(const record of r.value.records){assert.ok(record.cursor>after&&!seen.has(record.cursor));seen.add(record.cursor);const d=record.data;if(record.cursor.startsWith('message:'))assert.equal(d.operation.account_id,alice.session.account.id);if(record.cursor.startsWith('report:'))assert.ok([d.envelope.reporter.account_id,d.envelope.recipient.member.account_id].includes(alice.session.account.id))}
    const raw=JSON.stringify(r.value);assert.ok(!raw.includes('password_file')&&!raw.includes('token_hash')&&!raw.includes('opaque_state')&&!raw.includes('HEARTH_REPORT_CANARY_selected_reason'))
    pages++;if(!r.value.next)break;assert.ok(r.value.next>after);after=r.value.next
  }
  assert.ok(pages>1&&seen.size>32)
  checks.account_export_pages_owned_metadata_and_ciphertext_without_credentials_or_other_senders=true
  assert.equal((await request(blocks,{account_id:bid,active:true},token)).status,204)
  assert.equal((await request(blocks,undefined,token)).value[0].id,bid)
  assert.deepEqual((await request(blocks,undefined,bob.session.token)).value,[])
  const blocked=json(bob.client,'send',{id:dmId,content:{kind:'text',text:'blocked direct message',reply_to:null}})
  assert.equal((await request(`/api/v1/chat/conversations/${dmId}/message`,blocked,bob.session.token)).status,403);op(bob.client,'reject',blocked.operation_id)
  await stop();start();await healthy();assert.equal((await request(blocks,undefined,token)).value[0].id,bid)
  assert.equal((await request(blocks,{account_id:bid,active:false},token)).status,204)
  assert.deepEqual((await request(blocks,undefined,token)).value,[])
  checks.user_dm_blocks_are_private_per_account_block_delivery_and_survive_restart=true
  assert.equal((await request(bans,undefined,bob.session.token)).status,403)
  assert.equal((await request(bans,{account_id:alice.session.account.id,active:true},token)).status,403)
  const pending=await login('HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only',serverId,null,'bob')
  const gateway=await connect(bob)
  assert.equal((await request(bans,{account_id:bid,active:true},token)).status,204)
  await until(()=>gateway.socket.readyState===WebSocket.CLOSED)
  assert.equal((await request('/api/v1/auth/session',undefined,bob.session.token)).status,401)
  assert.equal((await request('/api/v1/auth/login/finish',pending)).status,401)
  await assert.rejects(login('HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only',serverId,null,'bob'))
  await stop();start();await healthy();assert.equal((await request(bans,undefined,token)).value[0].id,bid)
  assert.equal((await request(bans,{account_id:bid,active:false},token)).status,204)
  const proof=await login('HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only',serverId,null,'bob'),session=await request('/api/v1/auth/login/finish',proof);assert.equal(session.status,200);bob.session=session.value
  checks.server_operator_bans_revoke_sessions_live_gateway_and_pending_login_without_community_privileges=true
}
