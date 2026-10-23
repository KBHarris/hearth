import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isVoicePresence,isVoiceRoom,isSfuAccess} from '../src/voice.ts'
import {HearthClient} from '../src/index.ts'
const id=char=>char.repeat(64),now=Date.now()
const presence={channel_id:id('a'),room_id:id('b'),epoch:1,device_key:id('c'),incarnation:id('d'),public_key:'04'+'ab'.repeat(64),relay_only:true,active:true,issued_at:now,expires_at:now+30000,signature:'ab'.repeat(64)}
const room={channel_id:id('a'),room_id:id('b'),epoch:1,revision:1,relay_only:true,capacity:4,participants:[presence]}
test('public occupancy bounds bind the room, privacy, sorted devices and short presence lifetime',()=>{
  assert.ok(isVoicePresence(presence));assert.ok(isVoiceRoom(room));assert.ok(isVoiceRoom({...room,participants:[]}))
  for(const patch of [{public_key:'04'+'AB'.repeat(64)},{expires_at:now+30001},{issued_at:NaN},{signature:''},{device_key:'bad'}])assert.equal(isVoicePresence({...presence,...patch}),false)
  for(const patch of [{revision:0},{capacity:5},{participants:[presence,presence]},{participants:[{...presence,relay_only:false}]},{participants:[{...presence,room_id:id('e')}]},{participants:Array(5).fill(presence)}])assert.equal(isVoiceRoom({...room,...patch}),false)
})
test('room occupancy requests use authenticated JSON and preserve the signed public body',async t=>{
  const requests=[],client=new HearthClient('http://127.0.0.1:1234')
  t.mock.method(globalThis,'fetch',async(input,init)=>{requests.push([String(input),init]);return Response.json(room)})
  await client.voiceRoom('session',presence.channel_id,presence.device_key);await client.voicePresence('session',presence)
  assert.ok(requests.every(([url,init])=>url.endsWith('/voice/'+presence.channel_id+'/'+presence.device_key)&&init.headers.Authorization==='Bearer session'))
  assert.equal(requests[1][1].headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(requests[1][1].body),presence)
})

test('SFU mode binds capacity and every signed occupancy entry',()=>{
  const sfu={...room,sfu:true,capacity:25,participants:[{...presence,sfu:true}]}
  assert.ok(isVoiceRoom(sfu))
  for(const patch of [{sfu:false},{capacity:4},{participants:[presence]}])assert.equal(isVoiceRoom({...sfu,...patch}),false)
  assert.equal(isVoiceRoom({...room,participants:[{...presence,sfu:true}]}),false)
})

test('SFU tokens require bounded admission, exact revision names and safe endpoint origins',async t=>{
  const access={channel_id:presence.channel_id,room_id:presence.room_id,revision:3,room:'hearth-'+presence.room_id+'-3',identity:presence.device_key+'-'+presence.incarnation,url:'wss://media.example',token:'eyheader.eypayload.signature',expires_at:Date.now()+60000}
  assert.ok(isSfuAccess(access));assert.ok(isSfuAccess({...access,url:'ws://127.0.0.1:7880'}))
  for(const patch of [{room:'wrong'},{revision:4},{identity:presence.device_key},{expires_at:Date.now()-1},{expires_at:Date.now()+66000},{token:'bad'},{url:'ws://media.example'},{url:'wss://user:key@media.example'},{url:'wss://media.example/?key=private'},{url:'wss://media.example/path'}])assert.equal(isSfuAccess({...access,...patch}),false)
  let request;const client=new HearthClient('http://127.0.0.1:1234')
  t.mock.method(globalThis,'fetch',async(input,init)=>{request=[String(input),init];return Response.json(access)})
  assert.deepEqual(await client.sfuAccess('session',presence.channel_id,presence.device_key,3),access)
  assert.ok(request[0].endsWith('/voice/'+presence.channel_id+'/'+presence.device_key+'/sfu?revision=3'));assert.equal(request[1].headers.Authorization,'Bearer session')
})

test('only loopback-authenticated backends can select local SFU signaling',async t=>{
  let access={channel_id:presence.channel_id,room_id:presence.room_id,revision:3,room:'hearth-'+presence.room_id+'-3',identity:presence.device_key+'-'+presence.incarnation,url:'wss://host.example/hearth-media',local_url:'ws://127.0.0.1:7880',token:'eyheader.eypayload.signature',expires_at:Date.now()+60000}
  t.mock.method(globalThis,'fetch',async()=>Response.json(access))
  assert.equal((await new HearthClient('http://127.0.0.1:8080').sfuAccess('session',presence.channel_id,presence.device_key,3)).url,access.local_url)
  const remote=new HearthClient('https://host.example')
  assert.equal((await remote.sfuAccess('session',presence.channel_id,presence.device_key,3)).url,access.url)
  access={...access,url:access.local_url};await assert.rejects(remote.sfuAccess('session',presence.channel_id,presence.device_key,3),/public encrypted media/)
  assert.equal(isSfuAccess({...access,local_url:'ws://192.168.1.2:7880'}),false)
})
