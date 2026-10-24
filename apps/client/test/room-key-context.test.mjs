import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Permission} from '@hearth/sdk'
import {currentRoomKeyContext} from '../src/crypto/room-key-context.ts'
const id=char=>char.repeat(64),devices=['a','b','c'].map(id),accounts=['1','2','3'].map(id),identities=['d','e','f'].map(id),channel=id('4')
function fixture(){
  const members=devices.map((device_key,index)=>({account_id:accounts[index],enrollment:{device_key,identity_key:identities[index]}}))
  return {conversation:{id:channel,epoch:7,members},roster:{channel:{id:channel,kind:'voice'},community:{owner_id:accounts[0]},authority:{owner:members[0]},admissions:members.slice(1).map(member=>({account_id:member.account_id,identity_key:member.enrollment.identity_key})),people:members.map(member=>({account:{id:member.account_id},devices:[member.enrollment]})),departures:[]},signal:{voice_room:id('5'),participants:devices,epoch:7}}
}
const status=expected=>error=>error.status===expected
test('current room keys still require the authoritative export; stale epoch or missing verified roster is rejected first',()=>{
  const f=fixture();assert.doesNotThrow(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[0]))
  assert.throws(()=>currentRoomKeyContext({...f.signal,epoch:6},f.conversation,f.roster,devices[0]),status(409))
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,undefined,devices[0]),status(409))
  assert.doesNotThrow(()=>currentRoomKeyContext({epoch:6},undefined,undefined,devices[0]))
})
test('queued keys for a newly restricted peer request fresh context; own access loss remains terminal',()=>{
  const f=fixture();f.roster.governance={everyone:15,roles:[],assignments:[],overrides:[{channel_id:channel,kind:'member',target_id:accounts[1],allow:0,deny:Permission.send}],sanctions:[]}
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[0]),status(409))
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[1]),status(403))
  assert.doesNotThrow(()=>currentRoomKeyContext({...f.signal,participants:[devices[0],devices[2]]},f.conversation,f.roster,devices[0]))
  f.roster.governance.overrides.push({channel_id:channel,kind:'member',target_id:accounts[2],allow:0,deny:Permission.send})
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[2]),status(403))
  f.roster.governance.revision=8
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[2],Date.now(),7),status(403))
})
test('revoked devices, departed identities and changed admission cannot export under an obsolete audience',()=>{
  for(const change of [f=>{f.roster.people[1].devices=[]},f=>{f.roster.departures=[{member:f.conversation.members[1]}]},f=>{f.roster.admissions[0].identity_key=id('0')}]){
    const f=fixture();change(f);assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[0]),status(409))
  }
})
test('explicit audience permissions allow receive-only key wrapping without granting speak or screen publication',()=>{
  const f=fixture();f.roster.channel.kind='stage';f.roster.governance={media_version:1,everyone:Permission.read|Permission.connect|Permission.listen,roles:[],assignments:[],overrides:[],sanctions:[]}
  assert.doesNotThrow(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[1]))
  f.roster.governance.overrides=[{channel_id:channel,kind:'member',target_id:accounts[1],allow:0,deny:Permission.listen}]
  assert.throws(()=>currentRoomKeyContext(f.signal,f.conversation,f.roster,devices[1]),status(403))
})
