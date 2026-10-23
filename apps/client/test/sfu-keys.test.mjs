import assert from 'node:assert/strict'
import {test} from 'node:test'
import {SfuKeys} from '../src/media/sfu-keys.ts'
import {GroupKeyAgreement} from '../src/media/group-admission.ts'
import {VoiceMembership,voiceContext} from '../src/media/voice-membership.ts'
const id=number=>number.toString(16).padStart(64,'0'),server=id(1000),channel=id(1001),roomId=id(1002)
async function fixture(count=6,revision=1){
  const devices=Array.from({length:count},(_,index)=>id(index+1))
  const initial={server,conversation:channel,id:roomId,voiceRoom:roomId,sfu:true,epoch:1,host:devices[0],participants:devices,relayOnly:false}
  const roots=await Promise.all(devices.map(device=>GroupKeyAgreement.create(initial,device)))
  const room={channel_id:channel,room_id:roomId,epoch:1,revision,capacity:25,sfu:true,relay_only:false,participants:devices.map((device,index)=>({channel_id:channel,room_id:roomId,epoch:1,device_key:device,incarnation:id(index+20),public_key:roots[index].publicKey,sfu:true,relay_only:false,active:true,issued_at:Date.now(),expires_at:Date.now()+30000,signature:'a'.repeat(128)}))}
  const context=await voiceContext(server,room),members=devices.map(device=>new VoiceMembership(context,device,room)),agreements=roots.map(root=>root.forkForRoom(context))
  const exporter=async signal=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([signal.kind,signal.group_id,signal.from_device,signal.to_device])))),byte=>byte.toString(16).padStart(2,'0')).join('')
  const keys=agreements.map((agreement,index)=>new SfuKeys(agreement,members[index],exporter))
  const close=()=>{for(const key of keys)key.close();for(const agreement of agreements)agreement.close();for(const root of roots)root.close();for(const member of members)member.end('test ended')}
  return {devices,roots,room,context,members,agreements,exporter,keys,close}
}

test('six SFU publishers independently wrap unique MLS/ECDH keys for selected recipients without waiting for everyone',async()=>{
  const f=await fixture()
  try{
    const first=await f.keys[0].create()
    assert.ok(first.signal.description.length<8192)
    const second=await f.keys[1].receive(first.signal);assert.deepEqual(first.key,second);second.fill(0)
    assert.equal(await f.keys[1].receive(f.keys[0].repeat()),null)
    const remaining=await Promise.all(f.keys.slice(1).map(key=>key.create()))
    assert.equal(new Set([first,...remaining].map(bundle=>Buffer.from(bundle.key).toString('hex'))).size,6)
    for(const [index,bundle] of [first,...remaining].entries())for(const [receiver,key] of f.keys.entries())if(index!==receiver){const received=await key.receive(bundle.signal);if(index===0&&receiver===1)assert.equal(received,null);else{assert.deepEqual(received,bundle.key);received.fill(0)}}
    first.key.fill(0);for(const bundle of remaining)bundle.key.fill(0)
    await assert.rejects(GroupKeyAgreement.create(f.context,id(999)))
  }finally{f.close()}
})

test('wrapped keys reject tampering, changed audience, wrong contribution and expired controls without poisoning valid material',async()=>{
  const f=await fixture(3)
  try{
    const bundle=await f.keys[0].create(),entries=JSON.parse(bundle.signal.description)
    entries.find(entry=>entry.recipient===f.devices[1]).ciphertext='0'.repeat(96)
    await assert.rejects(f.keys[1].receive({...bundle.signal,description:JSON.stringify(entries)}))
    await assert.rejects(f.keys[1].receive({...bundle.signal,group_id:id(999)}))
    await assert.rejects(f.keys[1].receive({...bundle.signal,expires_at:Date.now()-1}))
    const received=await f.keys[1].receive(bundle.signal);assert.deepEqual(received,bundle.key);received.fill(0)
    await assert.rejects(f.keys[1].receive({...bundle.signal,description:JSON.stringify(entries)}))
    f.keys[2].close();await assert.rejects(f.keys[2].receive(bundle.signal));bundle.key.fill(0)
  }finally{f.close()}
})

test('twenty-five selected devices unwrap one publisher while the host and an unjoined MLS member have no ECDH secret',async()=>{
  const f=await fixture(25)
  try{
    const bundle=await f.keys[0].create(),encoded=JSON.stringify(bundle.signal)
    assert.equal(JSON.parse(bundle.signal.description).length,24)
    assert.equal(encoded.includes(Buffer.from(bundle.key).toString('hex')),false)
    for(const receiver of f.keys.slice(1)){const key=await receiver.receive(bundle.signal);assert.deepEqual(key,bundle.key);key.fill(0)}
    const changed={...f.room,revision:2},context=await voiceContext(server,changed),member=new VoiceMembership(context,f.devices[1],changed),agreement=f.roots[1].forkForRoom(context),fresh=new SfuKeys(agreement,member,f.exporter)
    try{await assert.rejects(fresh.receive(bundle.signal))}finally{fresh.close();agreement.close();member.end('done')}
    bundle.key.fill(0)
  }finally{f.close()}
})
