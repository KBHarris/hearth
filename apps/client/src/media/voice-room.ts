import type {CallSignal,Conversation,LocalCallSignal,VoicePresence,VoiceRoom,SfuAccess} from '@hearth/sdk'
import {Permission,MEDIA_PERMISSIONS} from '@hearth/sdk'
import {DirectCall,callCapability,type CallState,type CallTransport} from './direct-call.ts'
import {GroupKeyAgreement,type GroupContext} from './group-admission.ts'
import {groupEdgeId} from './group-call.ts'
import {VoiceMembership,voiceContext,voiceManifest} from './voice-membership.ts'
import {SfuKeys} from './sfu-keys.ts'
import {captureDisplay} from './display-capture.ts'
import type {SfuSession,SfuSource} from './sfu-session.ts'
import {RemoteRoomMedia,roomMediaDescription,type RoomMediaKind} from './room-media.ts'
type View={room:VoiceRoom;conversation:Conversation;permissions?:Record<string,number>;stage?:boolean}
export interface VoiceTransport extends Pick<CallTransport,'callDevice'|'callAccount'|'callKey'|'send'|'onCall'> {
  renewVoicePresence?:(value:VoicePresence)=>Promise<number>
  sfuAccess?:(id:string,revision:number)=>Promise<SfuAccess>
  voiceRoom:(id:string)=>Promise<View>
  voicePresence:(value:VoicePresence)=>Promise<View>
}
export type VoiceState={phase:'idle'|'joining'|'waiting'|'connecting'|'connected'|'ended';channel:string;message:string;muted:boolean;camera:boolean;sharing:boolean;cameraPending:boolean;sharingPending:boolean;mediaNotice:string;relayOnly:boolean;capacity:number;sfu:boolean;systemAudio:boolean;participants:{device:string;account:string;remote:MediaStream|null;phase:string;camera?:boolean;sharing?:boolean;cameraTrack?:MediaStreamTrack|null;screenTrack?:MediaStreamTrack|null;systemAudio?:boolean;systemAudioTrack?:MediaStreamTrack|null}[]}
export const idleVoice:VoiceState={phase:'idle',channel:'',message:'',muted:false,camera:false,sharing:false,cameraPending:false,sharingPending:false,mediaNotice:'',relayOnly:false,capacity:4,sfu:false,systemAudio:false,participants:[]}
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')
const hex=(key:Uint8Array)=>Array.from(key,byte=>byte.toString(16).padStart(2,'0')).join('')
const transient=(error:unknown)=>['network','timeout'].includes((error as {kind?:string})?.kind??'')||(error as {name?:string})?.name==='RoomSignalingPending'||[409,503].includes((error as {status?:number})?.status??0)
const signalingPending=()=>Object.assign(new Error('Room signaling is awaiting delivery.'),{name:'RoomSignalingPending'})
type Edge={id:string;call:DirectCall;listener?:(event:LocalCallSignal)=>void;answering:boolean}

/** Persistent channel, explicit local participation, bounded four-person mesh.
 * Server occupancy is signed by devices; all media keys remain on endpoints. */
export class VoiceRoomCall {
  state:VoiceState={...idleVoice}
  private active=false
  private generation=0
  private mesh=0
  private created=0
  private checkedAt=0
  private lastPoll=0
  private renewedAt=0
  private lastHeartbeat=0
  private issuedAt=0
  private snapshot:View|null=null
  private permissions=new Map<string,number>()
  private own:VoicePresence|null=null
  private contribution:GroupKeyAgreement|null=null
  private agreement:GroupKeyAgreement|null=null
  private admission:VoiceMembership|null=null
  private edges=new Map<string,Edge>()
  private pending:LocalCallSignal[]=[]
  private sfu:SfuSession|null=null
  private sfuKeys:SfuKeys|null=null
  private sfuPublishedKeys=false
  private lastSfuKeys=0
  private sfuSerial:Promise<void>=Promise.resolve()
  private recovering=false
  private retainedCapture=false
  private recoveryUntil=0
  private recoveryEpoch=0
  private recoveries:number[]=[]
  private restoredVideo=0
  private speakConsent=true
  private refreshPromise:Promise<void>|null=null
  private renewing=false
  private timer:ReturnType<typeof setInterval>|undefined
  private connectUntil=0
  private source:MediaStream|null=null
  private sourcePromise:Promise<MediaStream>|null=null
  private sourceVersion=0
  private videoSources=new Map<RoomMediaKind,MediaStream>()
  private videoVersion={camera:0,screen:0}
  private deviceVersion={audio:0,video:0}
  private cameraDevice=''
  private mediaRevision=1
  private remoteMedia=new RemoteRoomMedia()
  private ice:RTCIceServer[]=[]
  private dispose:()=>void
  private fault:{operation:string;name?:string;status?:number;reason?:number;stage?:string;leaseRemaining?:number;checkedAge?:number;locations?:string[]}|null=null
  private failed(operation:string,error:unknown){
    this.fault={operation,name:error instanceof Error?error.name:'untyped',locations:error instanceof Error?error.stack?.split('\n').map(line=>line.match(/(?:voice-room|group-admission|direct-call|messaging-session)\.ts:\d+:\d+/)?.[0]).filter((line):line is string=>!!line).slice(0,5):[]}
    const status=(error as {status?:unknown})?.status;if(typeof status==='number')this.fault.status=status
    const reason=['Your voice room participation is no longer active.','The voice room roster moved backwards.','Encrypted message or device verification failed. Existing data was preserved; sign in again to retry.','Group call ended during key agreement','Unknown SFU participant'].indexOf(error instanceof Error?error.message:'');if(reason>=0)this.fault.reason=reason
  }
  failureDiagnostics(){return this.fault}
  private transport:VoiceTransport
  private server:string
  private changed:(state:VoiceState)=>void
  private capture:(constraints:MediaStreamConstraints)=>Promise<MediaStream>
  private available:()=>boolean
  private displayCapture:(audio?:boolean)=>Promise<MediaStream>
  constructor(transport:VoiceTransport,server:string,changed:(state:VoiceState)=>void,
    capture=(constraints:MediaStreamConstraints)=>navigator.mediaDevices.getUserMedia(constraints),available=()=>true,
    displayCapture=captureDisplay){
    this.transport=transport;this.server=server;this.changed=changed;this.capture=capture;this.available=available;this.displayCapture=displayCapture
    this.dispose=transport.onCall(event=>{
      if(!event.signal.voice_room||!this.active||event.conversation_id!==this.state.channel)return
      // Recovery owns fresh admission. Old-room controls must not race its new
      // contribution or trigger a second refresh against a replaced incarnation.
      if(this.recovering)return
      if(event.signal.kind.startsWith('sfu-')){
        if(this.matches(event.signal)&&this.sfu&&this.sfuKeys)this.receiveSfu(event.signal,this.mesh)
        else if(event.signal.expires_at>Date.now()){
          if(this.pending.length<128)this.pending.push(event)
          const generation=this.generation
          void this.refresh().catch(error=>{if(generation===this.generation){this.failed('sfu-refresh',error);if(transient(error))this.recover('Reconnecting encrypted room signaling…');else this.finish('SFU room access was lost.')}})
        }
        return
      }
      const edge=this.edges.get(event.signal.from_device)
      if(event.signal.kind==='room-heartbeat'&&this.matches(event.signal)&&event.signal.call_id===this.admission?.context.id&&edge){
        if(event.signal.expires_at<=Date.now()||event.signal.expires_at>Date.now()+65_000)return
        // The MLS engine authenticates the parent broadcast to the selected room
        // roster. Each child consumes liveness only for that authenticated peer.
        try{const flags=this.remoteMedia.receive(event.signal.from_device,event.signal.description);if(flags)this.publish({participants:this.state.participants.map(person=>person.device===event.signal.from_device?{...person,...flags}:person)})}catch{this.finish('Room media state could not be verified.');return}
        edge.listener?.({...event,signal:{...event.signal,kind:'heartbeat',description:null,call_id:edge.id,to_device:this.transport.callDevice}});return
      }
      if(this.matches(event.signal)&&edge?.id===event.signal.call_id){edge.listener?.(event);return}
      if(event.signal.kind==='offer'&&event.signal.expires_at>Date.now()){
        if(this.pending.length<8)this.pending.push(event)
        const generation=this.generation
        void this.refresh().catch(error=>{if(generation===this.generation){this.failed('offer-refresh',error);this.finish('Voice room access was lost.')}})
      }
    },id=>{if(!id||id===this.state.channel)this.finish('Voice room ended because encryption or access changed.')},(id,epoch)=>{if(id===this.state.channel&&(!epoch||epoch>(this.own?.epoch??0)))this.recover('Updating room encryption…',epoch??(this.own?.epoch??0)+1)})
  }
  get busy(){return this.active}
  private publish(patch:Partial<VoiceState>){this.state={...this.state,...patch};this.changed(this.state)}
  private current(generation=this.generation){if(!this.active||generation!==this.generation)throw new Error('You left the voice room')}
  private checkMesh(version:number){this.current();if(version!==this.mesh||!this.admission||this.admission.stopped)throw new Error('Voice room membership changed')}
  private matches(signal:CallSignal){const context=this.admission?.context;return !!context&&signal.voice_room===context.voiceRoom&&signal.group_id===context.id&&signal.epoch===context.epoch&&signal.relay_only===context.relayOnly&&JSON.stringify(signal.participants)===JSON.stringify(context.participants)}
  async join(channel:string,relayOnly=false,ice:RTCIceServer[]=[]){
    if(this.active||!this.available())throw new Error('Leave the current call first.')
    if(!callCapability())throw new Error('This runtime cannot encrypt voice frames.')
    if(relayOnly&&!ice.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url))))throw new Error('Relay-only voice rooms need a configured TURN relay.')
    this.active=true;this.fault=null;this.recoveries=[];const generation=++this.generation;this.created=this.checkedAt=Date.now();this.ice=ice
    this.publish({...idleVoice,phase:'joining',channel,relayOnly,message:'Checking voice room access…'})
    this.timer=setInterval(()=>this.watch(),1000)
    try{
      const initial=await this.transport.voiceRoom(channel);this.current(generation)
      this.speakConsent=!!((initial.permissions?.[this.transport.callDevice]??MEDIA_PERMISSIONS)&Permission.speak)
      if(initial.room.participants.length&&initial.room.relay_only!==relayOnly)throw new Error('This room has a different connection privacy setting. Refresh the room and review it before joining.')
      const context:GroupContext={server:this.server,conversation:channel,id:initial.room.room_id,epoch:initial.room.epoch,host:this.transport.callDevice,participants:[this.transport.callDevice],relayOnly,voiceRoom:initial.room.room_id,...(initial.room.sfu?{sfu:true as const}:{})}
      const contribution=await GroupKeyAgreement.create(context,this.transport.callDevice)
      if(!this.active||generation!==this.generation){contribution.close();return}
      this.contribution=contribution
      this.publish({sfu:!!initial.room.sfu,capacity:initial.room.capacity})
      this.own={...(initial.room.sfu?{sfu:true}:{}),channel_id:channel,room_id:initial.room.room_id,epoch:initial.room.epoch,device_key:this.transport.callDevice,incarnation:randomId(),public_key:contribution.publicKey,relay_only:relayOnly,active:true,issued_at:0,expires_at:0,signature:''}
      const view=await this.transport.voicePresence(this.presence(true));this.current(generation)
      this.renewedAt=this.checkedAt=Date.now();await this.apply(view,generation)
    }catch(error){if(generation===this.generation){this.failed('join',error);this.finish(error instanceof Error?error.message:'The voice room could not be joined.')}throw error}
  }
  private presence(active:boolean){
    if(!this.own)throw new Error('No voice room presence')
    this.issuedAt=Math.max(Date.now(),this.issuedAt+1)
    return {...this.own,active,issued_at:this.issuedAt,expires_at:this.issuedAt+30_000}
  }
  private async refresh(maxAge=2000){
    this.current();if(this.snapshot&&Date.now()-this.checkedAt<maxAge)return
    if(!this.refreshPromise){
      const generation=this.generation
      const request=this.transport.voiceRoom(this.state.channel).then(async view=>{this.current(generation);await this.apply(view,generation);this.current(generation);this.checkedAt=Date.now()})
      this.refreshPromise=request
      void request.finally(()=>{if(this.refreshPromise===request)this.refreshPromise=null}).catch(()=>{})
    }
    await this.refreshPromise
  }
  private async apply(view:View,generation:number){
    this.current(generation)
    const {room,conversation}=view,previous=this.snapshot?.room,own=room.participants.find(peer=>peer.device_key===this.transport.callDevice)
    this.permissions=new Map(conversation.members.map(peer=>[peer.enrollment.device_key,view.permissions?.[peer.enrollment.device_key]??MEDIA_PERMISSIONS]))
    const ownPermissions=this.permissions.get(this.transport.callDevice)??0
    if(!(ownPermissions&Permission.speak)){this.speakConsent=false;this.stopSource()}
    if(!(ownPermissions&Permission.camera))this.stopVideo('camera')
    if(!(ownPermissions&Permission.screen))this.stopVideo('screen')
    if(!this.own||room.channel_id!==this.state.channel||room.room_id!==this.own.room_id||room.epoch!==this.own.epoch||room.sfu!==this.own.sfu||room.relay_only!==this.state.relayOnly||!own||own.incarnation!==this.own.incarnation||own.public_key!==this.own.public_key)throw new Error('Your voice room participation is no longer active.')
    const manifest=voiceManifest(room)
    if(previous&&(room.revision<previous.revision||room.revision===previous.revision&&manifest!==voiceManifest(previous)))throw new Error('The voice room roster moved backwards.')
    this.own={...this.own,expires_at:own.expires_at};this.snapshot=view
    if(previous&&manifest===voiceManifest(previous)){this.admission?.refresh(room);return}
    const version=++this.mesh;this.admission?.end('Voice room membership changed');this.agreement?.close();this.agreement=null
    const preserveVideo=(!!previous&&room.participants.length>1)||this.retainedCapture
    const videoWasActive=this.state.camera||this.state.sharing||this.state.cameraPending||this.state.sharingPending
    this.sfu?.close();this.sfu=null;this.sfuKeys?.close();this.sfuKeys=null;this.sfuPublishedKeys=false
    if(!preserveVideo){this.stopVideo('camera');this.stopVideo('screen')}
    else{this.videoVersion.camera++;this.videoVersion.screen++;this.publish({cameraPending:false,sharingPending:false,mediaNotice:videoWasActive?'Refreshing encrypted media for the changed room…':''})}
    this.remoteMedia.clear();this.mediaRevision=1
    if(videoWasActive&&!preserveVideo)this.publish({mediaNotice:'Room membership changed. Turn your camera or screen sharing on again when ready.'})
    this.lastHeartbeat=0
    for(const edge of this.edges.values())edge.call.close();this.edges.clear()
    this.publish({participants:room.participants.map(peer=>({device:peer.device_key,account:conversation.members.find(member=>member.enrollment.device_key===peer.device_key)!.account_id,remote:null,phase:peer.device_key===this.transport.callDevice?'You':'Connecting'}))})
    if(room.participants.length===1){this.admission=null;if(!this.retainedCapture)this.stopSource();this.connectUntil=this.retainedCapture?Date.now()+30_000:0;this.publish({phase:'waiting',message:this.retainedCapture?'Encryption updated. Waiting for room participants; capture is paused.':'You’re in the room. Your microphone is off until someone joins.'});return}
    const context=await voiceContext(this.server,room);this.current(generation);if(version!==this.mesh)return
    const admission=new VoiceMembership(context,this.transport.callDevice,room);this.admission=admission
    this.agreement=this.contribution!.forkForRoom(context)
    this.connectUntil=Date.now()+(room.sfu?90_000:45_000);this.publish({phase:'connecting',message:room.sfu?'Connecting encrypted SFU room…':'Connecting encrypted room audio…'})
    if(room.sfu){void this.startSfu(room,admission,version).catch(error=>{if(this.active&&version===this.mesh){this.failed('sfu-start',error);if(transient(error))this.recover('Reconnecting encrypted room signaling…');else this.finish('The encrypted SFU room could not connect.')}});return}
    const ids=await Promise.all(context.participants.filter(peer=>peer!==this.transport.callDevice).map(async peer=>[peer,await groupEdgeId(context,this.transport.callDevice,peer,admission.transcript())] as const));this.checkMesh(version)
    for(const [peer,id] of ids){
      const edge={} as Edge
      const transport:CallTransport={callDevice:this.transport.callDevice,callAccount:this.transport.callAccount,
        authorizeCall:async(_,signal)=>{this.checkMesh(version);await this.refresh();this.checkMesh(version);if(signal&&!this.matches(signal))throw new Error('Unexpected room peer');return this.snapshot!.conversation},
        watchCall:async(_,signal)=>{this.checkMesh(version);await this.refresh(10_000);this.checkMesh(version);if(!this.matches(signal))throw new Error('Unexpected room peer');return this.snapshot!.conversation},
        callKey:async(id,signal)=>{this.checkMesh(version);if(!this.matches(signal)||signal.call_id!==edge.id)throw new Error('Unexpected room edge');await this.refresh();this.checkMesh(version);const base=await this.transport.callKey(id,signal);this.checkMesh(version);const key=await this.agreement!.derive(admission,peer,base);try{this.checkMesh(version);return hex(key)}finally{key.fill(0)}},
        send:async(id,content)=>{this.checkMesh(version);if(content.kind!=='call'||!this.matches(content.signal)||content.signal.call_id!==edge.id)throw new Error('Unexpected room signaling');if(content.signal.kind==='heartbeat')return 'sent';return this.transport.send(id,content)},
        onCall:listener=>{edge.listener=listener;return()=>{edge.listener=undefined}},
      }
      edge.id=id;edge.answering=false
      edge.call=new DirectCall(transport,state=>{if(version===this.mesh)this.edgeChanged(peer,state,version)},async()=>{this.checkMesh(version);const stream=await this.microphone();if(version!==this.mesh){stream.getTracks().forEach(track=>track.stop());throw new Error('Room changed during capture')}return stream},async()=>{throw new Error('Room video is not available yet')},{groupId:context.id,participants:context.participants,callId:id,voiceRoom:context.voiceRoom,allowAudio:this.canSpeak&&this.speakConsent})
      this.edges.set(peer,edge)
    }
    const pending=this.pending;this.pending=[]
    for(const event of pending){const edge=this.edges.get(event.signal.from_device);if(this.matches(event.signal)&&edge?.id===event.signal.call_id)edge.listener?.(event)}
    void Promise.all([...this.edges].filter(([peer])=>this.transport.callDevice<peer).map(([peer,edge])=>edge.call.start(context.conversation,peer,context.relayOnly,this.ice))).catch(error=>{if(this.active&&version===this.mesh){this.failed('edge-start',error);this.finish('Room audio could not be encrypted or connected.')}})
  }
  private receiveSfu(signal:CallSignal,version:number){
    if(!this.active||version!==this.mesh||!this.matches(signal)||signal.expires_at<=Date.now()||signal.expires_at>Date.now()+65_000)return
    if(signal.kind==='sfu-heartbeat'){
      try{const flags=this.remoteMedia.receive(signal.from_device,signal.description);this.publish({participants:this.state.participants.map(person=>person.device===signal.from_device?{...person,...flags,phase:'Connected'}:person)})}catch{this.finish('SFU media state could not be verified.')}
      return
    }
    const keys=this.sfuKeys,session=this.sfu
    if(signal.kind!=='sfu-key'||!keys||!session)return
    this.sfuSerial=this.sfuSerial.then(async()=>{
      if(!this.active||version!==this.mesh||session!==this.sfu||signal.expires_at<=Date.now())return
      await this.refresh()
      if(!this.active||version!==this.mesh||session!==this.sfu||signal.expires_at<=Date.now())return
      const key=await keys.receive(signal)
      if(key)try{if(this.active&&version===this.mesh&&session===this.sfu)await session.install(signal.from_device,key)}finally{key.fill(0)}
    }).catch(error=>{if(this.active&&version===this.mesh){this.failed('sfu-key',error);if((error instanceof Error&&error.name==='SfuLeaseExpired')||transient(error))this.recover('Refreshing encrypted room participation…');else this.finish('SFU participant encryption could not be verified.')}})
  }
  private sfuTrack(device:string,source:SfuSource,track:MediaStreamTrack|null,version:number){
    if(!this.active||version!==this.mesh)return
    this.publish({participants:this.state.participants.map(person=>person.device===device?{...person,phase:'Connected',...(source==='microphone'?{remote:track?new MediaStream([track]):null}:source==='camera'?{cameraTrack:track}:source==='screen'?{screenTrack:track}:{systemAudioTrack:track})}:person)})
  }
  private async startSfu(room:VoiceRoom,admission:VoiceMembership,version:number){
    const {SfuSession}=await import('./sfu-session.ts');this.checkMesh(version)
    const session=new SfuSession(room,this.transport.callDevice,(device,source,track)=>this.sfuTrack(device,source,track,version),(reason,detail)=>{if(this.active&&version===this.mesh){if(reason==='reconnecting'||reason==='disconnected'){this.recover('Reconnecting the encrypted room…');return}this.fault={operation:'sfu-'+reason,reason:detail};this.finish('The encrypted SFU connection was lost. Join again to reconnect.')}},()=>{},this.permissions)
    this.sfu=session
    const keys=new SfuKeys(this.agreement!,admission,async signal=>{await this.refresh();this.checkMesh(version);const key=await this.transport.callKey(this.state.channel,signal);await this.refresh();this.checkMesh(version);return key});this.sfuKeys=keys
    const pending=this.pending;this.pending=[]
    for(const event of pending)if(this.matches(event.signal))this.receiveSfu(event.signal,version)
    const bundle=await keys.create()
    try{
      this.checkMesh(version)
      if(await this.transport.send(this.state.channel,{kind:'call',signal:bundle.signal})!=='sent')throw signalingPending()
      this.checkMesh(version);this.sfuPublishedKeys=true;this.lastSfuKeys=Date.now()
      if(!this.transport.sfuAccess)throw new Error('SFU admission is unavailable')
      let access:SfuAccess
      try{access=await this.transport.sfuAccess(this.state.channel,room.revision)}catch(error){if((error as {status?:number}).status===409){await this.refresh(0);if(version!==this.mesh)return}throw error}
      this.checkMesh(version)
      if(access.channel_id!==room.channel_id||access.room_id!==room.room_id||access.revision!==room.revision)throw new Error('SFU admission does not match the verified room')
      await session.start(access,bundle.key,this.ice,this.canSpeak&&this.speakConsent?()=>this.microphone():null);this.checkMesh(version)
      await this.refresh(0);this.checkMesh(version)
      this.resumeSources()
      for(const kind of ['camera','screen'] as const){
        const stream=this.videoSources.get(kind),track=stream?.getVideoTracks()[0]
        if(track?.readyState==='live'){
          await session.publish(kind,track.clone());this.checkMesh(version)
          const audio=kind==='screen'?stream?.getAudioTracks()[0]:null
          if(audio?.readyState==='live'){await session.publish('system',audio.clone());this.checkMesh(version)}
        }else if(stream)this.stopVideo(kind)
      }
      this.connectUntil=0;this.retainedCapture=false
      this.publish({phase:'connected',message:this.state.relayOnly?'Encrypted SFU room · relay only':'Encrypted SFU room',mediaNotice:''});this.mediaChanged()
    }finally{bundle.key.fill(0)}
  }
  private async microphone(){
    if(!this.canSpeak||!this.speakConsent)throw new Error('Choose Start speaking before opening your microphone.')
    const generation=this.generation,mesh=this.mesh;this.current(generation);if(!this.admission?.canPublish)throw new Error('No active room peers')
    await this.refresh();this.current(generation);this.checkMesh(mesh)
    if(!this.sourcePromise){const sourceVersion=this.sourceVersion
      this.sourcePromise=this.capture({audio:{echoCancellation:true,noiseSuppression:true},video:false}).then(stream=>{
        if(!this.active||generation!==this.generation||sourceVersion!==this.sourceVersion||!this.admission?.canPublish||stream.getAudioTracks().length!==1||stream.getVideoTracks().length){stream.getTracks().forEach(track=>track.stop());throw new Error('Room changed during capture')}
        this.source=stream;const track=stream.getAudioTracks()[0];track.enabled=!this.state.muted;track.onended=()=>this.finish('The microphone stopped.');return stream
      })
    }
    const source=await this.sourcePromise;this.current(generation)
    // Permission prompts can outlive the authorization that opened them.
    try{await this.refresh(0);this.current(generation);this.checkMesh(mesh);if(!this.admission?.canPublish)throw new Error('Room access changed during microphone capture')}
    catch(error){if(this.active&&generation===this.generation&&mesh===this.mesh){if((error as {status?:number}).status===409)this.recover('Updating room participation…');else this.finish('Room microphone access could not be verified.')}throw error}
    this.resumeSources();const track=source.getAudioTracks()[0].clone();track.enabled=!this.state.muted;return new MediaStream([track])
  }
  private resumeSources(){
    if(!this.admission?.canPublish)throw new Error('Room authorization is not current.')
    this.source?.getAudioTracks().forEach(track=>{track.enabled=this.canSpeak&&this.speakConsent&&!this.state.muted})
    for(const [kind,stream] of this.videoSources)if(this.ownPermissions&(kind==='camera'?Permission.camera:Permission.screen))stream.getTracks().forEach(track=>{track.enabled=true})
  }
  /** Epoch notifications may run inside the messaging queue. Pause synchronously,
   * then reauthorize outside it, so no callback waits on its own queue. */
  private recover(message:string,minimumEpoch=0){
    if(!this.active)return
    if(this.recovering){this.recoveryEpoch=Math.max(this.recoveryEpoch,minimumEpoch);return}
    this.recoveryEpoch=minimumEpoch
    this.recoveries=this.recoveries.filter(time=>Date.now()-time<60_000)
    if(this.recoveries.length>=3){this.fault??={operation:'recovery-budget',reason:['Updating room encryption…','Reconnecting encrypted room signaling…','Reconnecting the encrypted room…','Updating room participation…','Refreshing encrypted room participation…'].indexOf(message)};this.finish('Room recovery could not stabilize. Join again when the connection is ready.');return}
    this.recoveries.push(Date.now())
    this.recovering=true;this.retainedCapture=true;this.renewing=false;this.recoveryUntil=Date.now()+30_000
    const generation=++this.generation;this.mesh++;this.refreshPromise=null
    this.source?.getTracks().forEach(track=>{track.enabled=false})
    if(!this.source){this.sourceVersion++;this.sourcePromise=null}
    for(const stream of this.videoSources.values())stream.getTracks().forEach(track=>{track.enabled=false})
    this.sfu?.close();this.sfu=null;this.sfuKeys?.close();this.sfuKeys=null;this.sfuPublishedKeys=false
    for(const edge of this.edges.values())edge.call.close();this.edges.clear()
    this.admission?.end('Encryption transition');this.admission=null;this.agreement?.close();this.agreement=null
    this.publish({phase:'connecting',message})
    void(async()=>{
      while(this.active&&generation===this.generation&&Date.now()<this.recoveryUntil){
        try{
          const initial=await this.transport.voiceRoom(this.state.channel);this.current(generation)
          if(initial.room.epoch<this.recoveryEpoch){await new Promise(resolve=>setTimeout(resolve,250));continue}
          if(initial.room.participants.length&&initial.room.relay_only!==this.state.relayOnly)throw Object.assign(new Error('The room privacy setting changed.'),{status:403})
          const context:GroupContext={server:this.server,conversation:this.state.channel,id:initial.room.room_id,voiceRoom:initial.room.room_id,epoch:initial.room.epoch,host:this.transport.callDevice,participants:[this.transport.callDevice],relayOnly:this.state.relayOnly,...(initial.room.sfu?{sfu:true as const}:{})}
          const contribution=await GroupKeyAgreement.create(context,this.transport.callDevice)
          if(!this.active||generation!==this.generation){contribution.close();return}
          this.contribution?.close();this.contribution=contribution
          this.own={channel_id:this.state.channel,room_id:initial.room.room_id,epoch:initial.room.epoch,device_key:this.transport.callDevice,incarnation:randomId(),public_key:contribution.publicKey,relay_only:this.state.relayOnly,...(initial.room.sfu?{sfu:true}:{}),active:true,issued_at:0,expires_at:0,signature:''}
          const view=await this.transport.voicePresence(this.presence(true));this.current(generation)
          this.snapshot=null;this.checkedAt=this.renewedAt=Date.now();await this.apply(view,generation)
          this.current(generation);this.recovering=false;return
        }catch(error){
          if(!this.active||generation!==this.generation)return
          if([401,403,404].includes((error as {status?:number}).status??0))throw error
          await new Promise(resolve=>setTimeout(resolve,500))
        }
      }
      throw new Error('Encrypted room recovery timed out.')
    })().catch(error=>{if(this.active&&generation===this.generation){this.failed('recovery',error);this.finish('Room access or encryption could not be restored.')}})
  }
  private async restoreMeshVideo(version:number){
    if(this.restoredVideo===version)return;this.restoredVideo=version
    await this.refresh(0);this.checkMesh(version);this.resumeSources()
    for(const [kind,stream] of this.videoSources){
      const track=stream.getVideoTracks()[0]
      if(track?.readyState==='live')await Promise.all([...this.edges.values()].flatMap(edge=>[edge.call.setRoomVideo(kind,track.clone()),...(kind==='screen'&&stream.getAudioTracks()[0]?[edge.call.setRoomVideo('system',stream.getAudioTracks()[0].clone())]:[])]))
      this.checkMesh(version)
    }
    this.retainedCapture=false;this.mediaChanged()
  }
  private edgeChanged(peer:string,state:CallState,version:number){
    if(!this.active||version!==this.mesh)return
    this.publish({participants:this.state.participants.map(person=>person.device===peer?{...person,phase:state.phase,remote:state.remote,cameraTrack:state.remoteCamera,screenTrack:state.remoteScreen,systemAudioTrack:state.remoteSystemAudio}:person)})
    const edge=this.edges.get(peer)
    if(state.phase==='incoming'&&edge&&!edge.answering){edge.answering=true;void edge.call.answer(this.ice).catch(error=>{if(this.active&&version===this.mesh){this.failed('edge-answer',error);this.finish('A room audio connection failed.')}})}
    if(state.phase==='ended'){
      const reason=['Call ended.','Connection interrupted. Start a new call.','The selected privacy route could not be verified.','Connection recovery timed out. Start a new call.','Connection recovery failed. Start a new call.','Call verification timed out. Start a new call.','Call ended because authorization or signaling was lost.','Group encryption changed. Start a new call.'].indexOf(state.message)
      this.fault={operation:'edge-ended',reason}
      setTimeout(()=>{if(!this.active||version!==this.mesh)return;void this.refresh(0).then(()=>{if(this.active&&version===this.mesh)this.finish('A room audio connection ended. Join again to reconnect.')}).catch(error=>{if(version===this.mesh){this.failed('edge-ended-refresh',error);this.finish('Room access was lost.')}})},2000)
    }
  }
  private watch(){
    if(!this.active)return
    const now=Date.now(),generation=this.generation
    if(this.recovering){if(now>=this.recoveryUntil)this.finish('Encrypted room recovery timed out.');return}
    if(now-this.checkedAt>25_000||now-this.created>=50*60_000||this.own&&this.own.expires_at>0&&this.own.expires_at<=now){this.fault={operation:'authorization-expired',checkedAge:now-this.checkedAt,leaseRemaining:(this.own?.expires_at??now)-now};this.finish('Voice room access verification expired.');return}
    if(this.connectUntil&&now>this.connectUntil){this.fault={operation:'connect-timeout',stage:this.sfu?.stage??'key-wrap',leaseRemaining:Math.min(...(this.snapshot?.room.participants.map(peer=>peer.expires_at-now)??[0])),checkedAge:now-this.checkedAt};this.finish('Room audio connection timed out.');return}
    if(this.snapshot&&this.own&&now-this.renewedAt>=10_000&&!this.renewing){
      this.renewing=true
      const renewal=this.transport.renewVoicePresence?this.transport.renewVoicePresence(this.presence(true)).then(expires=>{this.current(generation);if(this.own)this.own={...this.own,expires_at:expires};this.renewedAt=Date.now()}):this.transport.voicePresence(this.presence(true)).then(async view=>{this.current(generation);await this.apply(view,generation);this.current(generation);this.renewedAt=this.checkedAt=Date.now()})
      void renewal.catch(error=>{if(generation===this.generation){this.failed('renew',error);if((error as {status?:number}).status===409||transient(error))this.recover('Updating room participation…');else this.finish('Voice room permissions were lost.')}}).finally(()=>{if(generation===this.generation)this.renewing=false})
    }
    if(this.snapshot&&this.own&&now-this.lastPoll>=5000){this.lastPoll=now;void this.refresh().catch(error=>{if(generation===this.generation){this.failed('poll',error);if((error as {status?:number}).status===409||transient(error))this.recover('Updating room participation…');else this.finish('Voice room access was lost.')}})}
    // SFU liveness already has independent signed leases and fresh-policy reads.
    // State changes send immediately; periodic MLS state/key repeats need only
    // run every thirty seconds. Mesh peers retain their ten-second heartbeat.
    if((this.edges.size||this.sfu)&&this.admission&&now-this.lastHeartbeat>=(this.sfu?30_000:10_000)){
      this.lastHeartbeat=now;const context=this.admission.context,version=this.mesh
      const signal:CallSignal={call_id:context.id,group_id:context.id,voice_room:context.voiceRoom,participants:[...context.participants],epoch:context.epoch,from_device:this.transport.callDevice,to_device:context.participants.find(device=>device!==this.transport.callDevice)!,kind:context.sfu?'sfu-heartbeat':'room-heartbeat',description:roomMediaDescription(this.mediaRevision,this.state),relay_only:context.relayOnly,expires_at:now+60_000}
      if(this.sfuPublishedKeys&&this.sfuKeys&&now-this.lastSfuKeys>=30_000){try{this.lastSfuKeys=now;void this.transport.send(context.conversation,{kind:'call',signal:this.sfuKeys.repeat()}).catch(()=>{if(this.active&&version===this.mesh)this.finish('SFU key signaling was lost.')})}catch{this.recover('Refreshing encrypted room participation…');return}}
      void this.transport.send(context.conversation,{kind:'call',signal}).then(result=>{if(result!=='sent')throw signalingPending()}).catch(error=>{if(this.active&&version===this.mesh){this.failed('heartbeat',error);if(transient(error))this.recover('Reconnecting encrypted room signaling…');else this.finish('Voice room signaling was lost.')}})
    }
    if(this.edges.size&&[...this.edges.values()].every(edge=>edge.call.state.phase==='connected')){
      const version=this.mesh
      void this.diagnostics().then(async metrics=>{if(this.active&&version===this.mesh&&metrics.every(metric=>!(this.permissions.get(metric.peer)!&Permission.speak)||metric.decrypted>0)){this.connectUntil=0;this.publish({phase:'connected',message:this.state.relayOnly?'Encrypted voice room · relay only':'Encrypted voice room'});await this.restoreMeshVideo(version)}}).catch(()=>{if(this.active&&version===this.mesh)this.finish('Room encryption could not be verified.')})
    }
  }
  mute(){if(!this.active)return;const muted=!this.state.muted;this.source?.getAudioTracks().forEach(track=>{track.enabled=!muted});for(const edge of this.edges.values())edge.call.mute(muted);this.sfu?.mute(muted);this.publish({muted})}
  private stopVideo(kind:RoomMediaKind){
    this.videoVersion[kind]++
    const stream=this.videoSources.get(kind);this.videoSources.delete(kind)
    stream?.getTracks().forEach(track=>{track.onended=null;track.stop()})
    // Child setters synchronously stop their owned clones before detaching.
    for(const edge of this.edges.values()){void edge.call.setRoomVideo(kind,null).catch(()=>{});if(kind==='screen')void edge.call.setRoomVideo('system',null).catch(()=>{})}
    if(this.sfu){void this.sfu.publish(kind,null).catch(()=>{});if(kind==='screen')void this.sfu.publish('system',null).catch(()=>{})}
    this.publish(kind==='camera'?{camera:false,cameraPending:false}:{sharing:false,sharingPending:false,systemAudio:false})
  }
  private mediaChanged(){
    this.mediaRevision++
    this.publish({participants:this.state.participants.map(person=>person.device===this.transport.callDevice?{...person,camera:this.state.camera,sharing:this.state.sharing,systemAudio:this.state.systemAudio,cameraTrack:this.videoSources.get('camera')?.getVideoTracks()[0],screenTrack:this.videoSources.get('screen')?.getVideoTracks()[0]}:person)})
    this.lastHeartbeat=-Infinity;this.watch()
  }
  async video(kind:RoomMediaKind,withAudio=false){
    const enabled=kind==='camera'?this.state.camera:this.state.sharing,pending=kind==='camera'?this.state.cameraPending:this.state.sharingPending
    if(enabled||pending){this.stopVideo(kind);this.mediaChanged();return}
    if(!this.active||this.state.phase!=='connected'||(!this.sfu&&!this.edges.size)||[...this.edges.values()].some(edge=>edge.call.state.phase!=='connected'))throw new Error('Wait for room audio to connect before sharing video.')
    const generation=this.generation,mesh=this.mesh,version=++this.videoVersion[kind]
    let stream:MediaStream|null=null
    const current=()=>this.active&&generation===this.generation&&mesh===this.mesh&&version===this.videoVersion[kind]
    const authorize=async()=>{try{await this.refresh(0);this.checkMesh(mesh);if(!(this.ownPermissions&(kind==='camera'?Permission.camera:Permission.screen)))throw new Error('Your role does not allow this publication.')}catch(error){if(current())this.finish('Room video access could not be verified.');throw error}}
    this.publish({...(kind==='camera'?{cameraPending:true}:{sharingPending:true}),mediaNotice:''})
    try{
      await authorize();if(!current())return
      stream=kind==='camera'?await this.capture({audio:false,video:{deviceId:this.cameraDevice?{exact:this.cameraDevice}:undefined,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:15,max:20}}}):await this.displayCapture(withAudio)
      if(!current()){stream.getTracks().forEach(track=>track.stop());return}
      const track=stream.getVideoTracks()[0]
      if(stream.getVideoTracks().length!==1||stream.getAudioTracks().length>(kind==='screen'&&withAudio?1:0)||!track||track.readyState!=='live')throw new Error('Select one video source and explicitly enable any shared computer audio.')
      // Capture permissions may have been pending while channel access changed.
      await authorize();if(!current()){stream.getTracks().forEach(track=>track.stop());return}
      this.videoSources.set(kind,stream)
      track.onended=()=>{if(this.active&&generation===this.generation&&this.videoSources.get(kind)===stream){this.stopVideo(kind);this.mediaChanged()}}
      const audio=kind==='screen'?stream.getAudioTracks()[0]:null
      if(audio)audio.onended=()=>{
        if(!this.active||generation!==this.generation||this.videoSources.get(kind)!==stream)return
        for(const edge of this.edges.values())void edge.call.setRoomVideo('system',null).catch(()=>{})
        if(this.sfu)void this.sfu.publish('system',null).catch(()=>{})
        this.publish({systemAudio:false,mediaNotice:'Shared audio stopped. Your screen video is still shared.'});this.mediaChanged()
      }
      if(this.sfu){await this.sfu.publish(kind,track.clone());if(kind==='screen'&&stream.getAudioTracks()[0])await this.sfu.publish('system',stream.getAudioTracks()[0].clone())}
      else await Promise.all([...this.edges.values()].flatMap(edge=>[edge.call.setRoomVideo(kind,track.clone()),...(kind==='screen'&&stream!.getAudioTracks()[0]?[edge.call.setRoomVideo('system',stream!.getAudioTracks()[0].clone())]:[])]))
      if(!current())return
      this.publish(kind==='camera'?{camera:true,cameraPending:false}:{sharing:true,sharingPending:false,systemAudio:stream.getAudioTracks().length===1});if(kind==='screen'&&withAudio&&!stream.getAudioTracks().length)this.publish({mediaNotice:'The selected source did not provide audio. Video is shared; choose a supported tab or display with audio to include sound.'});this.mediaChanged()
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(current())this.stopVideo(kind);throw error}
  }
  leave(){this.finish('You left the voice room.')}
  get ownPermissions(){return this.permissions.get(this.transport.callDevice)??MEDIA_PERMISSIONS}
  get canSpeak(){return !!(this.ownPermissions&Permission.speak)}
  get speaking(){return this.canSpeak&&this.speakConsent}
  async changeDevice(kind:'audio'|'video',device:string){
    const version=++this.deviceVersion[kind],generation=this.generation,mesh=this.mesh
    if(kind==='video'){this.cameraDevice=device;if(!this.state.camera)return}
    if(this.state.phase!=='connected'||kind==='audio'&&!this.speaking)throw new Error('Join as a speaker before changing the active microphone.')
    await this.refresh(0);this.checkMesh(mesh)
    const stream=await this.capture(kind==='audio'?{audio:{deviceId:device?{exact:device}:undefined,echoCancellation:true,noiseSuppression:true},video:false}:{audio:false,video:{deviceId:device?{exact:device}:undefined,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:15,max:20}}})
    try{
      await this.refresh(0);this.current(generation);this.checkMesh(mesh)
      if(version!==this.deviceVersion[kind]||stream.getTracks().length!==1||stream.getTracks()[0].kind!==kind)throw new Error('Device selection changed during permission approval.')
      const track=stream.getTracks()[0]
      if(kind==='audio'){
        if(!this.speaking)throw new Error('Speaking permission was lost.')
        track.enabled=!this.state.muted
        if(this.sfu)await this.sfu.publish('microphone',track.clone());else await Promise.all([...this.edges.values()].map(edge=>edge.call.setMicrophone(track.clone())))
        this.checkMesh(mesh);const previous=this.source;this.sourceVersion++;this.source=stream;this.sourcePromise=Promise.resolve(stream);previous?.getTracks().forEach(track=>{track.onended=null;track.stop()})
        track.onended=()=>{if(this.source===stream)this.finish('The microphone stopped.')}
      }else{
        if(!(this.ownPermissions&Permission.camera))throw new Error('Camera permission was lost.')
        if(this.sfu)await this.sfu.publish('camera',track.clone());else await Promise.all([...this.edges.values()].map(edge=>edge.call.setRoomVideo('camera',track.clone())))
        this.checkMesh(mesh);const previous=this.videoSources.get('camera');this.videoVersion.camera++;this.videoSources.set('camera',stream);previous?.getTracks().forEach(track=>{track.onended=null;track.stop()});track.onended=()=>{if(this.videoSources.get('camera')===stream){this.stopVideo('camera');this.mediaChanged()}};this.mediaChanged()
      }
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error}
  }
  async startSpeaking(){
    await this.refresh(0);if(!this.canSpeak||this.state.phase!=='connected')throw new Error('Speaking permission is not available.')
    this.speakConsent=true
    const version=this.mesh
    try{const stream=await this.microphone();this.checkMesh(version);if(this.sfu)await this.sfu.publish('microphone',stream.getAudioTracks()[0]);else{await Promise.all([...this.edges.values()].map(edge=>edge.call.setMicrophone(stream.getAudioTracks()[0].clone())));stream.getTracks().forEach(track=>track.stop())}}catch(error){this.speakConsent=false;this.stopSource();throw error}
  }
  speaker(device:string){return !!((this.permissions.get(device)??MEDIA_PERMISSIONS)&Permission.speak)}
  private stopSource(){this.sourceVersion++;this.source?.getTracks().forEach(track=>{track.onended=null;track.stop()});this.source=null;this.sourcePromise=null}
  private finish(message:string){
    if(!this.active)return
    const presence=this.own?this.presence(false):null
    this.active=false;this.generation++;this.mesh++;clearInterval(this.timer);this.timer=undefined
    this.recovering=false;this.retainedCapture=false;this.recoveryUntil=0;this.recoveryEpoch=0
    this.stopVideo('camera');this.stopVideo('screen');this.sfu?.close();this.sfu=null;this.sfuKeys?.close();this.sfuKeys=null;this.sfuPublishedKeys=false;this.remoteMedia.clear()
    this.admission?.end(message);this.admission=null;this.agreement?.close();this.agreement=null;this.contribution?.close();this.contribution=null
    for(const edge of this.edges.values())edge.call.close();this.edges.clear();this.stopSource()
    this.pending=[];this.snapshot=null;this.own=null;this.refreshPromise=null;this.renewing=false;this.connectUntil=0;this.lastPoll=0;this.renewedAt=0;this.ice=[]
    this.publish({phase:'ended',message,muted:false,camera:false,sharing:false,cameraPending:false,sharingPending:false,systemAudio:false,mediaNotice:'',participants:[]})
    if(presence)void this.transport.voicePresence(presence).catch(()=>{})
  }
  async diagnostics(){return Promise.all([...this.edges].map(async([peer,edge])=>({peer,...await edge.call.diagnostics()})))}
  sfuDiagnostics(){return this.sfu?.diagnostics()??Promise.resolve(null)}
  close(){this.dispose();this.finish('Voice room closed.')}
}
