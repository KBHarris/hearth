import type {CallSignal,Conversation,LocalCallSignal} from '@hearth/sdk'
import {DirectCall,callCapability,type CallState,type CallTransport,type GroupEdge} from './direct-call.ts'
import {GroupKeyAgreement,groupContext,type GroupContext} from './group-admission.ts'
import {captureDisplay} from './display-capture.ts'
import {RemoteRoomMedia,roomMediaDescription,type RoomMediaKind} from './room-media.ts'
import {GroupMembership} from './group-membership.ts'

export interface GroupTransport extends CallTransport {authorizeGroupCall:(id:string,signal?:CallSignal)=>Promise<Conversation>}
export type GroupCallState={phase:'idle'|'preparing'|'incoming'|'outgoing'|'connecting'|'connected'|'reconnecting'|'ended';conversation:string;message:string;muted:boolean;camera:boolean;sharing:boolean;systemAudio:boolean;cameraPending:boolean;sharingPending:boolean;mediaNotice:string;relayOnly:boolean;canRejoin:boolean;participants:{device:string;account:string;phase:string;remote:MediaStream|null;camera?:boolean;sharing?:boolean;systemAudio?:boolean;cameraTrack?:MediaStreamTrack|null;screenTrack?:MediaStreamTrack|null;systemAudioTrack?:MediaStreamTrack|null}[]}
export const idleGroup:GroupCallState={phase:'idle',conversation:'',message:'',muted:false,camera:false,sharing:false,systemAudio:false,cameraPending:false,sharingPending:false,mediaNotice:'',relayOnly:false,canRejoin:false,participants:[]}
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')
const hex=(key:Uint8Array)=>Array.from(key,byte=>byte.toString(16).padStart(2,'0')).join('')
export async function groupEdgeId(context:GroupContext,a:string,b:string,transcript:readonly string[][]=[]){
  if(a===b||![a,b].every(device=>context.participants.includes(device)))throw new Error('Invalid group edge')
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['hearth/v1/group-call/edge',context.server,context.conversation,context.id,context.epoch,context.host,context.participants,context.relayOnly,[a,b].sort(),transcript])))))
}
type Edge={call:DirectCall;listener?:(event:LocalCallSignal)=>void;answering:boolean;id:string}

/** Bounded three-person media mesh. Participation and MLS changes replace
 * peer keys, with capture paused during bounded epoch recovery.
 */
export class GroupCall {
  state:GroupCallState={...idleGroup}
  private transport:GroupTransport
  private server:string
  private changed:(state:GroupCallState)=>void
  private capture:(constraints:MediaStreamConstraints)=>Promise<MediaStream>
  private available:()=>boolean
  private dispose:()=>void
  private room:GroupMembership|null=null
  // Public membership only; no media, private key, authorization lease or call slot.
  private parked:{room:GroupMembership;current:Conversation}|null=null
  private keys:GroupKeyAgreement|null=null
  private current:Conversation|null=null
  private generation=0
  private active=false
  private created=0
  private timer:ReturnType<typeof setInterval>|undefined
  private serial:Promise<unknown>=Promise.resolve()
  private edges=new Map<string,Edge>()
  private pending:LocalCallSignal[]=[]
  private meshVersion=0
  private membershipAt=-1
  private meshReady=false
  private connectUntil=0
  private ice:RTCIceServer[]=[]
  private source:MediaStream|null=null
  private sourceVersion=0
  private deviceVersion=0
  private recovering=false
  private recoveryUntil=0
  private retainedCapture=false
  private epochPending:LocalCallSignal[]=[]
  private transition:GroupMembership|null=null
  private videoSources=new Map<RoomMediaKind,MediaStream>()
  private videoVersion={camera:0,screen:0}
  private cameraDevice=''
  private mediaRevision=1
  private lastMediaHeartbeat=0
  private remoteMedia=new RemoteRoomMedia()
  private restoredVideo=-1
  private displayCapture:(audio?:boolean)=>Promise<MediaStream>
  private sourcePromise:Promise<MediaStream>|null=null
  private authPromise:Promise<Conversation>|null=null
  private authAt=0
  private lastHeartbeat=0
  private checking=false
  private retired=new Map<string,number>()
  private fault:{operation:string;name:string;status?:number;locations:string[]} | null=null
  private noteFailure(operation:string,error:unknown){
    this.fault={operation,name:error instanceof Error?error.name:'untyped',locations:error instanceof Error?error.stack?.split('\n').map(line=>line.match(/(?:group-call|group-membership|group-admission|direct-call|messaging-session)\.ts:\d+:\d+/)?.[0]).filter((line):line is string=>!!line).slice(0,6)??[]:[]}
    const status=(error as {status?:unknown})?.status
    if(typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599)this.fault.status=status
  }
  failureDiagnostics(){return this.fault}
  constructor(transport:GroupTransport,server:string,changed:(state:GroupCallState)=>void,capture=(constraints:MediaStreamConstraints)=>navigator.mediaDevices.getUserMedia(constraints),available=()=>true,displayCapture=captureDisplay){
    this.transport=transport;this.server=server;this.changed=changed;this.capture=capture;this.available=available;this.displayCapture=displayCapture
    const lock=(conversation?:string)=>{if(!conversation||conversation===this.state.conversation)this.finish('Group call ended because encryption or access changed.')}
    this.dispose=transport.onCall(event=>{
      if(event.signal.group_id===undefined)return
      const generation=this.generation
      this.serial=this.serial.then(()=>this.receive(event)).catch(()=>{if(generation===this.generation)this.finish('Group call verification failed. Start a new call.')})
    },lock,(conversation,epoch)=>this.epochChanged(conversation,epoch))
  }
  get busy(){return this.active}
  private publish(patch:Partial<GroupCallState>){this.state={...this.state,...patch};this.changed(this.state)}
  private claim(conversation:string,phase:GroupCallState['phase'],relayOnly:boolean){
    if(this.active||!this.available())throw new Error('End the current call first.')
    if(!callCapability())throw new Error('Encrypted group calls need a supported runtime with encoded media transforms.')
    for(const [id,until] of this.retired)if(until<Date.now())this.retired.delete(id)
    if(this.retired.size>=128)throw new Error('Too many recent invitations. Wait a moment before calling again.')
    this.forgetParked();clearInterval(this.timer)
    this.active=true;this.created=Date.now();this.authAt=this.created;this.generation++
    this.publish({...idleGroup,conversation,phase,relayOnly,message:'Checking group call access…'})
    this.timer=setInterval(()=>this.watch(),1000)
    return this.generation
  }
  private check(room:GroupMembership){room.checkTime();if(!this.active||this.room!==room||room.stopped)throw new Error('Group call ended')}
  private matches(room:GroupMembership,signal:CallSignal){
    const c=room.context
    return signal.group_id===c.id&&signal.epoch===c.epoch&&signal.relay_only===c.relayOnly&&JSON.stringify(signal.participants)===JSON.stringify(c.participants)&&c.participants.includes(signal.from_device)&&c.participants.includes(signal.to_device)&&signal.from_device!==signal.to_device
  }
  private heartbeatSignal(room:GroupMembership):CallSignal {
    const c=room.context
    return {call_id:c.id,group_id:c.id,participants:[...c.participants],epoch:c.epoch,from_device:this.transport.callDevice,to_device:c.participants.find(device=>device!==this.transport.callDevice)!,kind:'group-heartbeat',description:null,relay_only:c.relayOnly,expires_at:Date.now()+60_000}
  }
  private async authorize(room:GroupMembership,signal=this.heartbeatSignal(room),maxAge=0){
    this.check(room)
    if(!this.matches(room,signal))throw new Error('Group call context changed')
    if(this.current&&maxAge>0&&Date.now()-this.authAt<maxAge)return this.current
    if(!this.authPromise){
      const request=this.transport.authorizeGroupCall(room.context.conversation,signal).then(current=>{
        this.check(room)
        if(current.epoch!==room.context.epoch)throw new Error('Group encryption changed')
        groupContext(this.server,current,room.context.id,room.context.host,room.context.participants,room.context.relayOnly)
        this.current=current;this.authAt=Date.now();return current
      })
      this.authPromise=request
      void request.finally(()=>{if(this.authPromise===request)this.authPromise=null}).catch(()=>{})
    }
    const result=await this.authPromise;this.check(room);return result
  }
  private async dispatch(room:GroupMembership,signals:CallSignal[]){
    for(const signal of signals){this.check(room);if(await this.transport.send(room.context.conversation,{kind:'call',signal})!=='sent')throw new Error('Group call signaling is offline');this.check(room)}
  }
  private dispatchLater(room:GroupMembership,signals:CallSignal[]){
    void this.dispatch(room,signals).catch(()=>{if(this.room===room)this.finish('Group call signaling was lost.')})
  }
  async start(conversation:string,selected:readonly string[],relayOnly=false,ice:RTCIceServer[]=[]){
    this.requireRelay(relayOnly,ice)
    const generation=this.claim(conversation,'preparing',relayOnly)
    try{
      const current=await this.transport.authorizeGroupCall(conversation)
      if(!this.active||generation!==this.generation)return
      const context=groupContext(this.server,current,randomId(),this.transport.callDevice,selected,relayOnly)
      const room=new GroupMembership(context,this.transport.callDevice);this.room=room;this.current=current;this.authAt=Date.now();this.ice=ice
      this.publish({participants:this.participants(current,context),message:'Preparing encrypted invitations…'})
      const keys=await GroupKeyAgreement.create(context,this.transport.callDevice)
      if(this.room!==room||!this.active){keys.close();return}
      this.keys=keys;this.publish({phase:'outgoing',message:'Waiting for someone to join. Your microphone is off.'})
      await this.dispatch(room,room.invite(keys.publicKey))
    }catch(error){if(generation===this.generation)this.finish(error instanceof Error?error.message:'Group call could not start.');throw error}
  }
  private participants(current:Conversation,c:GroupContext){return c.participants.map(device=>({device,account:current.members.find(member=>member.enrollment.device_key===device)!.account_id,phase:device===this.transport.callDevice?'You':'Invited',remote:null}))}
  private requireRelay(relay:boolean,ice:RTCIceServer[]){if(relay&&!ice.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url))))throw new Error('Relay-only group calls need a configured TURN relay. No direct connection was attempted.')}
  async answer(ice:RTCIceServer[]=[]){
    const room=this.room;if(!room||this.state.phase!=='incoming')return
    this.requireRelay(room.context.relayOnly,ice)
    this.publish({phase:'preparing',message:'Checking group call access…'})
    try{
      await this.authorize(room);this.check(room);this.ice=ice
      const keys=await GroupKeyAgreement.create(room.context,this.transport.callDevice)
      if(this.room!==room||!this.active){keys.close();return}
      this.keys=keys;const controls=room.answer(keys.publicKey)
      this.publish({phase:'outgoing',message:'Joining encrypted group voice…'})
      await this.dispatch(room,controls)
      this.membershipChanged(room)
    }catch(error){this.noteFailure('join',error);if(this.room===room)this.finish('The group call could not be answered.');throw error}
  }
  async rejoin(ice:RTCIceServer[]=[]){
    const parked=this.parked;if(!parked||!this.state.canRejoin)return
    parked.room.checkTime()
    if(parked.room.stopped||!parked.room.readyPeers.length){this.forgetParked();return}
    this.requireRelay(parked.room.context.relayOnly,ice)
    // claim clears the observer, so hold the bounded public state locally.
    const room=parked.room.resume()
    const generation=this.claim(room.context.conversation,'preparing',room.context.relayOnly)
    this.room=room;this.current=parked.current
    this.publish({participants:this.participants(parked.current,room.context),message:'Checking access before rejoining…'})
    try{
      await this.authorize(room);this.check(room);this.ice=ice
      const keys=await GroupKeyAgreement.create(room.context,this.transport.callDevice)
      if(this.room!==room||!this.active||generation!==this.generation){keys.close();return}
      this.keys=keys;const controls=room.answer(keys.publicKey)
      this.publish({phase:'outgoing',message:'Rejoining encrypted group voice…'})
      await this.dispatch(room,controls);this.membershipChanged(room)
    }catch(error){if(generation===this.generation){this.noteFailure('rejoin',error);this.finish('The group call could not be rejoined.')}throw error}
  }
  private forgetParked(){
    this.parked?.room.end('The local call observer ended.');this.parked=null
    if(!this.active){clearInterval(this.timer);this.timer=undefined}
    if(this.state.canRejoin)this.publish({canRejoin:false})
  }
  private async receive(event:LocalCallSignal){
    const signal=event.signal
    const transition=this.transition
    if(this.active&&this.recovering&&transition&&signal.group_id===transition.context.id&&signal.epoch>transition.context.epoch&&signal.kind==='group-member'){
      if(this.epochPending.length<16)this.epochPending.push(event);return
    }
    const broadcast=signal.kind.startsWith('group-')&&signal.participants?.includes(this.transport.callDevice)&&signal.from_device!==this.transport.callDevice
    if(!broadcast&&signal.to_device!==this.transport.callDevice||signal.expires_at<=Date.now()||signal.expires_at>Date.now()+65_000||!signal.group_id)return
    const parked=this.parked
    if(!this.active&&parked&&event.conversation_id===parked.room.context.conversation&&this.matches(parked.room,signal)){
      if(signal.kind==='group-member'||signal.kind==='group-decline'){
        parked.room.receive(signal);this.watchParked()
      }
      return
    }
    if(this.retired.has(signal.group_id)&&this.room?.context.id!==signal.group_id)return
    if(signal.kind==='group-invite'&&!this.active){
      if(!this.available())return
      const generation=this.claim(event.conversation_id,'preparing',signal.relay_only)
      let current:Conversation
      try{current=await this.transport.authorizeGroupCall(event.conversation_id,signal)}catch(error){if(generation===this.generation)this.finish('This group invitation could not be verified.');throw error}
      if(generation!==this.generation||!this.active)return
      const context=groupContext(this.server,current,signal.group_id,signal.from_device,signal.participants??[],signal.relay_only)
      if(signal.call_id!==context.id||signal.epoch!==context.epoch)return this.finish('This group invitation expired.')
      this.room=new GroupMembership(context,this.transport.callDevice);this.current=current;this.authAt=Date.now()
      this.publish({phase:'incoming',participants:this.participants(current,context),message:'You’re invited to group voice. Join when you’re ready; your microphone is off.'});return
    }
    const room=this.room
    if(!room||event.conversation_id!==room.context.conversation||!this.matches(room,signal))return
    if(signal.kind==='group-heartbeat'&&signal.description!==null){
      if(!room.readyPeers.includes(signal.from_device))return
      const flags=this.remoteMedia.receive(signal.from_device,signal.description);if(flags)this.publish({participants:this.state.participants.map(person=>person.device===signal.from_device?{...person,...flags}:person)})
      room.receive({...signal,description:null})
      const edge=this.edges.get(signal.from_device)
      edge?.listener?.({...event,signal:{...signal,kind:'heartbeat',description:null,call_id:edge.id,to_device:this.transport.callDevice}})
      return
    }
    if(signal.kind.startsWith('group-')){
      const controls=room.receive(signal)
      if(room.stopped){this.finish(room.reason);return}
      this.dispatchLater(room,controls)
      this.membershipChanged(room)
    }else if(['offer','answer','heartbeat','hangup'].includes(signal.kind)){
      if(!this.meshReady){if(this.pending.length>=8){this.finish('Too many pending group descriptions.');return}this.pending.push(event)}
      else this.edgeSignal(room,event)
    }
  }
  private edgeSignal(room:GroupMembership,event:LocalCallSignal,retainUnknown=true){
    const edge=this.edges.get(event.signal.from_device)
    if(!edge||event.signal.call_id!==edge.id){
      if(retainUnknown&&event.signal.kind==='offer'){
        if(this.pending.length>=8){this.finish('Too many pending group descriptions.');return}
        this.pending.push(event)
      }
      return
    }
    // Existing per-edge heartbeats also prove liveness to group admission.
    room.receive({...event.signal,call_id:room.context.id,kind:'group-heartbeat',description:null})
    if(room.stopped){this.finish(room.reason);return}
    edge.listener?.(event)
  }
  private membershipChanged(room:GroupMembership){
    if(this.room!==room||room.stopped)return
    this.publish({participants:this.state.participants.map(person=>({...person,phase:room.status(person.device)}))})
    if(this.membershipAt===room.generation)return
    this.membershipAt=room.generation
    const version=++this.meshVersion
    for(const edge of this.edges.values())edge.call.close();this.edges.clear()
    this.meshReady=false;this.checking=false;this.remoteMedia.clear();this.mediaRevision=1;this.lastMediaHeartbeat=0
    this.publish({participants:this.state.participants.map(person=>({...person,remote:null}))})
    if(!room.hasConsent)return
    if(!room.canPublish){if(!this.retainedCapture){this.stopSource();this.stopVideo('camera');this.stopVideo('screen')}this.connectUntil=this.retainedCapture?Date.now()+30_000:0;this.publish({phase:'outgoing',message:this.retainedCapture?'Encryption updated. Waiting for continuing participants; your microphone is paused.':'Waiting for someone to join. Your microphone is off.'});return}
    this.connectUntil=Date.now()+45_000
    this.publish({phase:'connecting',message:this.source?'Updating group encryption…':'Connecting encrypted group audio…'})
    void this.beginMesh(room,version).catch(error=>{if(this.room===room&&version===this.meshVersion){this.noteFailure('mesh',error);this.finish('Group media could not be encrypted or connected.')}})
  }
  private checkMesh(room:GroupMembership,version:number){this.check(room);if(version!==this.meshVersion||room.generation!==this.membershipAt)throw new Error('Group membership changed')}
  private async beginMesh(room:GroupMembership,version:number){
    // One current grant covers the bounded mesh burst, including both child
    // endpoints. Explicit join/rejoin still requests a fresh grant first.
    await this.authorize(room,undefined,2000);this.checkMesh(room,version)
    const peers=room.readyPeers,transcript=room.transcript()
    const ids=await Promise.all(peers.map(peer=>groupEdgeId(room.context,this.transport.callDevice,peer,transcript)));this.checkMesh(room,version)
    peers.forEach((peer,index)=>{
      const edge={} as Edge
      const binding:GroupEdge={groupId:room.context.id,participants:room.context.participants,callId:ids[index]}
      const transport:CallTransport={callDevice:this.transport.callDevice,callAccount:this.transport.callAccount,
        authorizeCall:async(_,signal)=>{this.checkMesh(room,version);const value=await this.authorize(room,signal??this.heartbeatSignal(room),2000);this.checkMesh(room,version);return value},
        watchCall:async(_,signal)=>{this.checkMesh(room,version);const value=await this.authorize(room,signal,10_000);this.checkMesh(room,version);return value},
        callKey:async(id,signal)=>{
          this.checkMesh(room,version)
          if(!this.matches(room,signal)||signal.call_id!==edge.id||![signal.from_device,signal.to_device].includes(peer))throw new Error('Unexpected group edge')
          await this.authorize(room,signal,2000)
          const base=await this.transport.callKey(id,signal);this.checkMesh(room,version)
          const key=await this.keys!.derive(room,peer,base)
          try{this.checkMesh(room,version);return hex(key)}finally{key.fill(0)}
        },
        send:async(id,content)=>{this.checkMesh(room,version);if(content.kind!=='call'||!this.matches(room,content.signal)||content.signal.call_id!==edge.id)throw new Error('Unexpected group edge');if(content.signal.kind==='heartbeat')return 'sent';return this.transport.send(id,content)},
        onCall:listener=>{edge.listener=listener;return()=>{edge.listener=undefined}},
      }
      edge.id=ids[index];edge.answering=false
      edge.call=new DirectCall(transport,state=>{if(version===this.meshVersion)this.edgeChanged(room,peer,state)},async()=>{this.checkMesh(room,version);const stream=await this.microphone(room);if(version!==this.meshVersion){stream.getTracks().forEach(track=>track.stop());throw new Error('Group membership changed')}return stream},async()=>{throw new Error('Group video is not available')},binding)
      this.edges.set(peer,edge)
    })
    this.meshReady=true;this.publish({phase:'connecting',message:'Connecting encrypted group audio…'})
    const pending=this.pending;this.pending=[];for(const event of pending)this.edgeSignal(room,event,false)
    await Promise.all([...this.edges].filter(([peer])=>this.transport.callDevice<peer).map(([peer,edge])=>edge.call.start(room.context.conversation,peer,room.context.relayOnly,this.ice)))
  }
  private async microphone(room:GroupMembership){
    this.check(room)
    if(!room.canPublish)throw new Error('Join the call before using the microphone')
    await this.authorize(room,undefined,2000);this.check(room)
    if(!this.sourcePromise){
      const sourceVersion=this.sourceVersion
      this.sourcePromise=this.capture({audio:{echoCancellation:true,noiseSuppression:true},video:false}).then(stream=>{
        if(this.room!==room||!this.active||!room.canPublish||sourceVersion!==this.sourceVersion){stream.getTracks().forEach(track=>track.stop());throw new Error('Group call ended during capture')}
        if(stream.getAudioTracks().length!==1||stream.getVideoTracks().length){stream.getTracks().forEach(track=>track.stop());throw new Error('Group voice requires one microphone track')}
        this.source=stream;const track=stream.getAudioTracks()[0];track.enabled=!this.state.muted
        track.onended=()=>{if(this.room===room)this.finish('The microphone stopped.')};return stream
      })
    }
    const source=await this.sourcePromise;this.check(room)
    source.getAudioTracks()[0].onended=()=>{if(this.active&&this.source===source)this.finish('The microphone stopped.')}
    source.getAudioTracks()[0].enabled=!this.state.muted
    const track=source.getAudioTracks()[0].clone();track.enabled=!this.state.muted
    return new MediaStream([track])
  }
  private edgeChanged(room:GroupMembership,peer:string,state:CallState){
    if(this.room!==room||!this.active)return
    if(state.phase==='ended'){
      const version=this.meshVersion
      setTimeout(()=>{if(this.room===room&&version===this.meshVersion)this.finish(state.message||'A participant disconnected.')},1000)
      return
    }
    this.publish({participants:this.state.participants.map(person=>person.device===peer?{...person,phase:state.phase,remote:state.remote,cameraTrack:state.remoteCamera,screenTrack:state.remoteScreen,systemAudioTrack:state.remoteSystemAudio}:person)})
    if(state.phase==='incoming'){
      const edge=this.edges.get(peer)
      if(!edge||edge.answering||!room.canPublish)return
      const version=this.meshVersion
      edge.answering=true;void edge.call.answer(this.ice).catch(error=>{if(this.room===room&&version===this.meshVersion){this.noteFailure('edge-answer',error);this.finish('A group audio connection failed.')}})
    }
    if(state.phase==='reconnecting'){if(!this.connectUntil)this.connectUntil=Date.now()+25_000;this.publish({phase:'reconnecting',message:'Reconnecting encrypted group audio…'})}
  }
  private watch(){
    if(!this.active){this.watchParked();return}
    const room=this.room,now=Date.now()
    if(this.recovering){if(now>=this.recoveryUntil)this.finish('Group encryption recovery timed out.');return}
    if(now-this.authAt>25_000||!room&&now-this.created>25_000){this.finish('Group call access verification timed out.');return}
    if(!room)return
    room.checkTime(now)
    if(room.stopped){this.finish(room.reason);return}
    this.membershipChanged(room)
    if(this.connectUntil&&this.state.phase!=='connected'&&now>this.connectUntil){this.finish('Group audio connection timed out.');return}
    if(now-this.authAt>=10_000)void this.authorize(room,undefined,10_000).catch(error=>{if(this.room===room){this.noteFailure('periodic-authorization',error);this.finish('Group call access was lost.')}})
    if(now-this.lastHeartbeat>=10_000){this.lastHeartbeat=now;this.dispatchLater(room,room.heartbeat())}
    if(room.canPublish&&this.meshReady&&now-this.lastMediaHeartbeat>=10_000){this.lastMediaHeartbeat=now;this.dispatchLater(room,[{...this.heartbeatSignal(room),description:roomMediaDescription(this.mediaRevision,this.state)}])}
    if(!this.edges.size||![...this.edges.values()].every(edge=>edge.call.state.phase==='connected')||this.checking)return
    this.checking=true;const version=this.meshVersion
    void Promise.all([...this.edges.values()].map(edge=>edge.call.diagnostics())).then(async metrics=>{
      this.checkMesh(room,version)
      if(metrics.every(metric=>metric.decrypted>0)&&[...this.edges.values()].every(edge=>edge.call.state.phase==='connected')){
        this.connectUntil=0;this.retainedCapture=false;this.publish({phase:'connected',message:room.context.relayOnly?'Encrypted group call · relay only':'Encrypted group call'});await this.restoreVideo(room,version)
      }
    }).catch(()=>{if(this.room===room&&version===this.meshVersion)this.finish('Group encryption could not be verified.')}).finally(()=>{if(this.room===room&&version===this.meshVersion)this.checking=false})
  }
  private epochChanged(conversation:string,epoch?:number){
    if(conversation!==this.state.conversation)return
    if(!this.active){this.forgetParked();return}
    if(this.recovering)return
    const previous=this.room
    if(epoch!==undefined&&previous&&epoch<=previous.context.epoch)return
    if(!previous?.hasConsent){this.finish('Encryption changed before the invitation was joined.');return}
    this.recovering=true;this.retainedCapture=true;this.recoveryUntil=Date.now()+30_000
    const generation=++this.generation;this.meshVersion++;this.meshReady=false;this.authPromise=null
    this.source?.getTracks().forEach(track=>{track.enabled=false})
    for(const stream of this.videoSources.values())stream.getTracks().forEach(track=>{track.enabled=false})
    if(!this.source){this.sourceVersion++;this.sourcePromise=null}
    for(const edge of this.edges.values())edge.call.close();this.edges.clear()
    this.keys?.close();this.keys=null
    this.transition=previous;this.room=null;previous.end('Previous media epoch ended')
    this.publish({phase:'reconnecting',message:'Updating private group encryption…',participants:this.state.participants.map(person=>({...person,remote:null}))})
    // Do not await messaging from its own epoch callback.
    void(async()=>{
      while(this.active&&generation===this.generation&&Date.now()<this.recoveryUntil){
        try{
          const current=await this.transport.authorizeGroupCall(conversation)
          if(!this.active||generation!==this.generation)return
          if(current.epoch<=previous.context.epoch){await new Promise(resolve=>setTimeout(resolve,250));continue}
          const context=groupContext(this.server,current,previous.context.id,previous.context.host,previous.context.participants,previous.context.relayOnly)
          const room=new GroupMembership(context,this.transport.callDevice),keys=await GroupKeyAgreement.create(context,this.transport.callDevice)
          if(!this.active||generation!==this.generation){keys.close();return}
          this.transition=null;this.room=room;this.keys=keys;this.current=current;this.authAt=Date.now();this.membershipAt=-1
          const controls=room.answer(keys.publicKey)
          for(const event of this.epochPending)if(this.matches(room,event.signal))room.receive(event.signal)
          this.epochPending=[];this.recovering=false
          await this.dispatch(room,controls);this.membershipChanged(room);return
        }catch(error){
          if(!this.active||generation!==this.generation)return
          // Once a contribution has been installed, never retry by publishing
          // a second round-one key for the same incarnation and epoch.
          if(this.room||[401,403,404].includes((error as {status?:number}).status??0))throw error
          await new Promise(resolve=>setTimeout(resolve,500))
        }
      }
      throw new Error('Group encryption recovery timed out.')
    })().catch(error=>{if(this.active&&generation===this.generation){this.noteFailure('epoch-recovery',error);this.finish('Private group encryption or access could not be restored.')}})
  }
  private watchParked(){
    const parked=this.parked;if(!parked)return
    parked.room.checkTime()
    if(parked.room.stopped||!parked.room.readyPeers.length){this.forgetParked();return}
    this.publish({canRejoin:true,participants:this.state.participants.map(person=>({...person,phase:person.device===this.transport.callDevice?'Left':parked.room.status(person.device),remote:null}))})
  }
  private stopVideo(kind:RoomMediaKind){
    this.videoVersion[kind]++
    const stream=this.videoSources.get(kind);this.videoSources.delete(kind);stream?.getTracks().forEach(track=>{track.onended=null;track.stop()})
    for(const edge of this.edges.values()){void edge.call.setRoomVideo?.(kind,null).catch(()=>{});if(kind==='screen')void edge.call.setRoomVideo?.('system',null).catch(()=>{})}
    this.publish(kind==='camera'?{camera:false,cameraPending:false}:{sharing:false,sharingPending:false,systemAudio:false})
  }
  private mediaChanged(){
    this.mediaRevision++;this.lastMediaHeartbeat=-Infinity
    this.publish({participants:this.state.participants.map(person=>person.device===this.transport.callDevice?{...person,camera:this.state.camera,sharing:this.state.sharing,systemAudio:this.state.systemAudio,cameraTrack:this.videoSources.get('camera')?.getVideoTracks()[0],screenTrack:this.videoSources.get('screen')?.getVideoTracks()[0]}:person)})
    this.watch()
  }
  private async restoreVideo(room:GroupMembership,version:number){
    if(this.restoredVideo===version)return;this.restoredVideo=version
    if(!this.videoSources.size)return
    await this.authorize(room);this.checkMesh(room,version)
    for(const [kind,stream] of this.videoSources){
      stream.getTracks().forEach(track=>{track.enabled=true})
      const video=stream.getVideoTracks()[0],audio=kind==='screen'?stream.getAudioTracks()[0]:null
      if(video?.readyState==='live')await Promise.all([...this.edges.values()].flatMap(edge=>[edge.call.setRoomVideo(kind,video.clone()),...(audio?.readyState==='live'?[edge.call.setRoomVideo('system',audio.clone())]:[])]))
      this.checkMesh(room,version)
    }
    this.mediaChanged()
  }
  async video(kind:RoomMediaKind,withAudio=false){
    if((kind==='camera'?this.state.camera||this.state.cameraPending:this.state.sharing||this.state.sharingPending)){this.stopVideo(kind);this.mediaChanged();return}
    const room=this.room,mesh=this.meshVersion,version=++this.videoVersion[kind],generation=this.generation
    if(!room||this.state.phase!=='connected'||!this.edges.size||[...this.edges.values()].some(edge=>edge.call.state.phase!=='connected'))throw new Error('Wait for private group media to connect.')
    const current=()=>this.active&&this.room===room&&this.generation===generation&&this.meshVersion===mesh&&this.videoVersion[kind]===version
    let stream:MediaStream|null=null
    this.publish({...(kind==='camera'?{cameraPending:true}:{sharingPending:true}),mediaNotice:''})
    try{
      await this.authorize(room);this.checkMesh(room,mesh);if(!current())return
      stream=kind==='camera'?await this.capture({audio:false,video:{deviceId:this.cameraDevice?{exact:this.cameraDevice}:undefined,width:{ideal:1280},height:{ideal:720},frameRate:{ideal:15,max:20}}}):await this.displayCapture(withAudio)
      if(!current()){stream.getTracks().forEach(track=>track.stop());return}
      const video=stream.getVideoTracks()[0],audio=stream.getAudioTracks()[0]
      if(!video||stream.getVideoTracks().length!==1||stream.getAudioTracks().length>(kind==='screen'&&withAudio?1:0)||video.readyState!=='live')throw new Error('Select one video source and explicitly opt in to its audio.')
      await this.authorize(room);this.checkMesh(room,mesh);if(!current()){stream.getTracks().forEach(track=>track.stop());return}
      this.videoSources.set(kind,stream)
      video.onended=()=>{if(this.videoSources.get(kind)===stream){this.stopVideo(kind);this.mediaChanged()}}
      if(audio)audio.onended=()=>{if(this.videoSources.get(kind)===stream){for(const edge of this.edges.values())void edge.call.setRoomVideo('system',null).catch(()=>{});this.publish({systemAudio:false,mediaNotice:'Shared audio stopped. Your screen video is still shared.'});this.mediaChanged()}}
      await Promise.all([...this.edges.values()].flatMap(edge=>[edge.call.setRoomVideo(kind,video.clone()),...(audio?[edge.call.setRoomVideo('system',audio.clone())]:[])]))
      if(!current())return
      this.publish(kind==='camera'?{camera:true,cameraPending:false}:{sharing:true,sharingPending:false,systemAudio:!!audio})
      if(kind==='screen'&&withAudio&&!audio)this.publish({mediaNotice:'This source did not provide computer audio. Your screen video is shared.'})
      this.mediaChanged()
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(current())this.stopVideo(kind);throw error}
  }
  async changeDevice(kind:'audio'|'video',device:string){
    if(kind==='video'){this.cameraDevice=device;if(this.state.camera){this.stopVideo('camera');await this.video('camera')}return}
    const room=this.room,version=++this.deviceVersion,mesh=this.meshVersion
    if(!room||this.state.phase!=='connected')throw new Error('Wait for group audio to connect.')
    await this.authorize(room);this.checkMesh(room,mesh)
    const stream=await this.capture({audio:{deviceId:device?{exact:device}:undefined,echoCancellation:true,noiseSuppression:true},video:false})
    try{
      await this.authorize(room);this.checkMesh(room,mesh)
      if(version!==this.deviceVersion||stream.getTracks().length!==1||stream.getAudioTracks().length!==1)throw new Error('Microphone selection changed during permission approval.')
      const track=stream.getAudioTracks()[0];track.enabled=!this.state.muted
      await Promise.all([...this.edges.values()].map(edge=>edge.call.setMicrophone(track.clone(),()=>version===this.deviceVersion)))
      this.checkMesh(room,mesh);const previous=this.source;this.sourceVersion++;this.source=stream;this.sourcePromise=Promise.resolve(stream);previous?.getTracks().forEach(track=>{track.onended=null;track.stop()});track.onended=()=>{if(this.source===stream)this.finish('The microphone stopped.')}
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error}
  }
  mute(){
    if(!this.active)return
    const muted=!this.state.muted
    this.source?.getAudioTracks().forEach(track=>{track.enabled=!muted})
    for(const edge of this.edges.values())edge.call.mute(muted)
    this.publish({muted})
  }
  hangup(message='You left the group call.'){this.finish(message,true)}
  private stopSource(){this.sourceVersion++;this.source?.getTracks().forEach(track=>{track.onended=null;track.stop()});this.source=null;this.sourcePromise=null}
  private finish(message:string,allowRejoin=false){
    if(!this.active){this.forgetParked();return}
    this.stopVideo('camera');this.stopVideo('screen');this.remoteMedia.clear()
    this.active=false;this.generation++;clearInterval(this.timer);this.timer=undefined
    this.recovering=false;this.recoveryUntil=0;this.retainedCapture=false;this.epochPending=[];this.transition=null
    const room=this.room,keep=allowRejoin&&room&&!room.stopped&&room.readyPeers.length>0&&this.current
    // Incarnation-bound leave is computed before consent/key state is dropped.
    const controls=room?room.leave():[]
    if(keep)this.parked={room,current:this.current!}
    else{room?.end(message);this.parked=null}
    if(room)this.retired.set(room.context.id,Date.now()+120_000)
    this.room=null;this.keys?.close();this.keys=null
    this.meshVersion++;for(const edge of this.edges.values())edge.call.close();this.edges.clear();this.stopSource()
    this.pending=[];this.membershipAt=-1;this.meshReady=false;this.connectUntil=0;this.authPromise=null;this.current=null;this.checking=false;this.lastHeartbeat=0
    this.publish({phase:'ended',message,muted:false,camera:false,sharing:false,systemAudio:false,cameraPending:false,sharingPending:false,mediaNotice:'',canRejoin:!!this.parked,participants:this.state.participants.map(person=>({...person,phase:'ended',remote:null}))})
    if(this.parked){this.timer=setInterval(()=>this.watchParked(),1000);this.watchParked()}
    // Teardown is synchronous; terminal notifications must not hold capture open.
    if(room)for(const signal of controls)void this.transport.send(room.context.conversation,{kind:'call',signal}).catch(()=>{})
  }
  async diagnostics(){return Promise.all([...this.edges].map(async([peer,edge])=>({peer,...await edge.call.diagnostics()})))}
  close(){this.dispose();this.finish('Group call ended.')}
}
