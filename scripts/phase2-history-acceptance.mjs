// Product WASM + authenticated server. History bytes are never decrypted by the fixture host.
import assert from 'node:assert/strict'
export async function verifyHistory({alice,bob,carol,linked,request,json,op,view,uploadedPackage,submitted,ready,until,checks,scanDatabase}) {
  const base='/api/v1/communities'
  const community=(await request(base,{name:'History policy fixture'},alice.session.token)).value
  const authority=json(alice.client,'sign_authority',community.id)
  assert.equal((await request(`${base}/${community.id}/authority`,authority,alice.session.token)).status,200)
  const channels=[]
  const canary='HEARTH_HISTORY_CANARY_private_archive'
  for(const history of ['none','full','since_invite']) {
    const created=await request(`${base}/${community.id}/channels`,{name:history,kind:'text',category_id:null},alice.session.token)
    assert.equal(created.status,200);const id=created.value.id
    const policy=json(alice.client,'sign_policy',{authority,channel_id:id,kind:'text',history,revision:1})
    assert.equal((await request(`${base}/channels/${id}/policy`,policy,alice.session.token)).status,200)
    json(alice.client,'authorize_channel',{id,authorization:{authority,policy,admissions:[]}})
    await submitted(alice,id,json(alice.client,'add_channel',{id,packages:[],create:true}),'commit')
    const before=json(alice.client,'send',{id,content:{kind:'text',text:canary+' before '+history,reply_to:null}})
    await submitted(alice,id,before,'message')
    await submitted(alice,id,json(alice.client,'add_channel',{id,packages:[],create:false}),'commit')
    channels.push({id,history,policy,before})
  }
  const floors=Object.fromEntries(channels.map(c=>[c.id,view(alice.client).groups.find(g=>g.id===c.id).epoch]))
  const [code,invitation]=json(alice.client,'sign_invitation',{authority,history_from:floors,issued_at:Date.now()})
  assert.equal((await request(`${base}/${community.id}/invites`,{code,authorization:invitation,expires_in_seconds:3600,max_uses:2},alice.session.token)).status,200)
  for(const channel of channels){channel.after=json(alice.client,'send',{id:channel.id,content:{kind:'text',text:canary+' after invite '+channel.history,reply_to:null}});await submitted(alice,channel.id,channel.after,'message')}
  const admissions=[]
  for(const install of [bob,carol]) {
    assert.equal((await request(`${base}/join`,{code},install.session.token)).status,200)
    const changed={...invitation,history_from:Object.fromEntries(channels.map(c=>[c.id,0]))}
    assert.throws(()=>json(install.client,'pin_invitation',{authority,code,invitation:changed}))
    assert.throws(()=>json(install.client,'pin_invitation',{authority,code:'f'.repeat(64),invitation}))
    json(install.client,'pin_invitation',{authority,code,invitation})
    const grant=json(alice.client,'sign_admission',{authority,account_id:install.session.account.id,identity_key:install.identity.enrollment.identity_key,invitation})
    assert.equal((await request(`${base}/${community.id}/admissions`,grant,alice.session.token)).status,200);admissions.push(grant)
  }
  async function add(install,channel) {
    json(alice.client,'authorize_channel',{id:channel.id,authorization:{authority,policy:channel.policy,admissions}})
    const p=await uploadedPackage(install)
    const claim=await request('/api/v1/chat/packages/claim',{device_keys:[p.member.enrollment.device_key]},alice.session.token)
    assert.equal(claim.status,200)
    await submitted(alice,channel.id,json(alice.client,'add_channel',{id:channel.id,packages:claim.value,create:false}),'commit')
    await ready(()=>view(install.client).groups.some(g=>g.id===channel.id && g.epoch===view(alice.client).groups.find(g=>g.id===channel.id).epoch))
  }
  async function backfill(install,channel) {
    const id=channel.id
    await ready(()=>view(install.client).groups.find(g=>g.id===id)?.epoch===view(alice.client).groups.find(g=>g.id===id)?.epoch)
    await submitted(install,id,json(install.client,'request_history',id),'message')
    let share
    await until(()=>{share=json(alice.client,'offer_history',id);return !!share})
    await submitted(alice,id,share,'message')
    await ready(()=>view(install.client).history_backfill.includes(id))
    const page=await request(`/api/v1/chat/conversations/${id}/history?device=${install.identity.enrollment.device_key}&after=0`,undefined,install.session.token)
    assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store')
    const allHistory=channel.history==='full'||install.session.account.id===alice.session.account.id
    assert.equal(page.value.items.length,allHistory?2:1)
    assert.equal((await request(`/api/v1/chat/conversations/${id}/history?device=${carol.identity.enrollment.device_key}&after=0`,undefined,install.session.token)).status,403)
    const forged=structuredClone(page.value.items[0]);forged.archive.ciphertext=(parseInt(forged.archive.ciphertext.slice(0,2),16)^1).toString(16).padStart(2,'0')+forged.archive.ciphertext.slice(2)
    assert.throws(()=>json(install.client,'import_history',{id,uploads:[forged]}))
    json(install.client,'import_history',{id,uploads:page.value.items});op(install.client,'finish_history',id)
    const messages=view(install.client).messages.filter(m=>m.conversation_id===id)
    assert.ok(messages.some(m=>m.id===channel.after.operation_id))
    assert.equal(messages.some(m=>m.id===channel.before.operation_id),allHistory)
    assert.equal(json(install.client,'import_history',{id,uploads:page.value.items}),0)
  }
  for(const channel of channels){
    await add(bob,channel);await add(carol,channel)
    if(channel.history==='none') {
      assert.throws(()=>json(bob.client,'request_history',channel.id))
      assert.equal((await request(`/api/v1/chat/conversations/${channel.id}/history?device=${bob.identity.enrollment.device_key}&after=0`,undefined,bob.session.token)).status,403)
      assert.equal(channel.before.archive,undefined);continue
    }
    await backfill(bob,channel)
    await add(linked,channel);await backfill(linked,channel)
  }
  checks.history_none_full_and_signed_since_invite_cutoff_pass_with_late_linked_owner_device=true
  checks.history_archive_tampering_wrong_device_and_duplicate_import_are_rejected=true
  const disk=op(bob.client,'seal');bob.client.openMessaging(disk,bob.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  assert.equal(view(bob.client).messages.filter(m=>channels.some(c=>c.id===m.conversation_id)).length,3)
  await scanDatabase(canary)
  for(const install of [alice,bob,carol,linked])assert.ok(!Buffer.from(op(install.client,'seal'),'hex').includes(Buffer.from(canary)))
  checks.history_survives_sealed_restart_and_plaintext_is_absent_from_host=true
}
