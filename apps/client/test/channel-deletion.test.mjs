import assert from 'node:assert/strict'
import {test} from 'node:test'
import {registerHooks} from 'node:module'
import {HearthError} from '@hearth/sdk'
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error}}})
const {MessagingSession}=await import('../src/crypto/messaging-session.ts')
const id=char=>char.repeat(64),channel=id('1'),dm=id('2'),account=id('3'),device=id('4')
function fixture(){
 const service=new MessagingSession({}, {token:'fixture',account:{id:account}},{device_key:device},id('5'),'http://127.0.0.1:8080',()=>{})
 const groups=[{id:channel,channel_id:channel,epoch:1,members:[],accounts:[account]},{id:dm,epoch:1,members:[],accounts:[account]}]
 service.view.groups=groups;service.state.conversations=groups;service.view.messages=[{id:id('6'),conversation_id:channel,text:'local history'}]
 service.view.history_backfill=[];service.publish();return service
}
test('removing a channel stops its calls and send path without erasing local history or touching DMs',async()=>{
 const service=fixture(),locked=[];service.onCall(()=>{},id=>locked.push(id))
 try{
  const messages=service.view.messages;service.channelsRemoved([channel]);service.publish()
  assert.deepEqual(locked,[channel]);assert.deepEqual(service.state.joined,[dm]);assert.deepEqual(service.state.conversations.map(group=>group.id),[dm])
  assert.equal(service.view.groups.length,2);assert.equal(service.view.messages,messages)
  service.flush=async()=>{throw new Error('Must not change crypto/outbox')}
  await assert.rejects(service.send(channel,{kind:'text',text:'draft'}),/no longer available/)
 }finally{service.close()}
})
test('a roster deleted after the list was read is excluded without breaking messaging refresh',async()=>{
 const service=fixture();service.synchronize=async()=>{};service.client.conversations=async()=>[service.view.groups[0]]
 service.prepareChannel=async()=>{throw new HearthError(403,'gone')};service.verifyPeers=async()=>{}
 service.client.blocks=async()=>[];service.client.packageCount=async()=>({available:4})
 try{await service.refresh();assert.deepEqual(service.state.conversations,[]);assert.ok(service.state.unavailable.includes(channel));assert.equal(service.view.messages.length,1)}finally{service.close()}
})
