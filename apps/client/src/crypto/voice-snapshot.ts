/** Ignore expired occupancy without accepting it. A second read must still pass
 * every signature/permission check, and no retry extends the caller's watchdog. */
export async function verifiedVoiceSnapshot<T extends {room:{participants:readonly {expires_at:number}[]}}>(read:()=>Promise<T>,verify:(value:T,now:number)=>Promise<unknown>,now=Date.now):Promise<T>{
  for(let attempt=0;attempt<2;attempt++){
    const value=await read(),checkedAt=now()
    if(value.room.participants.some(peer=>peer.expires_at<=checkedAt))continue
    await verify(value,checkedAt)
    if(value.room.participants.every(peer=>peer.expires_at>now()))return value
  }
  throw Object.assign(new Error('Voice room occupancy expired. Retry with current participation.'),{status:409})
}
