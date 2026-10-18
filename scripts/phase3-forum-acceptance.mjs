import assert from 'node:assert/strict'
export async function verifyForums({alice,bob,request,json,op,view,uploadedPackage,submitted,start,stop,healthy,checks,scanDatabase}){
  await stop();start();await healthy()
  const base='/api/v1/communities',token=alice.session.token
  const community=(await request(base,{name:'Forum fixture'},token)).value,id=community.id
  const authority=json(alice.client,'sign_authority',id);assert.equal((await request(`${base}/${id}/authority`,authority,token)).status,200)
  const channel=(await request(`${base}/${id}/channels`,{name:'ideas',kind:'forum',category_id:null},token)).value,cid=channel.id
  assert.equal(channel.kind,'forum')
  const policy=json(alice.client,'sign_policy',{authority,channel_id:cid,kind:'forum',history:'none',revision:1});assert.equal((await request(`${base}/channels/${cid}/policy`,policy,token)).status,200)
  const [code,invitation]=json(alice.client,'sign_invitation',{authority,history_from:{},issued_at:Date.now()})
  assert.equal((await request(`${base}/${id}/invites`,{code,authorization:invitation,expires_in_seconds:3600,max_uses:2},token)).status,200)
  assert.equal((await request(`${base}/join`,{code},bob.session.token)).status,200);json(bob.client,'pin_invitation',{authority,code,invitation})
  assert.deepEqual((await request(`${base}/${id}/invitation`,undefined,bob.session.token)).value,invitation)
  const pkg=await uploadedPackage(bob),grant=json(alice.client,'sign_admission',{authority,account_id:bob.session.account.id,identity_key:pkg.member.enrollment.identity_key,history_from:{},invitation})
  assert.equal((await request(`${base}/${id}/admissions`,grant,token)).status,200)
  json(alice.client,'authorize_channel',{id:cid,authorization:{authority,policy,admissions:[grant]}})
  const claimed=(await request('/api/v1/chat/packages/claim',{device_keys:[pkg.member.enrollment.device_key]},token)).value
  await submitted(alice,cid,json(alice.client,'add_channel',{id:cid,packages:claimed,create:true}),'commit')
  async function drain(){for(const install of [alice,bob])for(;;){const r=await request(`/api/v1/chat/events/${install.identity.enrollment.device_key}?after=${view(install.client).last_seq}`,undefined,install.session.token);assert.equal(r.status,200);for(const e of r.value)json(install.client,'receive',e);if(r.value.length<128)break}}
  await drain()
  async function send(install,content){const upload=json(install.client,'send',{id:cid,content});await submitted(install,cid,upload,'message');await drain();return upload.operation_id}
  assert.throws(()=>json(alice.client,'send',{id:cid,content:{kind:'text',text:'root messages require a post',reply_to:null}}))
  assert.throws(()=>json(alice.client,'send',{id:cid,content:{kind:'poll',question:'orphan',options:['a','b'],multiple:false,parent:null}}))
  const post=await send(alice,{kind:'forum_post',title:'HEARTH_FORUM_CANARY_secret_title',text:'A proposed weekend plan'})
  const reply=await send(bob,{kind:'thread',parent:post,text:'Encrypted forum reply'})
  assert.equal(view(bob.client).messages.find(m=>m.id===post).topic,'HEARTH_FORUM_CANARY_secret_title');assert.equal(view(alice.client).messages.find(m=>m.id===reply).thread,post)
  assert.throws(()=>json(alice.client,'send',{id:cid,content:{kind:'thread',parent:reply,text:'Nested reply is not a post'}}))
  checks.forum_titles_posts_and_replies_are_encrypted_with_signed_channel_kind=true
  const poll=await send(alice,{kind:'poll',question:'HEARTH_FORUM_CANARY_poll_question',options:['HEARTH_FORUM_CANARY_option_a','Option B'],multiple:false,parent:post})
  await send(bob,{kind:'poll_vote',id:poll,choices:[0]});assert.deepEqual(view(alice.client).messages.find(m=>m.id===poll).poll.votes[bob.session.account.id],[0])
  await send(bob,{kind:'poll_vote',id:poll,choices:[1]});assert.deepEqual(view(alice.client).messages.find(m=>m.id===poll).poll.votes[bob.session.account.id],[1])
  await send(bob,{kind:'poll_vote',id:poll,choices:[]});assert.equal(view(alice.client).messages.find(m=>m.id===poll).poll.votes[bob.session.account.id],undefined)
  for(const choices of [[0,1],[2],[0,0]])assert.throws(()=>json(bob.client,'send',{id:cid,content:{kind:'poll_vote',id:poll,choices}}))
  assert.throws(()=>json(bob.client,'send',{id:cid,content:{kind:'poll_close',id:poll}}))
  await send(alice,{kind:'poll_close',id:poll});assert.ok(view(bob.client).messages.find(m=>m.id===poll).poll.closed)
  assert.throws(()=>json(bob.client,'send',{id:cid,content:{kind:'poll_vote',id:poll,choices:[0]}}))
  const multiple=await send(bob,{kind:'poll',question:'Multi choice',options:['First','Second','Third'],multiple:true,parent:post})
  await send(alice,{kind:'poll_vote',id:multiple,choices:[0,2]});assert.deepEqual(view(bob.client).messages.find(m=>m.id===multiple).poll.votes[alice.session.account.id],[0,2])
  checks.poll_votes_replace_withdraw_and_close_with_authenticated_participants=true
  const sealed=op(bob.client,'seal');bob.client.openMessaging(sealed,bob.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  await stop();start();await healthy();assert.equal((await request(`${base}/channels/${cid}/roster`,undefined,token)).value.channel.kind,'forum')
  assert.deepEqual(view(bob.client).messages.find(m=>m.id===multiple).poll.votes[alice.session.account.id],[0,2])
  await scanDatabase('HEARTH_FORUM_CANARY');assert.ok(!Buffer.from(sealed,'hex').includes(Buffer.from('HEARTH_FORUM_CANARY')))
  checks.forum_polls_restart_and_plaintext_canary_absence=true
  const key=json(alice.client,'report_key',id),keyPath=`${base}/channels/${cid}/report-keys`,reportsPath=`${base}/channels/${cid}/reports`
  assert.equal((await request(keyPath,key)).status,401)
  assert.equal((await request(keyPath,key,token)).status,204)
  assert.equal((await request(keyPath,json(bob.client,'report_key',id),bob.session.token)).status,403)
  assert.deepEqual((await request(keyPath,undefined,bob.session.token)).value,[key])
  const preview=json(bob.client,'report_preview',{id:cid,selected:[post,reply],reason:'HEARTH_REPORT_CANARY_selected_reason'})
  assert.equal(preview.selected.length,2)
  const envelope=json(bob.client,'prepare_report',{id:cid,selected:[post,reply],reason:preview.reason,key})
  assert.equal((await request(reportsPath,envelope)).status,401)
  assert.equal((await request(reportsPath,envelope,token)).status,403)
  assert.equal((await request(reportsPath,envelope,bob.session.token)).status,204)
  assert.equal((await request(reportsPath,envelope,bob.session.token)).status,204)
  assert.equal((await request(reportsPath,undefined,bob.session.token)).status,403)
  assert.equal((await request(reportsPath,{...envelope,ciphertext:'ff'+envelope.ciphertext.slice(2)},bob.session.token)).status,400)
  const queue=(await request(reportsPath,undefined,token)).value;assert.equal(queue.length,1)
  assert.deepEqual(json(alice.client,'open_report',queue[0].envelope),preview)
  assert.throws(()=>json(bob.client,'open_report',queue[0].envelope))
  checks.selected_report_evidence_is_sender_verified_and_encrypted_for_approved_moderator_device=true
  const moderatorStore=op(alice.client,'seal');alice.client.openMessaging(moderatorStore,alice.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  await stop();start();await healthy();assert.deepEqual(json(alice.client,'open_report',(await request(reportsPath,undefined,token)).value[0].envelope),preview)
  assert.equal((await request(`${reportsPath}/${envelope.id}/resolve`,{})).status,401)
  assert.equal((await request(`${reportsPath}/${envelope.id}/resolve`,{},bob.session.token)).status,403)
  assert.equal((await request(`${reportsPath}/${envelope.id}/resolve`,{},token)).status,204)
  assert.ok((await request(reportsPath,undefined,token)).value[0].resolved)
  await scanDatabase('HEARTH_REPORT_CANARY')
  checks.report_queue_permission_tamper_rejection_resolution_and_restart_canary_absence=true
}
