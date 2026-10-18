import test from 'node:test'
import assert from 'node:assert/strict'
import {conversationMembers,memberInitials} from '../src/members.ts'

const identity='a'.repeat(64),device={identity_key:identity,device_key:'b'.repeat(64)}
const person=(id,owner=false)=>({account:{id,username:id,owner},devices:[device]})
const people={alice:person('alice',true),bob:person('bob'),outsider:person('outsider')}
const conversation={accounts:['alice','bob'],members:[{account_id:'bob',enrollment:device}]}
const roster={people:[people.alice,people.bob],community:{owner_id:'alice'},authority:{owner:{account_id:'alice',enrollment:device}},admissions:[{account_id:'bob',identity_key:identity}],governance:{roles:[{id:'r',name:'Moderator'}],assignments:[{account_id:'bob',role_ids:['r']}]}}

test('the member sidebar never exposes unrelated cached accounts',()=>{
  assert.deepEqual(conversationMembers(conversation,roster,people,{}).map(m=>m.id),['alice','bob'])
  assert.deepEqual(conversationMembers(undefined,roster,people,{}),[])
})
test('authorized role labels, profiles and approval status are distinct',()=>{
  const members=conversationMembers(conversation,roster,people,{bob:{display_name:'Bobby',bio:'Shared encrypted bio'}})
  assert.deepEqual(members[0].roles,['Server owner','Community owner'])
  assert.equal(members[1].displayName,'Bobby')
  assert.deepEqual(members[1].roles,['Moderator'])
  assert.equal(members[1].approved,true)
  assert.equal(members[1].fingerprint,identity)
  assert.equal(members[1].bio,'Shared encrypted bio')
  assert.equal(conversationMembers(conversation,{...roster,admissions:[]},people,{})[1].approved,false)
})
test('DM fingerprints use only participants and missing identities stay unavailable',()=>{
  assert.equal(conversationMembers(conversation,undefined,{},{}).find(m=>m.id==='bob').fingerprint,identity)
  assert.equal(conversationMembers(conversation,undefined,{},{}).find(m=>m.id==='alice').fingerprint,null)
})
test('initial avatars preserve complete Unicode characters',()=>{
  assert.equal(memberInitials(' alice'),'AL')
  assert.equal(memberInitials('😀Z'),'😀Z')
})

test('signed admissions and conversation proofs take precedence over a substituted directory identity',()=>{
  const altered={...roster,people:roster.people.map(person=>({...person,devices:[{...device,identity_key:'f'.repeat(64)}]}))}
  assert.ok(conversationMembers(conversation,altered,people,{}).every(member=>member.fingerprint===identity&&member.approved))
  const directory={bob:{...people.bob,devices:[{...device,identity_key:'f'.repeat(64)}]}}
  assert.equal(conversationMembers(conversation,undefined,directory,{}).find(member=>member.id==='bob').fingerprint,identity)
})
