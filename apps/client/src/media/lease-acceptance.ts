import type {MessagingSession} from '../crypto/messaging-session'
import type {VoiceRoomCall} from './voice-room'
import type {VoicePresence} from '@hearth/sdk'
/** Explicit fixture probe: hold durable work while renewing the real signed
 * lease, and verify that this does not advance fresh-policy authorization. */
export async function verifyIndependentLease(service:MessagingSession,call:VoiceRoomCall){
  const internal=service as unknown as {tail:Promise<unknown>},room=call as unknown as {presence:(active:boolean)=>VoicePresence;checkedAt:number}
  await internal.tail
  let release!:()=>void,settled=false
  internal.tail=new Promise<void>(resolve=>{release=resolve})
  const checkedAt=room.checkedAt,pending=service.voiceRoom(call.state.channel).then(()=>{settled=true})
  try{
    const expires=await service.renewVoicePresence(room.presence(true))
    if(expires<=Date.now()||settled||room.checkedAt!==checkedAt)throw new Error('Presence renewal incorrectly depended on or advanced durable authorization')
    return {renewedWhileDurableWorkHeld:true,authorizationDeadlineUnchanged:true}
  }finally{release();await pending}
}
