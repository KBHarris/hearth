import assert from 'node:assert/strict'
import {test} from 'node:test'
import {RemoteRoomMedia,roomMediaDescription} from '../src/media/room-media.ts'

test('encrypted camera and screen flags are scoped per sender and reject stale or conflicting states',()=>{
  const media=new RemoteRoomMedia()
  assert.deepEqual(media.receive('alice',roomMediaDescription(1,{camera:true,sharing:true})),{camera:true,sharing:true,systemAudio:false})
  assert.deepEqual(media.receive('bob',roomMediaDescription(1,{camera:false,sharing:true})),{camera:false,sharing:true,systemAudio:false})
  assert.deepEqual(media.receive('alice','00000002:00'),{camera:false,sharing:false})
  assert.equal(media.receive('alice','00000001:11'),null)
  assert.equal(media.receive('alice',null),null)
  assert.equal(media.receive('alice','00000002:00'),null)
  assert.throws(()=>media.receive('alice','00000002:10'))
  media.clear();assert.deepEqual(media.receive('alice','00000001:10'),{camera:true,sharing:false})
})

test('media controls accept only bounded canonical counters and two binary flags',()=>{
  for(const description of ['00000000:00','1:10','00000001:20','00000001:0000','00000001:0😀','999999999:11'])assert.throws(()=>new RemoteRoomMedia().receive('alice',description))
  for(const revision of [0,-1,1.1,100_000_000,NaN])assert.throws(()=>roomMediaDescription(revision,{camera:false,sharing:false}))
  assert.equal(roomMediaDescription(99_999_999,{camera:false,sharing:true}),'99999999:010')
})
