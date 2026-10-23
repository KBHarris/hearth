import type {VoiceRoom} from '@hearth/sdk'
import type {GroupContext,GroupKeyState} from './group-admission.ts'

/** Input must already pass SDK bounds, device signatures and current MLS policy.
 * Expiry is renewed independently from the immutable media transcript. */
export const voiceManifest=(room:VoiceRoom)=>JSON.stringify([room.channel_id,room.room_id,room.epoch,room.revision,room.relay_only,room.participants.map(peer=>[peer.device_key,peer.incarnation,peer.public_key]),...(room.sfu?['sfu',room.capacity]:[])])
export async function voiceContext(server:string,room:VoiceRoom):Promise<GroupContext>{
  const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['hearth/v1/voice-room/mesh',server,voiceManifest(room)])))),byte=>byte.toString(16).padStart(2,'0')).join('')
  return {server,conversation:room.channel_id,id,epoch:room.epoch,host:room.participants[0].device_key,participants:room.participants.map(peer=>peer.device_key),relayOnly:room.relay_only,voiceRoom:room.room_id,...(room.sfu?{sfu:true}:{})}
}
export class VoiceMembership implements GroupKeyState {
  readonly context:GroupContext
  readonly own:string
  private room:VoiceRoom
  private ended=false
  private version=0
  constructor(context:GroupContext,own:string,room:VoiceRoom){this.context=context;this.own=own;this.room=room}
  get generation(){return this.version}
  get stopped(){return this.ended}
  get canPublish(){this.checkTime();return !this.ended&&this.context.participants.includes(this.own)&&this.context.participants.length>1}
  refresh(room:VoiceRoom){if(voiceManifest(room)!==voiceManifest(this.room))throw new Error('Voice room membership changed');this.room=room}
  transcript(){if(!this.canPublish)throw new Error('Join a live voice room before deriving keys');return this.room.participants.map(peer=>[peer.device_key,peer.public_key,peer.incarnation])}
  checkTime(now=Date.now()){if(this.room.participants.some(peer=>peer.expires_at<=now))this.end('Voice room presence expired')}
  end(_reason:string){if(!this.ended){this.ended=true;this.version++}}
}
