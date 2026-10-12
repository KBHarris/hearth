// Product WASM over actual HTTP/WebSocket. Only disposable fixture accounts.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { verifyChannels } from './phase2-channel-acceptance.mjs'

export async function verifyMessaging({wasm,request,login,origin,serverId,owner,password,prepared,linked,start,stop,healthy,checks,scanDatabase,storage,retentionFixture}) {
  const clients=[]
  const sockets=[]
  const wire=[]
  const typing=[]
  const op=(client,name,input='')=>{try{return client.messagingOperation(name,typeof input==='string'?input:JSON.stringify(input))}catch(error){throw new Error(`Product crypto operation ${name} failed`,{cause:error})}}
  const json=(client,name,input)=>JSON.parse(op(client,name,input))
  const view=client=>json(client,'view')
  async function unlock(username,secret,envelope) {
    let client
    const proof=await login(secret,serverId,value=>{client=value},username)
    clients.push(client)
    const session=await request('/api/v1/auth/login/finish',proof)
    assert.equal(session.status,200)
    const identity=JSON.parse(client.prepareIdentity(envelope,session.value.account.id,serverId))
    if (!envelope) assert.equal((await request('/api/v1/auth/device/first',identity.enrollment,session.value.token)).status,200)
    client.commitIdentity();client.openMessaging(undefined,session.value.account.id,serverId)
    return {client,session:session.value,identity}
  }
  async function uploadedPackage(install) {
    const record=json(install.client,'package')
    // Durable snapshot precedes advertising a public package with corresponding private secrets.
    install.sealed=op(install.client,'seal')
    assert.equal((await request('/api/v1/chat/packages',record,install.session.token)).status,204)
    op(install.client,'accept',record.package_hash);install.sealed=op(install.client,'seal')
    return record
  }
  async function submitted(install,id,upload,kind) {
    install.sealed=op(install.client,'seal')
    const result=await request(`/api/v1/chat/conversations/${id}/${kind}`,upload,install.session.token)
    assert.equal(result.status,204)
    op(install.client,'accept',upload.operation_id);install.sealed=op(install.client,'seal')
  }
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  async function until(predicate) {
    for(let i=0;i<100;i++) { if(predicate())return;await pause(100) }
    throw new Error('Messaging acceptance timed out')
  }
  async function connect(install) {
    const socket=new WebSocket(origin.replace(/^http/,'ws')+'/gateway');sockets.push(socket)
    let chain=Promise.resolve();let failure;let ready=false
    socket.addEventListener('error',()=>{failure=new Error('Gateway transport failed')})
    socket.addEventListener('message',event=>{
      wire.push(event.data)
      chain=chain.then(()=>{
        const frame=JSON.parse(event.data)
        if(frame.op==='challenge') {
          const signature=json(install.client,'gateway',{token:install.session.token,challenge:frame.d.challenge})
          socket.send(JSON.stringify({op:'identify',d:{protocol:1,token:install.session.token,device_key:install.identity.enrollment.device_key,signature}}))
        } else if(frame.op==='ready') {
          socket.send(JSON.stringify({op:'resume',d:{session_id:frame.d.session_id,last_seq:view(install.client).last_seq}}));ready=true
        } else if(frame.op==='event') {
          assert.equal(frame.d.seq,frame.d.event.seq)
          const indicator=json(install.client,'receive',frame.d.event)
          if(indicator)typing.push({device:install.identity.enrollment.device_key,indicator})
          install.sealed=op(install.client,'seal')
          socket.send(JSON.stringify({op:'ack',d:{last_seq:view(install.client).last_seq}}))
        } else if(frame.op==='invalid_session') throw new Error('Gateway rejected acceptance session')
      }).catch(error=>{failure=error})
    })
    await until(()=>{if(failure)throw failure;return ready})
    return {socket,check:()=>{if(failure)throw failure},drain:()=>chain}
  }
  async function rejectedGateway(install,mutate,badResume=false) {
    const socket=new WebSocket(origin.replace(/^http/,'ws')+'/gateway');sockets.push(socket)
    let rejected=false;let failure
    socket.addEventListener('message',event=>{
      try {
        const frame=JSON.parse(event.data)
        if(frame.op==='challenge') {
          const signature=json(install.client,'gateway',{token:install.session.token,challenge:frame.d.challenge})
          socket.send(JSON.stringify({op:'identify',d:mutate({protocol:1,token:install.session.token,device_key:install.identity.enrollment.device_key,signature})}))
        }else if(frame.op==='ready') {
          if(!badResume)throw new Error('Invalid device proof was accepted')
          socket.send(JSON.stringify({op:'resume',d:{session_id:frame.d.session_id,last_seq:Number.MAX_SAFE_INTEGER}}))
        }else if(frame.op==='invalid_session')rejected=true
      }catch(error){failure=error}
    })
    await until(()=>{if(failure)throw failure;return rejected});socket.close()
  }
  try {
    const alice=await unlock('owner',password,prepared.envelope)
    const bob=await unlock('bob','HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only')
    const bobPackage=await uploadedPackage(bob)
    const claimed=await request('/api/v1/chat/packages/claim',{device_keys:[bobPackage.member.enrollment.device_key]},owner)
    assert.equal(claimed.status,200)
    const id=randomBytes(32).toString('hex')
    const commit=json(alice.client,'add',{id,packages:claimed.value,create:true})
    await submitted(alice,id,commit,'commit')
    const bobGateway=await connect(bob)
    await until(()=>{bobGateway.check();return view(bob.client).groups.length===1})
    const canary='HEARTH_END_TO_END_SERVER_CANARY_opaque_chat_content'
    const text=json(alice.client,'send',{id,content:{kind:'text',text:canary,reply_to:null}})
    await submitted(alice,id,text,'message')
    await until(()=>{bobGateway.check();return view(bob.client).messages.length===1})
    assert.equal(view(bob.client).messages[0].text,canary)
    bobGateway.socket.send(JSON.stringify({op:'heartbeat',d:{last_seq:view(bob.client).last_seq}}))
    await until(()=>wire.some(raw=>JSON.parse(raw).op==='heartbeat_ack'))
    const reply=json(bob.client,'send',{id,content:{kind:'text',text:'Encrypted reply',reply_to:text.operation_id}})
    await submitted(bob,id,reply,'message')
    bobGateway.socket.close();await bobGateway.drain();await pause(150)
    const disk=op(bob.client,'seal')
    const offline=json(alice.client,'send',{id,content:{kind:'text',text:'While you were offline',reply_to:null}})
    await submitted(alice,id,offline,'message')
    await stop();start();await healthy()
    const resumed=await unlock('bob','HEARTH_SECOND_ACCOUNT_PASSWORD_CANARY_private_only',bob.identity.envelope)
    resumed.client.openMessaging(disk,resumed.session.account.id,serverId)
    const resumedGateway=await connect(resumed)
    await until(()=>{resumedGateway.check();return view(resumed.client).messages.length===3})
    assert.equal(view(resumed.client).messages[2].text,'While you were offline')
    assert.equal(view(resumed.client).messages[1].reply_to,text.operation_id)
    checks.wasm_mls_authenticated_gateway_and_offline_resume_after_restart=true
    const linkedInstall=await unlock('owner',password,linked.envelope)
    assert.equal(linkedInstall.identity.enrollment.identity_key,alice.identity.enrollment.identity_key)
    const linkedPackage=await uploadedPackage(linkedInstall)
    const addition=await request('/api/v1/chat/packages/claim',{device_keys:[linkedPackage.member.enrollment.device_key]},alice.session.token)
    assert.equal(addition.status,200)
    const add=json(alice.client,'add',{id,packages:addition.value,create:false});await submitted(alice,id,add,'commit')
    const linkedGateway=await connect(linkedInstall)
    await until(()=>{linkedGateway.check();return view(linkedInstall.client).groups.length===1})
    assert.equal(view(linkedInstall.client).messages.length,0)
    const fresh=json(alice.client,'send',{id,content:{kind:'text',text:'Linked device reads new messages',reply_to:null}})
    await submitted(alice,id,fresh,'message')
    await until(()=>{linkedGateway.check();resumedGateway.check();return view(linkedInstall.client).messages.length===1 && view(resumed.client).messages.length===4})
    assert.equal(view(linkedInstall.client).messages[0].text,'Linked device reads new messages')
    checks.linked_device_joins_new_epoch_without_old_history=true
    const edit=json(alice.client,'send',{id,content:{kind:'edit',id:text.operation_id,text:'Edited privately'}});await submitted(alice,id,edit,'message')
    await until(()=>{resumedGateway.check();return view(resumed.client).messages[0].edited})
    assert.equal(view(resumed.client).messages[0].text,'Edited privately')
    const deleted=json(alice.client,'send',{id,content:{kind:'delete',id:text.operation_id}});await submitted(alice,id,deleted,'message')
    await until(()=>{resumedGateway.check();return view(resumed.client).messages[0].deleted})
    checks.encrypted_reply_edit_and_delete=true
    await rejectedGateway(resumed,proof=>({...proof,signature:'00'.repeat(64)}))
    await rejectedGateway(resumed,proof=>({...proof,device_key:alice.identity.enrollment.device_key}))
    await rejectedGateway(resumed,proof=>({...proof,token:alice.session.token}))
    await rejectedGateway(resumed,proof=>proof,true)
    checks.gateway_rejects_forged_device_token_binding_and_future_resume=true
    // Exercise the third account and group DM through the same product HTTP flow.
    // Restart also resets the fixture's deliberately small authentication budget.
    for(const socket of sockets)socket.close()
    await pause(200);await stop();start();await healthy()
    assert.equal((await request('/api/v1/auth/admin/settings',{server_name:'Hearth acceptance',registration_mode:'open'},alice.session.token)).status,200)
    const registrationClient=new wasm.OpaqueAuthClient();clients.push(registrationClient)
    const carolPassword='HEARTH_THIRD_ACCOUNT_PASSWORD_CANARY_private_only'
    const registration=await request('/api/v1/auth/register/start',{username:'carol',message:registrationClient.registrationStart(carolPassword),invite_code:null})
    assert.equal(registration.status,200)
    assert.equal((await request('/api/v1/auth/register/finish',{username:'carol',message:registrationClient.registrationFinish(carolPassword,registration.value.message,'carol',serverId),invite_code:null})).status,200)
    const carol=await unlock('carol',carolPassword)
    const aliceGateway=await connect(alice)
    const groupBobGateway=await connect(resumed)
    const carolGateway=await connect(carol)
    await until(()=>{aliceGateway.check();return view(alice.client).last_seq>0})
    const packages=[await uploadedPackage(resumed),await uploadedPackage(carol)]
    const groupClaim=await request('/api/v1/chat/packages/claim',{device_keys:packages.map(p=>p.member.enrollment.device_key)},alice.session.token)
    assert.equal(groupClaim.status,200)
    const groupId=randomBytes(32).toString('hex')
    await submitted(alice,groupId,json(alice.client,'add',{id:groupId,packages:groupClaim.value,create:true}),'commit')
    await until(()=>{groupBobGateway.check();carolGateway.check();return view(carol.client).groups.length===1 && view(resumed.client).groups.length===2})
    const groupMessage=json(carol.client,'send',{id:groupId,content:{kind:'text',text:canary+' group',reply_to:null}})
    await submitted(carol,groupId,groupMessage,'message')
    await until(()=>{aliceGateway.check();groupBobGateway.check();return view(alice.client).messages.some(m=>m.id===groupMessage.operation_id) && view(resumed.client).messages.some(m=>m.id===groupMessage.operation_id)})
    const beforeTyping=view(alice.client).messages.length
    await submitted(carol,groupId,json(carol.client,'send',{id:groupId,content:{kind:'typing',active:true}}),'message')
    await until(()=>typing.some(value=>value.device===alice.identity.enrollment.device_key && value.indicator[0]===carol.session.account.id && value.indicator[1]))
    assert.equal(view(alice.client).messages.length,beforeTyping)
    checks.open_registration_three_person_group_dm_and_encrypted_typing=true
    await verifyChannels({alice,bob:resumed,carol,linked:linkedInstall,dmId:id,request,json,op,view,uploadedPackage,submitted,connect,until,pause,sockets,start,stop,healthy,checks,wire,scanDatabase,storage,retentionFixture})
    // Channel restart closed earlier gateways; open a current one for revocation.
    const revocationGateway=await connect(carol)
    assert.equal((await request('/api/v1/auth/logout',{},carol.session.token)).status,204)
    await until(()=>revocationGateway.socket.readyState===WebSocket.CLOSED)
    checks.live_gateway_closes_after_session_revocation=true
    assert.ok(wire.every(frame=>!frame.includes(canary)))
    for(const install of [alice,bob,resumed,linkedInstall,carol]) assert.ok(!Buffer.from(op(install.client,'seal'),'hex').includes(Buffer.from(canary)))
    await scanDatabase(canary)
    checks.message_canary_absent_from_server_database_and_gateway=true
    for(const socket of sockets)socket.close()
    await pause(200)
  } finally {
    for(const socket of sockets)socket.close()
    for(const client of clients)client.free()
  }
}
