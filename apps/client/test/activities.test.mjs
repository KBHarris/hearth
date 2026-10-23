import assert from 'node:assert/strict'
import {test} from 'node:test'
import {playbackAddress,playbackEnabled,playbackTarget} from '../src/activities.ts'
test('provider links drop tracking and accept only canonical public media identifiers',()=>{
  assert.deepEqual(playbackAddress('https://youtu.be/abcdefghijk?tracking=private#secret'),{provider:'youtube',url:'https://www.youtube.com/watch?v=abcdefghijk'})
  assert.equal(playbackAddress('https://open.spotify.com/track/1234567890123456789012?si=private').url,'https://open.spotify.com/track/1234567890123456789012')
  assert.equal(playbackAddress('https://soundcloud.com/artist/track?secret_token=private').url,'https://soundcloud.com/artist/track')
  assert.equal(playbackEnabled('spotify'),false)
  assert.equal(playbackEnabled('youtube')&&playbackEnabled('soundcloud'),true)
  for(const bad of ['http://www.youtube.com/watch?v=abcdefghijk','https://user:secret@www.youtube.com/watch?v=abcdefghijk','https://www.youtube.com.evil.example/watch?v=abcdefghijk','https://open.spotify.com/playlist/1234567890123456789012','https://soundcloud.com/artist','https://localhost/private','javascript:alert(1)'])assert.throws(()=>playbackAddress(bad))
})
test('synchronization clamps clock skew, bounds position and pauses a stale host',()=>{
  const position={revision:1,playing:true,position_ms:1000,sent_at:10000}
  assert.deepEqual(playbackTarget(position,15000),{playing:true,positionMs:6000})
  assert.deepEqual(playbackTarget(position,40000),{playing:true,positionMs:16000})
  assert.deepEqual(playbackTarget(position,60000),{playing:false,positionMs:1000})
  assert.equal(playbackTarget(position,0).playing,false)
  assert.equal(playbackTarget({...position,playing:false},15000).positionMs,1000)
})
