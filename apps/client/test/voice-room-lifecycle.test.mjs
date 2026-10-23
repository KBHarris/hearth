import assert from 'node:assert/strict'
import {test} from 'node:test'
import {VoiceRoomCall} from '../src/media/voice-room.ts'
import {VoiceMembership,voiceContext} from '../src/media/voice-membership.ts'
import {Permission} from '@hearth/sdk'
const id=char=>char.repeat(64),own=id('a'),peer=id('b'),channel=id('1'),server=id('2'),roomId=id('3')
const conversation={id:channel,channel_id:channel,epoch:1,accounts:[id('4'),id('5')],members:[own,peer].map((device_key,index)=>({account_id:id(String(index+4)),enrollment:{device_key}}))}
globalThis.isSecureContext=true;globalThis.RTCPeerConnection=class {};globalThis.Worker=class {};globalThis.RTCRtpScriptTransform=class {}
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{throw new Error('Real capture forbidden')}}},configurable:true})
class Track {kind='audio';enabled=true;readyState='live';onended=null;stop(){this.readyState='ended'}clone(){return new Track()}}
class Stream {constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}getAudioTracks(){return this.tracks}getVideoTracks(){return []}}
globalThis.MediaStream=Stream
const tick=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(capture=async()=>new Stream([new Track()]),available=()=>true){
  let locked,epoch,receiving,captures=0
  const snapshot={channel_id:channel,room_id:roomId,epoch:1,revision:1,capacity:4,relay_only:false,participants:[]},sent=[]
  const transport={callDevice:own,callAccount:id('4'),voiceRoom:async()=>({room:{...snapshot,participants:[...snapshot.participants]},conversation}),voicePresence:async presence=>{sent.push(presence);snapshot.revision++;snapshot.participants=presence.active?[presence]:[];return {room:{...snapshot,participants:[...snapshot.participants]},conversation}},callKey:async()=>{throw new Error('Unexpected key export')},send:async()=>{throw new Error('Unexpected signaling')},onCall:(listener,lock,changed)=>{receiving=listener;locked=lock;epoch=changed;return()=>{}}}
  const call=new VoiceRoomCall(transport,server,()=>{},async(...args)=>{captures++;return capture(...args)},available)
  return {call,transport,snapshot,sent,captures:()=>captures,lock:()=>locked(),epoch:()=>epoch(channel),receive:signal=>receiving({conversation_id:channel,account_id:id('5'),signal})}
}
async function seedAudio(f){
  await f.call.join(channel)
  const room={...f.snapshot,participants:[...f.snapshot.participants,{...f.snapshot.participants[0],device_key:peer,incarnation:id('c')}]}
  f.call.admission=new VoiceMembership(await voiceContext(server,room),own,room)
  f.call.refresh=async()=>{}
}
test('joining an empty persistent room holds no microphone; leaving frees the call slot and fresh consent changes the incarnation',async()=>{
  const f=fixture()
  try{await f.call.join(channel);assert.equal(f.call.state.phase,'waiting');assert.equal(f.captures(),0);const first=f.sent[0]
    f.call.leave();assert.equal(f.call.busy,false);assert.equal(f.call.contribution,null)
    await f.call.join(channel);const joined=f.sent.filter(presence=>presence.active)
    assert.equal(joined.length,2);assert.notEqual(joined[1].incarnation,first.incarnation);assert.notEqual(joined[1].public_key,first.public_key);assert.equal(f.captures(),0)
  }finally{f.call.close()}
})
test('leaving and lock stop original and edge tracks synchronously; late grants are discarded',async()=>{
  for(const operation of ['leave','lock']){
    const f=fixture();await seedAudio(f);const stream=await f.call.microphone(),source=f.call.source.getTracks()[0],clone=stream.getTracks()[0]
    f.call.edges.set(peer,{call:{setRoomVideo:async()=>{},close(){clone.stop()}}})
    try{operation==='leave'?f.call.leave():f[operation]();assert.equal(source.readyState,'ended');assert.equal(clone.readyState,'ended');assert.equal(f.call.agreement,null);assert.equal(f.call.contribution,null)}finally{f.call.close()}
  }
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}));await seedAudio(f)
  try{const pending=f.call.microphone();await tick();f.call.leave();const track=new Track();release(new Stream([track]));await assert.rejects(pending);assert.equal(track.readyState,'ended')}finally{f.call.close()}
})
test('capture is blocked before consent, denied authorization and another active call',async()=>{
  const f=fixture()
  try{await assert.rejects(f.call.microphone());f.transport.voiceRoom=async()=>{throw new Error('denied')};await assert.rejects(f.call.join(channel));assert.equal(f.captures(),0);assert.equal(f.call.busy,false)}finally{f.call.close()}
  const busy=fixture(undefined,()=>false)
  try{await assert.rejects(busy.call.join(channel));assert.equal(busy.sent.length,0);assert.equal(busy.captures(),0)}finally{busy.call.close()}
})
test('an MLS transition pauses originals, stops sender clones and ends capture if recovery exceeds its deadline',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});const f=fixture();await seedAudio(f)
  const stream=await f.call.microphone(),source=f.call.source.getTracks()[0],clone=stream.getTracks()[0]
  f.call.edges.set(peer,{call:{close(){clone.stop()}}});f.transport.voiceRoom=()=>new Promise(()=>{})
  try{f.epoch();assert.equal(source.readyState,'live');assert.equal(source.enabled,false);assert.equal(clone.readyState,'ended');assert.equal(f.call.state.phase,'connecting');t.mock.timers.tick(31000);f.call.watch();assert.equal(source.readyState,'ended');assert.equal(f.call.busy,false)}finally{f.call.close()}
})
test('listen-only admission and a later permission grant never acquire a microphone without new speaking consent',async()=>{
  const f=fixture();await seedAudio(f)
  try{f.call.permissions.set(own,Permission.connect|Permission.listen);await assert.rejects(f.call.microphone());assert.equal(f.captures(),0)
    f.call.permissions.set(own,31744);f.call.speakConsent=false;await assert.rejects(f.call.microphone());assert.equal(f.captures(),0)
    f.call.state.phase='connected';const published=[];f.call.sfu={publish:async(_,track)=>{if(track)published.push(track)},close(){published.forEach(track=>track.stop())}}
    await f.call.startSpeaking();assert.equal(f.captures(),1);assert.equal(f.call.speaking,true);assert.equal(published.length,1)
  }finally{f.call.close()}
})

test('authorization lost during a microphone prompt stops the granted source before returning a clone',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}));await seedAudio(f)
  try{
    const pending=f.call.microphone();await tick()
    f.call.refresh=async()=>{throw new Error('revoked')}
    const track=new Track();release(new Stream([track]));await assert.rejects(pending)
    assert.equal(track.readyState,'ended');assert.equal(f.call.busy,false)
  }finally{f.call.close()}
})
test('a stalled authorization cannot keep capture open beyond the independent watchdog',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});const f=fixture();await seedAudio(f)
  try{await f.call.microphone();const track=f.call.source.getTracks()[0];t.mock.timers.tick(26000);f.call.watch();assert.equal(track.readyState,'ended');assert.equal(f.call.busy,false)}finally{f.call.close()}
})

test('transient signaling pauses capture for bounded recovery, while denied access still stops it',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000})
  for(const denied of [false,true]){
    const f=fixture();await seedAudio(f);await f.call.microphone();const track=f.call.source.getTracks()[0]
    f.call.edges.set(peer,{call:{state:{phase:'connecting'},setRoomVideo:async()=>{},close(){}}});f.call.lastHeartbeat=Date.now();f.call.renewedAt=Date.now()
    f.call.refresh=async()=>{throw Object.assign(new Error('fixture'),denied?{status:403}:{kind:'timeout'})};f.transport.voiceRoom=()=>new Promise(()=>{})
    try{t.mock.timers.tick(6000);f.call.watch();await tick()
      if(denied){assert.equal(track.readyState,'ended');assert.equal(f.call.busy,false)}
      else{assert.equal(track.enabled,false);assert.equal(track.readyState,'live');assert.equal(f.call.state.phase,'connecting');t.mock.timers.tick(31000);f.call.watch();assert.equal(track.readyState,'ended');assert.equal(f.call.busy,false)}
    }finally{f.call.close()}
  }
})
test('cancelled initial authorization cannot publish presence or reacquire capture',async()=>{
  const f=fixture();let release
  f.transport.voiceRoom=()=>new Promise(resolve=>{release=resolve})
  try{const pending=f.call.join(channel);await tick();f.call.leave();release({room:f.snapshot,conversation});await assert.rejects(pending);assert.equal(f.sent.length,0);assert.equal(f.captures(),0);assert.equal(f.call.contribution,null)}finally{f.call.close()}
})

test('a key-exchange authorization timeout enters bounded recovery; a forbidden key exchange stops capture',async()=>{
  for(const denied of [false,true]){
    const f=fixture();await seedAudio(f);await f.call.microphone();const track=f.call.source.getTracks()[0]
    f.call.sfu={close(){},publish:async()=>{}};f.call.sfuKeys={close(){},receive:async()=>{throw new Error('Unverified key must not be installed')}}
    f.call.matches=()=>true;f.call.refresh=async()=>{throw Object.assign(new Error('fixture'),denied?{status:403}:{kind:'timeout'})};f.transport.voiceRoom=()=>new Promise(()=>{})
    try{f.call.receiveSfu({kind:'sfu-key',expires_at:Date.now()+60000},f.call.mesh);await f.call.sfuSerial
      assert.equal(track.readyState,denied?'ended':'live');assert.equal(f.call.state.phase,denied?'ended':'connecting');if(!denied)assert.equal(track.enabled,false)
    }finally{f.call.close()}
  }
})

test('one authenticated room heartbeat advances only its sender edge and rejects another room context',async()=>{
  const f=fixture();await seedAudio(f);const received=[]
  const context=f.call.admission.context
  f.call.edges.set(peer,{id:id('8'),listener:event=>received.push(event),call:{setRoomVideo:async()=>{},close(){}}})
  const signal={call_id:context.id,group_id:context.id,voice_room:roomId,epoch:1,participants:context.participants,from_device:peer,to_device:own,kind:'room-heartbeat',description:null,relay_only:false,expires_at:Date.now()+60000}
  try{
    f.receive(signal);assert.equal(received.length,1);assert.equal(received[0].signal.call_id,id('8'));assert.equal(received[0].signal.kind,'heartbeat')
    f.receive({...signal,group_id:id('9')});f.receive({...signal,voice_room:id('9')});f.receive({...signal,call_id:id('9')});f.receive({...signal,expires_at:Date.now()-1});f.receive({...signal,expires_at:Date.now()+66000});assert.equal(received.length,1)
  }finally{f.call.close()}
})
