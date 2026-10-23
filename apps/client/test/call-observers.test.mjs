import assert from 'node:assert/strict'
import {test} from 'node:test'
import {CallObservers} from '../src/media/call-observers.ts'
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('all call consumers receive events and unsubscribe independently',()=>{
  const listeners=new CallObservers(),seen=[],event={conversation_id:'room'}
  const remove=listeners.add(e=>seen.push(['a',e]),()=>{})
  listeners.add(e=>seen.push(['b',e]),()=>{})
  listeners.emit(event);remove();remove();listeners.emit(event)
  assert.deepEqual(seen,[['a',event],['b',event],['b',event]])
})
test('an MLS publication barrier waits for every consumer acknowledgment',async()=>{
  const listeners=new CallObservers(),seen=[];let first,second,finished=false
  listeners.add(()=>{},()=>{},(room,epoch)=>{seen.push([room,epoch]);return new Promise(resolve=>{first=resolve})})
  listeners.add(()=>{},()=>{},(room,epoch)=>{seen.push([room,epoch]);return new Promise(resolve=>{second=resolve})})
  const pending=listeners.changeEpoch('room').then(()=>{finished=true})
  assert.deepEqual(seen,[['room',undefined],['room',undefined]])
  first();await tick();assert.equal(finished,false);second();await pending;assert.equal(finished,true)
})
test('an observer without epoch support is locked before the commit barrier completes',async()=>{
  const listeners=new CallObservers(),seen=[]
  listeners.add(()=>{},room=>seen.push(room));await listeners.changeEpoch('room',9);assert.deepEqual(seen,['room'])
})
test('a synchronous pause failure still notifies and locks every observer',async()=>{
  const listeners=new CallObservers(),seen=[]
  listeners.add(()=>{},()=>{seen.push('lock-a');throw new Error('teardown')},()=>{throw new Error('pause')})
  listeners.add(()=>{},()=>seen.push('lock-b'),()=>seen.push('pause-b'))
  await assert.rejects(listeners.changeEpoch('room'));assert.deepEqual(seen,['pause-b','lock-a','lock-b'])
})
test('a failing event consumer cannot suppress delivery or teardown for another call',()=>{
  const listeners=new CallObservers(),seen=[]
  listeners.add(()=>{throw new Error('event')},()=>{seen.push('lock-a');throw new Error('teardown')})
  listeners.add(()=>seen.push('event-b'),()=>seen.push('lock-b'))
  assert.throws(()=>listeners.emit({conversation_id:'room'}),AggregateError)
  assert.deepEqual(seen,['event-b','lock-a','lock-b'])
})
