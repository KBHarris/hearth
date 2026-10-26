import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DirectCall,idleCall} from '../src/media/direct-call.ts'
const id=char=>char.repeat(64),own=id('a'),peer=id('b'),conversation=id('c')
globalThis.isSecureContext=true;globalThis.RTCPeerConnection=class {};globalThis.Worker=class {};globalThis.RTCRtpScriptTransform=class {}
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia(){throw new Error('Real capture forbidden')}}},configurable:true})
function fixture(){
  let locked
  const current={id:conversation,epoch:7,members:[{account_id:'own',enrollment:{device_key:own}},{account_id:'peer',enrollment:{device_key:peer}}]}
  const transport={callDevice:own,callAccount:'own',authorizeCall:async()=>current,callKey:async()=>{throw new Error('Unexpected export')},send:async()=> 'sent',onCall:(_,lock)=>{locked=lock;return()=>{}}}
  const call=new DirectCall(transport,()=>{},async()=>{throw new Error('Unexpected capture')})
  let descriptions=0
  const pc={connectionState:'new',localDescription:null,async createOffer(){return {type:'offer',sdp:'synthetic offer'}},async createAnswer(){return {type:'answer',sdp:'synthetic answer'}},async setLocalDescription(value){this.localDescription=value},async setRemoteDescription(){descriptions++;call.established=true;call.publish({phase:'connected',message:'Encrypted call'})},close(){}}
  call.prepare=async()=>{call.pc=pc};call.gather=async()=>{};call.watch=()=>{}
  return {call,pc,transport,descriptions:()=>descriptions,lock:id=>locked(id)}
}
test('a messaging lock leaves idle calls quiet but still ends a selected active call',async()=>{
  const f=fixture()
  try{
    f.lock();assert.deepEqual(f.call.state,idleCall)
    await f.call.start(conversation,peer)
    f.lock(id('e'));assert.equal(f.call.state.phase,'outgoing')
    f.lock(conversation);assert.equal(f.call.state.phase,'ended');assert.match(f.call.state.message,/Encryption or authentication changed/)
    const stopped=f.call.state;f.lock();assert.equal(f.call.state,stopped)
  }finally{f.call.close()}
})
test('a messaging lock still cancels preparation before an offer exists',async()=>{
  const f=fixture();let release
  f.transport.authorizeCall=()=>new Promise(resolve=>{release=resolve})
  try{
    const starting=f.call.start(conversation,peer);assert.equal(f.call.state.phase,'preparing')
    f.lock();release({id:conversation,epoch:7,members:[]});await starting
    assert.equal(f.call.state.phase,'ended');assert.equal(f.descriptions(),0)
  }finally{f.call.close()}
})
test('a fast authenticated answer can arrive before the outbound send settles without being ignored or downgrading connected',async()=>{
  const f=fixture()
  f.transport.send=async(_,content)=>{
    if(content.signal.kind==='offer')await f.call.receive({conversation_id:conversation,account_id:'peer',signal:{...content.signal,from_device:peer,to_device:own,kind:'answer',description:'synthetic answer'}})
    return 'sent'
  }
  try{await f.call.start(conversation,peer);assert.equal(f.descriptions(),1);assert.equal(f.call.state.phase,'connected')}finally{f.call.close()}
})
test('an answer acknowledgement cannot overwrite a connection that becomes established during sending',async()=>{
  const f=fixture(),offer={call_id:id('d'),epoch:7,from_device:peer,to_device:own,kind:'offer',description:'synthetic offer',expires_at:Date.now()+60000,relay_only:false}
  Object.assign(f.call,{active:true,offer,state:{...idleCall,phase:'incoming',conversation}})
  f.transport.send=async(_,content)=>{if(content.signal.kind==='answer'){f.call.established=true;f.call.publish({phase:'connected',message:'Encrypted call'})}return 'sent'}
  try{await f.call.answer();assert.equal(f.call.state.phase,'connected')}finally{f.call.close()}
})
