import assert from 'node:assert/strict'
import {test} from 'node:test'
import {sfuRoutes} from '../src/media/sfu-routes.ts'
function transport(kind){let calls=0;return {get calls(){return calls},async getStats(){calls++;return new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{type:'candidate-pair',localCandidateId:'candidate'}],['candidate',{type:'local-candidate',candidateType:kind}]])}}}
test('single-PC SFU validates the actual bidirectional route without requiring an unused subscriber PC',async()=>{
  const publisher=transport('relay'),result=await sfuRoutes({mode:'publisher-only',publisher})
  assert.equal(publisher.calls,1);assert.ok(result.every(side=>side.selectedRelay&&side.hostCandidates===0))
})
test('dual-PC SFU privacy requires each transport; host or absent routes cannot pass',async()=>{
  for(const subscriber of [transport('host'),undefined]){
    const result=await sfuRoutes({mode:'subscriber-primary',publisher:transport('relay'),subscriber})
    assert.equal(result[0].selectedRelay,true);assert.equal(result[1].selectedRelay,false)
  }
  assert.ok((await sfuRoutes()).every(side=>!side.selectedRelay))
})
