import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DirectCall,idleCall} from '../src/media/direct-call.ts'
import {RecoveryHandshake} from '../src/media/call-recovery.ts'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
// Seed an already-consented call; network/media APIs are fakes for cancellation
// and authorization tests. Actual ICE/SFrame playback is exercised by test:calls.
function fixture(authorize=async()=>({})){
  let locked,receiving,offers=0,captures=0,keys=0,terminated=false
  const sent=[],track={readyState:'live',enabled:true,stop(){this.readyState='ended'}}
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]}
  const transport={callDevice:'a'.repeat(64),callAccount:'c'.repeat(64),authorizeCall:authorize,callKey:async()=>{keys++;throw new Error('Recovery must reuse keys')},send:async(_,content)=>{sent.push(content.signal);return 'sent'},onCall:(receive,lock)=>{receiving=receive;locked=lock;return()=>{}}}
  const call=new DirectCall(transport,()=>{},async()=>{captures++;throw new Error('Recovery must reuse capture')})
  const offer={call_id:'d'.repeat(64),epoch:1,from_device:transport.callDevice,to_device:'b'.repeat(64),kind:'offer',description:'v=0\r\n',expires_at:Date.now()+60_000,relay_only:false}
  const pc={connectionState:'connected',iceConnectionState:'connected',iceGatheringState:'complete',signalingState:'stable',localDescription:{type:'offer',sdp:offer.description},
    async createOffer(){offers++;return {type:'offer',sdp:'v=0\r\na=ice-ufrag:fresh\r\n'}},async setLocalDescription(description){this.localDescription=description;this.signalingState='have-local-offer'},close(){this.connectionState='closed'}}
  Object.assign(call,{offer,pc,active:true,established:true,recovery:new RecoveryHandshake(false),worker:{terminate(){terminated=true}},streams:new Set([stream]),state:{...idleCall,phase:'connected',conversation:'conversation',local:stream}})
  call.diagnostics=async()=>({decrypted:10})
  return {call,track,offer,pc,sent,lock:()=>locked('conversation'),receive:signal=>receiving({signal,conversation_id:'conversation',account_id:'peer'}),counts:()=>({offers,captures,keys,terminated})}
}
test('permission denial ends recovery and stops capture before renegotiation',async()=>{
  const f=fixture(async()=>{throw new Error('Not authorized')})
  try{await assert.rejects(f.call.reconnect());assert.equal(f.call.state.phase,'ended');assert.equal(f.track.readyState,'ended');assert.deepEqual(f.counts(),{offers:0,captures:0,keys:0,terminated:true})}finally{f.call.close()}
})

test('group controls and mesh envelopes cannot change an existing one-to-one call',async()=>{
  const f=fixture()
  try{
    for(const patch of [{group_id:'e'.repeat(64)},{participants:['a','b','c']},{kind:'group-leave'}]){
      f.receive({...f.offer,from_device:f.offer.to_device,to_device:f.offer.from_device,kind:'hangup',description:null,...patch})
      await tick();assert.equal(f.call.state.phase,'connected');assert.equal(f.track.readyState,'live')
    }
  }finally{f.call.close()}
})
test('an epoch change stops a stalled recovery and late authorization cannot revive it',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
  const pending=f.call.reconnect();const rejected=assert.rejects(pending)
  try{await tick();f.lock();assert.equal(f.track.readyState,'ended');release({});await rejected;assert.equal(f.call.state.phase,'ended');assert.match(f.call.state.message,/Encryption/);assert.equal(f.counts().offers,0)}finally{f.call.close()}
})
test('hangup stops capture immediately while restart authorization is stalled',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
  const pending=f.call.reconnect();const rejected=assert.rejects(pending)
  try{await tick();await f.call.hangup();assert.equal(f.track.readyState,'ended');release({});await rejected;assert.equal(f.call.state.phase,'ended');assert.equal(f.counts().offers,0);assert.equal(f.sent.at(-1).kind,'hangup')}finally{f.call.close()}
})
test('the independent recovery deadline ends capture even when authorization never returns',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:1_000})
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
  const pending=f.call.reconnect();const rejected=assert.rejects(pending)
  try{await tick();t.mock.timers.tick(20_001);assert.equal(f.call.state.phase,'ended');assert.equal(f.track.readyState,'ended');assert.match(f.call.state.message,/timed out/);release({});await rejected}finally{f.call.close()}
})
test('an unknown answer or a restart from another call or epoch cannot complete recovery',async()=>{
  const f=fixture()
  try{
    await f.call.reconnect();const id=f.call.recovery.pending
    for(const changed of [{call_id:'f'.repeat(64)},{epoch:2},{from_device:'f'.repeat(64)},{relay_only:true},{}]){
      f.receive({...f.offer,from_device:f.offer.to_device,to_device:f.offer.from_device,kind:'answer',description:'v=0\r\na=x-hearth-restart:'+'e'.repeat(64)+'\r\n',...changed});await tick()
      assert.equal(f.call.recovery.pending,id);assert.equal(f.call.state.phase,'reconnecting')
    }
  }finally{f.call.close()}
})
