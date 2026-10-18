import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
test('notification worker never reads provider-supplied text or opens a provider URL',async()=>{
 const handlers={},calls=[];const self={location:{origin:'https://hearth.example'},addEventListener:(name,action)=>{handlers[name]=action},registration:{showNotification:async(...args)=>calls.push(args)},clients:{matchAll:async()=>[{url:'https://other.example/',focus:async()=>assert.fail('Wrong origin')}],openWindow:async url=>calls.push(url)}}
 runInNewContext(readFileSync(new URL('../../../apps/client/public/hearth-push.js',import.meta.url),'utf8'),{self,URL})
 let pending;handlers.push({data:{text(){assert.fail('Untrusted provider content read')}},waitUntil:p=>{pending=p}});await pending
 assert.equal(calls[0][0],'Hearth');assert.equal(calls[0][1].body,'New activity in Hearth.')
 handlers.notificationclick({notification:{close(){}},waitUntil:p=>{pending=p}});await pending;assert.equal(calls[1],'https://hearth.example/')
})
