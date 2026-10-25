import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mediaWirePrivate} from '../src/media/media-wire-audit.ts'

test('large room traffic is audited beyond 4096 frames without inventing a key leak',()=>{
  const key='a1'.repeat(32),frames=Array.from({length:5000},()=>'{"encrypted":"opaque"}')
  assert.equal(mediaWirePrivate(frames,new Set([key])),true)
  frames[4999]=JSON.stringify({disclosed:key})
  assert.equal(mediaWirePrivate(frames,new Set([key])),false)
})

test('the audit checks earlier frames against later captured keys and requires actual evidence',()=>{
  const key='b2'.repeat(32)
  assert.equal(mediaWirePrivate([JSON.stringify({disclosed:key}),'opaque'],new Set([key])),false)
  assert.equal(mediaWirePrivate([],new Set([key])),false)
  assert.equal(mediaWirePrivate(['opaque'],new Set()),false)
  assert.equal(mediaWirePrivate(['opaque'],new Set([''])),false)
})
