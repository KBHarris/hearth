import assert from 'node:assert/strict'
import {test} from 'node:test'
import {DirectCall} from '../src/media/direct-call.ts'
const id=char=>char.repeat(64),tick=()=>new Promise(resolve=>setImmediate(resolve))
test('room heartbeats use ten seconds while private calls retain five seconds and the 25-second watchdog',async t=>{
  t.mock.timers.enable({apis:['Date','setInterval'],now:1000})
  for(const room of [false,true]){
    const sent=[],offer={call_id:id('a'),epoch:1,from_device:id('b'),to_device:id('c'),expires_at:61000,kind:'offer',description:'pending',relay_only:false}
    const transport={callDevice:id('b'),callAccount:id('d'),onCall:()=>()=>{},send:async(_,content)=>{sent.push(content.signal.kind);return 'sent'},authorizeCall:async()=>({}),callKey:async()=>{throw new Error('No media') }}
    const call=new DirectCall(transport,()=>{},undefined,undefined,room?{groupId:id('e'),participants:[id('b'),id('c')],callId:offer.call_id,voiceRoom:id('f')}:undefined)
    Object.assign(call,{offer,active:true,started:Date.now(),state:{...call.state,phase:'connected',conversation:id('e')}})
    try{
      call.watch(offer);t.mock.timers.tick(5000);await tick();assert.equal(sent.length,room?0:1)
      t.mock.timers.tick(5000);await tick();assert.equal(sent.length,room?1:2)
      t.mock.timers.tick(16000);await tick();assert.equal(call.state.phase,'ended')
    }finally{call.close()}
  }
})
