import assert from 'node:assert/strict'
import {test} from 'node:test'
import {deliveryBatch} from '../src/crypto/delivery-batch.ts'
const events=[1,2,3].map(seq=>({seq,conversation_id:'channel',data:{kind:'redacted'}}))
test('one durable save covers an ordered batch; publication follows persistence and replay is ignored',async()=>{
  const order=[]
  await deliveryBatch(events,1,{before:async event=>order.push('before'+event.seq),receive:async event=>{order.push('receive'+event.seq);return event.seq},persist:async()=>order.push('save'),emit:items=>{assert.deepEqual(items.map(item=>item.event.seq),[2,3]);order.push('emit')}})
  assert.deepEqual(order,['before2','receive2','before3','receive3','save','emit'])
})
test('a corrupt later envelope saves and exposes only the verified prefix before failing',async()=>{
  const order=[]
  await assert.rejects(deliveryBatch(events,0,{before:async()=>{},receive:async event=>{if(event.seq===2)throw new Error('corrupt');return event.seq},persist:async()=>order.push('save'),emit:items=>order.push(items.map(item=>item.event.seq))}),/corrupt/)
  assert.deepEqual(order,['save',[1]])
})
test('storage failure exposes no unpersisted controls and oversized batches never touch crypto',async()=>{
  let emitted=false,received=0
  const callbacks={before:async()=>{},receive:async()=>{received++;return null},persist:async()=>{throw new Error('CAS conflict')},emit:()=>{emitted=true}}
  await assert.rejects(deliveryBatch(events,0,callbacks),/CAS conflict/);assert.equal(emitted,false)
  received=0;await assert.rejects(deliveryBatch(Array(17).fill(events[0]),0,callbacks),/bound/);assert.equal(received,0)
})
