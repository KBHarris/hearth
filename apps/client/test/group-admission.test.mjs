import assert from 'node:assert/strict'
import {test} from 'node:test'
import {groupContext,GroupAdmission,GroupKeyAgreement} from '../src/media/group-admission.ts'
import {SFrameCipher} from '@hearth/sdk/sframe'

const id=char=>char.repeat(64),devices=[id('a'),id('b'),id('c')],accounts=[id('1'),id('2'),id('3')]
const base='de'.repeat(32),fake='04'+'ab'.repeat(64)
function conversation(){return {id:id('4'),channel_id:null,epoch:7,accounts:[...accounts],members:devices.map((device_key,index)=>({account_id:accounts[index],enrollment:{device_key}}))}}
function context(patch={}){return {...groupContext(id('5'),conversation(),id('6'),devices[0],devices,true),...patch}}
function signal(from,to,kind,patch={}){const c=context();return {call_id:c.id,group_id:c.id,participants:[...c.participants],epoch:c.epoch,from_device:from,to_device:to,kind,description:null,relay_only:c.relayOnly,expires_at:Date.now()+60_000,...patch}}
function deliver(rooms,queue){
  const seen=[]
  while(queue.length){const next=queue.shift();seen.push(next);queue.push(...rooms[devices.indexOf(next.to_device)].receive(next))}
  return seen
}
async function admitted(patch={}){
  const c=context(patch),keys=await Promise.all(devices.map(device=>GroupKeyAgreement.create(c,device))),rooms=devices.map(device=>new GroupAdmission(c,device))
  deliver(rooms,rooms[0].invite(keys[0].publicKey))
  deliver(rooms,rooms[1].answer(keys[1].publicKey))
  deliver(rooms,rooms[2].answer(keys[2].publicKey))
  assert.ok(rooms.every(room=>room.canPublish))
  return {c,rooms,keys,close(){rooms.forEach(room=>room.end('test'));keys.forEach(key=>key.close())}}
}

test('the fixed roster selects exactly one approved device from each of three private accounts',()=>{
  const original=devices.slice().reverse(),c=groupContext(id('5'),conversation(),id('6'),devices[0],original,true)
  assert.deepEqual(c.participants,devices);assert.deepEqual(original,devices.slice().reverse());assert.ok(Object.isFrozen(c.participants))
  for(const selected of [[devices[0],devices[1]],[devices[0],devices[0],devices[2]],[...devices,id('d')],[devices[0],devices[1],id('d')]])assert.throws(()=>groupContext(id('5'),conversation(),id('6'),devices[0],selected))
  const linked=conversation();linked.members.push({account_id:accounts[0],enrollment:{device_key:id('d')}})
  assert.throws(()=>groupContext(id('5'),linked,id('6'),devices[0],[devices[0],devices[1],id('d')]))
  for(const patch of [{channel_id:id('7')},{accounts:accounts.slice(0,2)},{epoch:-1},{epoch:1.5}])assert.throws(()=>groupContext(id('5'),{...conversation(),...patch},id('6'),devices[0],devices))
  assert.throws(()=>new GroupAdmission(context(),id('d')))
})

test('all three explicit consents and direct public contributions precede media readiness',async()=>{
  const c=context(),keys=await Promise.all(devices.map(device=>GroupKeyAgreement.create(c,device))),rooms=devices.map(device=>new GroupAdmission(c,device))
  try{
    deliver(rooms,rooms[0].invite(keys[0].publicKey));assert.ok(rooms.every(room=>!room.canPublish))
    assert.deepEqual(rooms[2].receive(signal(devices[0],devices[2],'group-start')),[])
    await assert.rejects(keys[2].derive(rooms[2],devices[0],base))
    deliver(rooms,rooms[1].answer(keys[1].publicKey));assert.ok(rooms.every(room=>!room.canPublish))
    const controls=deliver(rooms,rooms[2].answer(keys[2].publicKey))
    assert.ok(rooms.every(room=>room.canPublish));assert.equal(controls.filter(s=>s.kind==='group-key').length,6)
    assert.equal(controls.filter(s=>s.kind==='group-start').length,2)
  }finally{rooms.forEach(room=>room.end('test'));keys.forEach(key=>key.close())}
})

test('a host ready/start cannot replace an unanswered participant or their directly authenticated key',()=>{
  const room=new GroupAdmission(context(),devices[1]);room.answer(fake)
  room.receive(signal(devices[0],devices[1],'group-ready'))
  room.receive(signal(devices[0],devices[1],'group-start'))
  room.receive(signal(devices[0],devices[1],'group-key',{description:fake}))
  assert.equal(room.canPublish,false);assert.throws(()=>room.transcript())
  room.receive(signal(devices[2],devices[1],'group-key',{description:fake}))
  assert.equal(room.canPublish,true)
})

test('wrong room, device, epoch, roster, expiry and privacy controls cannot advance admission',()=>{
  const patches=[{call_id:id('7')},{group_id:id('7')},{epoch:8},{relay_only:false},{to_device:devices[2]},
    {from_device:id('d')},{participants:devices.slice().reverse()},{participants:[devices[0],devices[1],id('d')]},
    {expires_at:Date.now()-1},{expires_at:Date.now()+120_000},{description:'unexpected'}]
  for(const patch of patches){
    const room=new GroupAdmission(context(),devices[0]);room.invite(fake)
    room.receive(signal(devices[1],devices[0],'group-join',patch))
    assert.deepEqual(room.receive(signal(devices[2],devices[0],'group-join')),[])
    assert.equal(room.canPublish,false)
  }
})

test('keys may arrive before ready/start; duplicates are harmless and a changed pinned key ends admission',()=>{
  const room=new GroupAdmission(context(),devices[1]);room.answer(fake)
  room.receive(signal(devices[0],devices[1],'group-key',{description:fake}))
  room.receive(signal(devices[2],devices[1],'group-key',{description:fake}))
  room.receive(signal(devices[0],devices[1],'group-start'));assert.equal(room.canPublish,false)
  assert.equal(room.receive(signal(devices[0],devices[1],'group-ready')).length,2);assert.equal(room.canPublish,true)
  assert.deepEqual(room.receive(signal(devices[0],devices[1],'group-ready')),[])
  room.receive(signal(devices[2],devices[1],'group-key',{description:fake}));assert.equal(room.canPublish,true)
  room.receive(signal(devices[2],devices[1],'group-key',{description:'04'+'cd'.repeat(64)}));assert.equal(room.stopped,true)
  assert.equal(room.canPublish,false);assert.throws(()=>room.transcript())
})

test('a decline, leave, access loss or stale invitation permanently closes the room',()=>{
  for(const kind of ['group-decline','group-leave']){
    const room=new GroupAdmission(context(),devices[0]);room.invite(fake)
    room.receive(signal(devices[1],devices[0],kind));assert.equal(room.stopped,true)
    room.receive(signal(devices[1],devices[0],'group-join'));assert.throws(()=>room.invite(fake))
  }
  const room=new GroupAdmission(context(),devices[1]);assert.equal(room.stop()[0].kind,'group-decline');assert.equal(room.stopped,true)
  const expired=new GroupAdmission(context(),devices[1],1_000);expired.checkTime(61_000);assert.throws(()=>expired.answer(fake))
  const accessLost=new GroupAdmission(context(),devices[0]);accessLost.invite(fake);accessLost.end('revoked');assert.deepEqual(accessLost.heartbeat(),[])
})

test('all participants stop on leave; missing heartbeats and the maximum lifetime expire admitted rooms',async()=>{
  for(const scenario of ['leave','heartbeat','lifetime']){
    const f=await admitted()
    try{
      if(scenario==='leave'){deliver(f.rooms,f.rooms[1].stop());assert.ok(f.rooms.every(room=>room.stopped))}
      else{f.rooms[0].checkTime(Date.now()+(scenario==='heartbeat'?30_001:50*60_000));assert.equal(f.rooms[0].stopped,true)}
      await assert.rejects(f.keys[0].derive(f.rooms[0],devices[1],base))
    }finally{f.close()}
  }
})

test('each admitted pair agrees on a different media key and authenticates encrypted frames',async()=>{
  const f=await admitted(),derived=[]
  try{
    for(const [a,b] of [[0,1],[0,2],[1,2]]){
      const left=await f.keys[a].derive(f.rooms[a],devices[b],base),right=await f.keys[b].derive(f.rooms[b],devices[a],base)
      derived.push(left);assert.deepEqual(left,right)
      const sender=await SFrameCipher.create(left,BigInt(10+a*3+b)),receiver=await SFrameCipher.create(right,BigInt(10+a*3+b)),plain=new Uint8Array([1,2,3,4])
      assert.deepEqual(await receiver.decrypt(await sender.encrypt(plain)),plain);right.fill(0)
    }
    assert.notDeepEqual(derived[0],derived[1]);assert.notDeepEqual(derived[0],derived[2])
    const outsider=await f.keys[2].derive(f.rooms[2],devices[0],base)
    const sender=await SFrameCipher.create(derived[0],19n),wire=await sender.encrypt(new Uint8Array([8,9]))
    await assert.rejects((await SFrameCipher.create(outsider,19n)).decrypt(wire));outsider.fill(0)
    assert.notDeepEqual(derived[0],new Uint8Array(Buffer.from(base,'hex')))
  }finally{derived.forEach(key=>key.fill(0));f.close()}
})

test('fresh call secrets and MLS bases produce fresh keys; a foreign room or device is rejected',async()=>{
  const a=await admitted(),b=await admitted(),derived=[]
  try{
    assert.equal(a.keys[0].secret.extractable,false)
    await assert.rejects(crypto.subtle.exportKey('pkcs8',a.keys[0].secret))
    const original=await a.keys[0].derive(a.rooms[0],devices[1],base);derived.push(original)
    for(const key of [await b.keys[0].derive(b.rooms[0],devices[1],base),await a.keys[0].derive(a.rooms[0],devices[1],'ab'.repeat(32))]){derived.push(key);assert.notDeepEqual(original,key)}
    await assert.rejects(a.keys[0].derive(b.rooms[0],devices[1],base))
    for(const peer of [devices[0],id('d')])await assert.rejects(a.keys[0].derive(a.rooms[0],peer,base))
    const otherRoom=new GroupAdmission(context({relayOnly:false}),devices[0]);await assert.rejects(a.keys[0].derive(otherRoom,devices[1],base))
    for(const wrong of ['x','AB'.repeat(32),'ab'.repeat(31)])await assert.rejects(a.keys[0].derive(a.rooms[0],devices[1],wrong))
  }finally{derived.forEach(key=>key.fill(0));a.close();b.close()}
})

test('invalid ECDH points and late completion after hangup or key disposal never produce a key',async()=>{
  const f=await admitted()
  try{
    const pending=f.keys[0].derive(f.rooms[0],devices[1],base);f.rooms[0].end('hangup');await assert.rejects(pending)
    const pending2=f.keys[1].derive(f.rooms[1],devices[2],base);f.keys[1].close();await assert.rejects(pending2)
    const room=new GroupAdmission(f.c,devices[2]);room.answer(f.keys[2].publicKey)
    for(const peer of devices.slice(0,2))room.receive(signal(peer,devices[2],'group-key',{description:'04'+'00'.repeat(64)}))
    room.receive(signal(devices[0],devices[2],'group-ready'));room.receive(signal(devices[0],devices[2],'group-start'))
    assert.equal(room.canPublish,true);await assert.rejects(f.keys[2].derive(room,devices[0],base));assert.equal(room.stopped,true)
  }finally{f.close()}
})

test('a late key derivation checks the heartbeat deadline even without a timer tick',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1_000})
  const f=await admitted()
  try{
    const pending=f.keys[0].derive(f.rooms[0],devices[1],base)
    t.mock.timers.tick(30_001);await assert.rejects(pending);assert.equal(f.rooms[0].stopped,true)
  }finally{f.close()}
})
