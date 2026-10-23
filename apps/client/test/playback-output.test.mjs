import assert from 'node:assert/strict'
import {test} from 'node:test'
import {registerOutput,setOutput,outputSnapshot} from '../src/media/playback-output.ts'

test('speaker changes serialize, preserve deafen/volume and roll back a rejected device',async()=>{
  let release,hold=false
  const player={volume:1,muted:false,sinkId:'',async setSinkId(device){if(device==='missing')throw new Error('disconnected');if(hold){hold=false;await new Promise(resolve=>{release=resolve})}this.sinkId=device}}
  const remove=registerOutput(player)
  try{
    await setOutput({device:'',volume:1,deafened:false});hold=true
    const first=setOutput({device:'headset',volume:.4,deafened:true}),second=setOutput({device:'speakers',volume:.8,deafened:false})
    await new Promise(resolve=>setImmediate(resolve));assert.equal(player.sinkId,'');release();await Promise.all([first,second])
    assert.deepEqual(outputSnapshot(),{device:'speakers',volume:.8,deafened:false});assert.equal(player.sinkId,'speakers');assert.equal(player.volume,.8);assert.equal(player.muted,false)
    await assert.rejects(setOutput({device:'missing',volume:0,deafened:true}));assert.equal(player.sinkId,'speakers');assert.equal(player.volume,.8)
    await assert.rejects(setOutput({device:'',volume:NaN,deafened:false}))
  }finally{remove();await setOutput({device:'',volume:1,deafened:false})}
})

test('unsupported output selection fails visibly while ordinary volume and deafen still work',async()=>{
  const player={volume:1,muted:false},remove=registerOutput(player)
  try{await assert.rejects(setOutput({device:'headset',volume:1,deafened:false}),/system sound settings/);await setOutput({device:'',volume:.3,deafened:true});assert.equal(player.volume,.3);assert.equal(player.muted,true)}finally{remove();await setOutput({device:'',volume:1,deafened:false})}
})
