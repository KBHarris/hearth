/** Recover a transient decoder/output failure without recapture or new keys.
 * Gesture restrictions remain visible; automatic retries are bounded. */
export function startPlayback(player:HTMLMediaElement,stream:MediaStream,blocked:(value:boolean)=>void,schedule=(work:()=>void,ms:number)=>{const timer=setTimeout(work,ms);return()=>clearTimeout(timer)}){
  let closed=false,generation=0,retries=0,cancel:(()=>void)|undefined
  function play(reset=false){
    if(closed)return
    cancel?.();cancel=undefined
    const current=++generation
    if(reset&&player.error){player.srcObject=null;player.srcObject=stream}
    // Keep play synchronous with an explicit retry click for gesture policies.
    void player.play().then(()=>{if(!closed&&current===generation)blocked(false)},()=>{if(!closed&&current===generation)blocked(true)})
  }
  function failed(){
    if(closed)return
    generation++;blocked(true)
    if(player.error?.code===3&&retries<3&&!cancel){retries++;cancel=schedule(()=>{cancel=undefined;play(true)},retries*1000)}
  }
  const added=()=>play()
  player.addEventListener('error',failed);stream.addEventListener('addtrack',added)
  player.srcObject=stream;play()
  return {retry(){retries=0;play(true)},close(){closed=true;generation++;cancel?.();player.removeEventListener('error',failed);stream.removeEventListener('addtrack',added);player.pause();player.srcObject=null}}
}
