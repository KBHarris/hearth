import assert from 'node:assert/strict'
import {test} from 'node:test'
import {registerHooks} from 'node:module'
// This browser module uses bundler extension resolution; keep its actual queue
// and public methods in the test while substituting only I/O and crypto effects.
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error}}})
const {MessagingSession}=await import('../src/crypto/messaging-session.ts')
const id=char=>char.repeat(64),channel=id('4'),devices=['a','b'].map(id),accounts=['1','2'].map(id),identities=['d','e'].map(id)
function fixture(){
  const members=devices.map((device_key,index)=>({account_id:accounts[index],enrollment:{device_key,identity_key:identities[index]}}))
  const service=new MessagingSession({}, {token:'synthetic',account:{id:accounts[0]}},members[0].enrollment,id('5'),'http://127.0.0.1:8080',()=>{})
  service.view={...service.view,groups:[{id:channel,epoch:7,members}]}
  const roster={channel:{id:channel,kind:'voice'},community:{owner_id:accounts[0]},authority:{owner:members[0]},admissions:[{account_id:accounts[1],identity_key:identities[1]}],people:members.map(member=>({account:{id:member.account_id},devices:[member.enrollment]})),departures:[]}
  service.mediaRosters.set(channel,roster)
  const operations=[];service.flush=async()=>false;service.persist=async()=>{};service.operation=async name=>{operations.push(name);return 'synthetic export'}
  return {service,roster,operations,signal:{voice_room:id('6'),participants:devices,epoch:7}}
}
test('queued key exports and queued signaling both reject stale policy before invoking crypto',async()=>{
  const f=fixture();let release
  f.service.tail=new Promise(resolve=>{release=resolve})
  const key=f.service.callKey(channel,f.signal),send=f.service.send(channel,{kind:'call',signal:f.signal})
  f.roster.governance={everyone:15,roles:[],assignments:[],overrides:[{channel_id:channel,kind:'member',target_id:accounts[1],allow:0,deny:2}],sanctions:[]}
  const deniedKey=assert.rejects(key,error=>error.status===409),deniedSend=assert.rejects(send,error=>error.status===409)
  release();await Promise.all([deniedKey,deniedSend]);assert.deepEqual(f.operations,[])
})
test('current signaling and key requests still invoke the authoritative crypto operation',async()=>{
  const f=fixture();assert.equal(await f.service.callKey(channel,f.signal),'synthetic export');assert.equal(await f.service.send(channel,{kind:'call',signal:f.signal}),'sent')
  assert.deepEqual(f.operations,['call_key','send'])
})
