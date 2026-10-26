import assert from 'node:assert/strict'
import {test} from 'node:test'
import {registerHooks} from 'node:module'
import {readMessages,writeMessages} from '../src/crypto/message-store.ts'
registerHooks({resolve(specifier,context,next){try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error}}})
const {MessagingSession}=await import('../src/crypto/messaging-session.ts')
const {DirectCall}=await import('../src/media/direct-call.ts')
const id=char=>char.repeat(64),scope=[id('a'),id('b'),id('c')].join(':')
const missing='The saved encryption key exists, but encrypted history is missing from this Windows profile. Keep the original profile and history files; do not reset your keys.'
globalThis.isTauri=true
const commands=[]
let rejection=missing
globalThis.window={__TAURI_INTERNALS__:{async invoke(command){commands.push(command);throw rejection}}}

test('a fixed native storage rejection reaches messaging startup and does not create a call-ended banner',async()=>{
  commands.length=0;rejection=missing
  let state,opened=false
  const service=new MessagingSession({async openMessages(){opened=true}}, {token:'synthetic',account:{id:id('b')}},{device_key:id('c')},id('a'),'http://127.0.0.1:8080',value=>{state=value})
  const call=new DirectCall(service,()=>{})
  try{
    await assert.rejects(service.start(),error=>error instanceof Error&&error.message===missing)
    assert.equal(state.fatal,true);assert.equal(state.error,missing);assert.equal(opened,false)
    assert.equal(call.state.phase,'idle');assert.equal(call.state.message,'')
    assert.deepEqual(commands,['message_store_read'])
  }finally{call.close();service.close()}
})

test('unknown native error text is redacted and read failure never initializes replacement storage',async()=>{
  for(const error of ['PRIVATE_STORAGE_KEY_CANARY',new Error('PRIVATE_STORAGE_KEY_CANARY'),{detail:'PRIVATE_STORAGE_KEY_CANARY'}]){
    commands.length=0;rejection=error
    await assert.rejects(readMessages(scope),failure=>failure instanceof Error&&failure.message.includes('Existing data was preserved')&&!failure.message.includes('PRIVATE_STORAGE_KEY_CANARY'))
    assert.deepEqual(commands,['message_store_read'])
  }
})

test('a failed native write retains its revision and cannot fall back to a fresh store',async()=>{
  commands.length=0;rejection=missing
  await assert.rejects(writeMessages(scope,42,'01'+'ab'.repeat(40)),error=>error instanceof Error&&error.message===missing)
  assert.deepEqual(commands,['message_store_write'])
})
