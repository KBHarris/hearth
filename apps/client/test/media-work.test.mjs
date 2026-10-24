import assert from 'node:assert/strict'
import {test} from 'node:test'
import {MediaWork} from '../src/crypto/media-work.ts'

test('media work waits for its durable boundary, serializes actions and isolates failures',async()=>{
  const queue=new MediaWork(),order=[];let release
  const first=queue.add(async()=>{order.push('first');await new Promise(resolve=>{release=resolve});order.push('saved');return 1})
  const failure=queue.add(async()=>{order.push('failure');throw new Error('revoked')}),rejected=assert.rejects(failure,/revoked/)
  const last=queue.add(async()=>{order.push('last');return 2})
  assert.deepEqual(order,[])
  const draining=queue.drain();await queue.drain();assert.deepEqual(order,['first'])
  release();await draining;assert.equal(await first,1);await rejected;assert.equal(await last,2)
  assert.deepEqual(order,['first','saved','failure','last'])
})

test('work arriving during a drain waits for the next boundary and reentrant drains cannot interleave',async()=>{
  const queue=new MediaWork(),order=[];let later
  const first=queue.add(async()=>{order.push('start');later=queue.add(async()=>order.push('later'));await queue.drain();order.push('finish')})
  await queue.drain();await first;assert.deepEqual(order,['start','finish']);await queue.drain();await later;assert.deepEqual(order,['start','finish','later'])
})

test('a saved delivery prefix remains unexposed to urgent work until its ordered publication completes',async()=>{
  const queue=new MediaWork(),order=[];const pending=queue.add(async()=>order.push('authorization'))
  await queue.batch(async()=>{order.push('saved');await queue.drain();order.push('published');assert.deepEqual(order,['saved','published'])})
  assert.deepEqual(order,['saved','published']);await queue.drain();await pending;assert.deepEqual(order,['saved','published','authorization'])
  const next=queue.add(async()=>order.push('later'));await assert.rejects(queue.batch(async()=>{await queue.drain();throw new Error('storage failure')}),/storage failure/)
  assert.equal(order.includes('later'),false);await queue.drain();await next;assert.equal(order.at(-1),'later')
})

test('fresh authorization runs before queued key exports without reordering either class',async()=>{
  const queue=new MediaWork(),order=[]
  const work=[queue.add(async()=>order.push('key1')),queue.add(async()=>order.push('policy1'),true),queue.add(async()=>order.push('key2')),queue.add(async()=>order.push('policy2'),true)]
  assert.equal(queue.waiting,true);await queue.drain();await Promise.all(work)
  assert.deepEqual(order,['policy1','policy2','key1','key2']);assert.equal(queue.waiting,false)
})
