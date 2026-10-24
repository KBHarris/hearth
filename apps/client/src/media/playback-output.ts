/** Session-local device choices. Device identifiers never enter storage or wire. */
type Output={device:string;volume:number;deafened:boolean}
let output:Output={device:'',volume:1,deafened:false}
const players=new Set<HTMLMediaElement>(),listeners=new Set<()=>void>()
let pending:Promise<unknown>=Promise.resolve()
function enqueue<T>(operation:()=>Promise<T>):Promise<T>{const next=pending.then(operation);pending=next.catch(()=>{});return next}
export const outputSnapshot=()=>output
export function subscribeOutput(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
async function apply(player:HTMLMediaElement,value:Output){
  if(value.device&&typeof player.setSinkId!=='function')throw new Error('This runtime does not support speaker selection. Use your system sound settings.')
  if(typeof player.setSinkId==='function'&&player.sinkId!==value.device)await player.setSinkId(value.device)
  player.volume=value.volume;player.muted=value.deafened
}
export function setOutput(value:Output){
  if(!Number.isFinite(value.volume)||value.volume<0||value.volume>1)return Promise.reject(new Error('Choose a volume from 0 to 100 percent.'))
  const requested={...value}
  return enqueue(async()=>{
    const previous=output
    try{await Promise.all([...players].map(player=>apply(player,requested)));output=requested;for(const listener of listeners)listener()}
    catch(error){await Promise.all([...players].map(player=>apply(player,previous).catch(()=>{})));throw error}
  })
}
export function registerOutput(player:HTMLMediaElement){player.volume=output.volume;player.muted=output.deafened;players.add(player);void enqueue(async()=>{if(players.has(player))await apply(player,output)}).catch(()=>{});return()=>{players.delete(player)}}
