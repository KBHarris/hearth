import type {CallSignal,LocalCallSignal,Conversation,MessageContent} from '@hearth/sdk'
import {RecoveryHandshake,restartDescription,restartId} from './call-recovery.ts'
import {captureDisplay} from './display-capture.ts'
export type CallState={phase:'idle'|'preparing'|'outgoing'|'incoming'|'connecting'|'connected'|'reconnecting'|'rekeying'|'ended';conversation:string;peer:string;message:string;muted:boolean;camera:boolean;sharing:boolean;relayOnly:boolean;local:MediaStream|null;remote:MediaStream|null;remoteCamera?:MediaStreamTrack|null;remoteScreen?:MediaStreamTrack|null;remoteSystemAudio?:MediaStreamTrack|null;systemAudio?:boolean}
export const idleCall:CallState={phase:'idle',conversation:'',peer:'',message:'',muted:false,camera:false,sharing:false,relayOnly:false,local:null,remote:null}
export interface CallTransport {
  callDevice:string;callAccount:string
  authorizeCall:(id:string,signal?:CallSignal)=>Promise<Conversation>
  watchCall?:(id:string,signal:CallSignal)=>Promise<Conversation>
  callKey:(id:string,signal:CallSignal)=>Promise<string>
  send:(id:string,content:MessageContent)=>Promise<'sent'|'queued'>
  onCall:(listener:(event:LocalCallSignal)=>void,locked:(conversation?:string)=>void,epochChanged?:(conversation:string,epoch?:number)=>void|Promise<void>)=>(()=>void)
}
export type GroupEdge={groupId:string;participants:readonly string[];callId:string;voiceRoom?:string;allowAudio?:boolean}
type TransformConstructor=new(worker:Worker,options:unknown)=>unknown
type TransformEndpoint={transform?:unknown}
type MediaCounters={encrypted:number;decrypted:number;rejected:number;authenticationFailures:number;replayed:number;malformed:number;unexpectedStream:number;emptyDropped:number;pausedDropped:number;staleDropped:number}
type Connectivity={connectionState:string;iceState:string;gatheringState:string;relayCandidates:number;hostCandidates:number;selectedRelay:boolean;relayProtocol?:string;stopReason:string}
export function callCapability(){
  return !!(globalThis.isSecureContext&&globalThis.RTCPeerConnection&&globalThis.Worker&&'RTCRtpScriptTransform' in globalThis&&navigator.mediaDevices?.getUserMedia)
}
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')
const live=(signal:CallSignal)=>signal.expires_at>Date.now()&&signal.expires_at<=Date.now()+65_000
export class DirectCall {
  state:CallState={...idleCall}
  private transport:CallTransport
  private changed:(state:CallState)=>void
  private capture:(constraints:MediaStreamConstraints)=>Promise<MediaStream>
  private displayCapture:(audio?:boolean)=>Promise<MediaStream>
  private offer:CallSignal|null=null
  private pc:RTCPeerConnection|null=null
  private worker:Worker|null=null
  private transceivers:RTCRtpTransceiver[]=[]
  private streams=new Set<MediaStream>()
  private roomVideo=new Map<'camera'|'screen'|'system',MediaStreamTrack>()
  private roomVideoVersion={camera:0,screen:0,system:0}
  private deviceVersion={audio:0,video:0}
  private cameraDevice=''
  private stopped=new Set<string>()
  private disposeListener:()=>void
  private timer:ReturnType<typeof setInterval>|undefined
  private lastPeer=0
  private started=0
  private serial:Promise<unknown>=Promise.resolve()
  private active=false
  private generation=0
  private established=false
  private edge:GroupEdge|undefined
  private recovery:RecoveryHandshake|null=null
  private recoveryTimer:ReturnType<typeof setInterval>|undefined
  private retryTimer:ReturnType<typeof setTimeout>|undefined
  private recoveryUntil=0
  private recoveryBaseline:Promise<number>|null=null
  private completedRestarts=0
  private negotiating=false
  private keyUpdating=false
  private keyUpdate:{id:string;epoch:number;stage:'offered'|'ready'|'committed'|'confirmed';baseline:number}|null=null
  private keyTimer:ReturnType<typeof setInterval>|undefined
  private completedRekeys=0
  private retiredKeyUpdates=new Set<string>()
  private connectivity:Connectivity={connectionState:'new',iceState:'new',gatheringState:'new',relayCandidates:0,hostCandidates:0,selectedRelay:false,stopReason:''}
  constructor(transport:CallTransport,changed:(state:CallState)=>void,capture=(constraints:MediaStreamConstraints)=>navigator.mediaDevices.getUserMedia(constraints),displayCapture=captureDisplay,edge?:GroupEdge){
    this.edge=edge
    this.transport=transport;this.changed=changed;this.capture=capture;this.displayCapture=displayCapture
    this.disposeListener=transport.onCall(event=>{const generation=this.generation;this.serial=this.serial.then(()=>this.receive(event)).catch(()=>{if(generation===this.generation)this.finish('Call verification failed. Start a new call.')})},conversation=>{if(!conversation||conversation===this.state.conversation)this.finish('Encryption or authentication changed. Start a new call.')},(conversation,epoch)=>this.epochChanged(conversation,epoch))
  }
  private publish(patch:Partial<CallState>){this.state={...this.state,...patch};this.changed(this.state)}
  private check(offer:CallSignal){if(this.offer!==offer||!this.active)throw new Error('Call ended')}
  private async signal(kind:string,description:string|null=null){
    const offer=this.offer;if(!offer)throw new Error('Call ended')
    const from=this.transport.callDevice,to=from===offer.from_device?offer.to_device:offer.from_device
    const result=await this.transport.send(this.state.conversation,{kind:'call',signal:{...offer,from_device:from,to_device:to,kind,description,expires_at:Date.now()+60_000}})
    if(result!=='sent')throw new Error('Call signaling is offline. Try again when messaging reconnects.')
  }
  async start(id:string,device:string,relayOnly=false,iceServers:RTCIceServer[]=[]){
    if(this.active)throw new Error('End the current call first.')
    if(!callCapability())throw new Error('Encrypted calls need a supported browser with media permissions and encoded transforms.')
    if(relayOnly&&!iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url))))throw new Error('Relay-only calls need a configured TURN relay. No direct connection was attempted.')
    const generation=++this.generation
    this.completedRekeys=0
    this.retiredKeyUpdates.clear()
    this.connectivity={connectionState:'new',iceState:'new',gatheringState:'new',relayCandidates:0,hostCandidates:0,selectedRelay:false,stopReason:''}
    this.active=true;this.started=Date.now();this.established=false;this.recovery=new RecoveryHandshake(false);this.completedRestarts=0;this.publish({...idleCall,phase:'preparing',conversation:id,relayOnly})
    try{
      const current=await this.transport.authorizeCall(id)
      if(!this.active||generation!==this.generation)return
      const peer=current.members.find(m=>m.enrollment.device_key===device&&m.account_id!==this.transport.callAccount)
      if(!peer)throw new Error('Choose an approved device belonging to the other person.')
      const offer:CallSignal={call_id:this.edge?.callId??randomId(),epoch:current.epoch,from_device:this.transport.callDevice,to_device:device,expires_at:Date.now()+60_000,kind:'offer',description:'pending',relay_only:relayOnly,...(this.edge?{group_id:this.edge.groupId,participants:[...this.edge.participants],...(this.edge.voiceRoom?{voice_room:this.edge.voiceRoom}:{})}:{})}
      this.offer=offer;this.publish({peer:peer.account_id})
      await this.prepare(offer,0,iceServers)
      this.check(offer)
      const description=await this.pc!.createOffer();await this.pc!.setLocalDescription(description);await this.gather(offer)
      this.check(offer);await this.signal('offer',this.pc!.localDescription!.sdp)
      this.check(offer);this.publish({phase:'outgoing',message:'Calling…'});this.watch(offer)
    }catch(error){if(generation===this.generation)this.finish(error instanceof Error?error.message:'The call could not start.');throw error}
  }
  private async prepare(offer:CallSignal,role:number,iceServers:RTCIceServer[]){
    this.check(offer)
    const key=await this.transport.callKey(this.state.conversation,offer);this.check(offer)
    const worker=new Worker(new URL('./transform-worker.ts',import.meta.url),{type:'module'});this.worker=worker
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Media encryption did not become ready.')),10_000)
      worker.onmessage=({data})=>{if(data.op==='ready'){clearTimeout(timer);resolve()}else if(data.op==='fatal'){clearTimeout(timer);reject(new Error('Media encryption failed.'));if(this.worker===worker&&this.offer===offer)this.finish('Media encryption failed.')}}
      worker.onerror=()=>{clearTimeout(timer);reject(new Error('Media encryption failed.'));if(this.worker===worker&&this.offer===offer)this.finish('Media encryption failed.')}
      worker.postMessage({op:'init',key,role,epoch:offer.epoch,id:offer.call_id,slots:4})
    })
    this.check(offer)
    const pc=new RTCPeerConnection({iceServers,iceTransportPolicy:offer.relay_only?'relay':'all',bundlePolicy:'max-bundle'});this.pc=pc
    const remote=new MediaStream();this.publish({remote})
    pc.ontrack=event=>{
      if(this.pc!==pc)return
      // Script addTrack() does not emit a MediaStream addtrack event. Publish a
      // new stream so playback and the camera/share tiles observe every track.
      const tracks=this.state.remote?.getTracks().filter(track=>track.id!==event.track.id)??[]
      const slot=pc.getTransceivers().indexOf(event.transceiver)
      if(slot===3){this.publish({remoteSystemAudio:event.track});return}
      this.publish({remote:new MediaStream([...tracks,event.track]),...(slot===1?{remoteCamera:event.track}:slot===2?{remoteScreen:event.track}:{})})
    }
    // The answerer must use the transceivers created by the authenticated offer.
    // Pre-creating unrelated receivers would leave the real inbound path unbound.
    if(role===1){await pc.setRemoteDescription({type:'offer',sdp:offer.description!});this.check(offer)}
    const Transform=(globalThis as unknown as {RTCRtpScriptTransform:TransformConstructor}).RTCRtpScriptTransform
    const kinds=['audio','video','video','audio']
    this.transceivers=kinds.map((kind,slot)=>{
      const transceiver=role===0?pc.addTransceiver(kind,{direction:'sendrecv'}):pc.getTransceivers()[slot]
      if(!transceiver||transceiver.receiver.track.kind!==kind||role===1&&pc.getTransceivers().length!==kinds.length)throw new Error('Unsupported encrypted call description.')
      transceiver.direction='sendrecv'
      ;(transceiver.sender as unknown as TransformEndpoint).transform=new Transform(worker,{direction:'send',slot})
      ;(transceiver.receiver as unknown as TransformEndpoint).transform=new Transform(worker,{direction:'receive',slot})
      // One video codec gives an explicit tested framing/packetization profile.
      if(kind==='video'){
        const codecs=RTCRtpReceiver.getCapabilities('video')?.codecs.filter(c=>c.mimeType.toLowerCase()==='video/vp8')
        if(!codecs?.length)throw new Error('This runtime needs VP8 for encrypted video calls.')
        transceiver.setCodecPreferences(codecs)
      }
      return transceiver
    })
    const connectionChanged=()=>{
      if(this.pc!==pc)return
      if(this.keyUpdating){if(pc.connectionState==='closed')this.finish('Connection interrupted during key update.');return}
      if(pc.connectionState==='closed')this.finish('Connection interrupted. Start a new call.')
      else if(['failed','disconnected'].includes(pc.connectionState)||['failed','disconnected'].includes(pc.iceConnectionState)){
        if(!this.established){this.finish('Connection interrupted. Start a new call.');return}
        this.beginRecovery(offer)
        if(!this.retryTimer&&!this.negotiating&&!this.recovery?.pending){
          this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;void this.reconnect().catch(()=>{})},pc.connectionState==='failed'||pc.iceConnectionState==='failed'?0:2000)
        }
      }else if(pc.connectionState==='connected'&&!this.recoveryUntil){
        void this.verifyRoute(offer).then(()=>{this.check(offer);if(this.recoveryUntil)return;this.established=true;this.publish({phase:'connected',message:offer.relay_only?'Encrypted · relay only':'Encrypted call'})}).catch(()=>{if(this.offer===offer&&this.pc===pc)this.finish('The selected privacy route could not be verified.')})
      }
    }
    pc.onconnectionstatechange=connectionChanged;pc.oniceconnectionstatechange=connectionChanged
    if(this.edge?.allowAudio===false)return
    const audio=await this.capture({audio:{echoCancellation:true,noiseSuppression:true},video:false})
    if(this.offer!==offer||!this.active){audio.getTracks().forEach(t=>t.stop());throw new Error('Call ended')}
    this.streams.add(audio);this.publish({local:audio})
    const track=audio.getAudioTracks()[0];if(!track)throw new Error('Microphone capture did not provide audio.')
    await this.transceivers[0].sender.replaceTrack(track)
  }
  private async verifyRoute(offer:CallSignal){
    if(!offer.relay_only)return
    // Candidate-pair stats can lag the connection-state event. Stay in connecting
    // until a bounded positive selected/nominated relay observation is available.
    for(let attempt=0;attempt<20;attempt++){
      this.check(offer);const stats=await this.pc!.getStats();let checked=false,relayProtocol:string|undefined
      const selected=(candidate:{candidateType?:string;relayProtocol?:string}|undefined)=>{if(candidate?.candidateType==='relay'){checked=true;if(['tls','tcp','udp'].includes(candidate.relayProtocol??''))relayProtocol=candidate.relayProtocol}}
      stats.forEach(report=>{
        if(report.type==='transport'&&report.selectedCandidatePairId){const pair=stats.get(report.selectedCandidatePairId);selected(pair&&stats.get(pair.localCandidateId))}
        if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded')selected(stats.get(report.localCandidateId))
      })
      if(checked){this.connectivity={...this.connectivity,selectedRelay:true,...(relayProtocol?{relayProtocol}:{})};return}
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    throw new Error('Relay route unavailable')
  }
  private async gather(offer:CallSignal){
    const pc=this.pc!;if(pc.iceGatheringState==='complete')return
    await new Promise<void>((resolve,reject)=>{
      const done=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',done);resolve()}}
      const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',done);reject(new Error('Network discovery timed out. Check your relay settings.'))},12_000)
      pc.addEventListener('icegatheringstatechange',done);done()
    });this.check(offer)
  }
  private beginRecovery(offer:CallSignal){
    if(this.recoveryUntil)return
    this.recoveryUntil=Date.now()+20_000
    this.recoveryBaseline=this.diagnostics().then(value=>value.decrypted)
    // Observe failures even if another queued operation never reaches the await.
    void this.recoveryBaseline.catch(()=>{if(this.offer===offer)this.finish('Media recovery could not be verified.')})
    this.publish({phase:'reconnecting',message:'Reconnecting encrypted call…'})
    let busy=false
    this.recoveryTimer=setInterval(()=>{
      if(this.offer!==offer)return
      if(Date.now()>=this.recoveryUntil){this.finish('Connection recovery timed out. Start a new call.');return}
      if(busy||this.negotiating||this.recovery?.pending||this.retryTimer||this.pc?.signalingState!=='stable'||!['connected','completed'].includes(this.pc.iceConnectionState))return
      busy=true
      void(async()=>{
        const baseline=await this.recoveryBaseline!,metrics=await this.diagnostics()
        this.check(offer)
        if(metrics.decrypted<=baseline||this.negotiating||this.recovery?.pending)return
        await this.verifyRoute(offer);this.check(offer)
        if(this.negotiating||this.recovery?.pending)return
        clearInterval(this.recoveryTimer);this.recoveryTimer=undefined;this.recoveryUntil=0;this.recoveryBaseline=null;this.completedRestarts++
        this.publish({phase:'connected',message:offer.relay_only?'Encrypted · relay only':'Encrypted call'})
      })().catch(()=>{if(this.offer===offer)this.finish('The recovered privacy route could not be verified.')}).finally(()=>{busy=false})
    },500)
  }
  /** Restart only the network negotiation. Capture, workers, keys and counters survive. */
  reconnect():Promise<void>{
    const scheduledOffer=this.offer
    const operation=this.serial.then(async()=>{
      const offer=this.offer,pc=this.pc
      if(!offer||offer!==scheduledOffer||!pc||!this.established||!this.active||this.recovery?.pending||this.keyUpdating)return
      this.negotiating=true
      try{
        this.beginRecovery(offer)
        await this.recoveryBaseline;this.check(offer)
        await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
        const id=randomId();this.recovery!.start(id)
        clearTimeout(this.retryTimer);this.retryTimer=undefined
        await pc.setLocalDescription(await pc.createOffer({iceRestart:true}));this.check(offer)
        await this.gather(offer)
        await this.signal('offer',restartDescription(pc.localDescription!.sdp,id));this.check(offer)
      }finally{if(this.offer===offer)this.negotiating=false}
    })
    this.serial=operation.catch(()=>{if(this.offer===scheduledOffer&&this.active)this.finish('Connection recovery failed. Start a new call.')})
    return operation
  }
  private async recoverSignal(signal:CallSignal,offer:CallSignal){
    const pc=this.pc,id=signal.description&&restartId(signal.description)
    if(!id||!pc||!this.established||!this.recovery)return
    if(signal.kind==='answer'){
      if(this.recovery.pending!==id||pc.signalingState!=='have-local-offer')return
      await this.transport.authorizeCall(this.state.conversation,signal);this.check(offer)
      await pc.setRemoteDescription({type:'answer',sdp:signal.description!});this.check(offer)
      this.recovery.answer(id);return
    }
    const action=this.recovery.incoming(id)
    if(action==='ignore')return
    this.negotiating=true
    try{
      this.beginRecovery(offer);await this.recoveryBaseline;this.check(offer)
      await this.transport.authorizeCall(this.state.conversation,signal);this.check(offer)
      clearTimeout(this.retryTimer);this.retryTimer=undefined
      if(action==='rollback')await pc.setLocalDescription({type:'rollback'})
      this.check(offer);await pc.setRemoteDescription({type:'offer',sdp:signal.description!});this.check(offer)
      await pc.setLocalDescription(await pc.createAnswer());this.check(offer);await this.gather(offer)
      await this.signal('answer',restartDescription(pc.localDescription!.sdp,id));this.check(offer)
    }finally{if(this.offer===offer)this.negotiating=false}
  }
  private async receive(event:LocalCallSignal){
    const {signal,conversation_id}=event
    // Group admission has its own consent/key boundary. A mesh edge must never
    // be interpreted as a fresh one-to-one invitation by this controller.
    if(this.edge){
      if(signal.group_id!==this.edge.groupId||signal.voice_room!==this.edge.voiceRoom||signal.call_id!==this.edge.callId||JSON.stringify(signal.participants)!==JSON.stringify(this.edge.participants)||signal.kind.startsWith('group-'))return
      if(signal.kind.startsWith('key-'))return
    }else if(signal.group_id!==undefined||signal.participants!==undefined||signal.kind.startsWith('group-'))return
    if(signal.to_device!==this.transport.callDevice||!live(signal)||this.stopped.has(signal.call_id))return
    if(signal.kind==='offer'&&!this.active){
      // A delayed restart can never become a fresh invitation after hangup.
      if(signal.description&&restartId(signal.description))return
      if(!callCapability())return
      await this.transport.authorizeCall(conversation_id,signal)
      if(this.active||!live(signal))return
      this.connectivity={connectionState:'new',iceState:'new',gatheringState:'new',relayCandidates:0,hostCandidates:0,selectedRelay:false,stopReason:''}
      this.active=true;this.offer=signal;this.started=Date.now();this.lastPeer=Date.now();this.established=false;this.recovery=new RecoveryHandshake(true);this.completedRestarts=0
      this.completedRekeys=0
      this.retiredKeyUpdates.clear()
      this.publish({...idleCall,phase:'incoming',conversation:conversation_id,peer:event.account_id,message:'Incoming encrypted call',relayOnly:signal.relay_only})
      this.watch(signal);return
    }
    const offer=this.offer
    if(signal.kind.startsWith('key-')){
      if(offer&&signal.call_id===offer.call_id&&signal.epoch>=offer.epoch&&signal.relay_only===offer.relay_only&&conversation_id===this.state.conversation&&signal.from_device===(this.transport.callDevice===offer.from_device?offer.to_device:offer.from_device))await this.keySignal(signal,offer)
      return
    }
    if(!offer||signal.call_id!==offer.call_id||signal.epoch!==offer.epoch||signal.relay_only!==offer.relay_only||conversation_id!==this.state.conversation||signal.from_device!==(this.transport.callDevice===offer.from_device?offer.to_device:offer.from_device))return
    this.lastPeer=Date.now()
    if(signal.kind==='hangup'){this.finish('Call ended.');return}
    if((signal.kind==='offer'||signal.kind==='answer')&&signal.description&&restartId(signal.description)){
      await this.recoverSignal(signal,offer);return
    }
    if(signal.kind==='answer'&&this.state.phase==='outgoing'&&this.transport.callDevice===offer.from_device){
      await this.transport.authorizeCall(conversation_id,signal);this.check(offer)
      await this.pc!.setRemoteDescription({type:'answer',sdp:signal.description!});this.publish({phase:'connecting',message:'Connecting securely…'})
    }
  }
  async answer(iceServers:RTCIceServer[]=[]){
    const offer=this.offer;if(!offer||this.state.phase!=='incoming')return
    try{
      if(offer.relay_only&&!iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url))))throw new Error('This call requires a configured TURN relay. No direct connection was attempted.')
      this.publish({phase:'preparing',message:'Preparing encrypted media…'})
      await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
      await this.prepare(offer,1,iceServers);this.check(offer)
      await this.pc!.setLocalDescription(await this.pc!.createAnswer());await this.gather(offer)
      await this.signal('answer',this.pc!.localDescription!.sdp);this.check(offer)
      this.publish({phase:'connecting',message:'Connecting securely…'})
    }catch(error){if(this.offer===offer)await this.hangup(error instanceof Error?error.message:'The call could not be answered.');throw error}
  }
  private epochChanged(conversation:string,epoch?:number){
    const offer=this.offer
    let paused:Promise<void>|undefined
    if(!offer||!this.active||conversation!==this.state.conversation)return
    if(this.edge){this.finish('Group encryption changed. Start a new call.');return}
    if(epoch===undefined&&this.keyUpdating){this.finish('Encryption changed again before the key update completed.');return}
    if(!this.keyUpdating){
      if(!this.established||this.recoveryUntil||this.negotiating||this.completedRekeys>=32){this.finish('Encryption changed. Start a new call.');return}
      this.keyUpdating=true
      paused=this.keyCommand('pause',randomId()).then(()=>{})
      void paused.catch(()=>{if(this.offer===offer)this.finish('Media publication could not be paused.')})
      this.publish({phase:'rekeying',message:'Updating call encryption…'})
      const deadline=Date.now()+20_000;let busy=false
      this.keyTimer=setInterval(()=>{
        if(this.offer!==offer)return
        if(Date.now()>=deadline||Date.now()-this.started>50*60_000){this.finish('Call encryption update timed out. Start a new call.');return}
        const update=this.keyUpdate
        if(busy||update?.stage!=='confirmed')return
        busy=true
        void(async()=>{
          const metrics=await this.diagnostics();this.check(offer)
          if(metrics.decrypted<=update.baseline)return
          await this.verifyRoute(offer);this.check(offer)
          if(this.keyUpdate!==update)return
          clearInterval(this.keyTimer);this.keyTimer=undefined;this.retiredKeyUpdates.add(update.id);this.keyUpdate=null;this.keyUpdating=false;this.completedRekeys++
          this.watch(offer);this.publish({phase:'connected',message:offer.relay_only?'Encrypted · relay only':'Encrypted call'})
        })().catch(()=>{if(this.offer===offer)this.finish('Call encryption could not be verified.')}).finally(()=>{busy=false})
      },500)
    }
    if(epoch!==undefined){
      this.serial=this.serial.then(()=>this.prepareEpoch(offer,epoch)).catch(()=>{if(this.offer===offer)this.finish('Call encryption update was not authorized.')})
    }
    return paused
  }
  private async keyCommand(op:'pause'|'install'|'resume',id:string,extra:Record<string,unknown>={}):Promise<number>{
    const worker=this.worker;if(!worker)throw new Error('Call ended')
    return new Promise((resolve,reject)=>{
      const listener=({data}:MessageEvent)=>{
        if(data.id===id&&data.op===(op==='pause'?'paused':op==='install'?'installed':'resumed')){clearTimeout(timer);worker.removeEventListener('message',listener);resolve(data.decrypted??0)}
        else if(data.op==='fatal'){clearTimeout(timer);worker.removeEventListener('message',listener);reject(new Error('Media encryption failed'))}
      }
      const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Media key update timed out'))},5000)
      worker.addEventListener('message',listener);worker.postMessage({op,id,...extra})
    })
  }
  private async authorizeEpoch(offer:CallSignal,epoch:number){
    if(epoch<=offer.epoch)throw new Error('Stale encryption update')
    await this.transport.authorizeCall(this.state.conversation,{...offer,epoch});this.check(offer)
    offer.epoch=epoch
  }
  private async installEpoch(offer:CallSignal,id:string){
    const key=await this.transport.callKey(this.state.conversation,{...offer,call_id:id,kind:'offer',description:'key update'})
    this.check(offer)
    return this.keyCommand('install',id,{epoch:offer.epoch,key})
  }
  private async prepareEpoch(offer:CallSignal,epoch:number){
    this.check(offer)
    if(!this.keyUpdating)return
    if(epoch===offer.epoch)return
    await this.authorizeEpoch(offer,epoch)
    if(this.transport.callDevice!==offer.from_device)return
    const id=randomId(),baseline=await this.installEpoch(offer,id);this.check(offer)
    this.keyUpdate={id,epoch,stage:'offered',baseline}
    await this.signal('key-offer',id);this.check(offer)
  }
  private async keySignal(signal:CallSignal,offer:CallSignal){
    const id=signal.description
    if(!id||!/^[a-f0-9]{64}$/.test(id)||!this.established||this.retiredKeyUpdates.has(id))return
    const caller=this.transport.callDevice===offer.from_device
    if(signal.kind==='key-offer'){
      if(caller||signal.epoch<offer.epoch)return
      if(!this.keyUpdating)await this.epochChanged(this.state.conversation)
      this.check(offer)
      if(!this.keyUpdating||this.keyUpdate)return
      if(signal.epoch>offer.epoch)await this.authorizeEpoch(offer,signal.epoch)
      else await this.transport.authorizeCall(this.state.conversation,signal)
      this.check(offer)
      const baseline=await this.installEpoch(offer,id);this.check(offer)
      this.keyUpdate={id,epoch:signal.epoch,stage:'ready',baseline}
      await this.signal('key-ready',id);this.check(offer);return
    }
    const update=this.keyUpdate
    if(!update||update.id!==id||update.epoch!==signal.epoch)return
    await this.transport.authorizeCall(this.state.conversation,signal);this.check(offer)
    if(caller&&signal.kind==='key-ready'&&update.stage==='offered'){
      await this.signal('key-commit',id);this.check(offer)
      await this.keyCommand('resume',id);this.check(offer);update.stage='committed'
    }else if(!caller&&signal.kind==='key-commit'&&update.stage==='ready'){
      await this.keyCommand('resume',id);this.check(offer)
      await this.signal('key-done',id);this.check(offer);update.stage='confirmed'
    }else if(caller&&signal.kind==='key-done'&&update.stage==='committed')update.stage='confirmed'
    this.lastPeer=Date.now()
  }
  private watch(offer:CallSignal){
    clearInterval(this.timer)
    this.lastPeer=Date.now();let busy=false,lastAuthorization=Date.now(),lastHeartbeat=Date.now()
    this.timer=setInterval(()=>{
      if(this.offer!==offer)return
      if(this.keyUpdating)return
      if(Date.now()-this.lastPeer>25_000||Date.now()-lastAuthorization>25_000||(['incoming','outgoing','connecting','preparing'].includes(this.state.phase)&&Date.now()-this.started>60_000)){this.finish('Call verification timed out. Start a new call.');return}
      if(Date.now()-this.started>50*60_000){this.finish('This preview call reached its 50-minute limit. Start a new call to refresh relay credentials.');return}
      if(busy)return
      busy=true
      void(async()=>{
        if(Date.now()-lastAuthorization>10_000){await (this.transport.watchCall?this.transport.watchCall(this.state.conversation,offer):this.transport.authorizeCall(this.state.conversation,offer));lastAuthorization=Date.now()}
        if(this.keyUpdating)return
        this.check(offer)
        // Room presence also renews independently. Keep encrypted peer liveness
        // within the same 25-second watchdog without sending three heartbeats
        // every five seconds from each member of a four-person mesh.
        if(!this.edge?.voiceRoom||Date.now()-lastHeartbeat>=10_000){await this.signal('heartbeat');lastHeartbeat=Date.now()}
        this.check(offer)
      })().catch(()=>{if(this.offer===offer&&!this.keyUpdating)this.finish('Call ended because authorization or signaling was lost.')}).finally(()=>{busy=false})
    },5000)
  }
  mute(muted=!this.state.muted){this.state.local?.getAudioTracks().forEach(track=>{track.enabled=!muted});this.publish({muted})}
  async setMicrophone(track:MediaStreamTrack,stillCurrent=()=>true){
    const offer=this.offer
    try{
      if(!offer||!this.active||!this.transceivers[0]||track.kind!=='audio'||track.readyState!=='live')throw new Error('The encrypted microphone connection is not ready.')
      await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer);if(!stillCurrent())throw new Error('Microphone selection changed.')
      track.enabled=!this.state.muted
      const previous=this.transceivers[0].sender.track
      await this.transceivers[0].sender.replaceTrack(track);this.check(offer);if(!stillCurrent())throw new Error('Microphone selection changed.')
      previous?.stop();this.streams.add(new MediaStream([track]));this.publish({local:new MediaStream([track])})
      track.onended=()=>{if(this.offer===offer&&this.transceivers[0]?.sender.track===track)this.finish('The microphone stopped.')}
    }catch(error){track.stop();throw error}
  }
  async changeDevice(kind:'audio'|'video',device:string){
    const offer=this.offer,version=++this.deviceVersion[kind]
    if(!offer||this.state.phase!=='connected'||this.edge)throw new Error('Wait for the call to connect before changing devices.')
    if(kind==='video'){this.cameraDevice=device;if(!this.state.camera)return}
    await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
    const stream=await this.capture(kind==='audio'?{audio:{deviceId:device?{exact:device}:undefined,echoCancellation:true,noiseSuppression:true},video:false}:{audio:false,video:{deviceId:device?{exact:device}:undefined,width:{ideal:1280},height:{ideal:720}}})
    try{
      await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
      if(version!==this.deviceVersion[kind]||stream.getTracks().length!==1||stream.getTracks()[0].kind!==(kind==='audio'?'audio':'video'))throw new Error('Device selection changed during permission approval.')
      if(kind==='audio')await this.setMicrophone(stream.getAudioTracks()[0],()=>version===this.deviceVersion[kind])
      else{const previous=this.transceivers[1].sender.track,track=stream.getVideoTracks()[0];await this.transceivers[1].sender.replaceTrack(track);this.check(offer);previous?.stop();track.onended=()=>{if(this.offer===offer&&this.transceivers[1]?.sender.track===track){void this.transceivers[1].sender.replaceTrack(null).catch(()=>{});this.publish({camera:false})}}}
      this.streams.add(stream)
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error}
  }
  /** The room owns capture consent; this edge takes ownership of a clone only.
   * Both video slots already have encrypted transforms before any publication. */
  async setRoomVideo(kind:'camera'|'screen'|'system',track:MediaStreamTrack|null){
    const slot=kind==='camera'?1:kind==='screen'?2:3,version=++this.roomVideoVersion[kind],offer=this.offer
    this.roomVideo.get(kind)?.stop();this.roomVideo.delete(kind)
    const sender=this.transceivers[slot]?.sender
    if(!track){this.publish(kind==='camera'?{camera:false}:kind==='screen'?{sharing:false}:{systemAudio:false});await sender?.replaceTrack(null);return}
    try{
      if(!this.edge||!offer||!sender||!this.worker||this.state.phase!=='connected'||track.kind!==(kind==='system'?'audio':'video')||track.readyState!=='live')throw new Error('Room media is not ready.')
      this.roomVideo.set(kind,track)
      await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
      if(version!==this.roomVideoVersion[kind]||this.state.phase!=='connected'||track.readyState!=='live')throw new Error('Room video changed.')
      await sender.replaceTrack(track);this.check(offer)
      if(version!==this.roomVideoVersion[kind]||track.readyState!=='live')throw new Error('Room video changed.')
      this.publish(kind==='camera'?{camera:true}:kind==='screen'?{sharing:true}:{systemAudio:true})
    }catch(error){track.stop();if(this.roomVideo.get(kind)===track)this.roomVideo.delete(kind);throw error}
  }
  async video(kind:'camera'|'screen',withAudio=false){
    if(this.edge)return
    const slot=kind==='camera'?1:2,enabled=kind==='camera'?this.state.camera:this.state.sharing
    const offer=this.offer;if(!offer||(this.state.phase!=='connected'&&!(['reconnecting','rekeying'].includes(this.state.phase)&&enabled)))return
    if(enabled){const track=this.transceivers[slot].sender.track;track?.stop();if(kind==='screen'){this.transceivers[3].sender.track?.stop();void this.transceivers[3].sender.replaceTrack(null).catch(()=>{})}await this.transceivers[slot].sender.replaceTrack(null);this.publish(kind==='camera'?{camera:false}:{sharing:false,systemAudio:false});return}
    await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)
    const stream=kind==='camera'?await this.capture({audio:false,video:{deviceId:this.cameraDevice?{exact:this.cameraDevice}:undefined,width:{ideal:1280},height:{ideal:720}}}):await this.displayCapture(withAudio)
    if(this.offer!==offer||!this.active){stream.getTracks().forEach(t=>t.stop());return}
    const track=stream.getVideoTracks()[0];if(!track||stream.getVideoTracks().length!==1||stream.getAudioTracks().length>(kind==='screen'&&withAudio?1:0)){stream.getTracks().forEach(t=>t.stop());throw new Error('Invalid selected video or audio tracks.')}
    try{await this.transport.authorizeCall(this.state.conversation,offer);this.check(offer)}catch(error){stream.getTracks().forEach(t=>t.stop());throw error}
    this.streams.add(stream)
    try{await this.transceivers[slot].sender.replaceTrack(track);if(kind==='screen'&&stream.getAudioTracks()[0])await this.transceivers[3].sender.replaceTrack(stream.getAudioTracks()[0]);this.check(offer)}catch{stream.getTracks().forEach(t=>t.stop());throw new Error('This capture could not be added to the encrypted call.')}
    track.onended=()=>{stream.getTracks().forEach(track=>track.stop());if(this.offer===offer){void this.transceivers[slot]?.sender.replaceTrack(null).catch(()=>{});if(kind==='screen')void this.transceivers[3]?.sender.replaceTrack(null).catch(()=>{});this.publish(kind==='camera'?{camera:false}:{sharing:false,systemAudio:false})}}
    const audio=kind==='screen'?stream.getAudioTracks()[0]:null
    if(audio)audio.onended=()=>{if(this.offer===offer&&this.transceivers[3]?.sender.track===audio){void this.transceivers[3].sender.replaceTrack(null).catch(()=>{});this.publish({systemAudio:false})}}
    this.publish(kind==='camera'?{camera:true}:{sharing:true,systemAudio:stream.getAudioTracks().length===1})
  }
  async hangup(message='Call ended.'){
    if(!this.active)return
    // End local capture immediately even if authenticated delivery is stalled.
    const notification=this.offer?this.signal('hangup').catch(()=>{}):Promise.resolve()
    this.finish(message);await notification
  }
  private finish(message:string){
    this.generation++
    this.roomVideoVersion.camera++;this.roomVideoVersion.screen++;this.roomVideoVersion.system++
    for(const track of this.roomVideo.values())track.stop();this.roomVideo.clear()
    clearInterval(this.keyTimer);this.keyTimer=undefined;this.keyUpdating=false;this.keyUpdate=null
    this.captureConnectivity()
    this.connectivity.stopReason=message.includes('privacy route')?'route':message.includes('verification timed')?'watchdog':message.includes('Connection interrupted')?'ice':message.includes('authorization or signaling')?'authorization':message.includes('Encryption or authentication')?'epoch_or_authentication':'ended'
    if(this.offer){this.stopped.add(this.offer.call_id);if(this.stopped.size>128)this.stopped.delete(this.stopped.values().next().value!)}
    this.active=false;this.offer=null;clearInterval(this.timer);clearInterval(this.recoveryTimer);clearTimeout(this.retryTimer);this.recoveryTimer=undefined;this.retryTimer=undefined;this.recoveryUntil=0;this.recoveryBaseline=null;this.recovery=null;this.established=false;this.negotiating=false;this.pc?.close();this.pc=null;this.worker?.terminate();this.worker=null
    for(const stream of this.streams)stream.getTracks().forEach(track=>track.stop());this.streams.clear();this.transceivers=[]
    this.state.remote?.getTracks().forEach(track=>track.stop())
    this.publish({phase:'ended',message,local:null,remote:null,remoteCamera:null,remoteScreen:null,remoteSystemAudio:null,muted:false,camera:false,sharing:false,systemAudio:false})
  }
  close(){this.disposeListener();this.finish('Call ended.')}
  private captureConnectivity(){
    if(!this.pc)return
    const lines=this.pc.localDescription?.sdp.split(/\r?\n/).filter(line=>line.startsWith('a=candidate:'))??[]
    Object.assign(this.connectivity,{connectionState:this.pc.connectionState,iceState:this.pc.iceConnectionState,gatheringState:this.pc.iceGatheringState,relayCandidates:lines.filter(line=>line.includes(' typ relay')).length,hostCandidates:lines.filter(line=>line.includes(' typ host')).length})
  }
  async diagnostics():Promise<MediaCounters&{decodedVideoFrames:number;completedRestarts:number;completedRekeys:number;connectivity:Connectivity}>{
    const worker=this.worker,pc=this.pc
    this.captureConnectivity()
    if(!worker||!pc)return {encrypted:0,decrypted:0,rejected:0,authenticationFailures:0,replayed:0,malformed:0,unexpectedStream:0,emptyDropped:0,pausedDropped:0,staleDropped:0,decodedVideoFrames:0,completedRestarts:this.completedRestarts,completedRekeys:this.completedRekeys,connectivity:{...this.connectivity}}
    const counters=await new Promise<MediaCounters>((resolve,reject)=>{
      const listener=({data}:MessageEvent)=>{if(data.op==='stats'){clearTimeout(timer);worker.removeEventListener('message',listener);resolve({encrypted:data.encrypted,decrypted:data.decrypted,rejected:data.rejected,authenticationFailures:data.authenticationFailures,replayed:data.replayed,malformed:data.malformed,unexpectedStream:data.unexpectedStream,emptyDropped:data.emptyDropped,pausedDropped:data.pausedDropped,staleDropped:data.staleDropped})}}
      const timer=setTimeout(()=>{worker.removeEventListener('message',listener);reject(new Error('Media diagnostics unavailable'))},2000)
      worker.addEventListener('message',listener);worker.postMessage({op:'stats'})
    })
    let decodedVideoFrames=0;(await pc.getStats()).forEach(report=>{if(report.type==='inbound-rtp'&&report.kind==='video')decodedVideoFrames+=report.framesDecoded??0})
    return {...counters,decodedVideoFrames,completedRestarts:this.completedRestarts,completedRekeys:this.completedRekeys,connectivity:{...this.connectivity}}
  }
}
