import assert from 'node:assert/strict'
import {test} from 'node:test'
import {GroupCall,idleGroup,groupEdgeId} from '../src/media/group-call.ts'
import {GroupMembership} from '../src/media/group-membership.ts'
import {groupContext} from '../src/media/group-admission.ts'
const id=char=>char.repeat(64),devices=[id('a'),id('b'),id('c')],accounts=[id('1'),id('2'),id('3')],fake='04'+'ab'.repeat(64)
const conversation={id:id('4'),epoch:1,accounts,members:devices.map((device_key,index)=>({account_id:accounts[index],enrollment:{device_key}}))}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
globalThis.isSecureContext=true;globalThis.RTCPeerConnection=class {};globalThis.Worker=class {};globalThis.RTCRtpScriptTransform=class {}
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{throw new Error('Real capture forbidden')}}},configurable:true})
class Track {constructor(kind='audio'){this.kind=kind}enabled=true;readyState='live';onended=null;stop(){this.readyState='ended'}clone(){const copy=new Track(this.kind);copy.enabled=this.enabled;return copy}}
class Stream {constructor(tracks){this.tracks=tracks}getTracks(){return this.tracks}getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio')}getVideoTracks(){return this.tracks.filter(track=>track.kind==='video')}}
globalThis.MediaStream=Stream
function fixture(authorize=async()=>conversation,capture=async()=>new Stream([new Track()]),available=()=>true){
  let lock,epoch,receiving,captures=0,authorizations=0,removed=false
  const sent=[],transport={callDevice:devices[0],callAccount:accounts[0],authorizeGroupCall:async(...args)=>{authorizations++;return authorize(...args)},authorizeCall:async()=>{throw new Error('Wrong authorization mode')},callKey:async()=>{throw new Error('Unexpected key export')},send:async(_,content)=>{sent.push(content.signal);return 'sent'},onCall:(listener,locked,changed)=>{receiving=listener;lock=locked;epoch=changed;return()=>{removed=true}}}
  const call=new GroupCall(transport,id('5'),()=>{},async(...args)=>{captures++;return capture(...args)},available)
  function seed(){
    const c=groupContext(id('5'),conversation,id('6'),devices[0],devices),rooms=devices.map(device=>new GroupMembership(c,device))
    for(const signal of [...rooms[0].invite(fake),...rooms[1].answer(fake)])for(const room of rooms)if(room.own!==signal.from_device)room.receive(signal)
    Object.assign(call,{active:true,room:rooms[0],current:conversation,authAt:Date.now(),created:Date.now(),state:{...idleGroup,phase:'connecting',conversation:conversation.id,participants:devices.map((device,index)=>({device,account:accounts[index],phase:'Joined',remote:null}))}})
    return rooms
  }
  return {call,seed,sent,receive:signal=>receiving({conversation_id:conversation.id,account_id:accounts[1],signal}),lock:()=>lock(),epoch:()=>epoch(conversation.id),captures:()=>captures,authorizations:()=>authorizations,removed:()=>removed}
}
test('one shared microphone source supplies independent clones and late capture is stopped after leaving',async()=>{
  let release;const f=fixture(undefined,()=>new Promise(resolve=>{release=resolve})),[room]=f.seed()
  try{
    const first=f.call.microphone(room),second=f.call.microphone(room);await tick();assert.equal(f.captures(),1)
    const source=new Stream([new Track()]);release(source);const [a,b]=await Promise.all([first,second])
    assert.notEqual(a.getAudioTracks()[0],b.getAudioTracks()[0]);assert.notEqual(a.getAudioTracks()[0],source.getAudioTracks()[0])
    a.getTracks().forEach(track=>track.stop());b.getTracks().forEach(track=>track.stop());f.call.hangup();assert.equal(source.getTracks()[0].readyState,'ended')
  }finally{f.call.close()}
  let later;const g=fixture(undefined,()=>new Promise(resolve=>{later=resolve})),[pendingRoom]=g.seed()
  try{const pending=g.call.microphone(pendingRoom);await tick();g.call.hangup();const source=new Stream([new Track()]);later(source);await assert.rejects(pending);assert.equal(source.getTracks()[0].readyState,'ended')}finally{g.call.close()}
})

test('a future-transcript offer survives an intermediate mesh and is delivered only after its prerequisite member arrives',async()=>{
  const f=fixture(),rooms=f.seed(),room=rooms[0],received=[]
  const partial=await groupEdgeId(room.context,devices[0],devices[1],room.transcript())
  const third=rooms[2].answer(fake)
  // Use a fork of the real two-person transcript to calculate the final edge.
  const completed=room.transcript().map(row=>row[0]===devices[2]?[devices[2],fake,'1']:row)
  const full=await groupEdgeId(room.context,devices[0],devices[1],completed)
  assert.notEqual(partial,full)
  const offer={call_id:full,group_id:room.context.id,participants:devices,epoch:room.context.epoch,from_device:devices[1],to_device:devices[0],kind:'offer',description:'synthetic future offer',relay_only:false,expires_at:Date.now()+60000}
  const edge={id:partial,listener:event=>received.push(event),call:{close(){}}}
  f.call.edges.set(devices[1],edge);f.call.meshReady=true
  try{
    f.receive(offer);await tick();assert.equal(f.call.pending.length,1)
    for(let index=0;index<5;index++)f.call.deliverPending(room)
    assert.equal(f.call.pending.length,1);assert.equal(received.length,0)
    f.receive(offer);await tick();assert.equal(f.call.pending.length,1)
    for(const signal of third)room.receive(signal)
    edge.id=await groupEdgeId(room.context,devices[0],devices[1],room.transcript());assert.equal(edge.id,full)
    f.call.deliverPending(room);assert.equal(f.call.pending.length,0);assert.equal(received.length,1);assert.equal(f.captures(),0)
  }finally{f.call.close()}
})

test('pending descriptions reject stale contexts and retain the unchanged eight-description bound',async()=>{
  const f=fixture(),[room]=f.seed()
  const event=patch=>({conversation_id:conversation.id,account_id:accounts[1],signal:{call_id:id('7'),group_id:room.context.id,participants:devices,epoch:1,from_device:devices[1],to_device:devices[0],kind:'offer',description:'synthetic offer',relay_only:false,expires_at:Date.now()+60000,...patch}})
  try{
    f.call.pending=[event({epoch:0}),event({expires_at:Date.now()-1})];f.call.deliverPending(room);assert.equal(f.call.pending.length,0)
    for(let index=0;index<8;index++)f.call.retainDescription(event({description:String(index)}))
    assert.equal(f.call.pending.length,8);f.call.retainDescription(event({description:'overflow'}));assert.equal(f.call.state.phase,'ended')
  }finally{f.call.close()}
})
test('lock stops capture; an epoch pauses originals, destroys old senders and bounds recovery',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000})
  for(const operation of ['lock','epoch']){
    const f=fixture();f.seed();const original=new Track(),clone=new Track()
    Object.assign(f.call,{source:new Stream([original]),edges:new Map([[devices[1],{call:{close(){clone.stop()}}}]])})
    try{
      f[operation]();assert.equal(clone.readyState,'ended')
      if(operation==='epoch'){
        assert.equal(original.readyState,'live');assert.equal(original.enabled,false);assert.equal(f.call.keys,null);assert.equal(f.call.state.phase,'reconnecting')
        t.mock.timers.tick(30_001);f.call.watch();await tick()
      }
      assert.equal(original.readyState,'ended');assert.equal(f.call.state.phase,'ended')
    }finally{f.call.close()}
  }
})
test('fresh permission denial blocks capture and an independent watchdog closes stalled authorization',async t=>{
  const denied=fixture(async()=>{throw new Error('revoked')}),[room]=denied.seed();denied.call.authAt=Date.now()-3000
  try{await assert.rejects(denied.call.microphone(room));assert.equal(denied.captures(),0)}finally{denied.call.close()}
  t.mock.timers.enable({apis:['Date'],now:1_000});let release
  const stalled=fixture(()=>new Promise(resolve=>{release=resolve}));stalled.seed();const track=new Track();stalled.call.source=new Stream([track])
  try{t.mock.timers.tick(11_000);stalled.call.watch();await tick();t.mock.timers.tick(15_000);stalled.call.watch();assert.equal(track.readyState,'ended');release(conversation);await tick();assert.equal(stalled.call.state.phase,'ended')}finally{stalled.call.close()}
})
test('hangup during initial authorization cannot send a late invitation or start capture',async()=>{
  let release;const f=fixture(()=>new Promise(resolve=>{release=resolve}))
  try{const pending=f.call.start(conversation.id,devices);await tick();f.call.hangup();release(conversation);await pending;assert.equal(f.captures(),0);assert.equal(f.sent.length,0);assert.equal(f.call.state.phase,'ended')}finally{f.call.close()}
})
test('being left alone releases pending capture while keeping the call open',async()=>{
  let release;const f=fixture(undefined,()=>new Promise(resolve=>{release=resolve})),rooms=f.seed()
  try{
    const pending=f.call.microphone(rooms[0]);await tick();for(const signal of rooms[1].stop())rooms[0].receive(signal)
    f.call.membershipChanged(rooms[0]);const track=new Track();release(new Stream([track]));await assert.rejects(pending)
    assert.equal(track.readyState,'ended');assert.equal(f.call.busy,true);assert.equal(f.call.state.phase,'outgoing')
  }finally{f.call.close()}
})
test('a retired room cannot ring again and concurrent 1:1 activity blocks group startup',async()=>{
  const f=fixture();const rooms=f.seed();f.call.hangup();const count=f.authorizations()
  try{f.receive({...rooms[1].context,group_id:id('6'),call_id:id('6'),from_device:devices[1],to_device:devices[0],participants:devices,epoch:1,relay_only:false,kind:'group-invite',description:null,expires_at:Date.now()+60_000});await tick();assert.equal(f.authorizations(),count);assert.equal(f.call.state.phase,'ended')}finally{f.call.close();assert.equal(f.removed(),true)}
  const busy=fixture(undefined,undefined,()=>false)
  try{await assert.rejects(busy.call.start(conversation.id,devices));assert.equal(busy.authorizations(),0);assert.equal(busy.captures(),0)}finally{busy.call.close()}
})

test('a rejected answer from an obsolete peer generation cannot end the continuing call',async()=>{
  const f=fixture(),[room]=f.seed();let reject
  const pending=new Promise((_,fail)=>{reject=fail})
  f.call.edges.set(devices[1],{answering:false,call:{answer:()=>pending,close(){}}})
  try{
    f.call.edgeChanged(room,devices[1],{phase:'incoming',remote:null});f.call.meshVersion++
    reject(new Error('superseded'));await tick();assert.equal(f.call.busy,true);assert.notEqual(f.call.state.phase,'ended')
  }finally{f.call.close()}
})
test('obsolete frame diagnostics cannot report a new membership connected or end it',async()=>{
  const f=fixture(),[room]=f.seed();let resolve
  f.call.membershipAt=room.generation
  f.call.edges.set(devices[1],{call:{state:{phase:'connected'},diagnostics:()=>new Promise(done=>{resolve=done}),close(){}}})
  try{
    f.call.watch();f.call.meshVersion++;f.call.state.phase='connecting';resolve({decrypted:20});await tick()
    assert.equal(f.call.busy,true);assert.equal(f.call.state.phase,'connecting')
  }finally{f.call.close()}
})

test('leaving retains only public rejoin state and releases the active call slot and microphone',async()=>{
  const f=fixture(),[room]=f.seed(),source=await f.call.microphone(room)
  try{
    source.getTracks().forEach(track=>track.stop());f.call.hangup()
    assert.equal(f.call.busy,false);assert.equal(f.call.state.canRejoin,true);assert.equal(f.call.room,null);assert.equal(f.call.keys,null);assert.equal(f.call.source,null)
    assert.equal(f.call.parked.room.hasConsent,false);assert.throws(()=>room.transcript())
    const before=f.captures();f.call.watch();assert.equal(f.captures(),before)
    f.lock();assert.equal(f.call.state.canRejoin,false);assert.equal(f.call.parked,null)
  }finally{f.call.close()}
})

test('expired or departed peers remove rejoin availability without capture',()=>{
  const f=fixture(),rooms=f.seed()
  try{
    f.call.hangup();assert.equal(f.call.state.canRejoin,true)
    for(const signal of rooms[1].leave())rooms[0].receive(signal)
    f.call.watch();assert.equal(f.call.state.canRejoin,false);assert.equal(f.call.parked,null);assert.equal(f.captures(),0)
  }finally{f.call.close()}
})

test('rejoin rechecks authorization and cancelled authorization cannot reuse the previous membership object',async()=>{
  let release,allow=true
  const f=fixture(async()=>{if(allow)return conversation;return new Promise(resolve=>{release=resolve})}),[old]=f.seed()
  try{
    f.call.hangup();allow=false;const pending=f.call.rejoin();await tick()
    assert.notEqual(f.call.room,old);assert.equal(old.stopped,true);assert.equal(f.call.room.hasConsent,false)
    f.call.hangup();release(conversation);await assert.rejects(pending)
    assert.equal(f.captures(),0);assert.equal(f.call.keys,null);assert.equal(f.call.busy,false)
  }finally{f.call.close()}
  const denied=fixture(async()=>{throw new Error('revoked')});denied.seed()
  try{denied.call.hangup();await assert.rejects(denied.call.rejoin());assert.equal(denied.call.state.canRejoin,false);assert.equal(denied.captures(),0)}finally{denied.call.close()}
})

test('old microphone grants are stopped after leave and cannot supply a resumed membership',async()=>{
  let release;const f=fixture(undefined,()=>new Promise(resolve=>{release=resolve})),[room]=f.seed()
  try{
    const pending=f.call.microphone(room);await tick();f.call.hangup()
    const next=f.call.parked.room.resume();f.call.forgetParked()
    Object.assign(f.call,{active:true,room:next});const track=new Track();release(new Stream([track]))
    await assert.rejects(pending);assert.equal(track.readyState,'ended');assert.equal(f.call.source,null)
  }finally{f.call.close()}
})

test('mesh authorization requests share one bounded grant and renew after its two-second window',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});let release
  const f=fixture(()=>new Promise(resolve=>{release=resolve})),[room]=f.seed()
  try{
    f.call.authAt=-3000
    const first=f.call.authorize(room,undefined,2000),second=f.call.authorize(room,undefined,2000)
    assert.equal(f.authorizations(),1);release(conversation);await Promise.all([first,second])
    await f.call.authorize(room,undefined,2000);assert.equal(f.authorizations(),1)
    t.mock.timers.tick(2001);const next=f.call.authorize(room,undefined,2000)
    assert.equal(f.authorizations(),2);release(conversation);await next
  }finally{f.call.close()}
})

test('leaving after peer expiry does not retain an empty observer timer',t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});const f=fixture();f.seed()
  try{t.mock.timers.tick(31_000);f.call.hangup();assert.equal(f.call.state.canRejoin,false);assert.equal(f.call.parked,null);assert.equal(f.call.timer,undefined)}finally{f.call.close()}
})

test('private group camera/screen share owned sources and stop computer audio independently',async()=>{
  const f=fixture(async()=>conversation,async()=>new Stream([new Track('video')])),[room]=f.seed(),clones=[]
  const video=new Track('video'),system=new Track('audio')
  Object.assign(f.call,{membershipAt:room.generation,state:{...f.call.state,phase:'connected'},displayCapture:async()=>new Stream([video,system])})
  f.call.watch=()=>{}
  for(const device of devices.slice(1))f.call.edges.set(device,{call:{state:{phase:'connected'},async setRoomVideo(kind,track){for(const item of clones.filter(item=>item.device===device&&item.kind===kind))item.track.stop();if(track)clones.push({device,kind,track})},close(){for(const item of clones.filter(item=>item.device===device))item.track.stop()}}})
  try{
    await f.call.video('camera');await f.call.video('screen',true)
    assert.equal(f.call.state.camera,true);assert.equal(f.call.state.systemAudio,true);assert.equal(clones.length,6)
    system.onended();system.stop();assert.equal(f.call.state.systemAudio,false);assert.equal(f.call.state.sharing,true);assert.equal(video.readyState,'live');assert.ok(clones.filter(item=>item.kind==='system').every(item=>item.track.readyState==='ended'))
    await f.call.video('screen');assert.equal(video.readyState,'ended');assert.equal(f.call.state.camera,true)
    f.call.hangup();assert.ok(clones.every(item=>item.track.readyState==='ended'))
  }finally{f.call.close()}
})

test('private group microphone switching preserves mute and rejects late permission grants',async()=>{
  let release,pending=false
  const fresh=new Track(),f=fixture(undefined,()=>pending?new Promise(resolve=>{release=resolve}):Promise.resolve(new Stream([fresh]))),[room]=f.seed(),old=new Track(),clones=[]
  Object.assign(f.call,{membershipAt:room.generation,source:new Stream([old]),state:{...f.call.state,phase:'connected',muted:true}})
  f.call.edges.set(devices[1],{call:{async setMicrophone(track){clones.push(track)},close(){clones.forEach(track=>track.stop())}}})
  try{
    await f.call.changeDevice('audio','chosen-mic');assert.equal(old.readyState,'ended');assert.equal(fresh.enabled,false);assert.equal(clones[0].enabled,false)
    pending=true;const changing=f.call.changeDevice('audio','late-mic');await tick();f.call.hangup();const late=new Track();release(new Stream([late]));await assert.rejects(changing);assert.equal(late.readyState,'ended');assert.equal(fresh.readyState,'ended')
  }finally{f.call.close()}
})

test('authenticated joined group heartbeat renews only its current child edge',async()=>{
  const f=fixture(),[room]=f.seed(),received=[],edgeId=id('9')
  f.call.edges.set(devices[1],{id:edgeId,listener:event=>received.push(event),call:{close(){}}})
  const control={call_id:room.context.id,group_id:room.context.id,participants:devices,epoch:1,from_device:devices[1],to_device:devices[0],relay_only:false,kind:'group-heartbeat',description:'00000001:000',expires_at:Date.now()+60000}
  try{
    f.receive(control);await tick();assert.equal(received.length,1);assert.equal(received[0].signal.kind,'heartbeat');assert.equal(received[0].signal.call_id,edgeId);assert.equal(received[0].signal.from_device,devices[1])
    f.receive({...control,epoch:2});await tick();assert.equal(received.length,1)
    f.receive({...control,from_device:devices[2]});await tick();assert.equal(received.length,1)
  }finally{f.call.close()}
})

test('an empty video restore does not request another grant or send a redundant media state',async()=>{
  const f=fixture(),[room]=f.seed(),before=f.authorizations()
  try{await f.call.restoreVideo(room,f.call.meshVersion);assert.equal(f.authorizations(),before);assert.equal(f.sent.length,0)}finally{f.call.close()}
})
