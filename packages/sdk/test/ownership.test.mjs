import assert from 'node:assert/strict'
import {test} from 'node:test'
import {HearthClient,HearthError} from '../src/index.ts'
import {isAuthority,isOwnershipHandoff} from '../src/community.ts'
import {isAudit} from '../src/governance.ts'
const id=n=>n.repeat(64),signature='a'.repeat(128)
const member=n=>({account_id:id(n),enrollment:{identity_key:id('b'),device_key:id('c'),certificate:signature,account_signature:signature,device_signature:signature}})
const root={community_id:id('1'),owner:member('2'),signature}
const offer={previous:root,issuer:root.owner,successor:member('3'),endorsed:[id('4'),id('5')],signature}
test('ownership responses bound nested lineage and require sorted unique exact object digests',()=>{
  assert.equal(isOwnershipHandoff(offer),true)
  assert.equal(isOwnershipHandoff({...offer,endorsed:[id('5'),id('4')]}),false)
  assert.equal(isOwnershipHandoff({...offer,endorsed:[id('4'),id('4')]}),false)
  assert.equal(isOwnershipHandoff({...offer,issuer:{}}),false)
  let authority=root
  for(let i=0;i<8;i++)authority={...root,handoff:{...offer,previous:authority}}
  assert.equal(isAuthority(authority),true)
  assert.equal(isAuthority({...root,handoff:{...offer,previous:authority}}),false)
  assert.equal(isAudit([{revision:2,actor_id:id('3'),action:'ownership_transfer',digest:id('4')}]),true)
})
test('ownership offer and acceptance use scoped bearer requests and reject malformed authority',async()=>{
  const original=globalThis.fetch,token=id('9'),client=new HearthClient('https://hearth.example')
  let step=0
  globalThis.fetch=async(url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer '+token);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error')
    assert.equal(url,`https://hearth.example/api/v1/communities/${root.community_id}/ownership${step++?'/accept':''}`)
    return Response.json(step===1?offer:{...root,signature:'invalid'})
  }
  try{assert.deepEqual(await client.offerOwnership(token,root.community_id,offer),offer);await assert.rejects(client.acceptOwnership(token,root.community_id,{}),e=>e instanceof HearthError&&e.kind==='invalid_response')}finally{globalThis.fetch=original}
})
