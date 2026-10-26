import assert from 'node:assert/strict'
import {test} from 'node:test'
import {HearthClient,HearthError} from '../src/index.ts'
const community='a'.repeat(64),resource='b'.repeat(64)
test('deletion requests bind the community, resource and confirmed name',async()=>{
  const original=globalThis.fetch,calls=[]
  globalThis.fetch=async(url,options)=>{calls.push({url,method:options.method,body:JSON.parse(options.body),token:options.headers.Authorization});return new Response(null,{status:204})}
  try{
    const client=new HearthClient('http://127.0.0.1:8080')
    await client.deleteChannel('fixture',community,resource,'General')
    await client.deleteCategory('fixture',community,resource,'Gaming')
    await client.deleteCommunity('fixture',community,'Friends')
    assert.deepEqual(calls.map(call=>[call.url,call.method,call.body]),[
      [`http://127.0.0.1:8080/api/v1/communities/${community}/channels/${resource}/delete`,'POST',{expected_name:'General'}],
      [`http://127.0.0.1:8080/api/v1/communities/${community}/categories/${resource}/delete`,'POST',{expected_name:'Gaming'}],
      [`http://127.0.0.1:8080/api/v1/communities/${community}/delete`,'POST',{expected_name:'Friends'}]])
    assert.ok(calls.every(call=>call.token==='Bearer fixture'))
    assert.throws(()=>client.deleteChannel('fixture',community,'../other','General'))
    globalThis.fetch=async()=>new Response(null,{status:403})
    await assert.rejects(client.deleteCommunity('fixture',community,'Friends'),error=>error instanceof HearthError&&error.status===403)
  }finally{globalThis.fetch=original}
})
