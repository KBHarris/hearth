import assert from 'node:assert/strict'
import {test} from 'node:test'
import {startPlayback} from '../src/media/playback.ts'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
class Player extends EventTarget{
  error=null;srcObject=null;plays=0;pauses=0
  play(){this.plays++;return Promise.resolve()}
  pause(){this.pauses++}
  fail(){this.error={code:3};this.dispatchEvent(new Event('error'))}
}
test('late decoder failures show a retry and automatic output resets stop at their bound',async()=>{
  const player=new Player(),stream=new EventTarget(),states=[],timers=[]
  const playback=startPlayback(player,stream,value=>states.push(value),(work,ms)=>{const timer={work,ms,cancelled:false};timers.push(timer);return()=>{timer.cancelled=true}})
  await tick();assert.equal(states.at(-1),false)
  for(let index=0;index<3;index++){player.fail();assert.equal(states.at(-1),true);assert.equal(timers[index].ms,(index+1)*1000);timers[index].work();assert.equal(player.srcObject,stream);await tick()}
  player.fail();assert.equal(timers.length,3);assert.equal(player.plays,4);assert.equal(states.at(-1),true)
  playback.retry();await tick();assert.equal(player.plays,5);assert.equal(states.at(-1),false)
  playback.close();assert.equal(player.srcObject,null);assert.equal(player.pauses,1)
  player.fail();assert.equal(timers.length,3)
})
test('gesture rejection stays visible without a retry loop; closing cancels stale completion and pending retries',async()=>{
  const player=new Player(),stream=new EventTarget(),states=[];let resolve,cancelled=false
  player.play=()=>Promise.reject(new DOMException('gesture','NotAllowedError'))
  const playback=startPlayback(player,stream,value=>states.push(value),()=>{throw new Error('Unexpected automatic gesture retry')})
  await tick();assert.deepEqual(states,[true]);player.play=()=>new Promise(done=>{resolve=done});playback.retry();playback.close();resolve();await tick();assert.deepEqual(states,[true])
  const other=new Player(),second=startPlayback(other,stream,()=>{},()=>()=>{cancelled=true})
  other.fail();second.close();assert.equal(cancelled,true)
})
