import assert from 'node:assert/strict'
import {test} from 'node:test'
import {MediaKeys} from '../src/media/frame-keys.ts'
const key='ab'.repeat(32),next='cd'.repeat(32),id='11'.repeat(32),id2='22'.repeat(32),plain=new Uint8Array([1,2,3,4])
test('computer audio has a fourth encrypted slot that cannot decode as microphone, camera or screen video',async()=>{
  const a=new MediaKeys(0,4),b=new MediaKeys(1,4),legacy=new MediaKeys(1)
  for(const keys of [a,b,legacy]){await keys.install(key,1,id);keys.resume(id)}
  const wire=await a.frame('send',3,plain)
  assert.equal(await b.frame('receive',0,wire),null);assert.equal(await b.frame('receive',2,wire),null)
  assert.equal(await legacy.frame('receive',3,wire),null)
  assert.deepEqual(await b.frame('receive',3,wire),plain)
  assert.equal(await b.frame('receive',3,wire),null)
})
async function pair(){const a=new MediaKeys(0),b=new MediaKeys(1);await Promise.all([a.install(key,1,id),b.install(key,1,id)]);a.resume(id);b.resume(id);return[a,b]}
test('epoch rotation drops old frames, requires matching resume, and decodes only the new key',async()=>{
  const[a,b]=await pair(),old=await a.frame('send',0,plain)
  assert.deepEqual(await b.frame('receive',0,old),plain)
  const delayed=await a.frame('send',0,plain)
  a.pause();b.pause();assert.equal(await a.frame('send',0,plain),null)
  await Promise.all([a.install(next,2,id2),b.install(next,2,id2)])
  assert.throws(()=>a.resume(id));assert.equal(await b.frame('receive',0,delayed),null)
  a.resume(id2);b.resume(id2)
  assert.equal(await b.frame('receive',0,delayed),null);assert.equal(b.stats.staleDropped,1)
  const fresh=await a.frame('send',0,plain);assert.deepEqual(await b.frame('receive',0,fresh),plain)
  assert.equal(await b.frame('receive',0,fresh),null);assert.equal(b.stats.replayed,1)
  assert.notDeepEqual(old,fresh)
})
test('pausing invalidates in-flight encryption and authentication outputs',async()=>{
  const[a,b]=await pair(),wire=await a.frame('send',0,plain)
  const encrypted=a.frame('send',0,plain),decrypted=b.frame('receive',0,wire)
  a.pause();b.pause();assert.equal(await encrypted,null);assert.equal(await decrypted,null)
  assert.equal(b.stats.decrypted,0)
})
test('key installation cannot roll epochs back or resume a paused old key',async()=>{
  const[a]=await pair();await assert.rejects(a.install(next,2,id2));a.pause();assert.throws(()=>a.resume(id))
  await assert.rejects(a.install(key,1,id2));await a.install(next,2,id2);a.resume(id2)
  a.pause();await assert.rejects(a.install(key,1,id));await assert.rejects(a.install(next,2,id2))
})
test('a pause during asynchronous derivation invalidates that installation',async()=>{
  const a=new MediaKeys(0),install=a.install(key,1,id);a.pause();await assert.rejects(install);assert.throws(()=>a.resume(id))
})
