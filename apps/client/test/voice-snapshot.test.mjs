import assert from 'node:assert/strict'
import {test} from 'node:test'
import {verifiedVoiceSnapshot} from '../src/crypto/voice-snapshot.ts'
const snapshot=expires_at=>({room:{participants:[{expires_at}]}})
test('expired occupancy is never accepted and the fresh replacement still requires verification',async()=>{
  let reads=0;const verified=[]
  const value=await verifiedVoiceSnapshot(async()=>snapshot(++reads===1?900:2000),async value=>verified.push(value),()=>1000)
  assert.equal(reads,2);assert.deepEqual(verified,[value]);assert.equal(value.room.participants[0].expires_at,2000)
})
test('expiry during verification causes a fresh read without changing the deadline',async()=>{
  let clock=1000,reads=0,checks=0
  const value=await verifiedVoiceSnapshot(async()=>snapshot(++reads===1?1100:3000),async()=>{checks++;clock=1200},()=>clock)
  assert.equal(reads,2);assert.equal(checks,2);assert.equal(value.room.participants[0].expires_at,3000)
})
test('bad signatures or denied access are terminal and stale retries are bounded',async()=>{
  let reads=0
  await assert.rejects(verifiedVoiceSnapshot(async()=>{reads++;return snapshot(2000)},async()=>{throw new Error('signature rejected')},()=>1000),/signature rejected/);assert.equal(reads,1)
  reads=0;await assert.rejects(verifiedVoiceSnapshot(async()=>{reads++;return snapshot(900)},async()=>assert.fail('Expired data cannot be accepted'),()=>1000),{status:409});assert.equal(reads,2)
  await assert.rejects(verifiedVoiceSnapshot(async()=>{throw Object.assign(new Error('forbidden'),{status:403})},async()=>{},()=>1000),{status:403})
})
