import assert from 'node:assert/strict'
import {test} from 'node:test'
import {HearthClient,HearthError,Permission,permissions,mediaPermissions,withMediaPermissions,MEDIA_PERMISSIONS} from '../src/index.ts'
import {isGovernance,isGovernanceView} from '../src/governance.ts'
const id=n=>n.repeat(64)
const owner={account_id:id('a'),enrollment:{identity_key:id('b'),device_key:id('c'),certificate:'d'.repeat(128),account_signature:'e'.repeat(128),device_signature:'f'.repeat(128)}}
const policy={community_id:id('1'),revision:1,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'Be kind.',screening:true,owner,signature:'1'.repeat(128)}
test('media grants distinguish listeners and publishers and legacy stage upgrades preserve unrelated restrictions',()=>{
  const account=id('2'),stage=id('3'),publish=Permission.speak|Permission.camera|Permission.screen
  assert.equal(mediaPermissions(policy,15),MEDIA_PERMISSIONS)
  assert.equal(mediaPermissions(policy,15,true),Permission.connect|Permission.listen)
  const old={...policy,overrides:[{channel_id:stage,kind:'everyone',target_id:'',allow:0,deny:Permission.attach},{channel_id:stage,kind:'member',target_id:account,allow:Permission.send,deny:Permission.pin}]}
  const upgraded=withMediaPermissions(old,[stage]);assert.equal(isGovernance(upgraded),true)
  const bits=permissions(upgraded,owner.account_id,account,stage)
  assert.equal(bits&Permission.attach,0);assert.equal(bits&Permission.pin,0);assert.equal(bits&publish,0)
  assert.equal(mediaPermissions(upgraded,bits),Permission.connect|Permission.listen)
  assert.equal(isGovernance({...upgraded,media_version:2}),false)
  const timed={...upgraded,everyone:32767,sanctions:[{account_id:account,channel_id:null,kind:'timeout',until:100}]}
  assert.equal(mediaPermissions(timed,permissions(timed,owner.account_id,account,null,99))&publish,0)
})
test('permission display agrees on override precedence, owner access and timeout boundaries',()=>{
  const account=id('2'),channel=id('3'),role=id('4')
  const p={...policy,roles:[{id:role,name:'Pinners',permissions:Permission.pin}],assignments:[{account_id:account,role_ids:[role]}],overrides:[{channel_id:channel,kind:'everyone',target_id:'',allow:0,deny:Permission.read},{channel_id:channel,kind:'role',target_id:role,allow:Permission.read,deny:Permission.pin},{channel_id:channel,kind:'member',target_id:account,allow:Permission.pin,deny:Permission.attach}]}
  assert.equal(permissions(p,owner.account_id,account,channel,0),23)
  assert.equal(permissions(p,owner.account_id,account,id('5'),0),31)
  const timed={...p,sanctions:[{account_id:account,channel_id:channel,kind:'timeout',until:100}]}
  assert.equal(permissions(timed,owner.account_id,account,channel,99),1)
  assert.equal(permissions(timed,owner.account_id,account,channel,100),23)
  const banned={...p,sanctions:[{account_id:account,channel_id:null,kind:'ban',until:null}]}
  assert.equal(permissions(banned,owner.account_id,account,channel),0)
  assert.equal(permissions(banned,owner.account_id,owner.account_id,channel),32767)
})
test('governance response rejects unknown bits, conflicting overrides and malformed consent',()=>{
  assert.equal(isGovernance(policy),true)
  assert.equal(isGovernance({...policy,everyone:1024}),false)
  assert.equal(isGovernance({...policy,rules:'x'.repeat(4097)}),false)
  assert.equal(isGovernance({...policy,overrides:[{channel_id:id('3'),kind:'everyone',target_id:'',allow:1,deny:1}]}),false)
  const view={governance:policy,members:[{id:owner.account_id,username:'owner',owner:true}],rules_accepted:false}
  assert.equal(isGovernanceView(view),true)
  assert.equal(isGovernanceView({...view,rules_accepted:'false'}),false)
})
test('rules acceptance uses the scoped bearer endpoint and fails closed on malformed policy',async()=>{
  const original=globalThis.fetch,token=id('9'),digest=id('8')
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://hearth.example/api/v1/communities/'+policy.community_id+'/rules/accept')
    assert.equal(init.headers.Authorization,'Bearer '+token)
    assert.equal(init.credentials,'omit')
    assert.equal(init.redirect,'error')
    assert.deepEqual(JSON.parse(init.body),{digest})
    return Response.json({governance:{...policy,everyone:2048},members:[],rules_accepted:true})
  }
  try{await assert.rejects(new HearthClient('https://hearth.example').acceptRules(token,policy.community_id,digest),error=>error instanceof HearthError&&error.kind==='invalid_response')}finally{globalThis.fetch=original}
})
