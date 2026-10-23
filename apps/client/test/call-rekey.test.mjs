import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DirectCall,idleCall} from '../src/media/direct-call.ts'
const tick=()=>new Promise(resolve=>setImmediate(resolve)),id='d'.repeat(64)
function fixture(authorize=async()=>({}),caller=true,acknowledgePause=true){
  let epoch,receive,lock,decrypted=10,terminated=false,pauseId
  const ops=[],sent=[],track={readyState:'live',stop(){this.readyState='ended'}},stream={getTracks:()=>[track]}
  const worker=new EventTarget();worker.terminate=()=>{terminated=true}
  worker.postMessage=data=>{ops.push(data.op);if(data.op==='pause')pauseId=data.id;if(['install','resume'].includes(data.op)||data.op==='pause'&&acknowledgePause)queueMicrotask(()=>worker.dispatchEvent(new MessageEvent('message',{data:{op:data.op==='pause'?'paused':data.op==='install'?'installed':'resumed',id:data.id,decrypted:10}})))}
  const own='a'.repeat(64),peer='b'.repeat(64)
  const offer={call_id:'c'.repeat(64),epoch:1,from_device:caller?own:peer,to_device:caller?peer:own,kind:'offer',description:'pending',expires_at:Date.now()+60_000,relay_only:false}
  const call=new DirectCall({callDevice:own,callAccount:'account',authorizeCall:authorize,callKey:async()=> 'ab'.repeat(32),send:async(_,content)=>{sent.push(content.signal);return 'sent'},onCall:(received,locked,changed)=>{receive=received;lock=locked;epoch=changed;return()=>{}}},()=>{})
  Object.assign(call,{offer,active:true,established:true,started:Date.now(),worker,streams:new Set([stream]),pc:{localDescription:null,close(){}},state:{...idleCall,phase:'connected',conversation:'conversation',local:stream}})
  call.diagnostics=async()=>({decrypted})
  return {call,track,ops,sent,offer,ackPause:()=>worker.dispatchEvent(new MessageEvent('message',{data:{op:'paused',id:pauseId}})),paused:()=>epoch('conversation'),epoch:()=>epoch('conversation',2),lock:()=>lock(),frames:()=>{decrypted=20},terminated:()=>terminated,receive:(kind,description,changed={})=>receive({conversation_id:'conversation',account_id:'peer',signal:{...offer,kind,description,from_device:peer,to_device:own,...changed}})}
}
test('the publication barrier resolves only after the media worker acknowledges pause',async()=>{
  const f=fixture(undefined,true,false);let acknowledged=false
  try{const barrier=f.paused().then(()=>{acknowledged=true});await tick();assert.equal(acknowledged,false);assert.equal(f.call.state.phase,'rekeying');f.ackPause();await barrier;assert.equal(acknowledged,true)}finally{f.call.close()}
})
test('the epoch pre-notice pauses frames synchronously and denied membership ends capture',async()=>{
  const f=fixture(async()=>{throw new Error('revoked')})
  try{f.paused();assert.equal(f.ops[0],'pause');assert.equal(f.call.state.phase,'rekeying');f.epoch();await tick();assert.equal(f.call.state.phase,'ended');assert.equal(f.track.readyState,'ended');assert.equal(f.ops.includes('install'),false)}finally{f.call.close()}
})
test('a stalled key authorization cannot outlive its independent capture deadline',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:1_000})
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
  try{f.paused();f.epoch();await tick();t.mock.timers.tick(20_001);assert.equal(f.track.readyState,'ended');release({});await tick();assert.equal(f.ops.includes('resume'),false)}finally{f.call.close()}
})
test('both the matching handshake and fresh media are required before returning to connected',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:1_000})
  const f=fixture()
  try{
    f.paused();f.epoch();await tick();const transaction=f.sent[0].description
    f.receive('key-ready',id);await tick();assert.equal(f.ops.includes('resume'),false)
    f.receive('key-ready',transaction);await tick();assert.equal(f.ops.includes('resume'),true)
    f.frames();t.mock.timers.tick(500);await tick();assert.equal(f.call.state.phase,'rekeying')
    f.receive('key-done',transaction);await tick();t.mock.timers.tick(500);await tick()
    assert.equal(f.call.state.phase,'connected');assert.equal(f.track.readyState,'live');assert.equal(f.call.completedRekeys,1)
  }finally{f.call.close()}
})
test('session lock and a second epoch change cancel updates without late resumption',async()=>{
  for(const finish of ['lock','paused']){
    let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
    try{f.paused();f.epoch();await tick();f[finish]();assert.equal(f.track.readyState,'ended');release({});await tick();assert.equal(f.ops.includes('resume'),false);assert.equal(f.terminated(),true)}finally{f.call.close()}
  }
})
test('a completed transaction cannot pause or resume the call when replayed',async()=>{
  const f=fixture(undefined,false)
  try{f.call.retiredKeyUpdates.add(id);f.receive('key-offer',id);await tick();assert.equal(f.call.state.phase,'connected');assert.deepEqual(f.ops,[])}finally{f.call.close()}
})
