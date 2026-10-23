import assert from 'node:assert/strict'
import {test} from 'node:test'
import {GroupKeyAgreement} from '../src/media/group-admission.ts'
import {VoiceMembership,voiceContext,voiceManifest} from '../src/media/voice-membership.ts'
const id=char=>char.repeat(64),devices=['a','b','c','d'].map(id),server=id('1'),channel=id('2'),roomId=id('3'),base='de'.repeat(32)
const root=device=>({server,conversation:channel,id:roomId,epoch:2,host:device,participants:[device],relayOnly:true,voiceRoom:roomId})
async function fixture(){
  const keys=await Promise.all(devices.map(device=>GroupKeyAgreement.create(root(device),device)))
  const room={channel_id:channel,room_id:roomId,epoch:2,revision:1,capacity:4,relay_only:true,participants:devices.map((device,index)=>({channel_id:channel,room_id:roomId,epoch:2,device_key:device,incarnation:id(String(index+4)),public_key:keys[index].publicKey,relay_only:true,active:true,issued_at:Date.now(),expires_at:Date.now()+30000,signature:'ab'.repeat(64)}))}
  return {keys,room,close(){keys.forEach(key=>key.close())}}
}
test('four-person room derives six distinct pair keys with matching endpoints and no third-party key',async()=>{
  const f=await fixture(),wrappers=[],derived=[]
  try{
    const context=await voiceContext(server,f.room),states=devices.map(device=>new VoiceMembership(context,device,f.room))
    wrappers.push(...f.keys.map(key=>key.forkForRoom(context)))
    for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){
      const left=await wrappers[a].derive(states[a],devices[b],base),right=await wrappers[b].derive(states[b],devices[a],base)
      assert.deepEqual(left,right);derived.push(left);right.fill(0)
    }
    assert.equal(new Set(derived.map(key=>Buffer.from(key).toString('hex'))).size,6)
    const third=await wrappers[2].derive(states[2],devices[0],base)
    assert.notDeepEqual(third,derived[0]);third.fill(0)
  }finally{wrappers.forEach(key=>key.close());derived.forEach(key=>key.fill(0));f.close()}
})
test('occupancy revision prevents returning to old pair keys and closing an obsolete wrapper preserves the current contribution',async()=>{
  const f=await fixture();let old,newest
  try{
    const pair={...f.room,participants:f.room.participants.slice(0,2)},context=await voiceContext(server,pair)
    old=f.keys[0].forkForRoom(context);const state=new VoiceMembership(context,devices[0],pair),before=await old.derive(state,devices[1],base)
    state.end('third joins');old.close()
    const after={...pair,revision:3},next=await voiceContext(server,after);newest=f.keys[0].forkForRoom(next)
    const key=await newest.derive(new VoiceMembership(next,devices[0],after),devices[1],base)
    assert.notEqual(context.id,next.id);assert.notDeepEqual(before,key);before.fill(0);key.fill(0)
    for(const patch of [{voiceRoom:id('9')},{epoch:3},{server:id('9')},{conversation:id('9')},{voiceRoom:undefined}])assert.throws(()=>f.keys[0].forkForRoom({...next,...patch}))
  }finally{old?.close();newest?.close();f.close()}
})
test('liveness renewal preserves the media transcript, while expiry and leaving prevent publication',async()=>{
  const f=await fixture()
  try{
    const context=await voiceContext(server,f.room),state=new VoiceMembership(context,devices[0],f.room),manifest=voiceManifest(f.room)
    const renewed={...f.room,participants:f.room.participants.map(peer=>({...peer,issued_at:peer.issued_at+10000,expires_at:peer.expires_at+10000}))}
    assert.equal(voiceManifest(renewed),manifest);state.refresh(renewed);assert.equal(state.canPublish,true)
    state.checkTime(Date.now()+41000);assert.equal(state.canPublish,false);assert.throws(()=>state.transcript())
    const alone={...f.room,participants:f.room.participants.slice(0,1)},waiting=new VoiceMembership(await voiceContext(server,alone),devices[0],alone)
    assert.equal(waiting.canPublish,false)
  }finally{f.close()}
})
