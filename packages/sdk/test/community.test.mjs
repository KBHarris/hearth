import assert from 'node:assert/strict'
import {test} from 'node:test'
import {HearthClient,HearthError} from '../src/index.ts'
import {isCommunityStructure,isChannelRoster} from '../src/community.ts'

const community={id:'a'.repeat(64),owner_id:'b'.repeat(64),name:'Test community'}
const category={id:'c'.repeat(64),community_id:community.id,name:'General'}
const channel={id:'d'.repeat(64),community_id:community.id,name:'chat',category_id:category.id,kind:'text'}
const owner={account:{id:community.owner_id,username:'owner',owner:true},devices:[{identity_key:'1'.repeat(64),device_key:'2'.repeat(64),certificate:'3'.repeat(128),account_signature:'4'.repeat(128),device_signature:'5'.repeat(128)}]}

test('channel roster rejects foreign routing, duplicate accounts and duplicate device proofs',()=>{
  const roster={community,channel,people:[owner],authority:null,policy:null,admissions:[],invitations:[]}
  assert.equal(isChannelRoster(roster),true)
  assert.equal(isChannelRoster({...roster,channel:{...channel,community_id:'f'.repeat(64)}}),false)
  assert.equal(isChannelRoster({...roster,people:[owner,owner]}),false)
  assert.equal(isChannelRoster({...roster,people:[owner,{...owner,account:{...owner.account,id:'f'.repeat(64)}}]}),false)
  assert.equal(isChannelRoster({...roster,people:[]}),false)
})
test('reject a directory with foreign categories, missing categories or repeated IDs',()=>{
  const structure={community,categories:[category],channels:[channel]}
  assert.equal(isCommunityStructure(structure),true)
  assert.equal(isCommunityStructure({...structure,channels:[channel,channel]}),false)
  assert.equal(isCommunityStructure({...structure,categories:[category,category]}),false)
  assert.equal(isCommunityStructure({...structure,categories:[{...category,community_id:'e'.repeat(64)}]}),false)
  assert.equal(isCommunityStructure({...structure,channels:[{...channel,category_id:'f'.repeat(64)}]}),false)
  assert.equal(isCommunityStructure({...structure,channels:[{...channel,kind:'plaintext'}]}),false)
})
test('community access carries a bearer token and fails closed on malformed responses',async()=>{
  const original=globalThis.fetch
  const token='e'.repeat(64)
  let calls=0
  globalThis.fetch=async(url,init)=>{
    calls++
    assert.equal(init.headers.Authorization,`Bearer ${token}`)
    assert.equal(init.credentials,'omit')
    assert.equal(init.redirect,'error')
    if(url==='https://hearth.example/api/v1/communities')return Response.json([community])
    if(url.endsWith('/join')) {
      assert.deepEqual(JSON.parse(init.body),{code:'f'.repeat(64)})
      return Response.json(community)
    }
    return Response.json({community,categories:[category],channels:[{...channel,community_id:'f'.repeat(64)}]})
  }
  try {
    const client=new HearthClient('https://hearth.example')
    assert.deepEqual(await client.communities(token),[community])
    assert.deepEqual(await client.joinCommunity(token,'f'.repeat(64)),community)
    await assert.rejects(client.communityStructure(token,community.id),error=>error instanceof HearthError && error.kind==='invalid_response')
    assert.throws(()=>client.communityStructure(token,'../../auth/admin/settings'))
    assert.equal(calls,3)
  }finally{globalThis.fetch=original}
})
