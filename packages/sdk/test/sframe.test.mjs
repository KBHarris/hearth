import assert from 'node:assert/strict'
import {test} from 'node:test'
import {SFrameCipher,sframeHeader} from '../src/sframe.ts'
const unhex=s=>new Uint8Array(Buffer.from(s,'hex'))
test('SFrame matches RFC 9605 AES-128-GCM vector including metadata',async()=>{
  const cipher=await SFrameCipher.create(unhex('000102030405060708090a0b0c0d0e0f'),0x123n,0x4567n)
  const encrypted=await cipher.encrypt(unhex('64726166742d696574662d736672616d652d656e63'),unhex('4945544620534672616d65205747'))
  assert.equal(Buffer.from(encrypted).toString('hex'),'9901234567b7412c2513a1b66dbb48841bbaf17f598751176ad847681a69c6d0b091c07018ce4adb34eb')
  assert.equal(Buffer.from(await cipher.decrypt(encrypted,unhex('4945544620534672616d65205747'))).toString('hex'),'64726166742d696574662d736672616d652d656e63')
})
test('SFrame rejects wrong keys, stream IDs, tampering, replay and stale window but permits reordering',async()=>{
  const key=crypto.getRandomValues(new Uint8Array(32)),wrong=crypto.getRandomValues(new Uint8Array(32))
  const sender=await SFrameCipher.create(key,0n),receiver=await SFrameCipher.create(key,0n)
  const a=await sender.encrypt(new Uint8Array([1,2,3])),b=await sender.encrypt(new Uint8Array([4,5,6]))
  await assert.rejects((await SFrameCipher.create(wrong,0n)).decrypt(a))
  await assert.rejects((await SFrameCipher.create(key,1n)).decrypt(a))
  const tampered=a.slice();tampered[tampered.length-1]^=1
  await assert.rejects(receiver.decrypt(tampered))
  assert.deepEqual(await receiver.decrypt(b),new Uint8Array([4,5,6]))
  assert.deepEqual(await receiver.decrypt(a),new Uint8Array([1,2,3]))
  await assert.rejects(receiver.decrypt(a))
  for(let i=0;i<130;i++)await receiver.decrypt(await sender.encrypt(new Uint8Array([7])))
  await assert.rejects(receiver.decrypt(b))
  assert.equal(Buffer.from(sframeHeader(0n,256n)).toString('hex'),'090100')
  assert.throws(()=>sframeHeader(-1n,0n))
})
