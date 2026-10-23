import assert from 'node:assert/strict'
import {test} from 'node:test'
import {restartDescription,restartId,RecoveryHandshake} from '../src/media/call-recovery.ts'
const id=n=>n.toString(16).padStart(64,'0')
test('restart markers bind one SDP transaction and reject ambiguous or malformed identifiers',()=>{
  const sdp=restartDescription('v=0\r\n',id(1))
  assert.equal(restartId(sdp),id(1));assert.equal(restartId('v=0\r\n'),undefined)
  for(const invalid of [sdp+sdp,sdp+'a=x-hearth-restart:bad\r\n','a=x-hearth-restart:BAD','a=x-hearth-restart-extra:'+id(1)])assert.throws(()=>restartId(invalid))
  assert.throws(()=>restartDescription(sdp,id(2)));assert.throws(()=>restartDescription('v=0','bad'))
})
test('answers cannot complete a different or previously completed transaction',()=>{
  const state=new RecoveryHandshake(false);state.start(id(1))
  assert.equal(state.answer(id(2)),false);assert.equal(state.pending,id(1))
  assert.equal(state.answer(id(1)),true);assert.equal(state.answer(id(1)),false)
  state.start(id(3));assert.equal(state.answer(id(1)),false);assert.equal(state.pending,id(3))
})
test('simultaneous restart offers converge on the original caller without losing its pending answer',()=>{
  const caller=new RecoveryHandshake(false),callee=new RecoveryHandshake(true)
  caller.start(id(1));callee.start(id(2))
  assert.equal(caller.incoming(id(2)),'ignore');assert.equal(caller.pending,id(1))
  assert.equal(callee.incoming(id(1)),'rollback');assert.equal(callee.pending,undefined)
  assert.equal(caller.answer(id(1)),true);assert.equal(callee.answer(id(2)),false)
  assert.equal(callee.incoming(id(1)),'ignore');assert.equal(caller.incoming(id(2)),'ignore')
})
test('replayed restart offers stay rejected beyond the rate-limit window',()=>{
  const state=new RecoveryHandshake(true)
  assert.equal(state.incoming(id(1),0),'answer')
  assert.equal(state.incoming(id(1),120_000),'ignore')
})
test('restart work is bounded per minute and a pending request cannot be replaced',()=>{
  const state=new RecoveryHandshake(false)
  for(let i=1;i<=6;i++){state.start(id(i),i);state.answer(id(i))}
  assert.throws(()=>state.start(id(7),7));state.start(id(8),60_010)
  assert.throws(()=>state.start(id(9),60_011));assert.equal(state.pending,id(8))
})
