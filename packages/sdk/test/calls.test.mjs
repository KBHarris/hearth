import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isIceConfiguration} from '../src/calls.ts'
import {HearthClient} from '../src/index.ts'

test('group support is explicitly announced without changing legacy endpoint requests',async t=>{
  const requests=[],device='a'.repeat(64),conversation='b'.repeat(64),client=new HearthClient('http://127.0.0.1:1234')
  t.mock.method(globalThis,'fetch',async(input,init)=>{const url=new URL(input);requests.push([url.pathname,url.search,init.headers.Authorization]);return url.pathname.includes('/media/')?Response.json({expires_at:Date.now()+3600000,ice_servers:[]}):new Response(null,{status:204})})
  await client.callConfiguration('session',device);await client.groupCallConfiguration('session',device)
  await client.callReady('session',conversation,device);await client.groupCallReady('session',conversation,device)
  assert.deepEqual(requests.map(request=>request[1]),['','?group=true&format=5','?format=5','?group=true&format=5']);assert.ok(requests.every(request=>request[2]==='Bearer session'))
})
test('ICE configuration accepts explicit bounded endpoints and rejects secret-bearing URLs and stale credentials',()=>{
  const expires_at=Date.now()+3600000
  assert.equal(isIceConfiguration({expires_at,ice_servers:[]}),true)
  assert.equal(isIceConfiguration({expires_at,ice_servers:[{urls:['stun:relay.example.org:3478'],username:null,credential:null},{urls:['turns:relay.example.org:5349?transport=tcp'],username:'expiry:scope',credential:'temporary'}]}),true)
  for(const url of ['https://relay.example.org','turn:user:private@relay.example.org','turn:relay.example.org/path','turn:relay.example.org?token=private','stun:relay.example.org?transport=udp','turn:','turn:relay.example.org:99999','turn:relay.example.org#private'])assert.equal(isIceConfiguration({expires_at,ice_servers:[{urls:[url],username:'scope',credential:'temporary'}]}),false,url)
  assert.equal(isIceConfiguration({expires_at:Date.now()-1,ice_servers:[]}),false)
  assert.equal(isIceConfiguration({expires_at:Date.now()+7200000,ice_servers:[]}),false)
})
