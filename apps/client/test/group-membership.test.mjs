import assert from 'node:assert/strict'
import {test} from 'node:test'
import {GroupMembership} from '../src/media/group-membership.ts'
import {GroupKeyAgreement,groupContext} from '../src/media/group-admission.ts'
import {groupEdgeId} from '../src/media/group-call.ts'
const id=char=>char.repeat(64),devices=[id('a'),id('b'),id('c')],base='de'.repeat(32),fake='04'+'ab'.repeat(64)
const context=()=>groupContext(id('1'),{id:id('2'),epoch:1,accounts:[id('3'),id('4'),id('5')],members:devices.map((device_key,index)=>({account_id:id(String(index+3)),enrollment:{device_key}}))},id('6'),devices[0],devices,true)
function fixture(){const c=context(),rooms=devices.map(device=>new GroupMembership(c,device));return {c,rooms,deliver(signals){for(const signal of signals)for(const room of rooms)if(room.own!==signal.from_device)room.receive(signal)}}}
async function cryptoFixture(){const f=fixture(),keys=await Promise.all(devices.map(device=>GroupKeyAgreement.create(f.c,device)));return {...f,keys,close(){f.rooms.forEach(room=>room.end('test'));keys.forEach(key=>key.close())}}}

test('one person answering connects the pair while the third has no media permission',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));assert.ok(f.rooms.every(room=>!room.canPublish))
  f.deliver(f.rooms[1].answer(fake));assert.equal(f.rooms[0].canPublish,true);assert.equal(f.rooms[1].canPublish,true);assert.equal(f.rooms[2].canPublish,false)
  assert.deepEqual(f.rooms[0].readyPeers,[devices[1]]);assert.throws(()=>f.rooms[2].transcript())
})
test('a late third participant joins independently; the original caller can leave without ending the other two',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));f.deliver(f.rooms[1].answer(fake));f.deliver(f.rooms[2].answer(fake))
  assert.ok(f.rooms.every(room=>room.canPublish));f.deliver(f.rooms[0].stop())
  assert.equal(f.rooms[0].stopped,true);assert.equal(f.rooms[1].stopped,false);assert.equal(f.rooms[2].stopped,false)
  assert.deepEqual(f.rooms[1].readyPeers,[devices[2]]);assert.deepEqual(f.rooms[2].readyPeers,[devices[1]])
})
test('declining an invitation does not end or rekey the already-connected pair',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));f.deliver(f.rooms[1].answer(fake));const before=f.rooms[0].transcript(),generation=f.rooms[0].generation
  f.deliver(f.rooms[2].stop());assert.equal(f.rooms[0].canPublish,true);assert.deepEqual(f.rooms[0].transcript(),before);assert.equal(f.rooms[0].generation,generation)
})
test('late public contributions cannot resurrect a participant who already left',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));f.deliver(f.rooms[1].answer(fake));const controls=f.rooms[2].answer(fake);f.deliver(controls);f.deliver(f.rooms[2].stop())
  const before=f.rooms[0].transcript(),generation=f.rooms[0].generation;f.deliver(controls)
  assert.deepEqual(f.rooms[0].transcript(),before);assert.equal(f.rooms[0].generation,generation);assert.equal(f.rooms[0].status(devices[2]),'Left')
})
test('join and leave produce fresh matching survivor pair keys without reusing pre-join keys',async()=>{
  const f=await cryptoFixture(),derived=[]
  try{
    f.deliver(f.rooms[0].invite(f.keys[0].publicKey));f.deliver(f.rooms[1].answer(f.keys[1].publicKey))
    const before=await f.keys[0].derive(f.rooms[0],devices[1],base);derived.push(before)
    const beforeEdge=await groupEdgeId(f.c,devices[0],devices[1],f.rooms[0].transcript())
    f.deliver(f.rooms[2].answer(f.keys[2].publicKey));const joined=await f.keys[0].derive(f.rooms[0],devices[1],base);derived.push(joined)
    assert.deepEqual(joined,await f.keys[1].derive(f.rooms[1],devices[0],base));assert.notDeepEqual(joined,before)
    const joinedEdge=await groupEdgeId(f.c,devices[0],devices[1],f.rooms[0].transcript());assert.notEqual(joinedEdge,beforeEdge)
    f.deliver(f.rooms[2].stop());const left=await f.keys[0].derive(f.rooms[0],devices[1],base);derived.push(left)
    assert.deepEqual(left,await f.keys[1].derive(f.rooms[1],devices[0],base));assert.notDeepEqual(left,before);assert.notDeepEqual(left,joined)
    assert.notEqual(await groupEdgeId(f.c,devices[0],devices[1],f.rooms[0].transcript()),beforeEdge)
    await assert.rejects(f.keys[2].derive(f.rooms[2],devices[0],base))
  }finally{derived.forEach(key=>key.fill(0));f.close()}
})
test('a membership change cancels in-flight derivation while preserving the continuing private contribution',async()=>{
  const f=await cryptoFixture()
  try{
    f.deliver(f.rooms[0].invite(f.keys[0].publicKey));f.deliver(f.rooms[1].answer(f.keys[1].publicKey))
    const pending=f.keys[0].derive(f.rooms[0],devices[1],base);f.deliver(f.rooms[2].answer(f.keys[2].publicKey));await assert.rejects(pending)
    assert.equal(f.rooms[0].stopped,false);const next=await f.keys[0].derive(f.rooms[0],devices[1],base);assert.equal(next.length,32);next.fill(0)
  }finally{f.close()}
})
test('missing peer heartbeats remove only that participant; being alone does not end a joined call',()=>{
  const f=fixture(),now=Date.now();f.deliver(f.rooms[0].invite(fake));f.deliver(f.rooms[1].answer(fake));f.deliver(f.rooms[2].answer(fake))
  f.rooms[0].receive({...f.rooms[1].heartbeat(now+20_000)[0],expires_at:now+80_000},now+20_000)
  f.rooms[0].checkTime(now+31_000);assert.deepEqual(f.rooms[0].readyPeers,[devices[1]]);assert.equal(f.rooms[0].canPublish,true)
  f.rooms[0].checkTime(now+51_000);assert.equal(f.rooms[0].canPublish,false);assert.equal(f.rooms[0].stopped,false)
})
test('room binding, explicit local consent and changed-key rejection still apply to independent joins',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));const signal=f.rooms[1].answer(fake)[0]
  for(const patch of [{epoch:2},{relay_only:false},{group_id:id('7')},{participants:devices.slice().reverse()},{expires_at:Date.now()-1}])f.rooms[0].receive({...signal,...patch})
  assert.equal(f.rooms[0].canPublish,false);f.deliver([signal]);assert.equal(f.rooms[2].canPublish,false)
  f.rooms[0].receive({...signal,description:'01:joined:04'+'cd'.repeat(64)});assert.equal(f.rooms[0].stopped,true)
})

test('rejoin uses a higher round; old joins, leaves and unbound controls cannot remove or revive it',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));const old=f.rooms[1].answer(fake);f.deliver(old)
  const leave=f.rooms[1].leave();f.deliver(leave);assert.equal(f.rooms[1].canPublish,false)
  const next=f.rooms[1].answer('04'+'cd'.repeat(64));f.deliver(next)
  const transcript=f.rooms[0].transcript(),revision=f.rooms[0].generation
  f.deliver([...old,...leave,{...leave[0],kind:'group-leave',description:null},{...leave[0],kind:'group-decline',description:null}])
  assert.deepEqual(f.rooms[0].transcript(),transcript);assert.equal(f.rooms[0].generation,revision);assert.equal(f.rooms[0].status(devices[1]),'Joined')
  f.deliver(f.rooms[1].leave());f.deliver(next);assert.equal(f.rooms[0].status(devices[1]),'Left')
})

test('a leave arriving before its join retains a round tombstone; reordering cannot resurrect it',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));const first=f.rooms[1].answer(fake);f.deliver(first);f.deliver(f.rooms[1].leave())
  const next=f.rooms[1].answer('04'+'cd'.repeat(64)),leave=f.rooms[1].leave();f.deliver(leave);f.deliver(next)
  assert.equal(f.rooms[0].status(devices[1]),'Left');assert.equal(f.rooms[0].canPublish,false)
})

test('each rejoin refreshes matching pair keys, requires consent and never reuses a previous incarnation',async()=>{
  const f=await cryptoFixture();let next
  try{
    f.deliver(f.rooms[0].invite(f.keys[0].publicKey));f.deliver(f.rooms[1].answer(f.keys[1].publicKey))
    const original=await f.keys[0].derive(f.rooms[0],devices[1],base)
    f.deliver(f.rooms[1].leave());f.keys[1].close();await assert.rejects(f.keys[1].derive(f.rooms[1],devices[0],base))
    const resumed=f.rooms[1].resume();f.rooms[1].end('old incarnation');f.rooms[1]=resumed
    assert.equal(resumed.hasConsent,false);assert.throws(()=>resumed.transcript())
    next=await GroupKeyAgreement.create(f.c,devices[1]);f.deliver(resumed.answer(next.publicKey))
    const a=await f.keys[0].derive(f.rooms[0],devices[1],base),b=await next.derive(resumed,devices[0],base)
    assert.deepEqual(a,b);assert.notDeepEqual(a,original);[a,b,original].forEach(key=>key.fill(0))
  }finally{next?.close();f.close()}
})

test('participation rounds are bounded and retain the original room lifetime',()=>{
  const f=fixture();f.deliver(f.rooms[0].invite(fake));f.deliver(f.rooms[1].answer(fake))
  for(let round=2;round<=32;round++){f.deliver(f.rooms[1].leave());f.deliver(f.rooms[1].answer('04'+round.toString(16).padStart(2,'0').repeat(64)))}
  f.rooms[1].leave();assert.throws(()=>f.rooms[1].answer('04'+'ff'.repeat(64)))
  f.rooms[0].checkTime(Date.now()+50*60_000);assert.equal(f.rooms[0].stopped,true)
})
