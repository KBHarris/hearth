import assert from 'node:assert/strict'
import {test} from 'node:test'
import {VoiceRoomCall,idleVoice} from '../src/media/voice-room.ts'
import {DirectCall,idleCall} from '../src/media/direct-call.ts'

const tick=()=>new Promise(resolve=>setImmediate(resolve)),own='a'.repeat(64),peer='b'.repeat(64)
class Track {constructor(kind='video'){this.kind=kind}readyState='live';onended=null;stop(){this.readyState='ended'}clone(){return new Track(this.kind)}}
class Stream {constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video')}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio')}}
globalThis.MediaStream=Stream
function fixture(capture=async()=>new Stream([new Track()])){
  let captures=0,authorize=async()=>{},locked,epoch
  const clones=[],sources=[],context={id:'c'.repeat(64),conversation:'channel',voiceRoom:'d'.repeat(64),participants:[own,peer],epoch:1,relayOnly:false}
  const transport={callDevice:own,onCall:(_,lock,changed)=>{locked=lock;epoch=changed;return()=>{}},voicePresence:async()=>{}}
  const call=new VoiceRoomCall(transport,'server',()=>{},async constraints=>{captures++;const stream=await capture(constraints);sources.push(stream);return stream},()=>true,async()=>{captures++;const stream=await capture({screen:true});sources.push(stream);return stream})
  Object.assign(call,{active:true,created:Date.now(),checkedAt:Date.now(),admission:{context,canPublish:true,stopped:false,end(){}},state:{...idleVoice,phase:'connected',channel:'channel'}})
  call.refresh=()=>authorize();call.watch=()=>{}
  call.edges.set(peer,{call:{state:{phase:'connected'},async setRoomVideo(kind,track){clones.filter(item=>item.kind===kind).forEach(item=>item.track.stop());if(track)clones.push({kind,track})},close(){clones.forEach(item=>item.track.stop())}}})
  return {call,clones,sources,captures:()=>captures,setAuthorize:fn=>{authorize=fn},lock:()=>locked(),epoch:()=>epoch('channel')}
}

test('camera and screen each capture once, publish clones and can stop independently without ending room audio',async()=>{
  const f=fixture()
  try{
    await f.call.video('camera');await f.call.video('screen')
    assert.equal(f.captures(),2);assert.equal(f.clones.length,2)
    assert.equal(f.call.state.camera,true);assert.equal(f.call.state.sharing,true)
    await f.call.video('camera');assert.equal(f.sources[0].getTracks()[0].readyState,'ended');assert.equal(f.clones[0].track.readyState,'ended')
    assert.equal(f.sources[1].getTracks()[0].readyState,'live');assert.equal(f.call.state.sharing,true);assert.equal(f.call.busy,true)
    f.sources[1].getTracks()[0].onended();assert.equal(f.call.state.sharing,false);assert.equal(f.clones[1].track.readyState,'ended')
  }finally{f.call.close()}
})

test('leave and lock stop camera/screen originals and every sender clone synchronously',async()=>{
  for(const action of ['leave','lock']){
    const f=fixture()
    try{await f.call.video('camera');await f.call.video('screen');if(action==='leave')f.call.leave();else f[action]();assert.ok(f.sources.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'));assert.ok(f.clones.every(c=>c.track.readyState==='ended'));assert.equal(f.call.state.camera,false);assert.equal(f.call.state.sharing,false)}finally{f.call.close()}
  }
})
test('epoch changes synchronously pause camera and screen originals and remove every old sender clone',async()=>{
  const f=fixture();f.call.transport.voiceRoom=()=>new Promise(()=>{})
  try{await f.call.video('camera');await f.call.video('screen');f.epoch();assert.ok(f.sources.flatMap(stream=>stream.getTracks()).every(track=>track.readyState==='live'&&track.enabled===false));assert.ok(f.clones.every(clone=>clone.track.readyState==='ended'));assert.equal(f.call.state.phase,'connecting')}finally{f.call.close()}
})

test('canceling a pending camera prompt discards a late grant and permits a fresh explicit attempt',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>{resolve=done}))
  try{
    const pending=f.call.video('camera');await tick();assert.equal(f.call.state.cameraPending,true)
    await f.call.video('camera');const stale=new Track();resolve(new Stream([stale]));await pending
    assert.equal(stale.readyState,'ended');assert.equal(f.clones.length,0);assert.equal(f.call.state.camera,false)
    const retry=f.call.video('camera');await tick();const fresh=new Track();resolve(new Stream([fresh]));await retry
    assert.equal(f.call.state.camera,true);assert.equal(f.captures(),2)
  }finally{f.call.close()}
})

test('membership changes during a screen prompt discard the selection before any publication',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>{resolve=done}))
  try{const pending=f.call.video('screen');await tick();f.call.mesh++;f.call.stopVideo('screen');const stale=new Track();resolve(new Stream([stale]));await pending;assert.equal(stale.readyState,'ended');assert.equal(f.clones.length,0);assert.equal(f.call.state.sharing,false)}finally{f.call.close()}
})

test('authorization is required before capture and rechecked after a capture permission grant',async()=>{
  const f=fixture();f.setAuthorize(async()=>{throw new Error('denied')})
  try{await assert.rejects(f.call.video('camera'));assert.equal(f.captures(),0);assert.equal(f.call.busy,false)}finally{f.call.close()}
  let resolve;const g=fixture(()=>new Promise(done=>{resolve=done}))
  try{const pending=g.call.video('screen');await tick();g.setAuthorize(async()=>{throw new Error('revoked')});const track=new Track();resolve(new Stream([track]));await assert.rejects(pending);assert.equal(track.readyState,'ended');assert.equal(g.clones.length,0);assert.equal(g.call.busy,false)}finally{g.call.close()}
})

test('video permission denial preserves audio; unexpected captured audio stops all selected tracks',async()=>{
  const denied=fixture(async()=>{throw new Error('permission denied')})
  try{await assert.rejects(denied.call.video('camera'));assert.equal(denied.call.busy,true);assert.equal(denied.call.state.cameraPending,false)}finally{denied.call.close()}
  const video=new Track(),audio=new Track();audio.kind='audio';const f=fixture(async()=>new Stream([video,audio]))
  try{await assert.rejects(f.call.video('screen'));assert.equal(video.readyState,'ended');assert.equal(audio.readyState,'ended');assert.equal(f.clones.length,0);assert.equal(f.call.busy,true)}finally{f.call.close()}
})

test('explicit screen audio stops independently when the picker ends it and screen stop cleans up both slots',async()=>{
  const video=new Track(),audio=new Track('audio'),f=fixture(async()=>new Stream([video,audio]))
  try{
    await f.call.video('screen',true)
    assert.equal(f.call.state.systemAudio,true);assert.equal(f.clones.length,2)
    audio.stop();audio.onended()
    assert.equal(f.call.state.systemAudio,false);assert.equal(f.call.state.sharing,true)
    assert.equal(f.clones.find(item=>item.kind==='system').track.readyState,'ended');assert.equal(video.readyState,'live')
    await f.call.video('screen');assert.equal(video.readyState,'ended');assert.ok(f.clones.every(item=>item.track.readyState==='ended'))
  }finally{f.call.close()}
})

test('cancelled screen-audio selection discards every late track before publication',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>{resolve=done}))
  try{
    const pending=f.call.video('screen',true);await tick();await f.call.video('screen',true)
    const video=new Track(),audio=new Track('audio');resolve(new Stream([video,audio]));await pending
    assert.equal(video.readyState,'ended');assert.equal(audio.readyState,'ended');assert.equal(f.clones.length,0)
  }finally{f.call.close()}
})

test('an edge stops pending clones on leave and refuses publication before transform readiness or outside a room',async()=>{
  for(const room of [false,true]){
    let resolve,attached=0
    const call=new DirectCall({callDevice:own,onCall:()=>()=>{},authorizeCall:()=>new Promise(done=>{resolve=done})},()=>{},undefined,undefined,room?{voiceRoom:'room'}:undefined)
    const track=new Track(),offer={call_id:'call'}
    Object.assign(call,{active:true,offer,worker:{terminate(){}},state:{...idleCall,phase:'connected'},transceivers:[{}, {sender:{replaceTrack:async()=>{attached++}}}]})
    try{
      const pending=call.setRoomVideo('camera',track),rejected=assert.rejects(pending)
      if(room){await tick();call.close();assert.equal(track.readyState,'ended');resolve({})}
      await rejected;assert.equal(track.readyState,'ended');assert.equal(attached,0)
    }finally{call.close()}
  }
})
