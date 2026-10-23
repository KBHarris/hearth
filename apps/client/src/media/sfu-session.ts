import {BaseKeyProvider,Room,RoomEvent,Track,LocalAudioTrack,LogLevel,setLogLevel,isE2EESupported,CryptorErrorReason,type RemoteParticipant,type RemoteTrack,type RemoteTrackPublication} from 'livekit-client'
import EncryptionWorker from 'livekit-client/e2ee-worker?worker'
import type {SfuAccess,VoiceRoom} from '@hearth/sdk'
import {Permission,MEDIA_PERMISSIONS} from '@hearth/sdk'
import {sfuRoutes} from './sfu-routes'
export type SfuSource='microphone'|'camera'|'screen'|'system'
type SfuFailure='worker'|'encryption'|'unexpected-track'|'subscriber-route'|'disconnected'|'reconnecting'|'mute'
const sources={microphone:Track.Source.Microphone,camera:Track.Source.Camera,screen:Track.Source.ScreenShare,system:Track.Source.ScreenShareAudio}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
async function bounded<T>(operation:Promise<T>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('SFU operation timed out')),ms)})])}finally{clearTimeout(timer)}}
setLogLevel(LogLevel.silent)
class ParticipantKeys extends BaseKeyProvider {
  constructor(){super({sharedKey:false,ratchetWindowSize:0,failureTolerance:-1})}
  async install(identity:string,key:Uint8Array<ArrayBuffer>){
    const material=await crypto.subtle.importKey('raw',key,'HKDF',false,['deriveBits','deriveKey'])
    this.onSetEncryptionKey(material,identity,0)
  }
}

/** One publisher/subscriber connection per endpoint. All publication uses the
 * pinned SDK's encoded-frame E2EE; signaling tokens contain no media keys. */
export class SfuSession {
  stage:'created'|'keys'|'transport'|'encryption'|'capture'|'publishing'|'route'|'ready'='created'
  private provider=new ParticipantKeys()
  private worker:Worker
  readonly room:Room
  private ended=false
  private ready=false
  private tracks=new Map<SfuSource,MediaStreamTrack>()
  private microphoneTrack:LocalAudioTrack|null=null
  private microphoneMuted:boolean|undefined
  private muteQueue:Promise<void>=Promise.resolve()
  private versions={microphone:0,camera:0,screen:0,system:0}
  private expected=new Map<string,string>()
  private installed=new Set<string>()
  private subscriptions=new Map<string,{device:string;source:SfuSource;track:RemoteTrack}>()
  private failures=0
  private missingKeys=0
  private ownIdentity:string
  private ownDevice:string
  private permissions:Map<string,number>
  private relayOnly:boolean
  private updated:(device:string,source:SfuSource,track:MediaStreamTrack|null)=>void
  private failed:(reason:SfuFailure,detail?:number)=>void
  private status:(connected:boolean)=>void
  constructor(snapshot:VoiceRoom,device:string,updated:(device:string,source:SfuSource,track:MediaStreamTrack|null)=>void,failed:(reason:SfuFailure,detail?:number)=>void,status:(connected:boolean)=>void,permissions=new Map<string,number>()){
    this.ownDevice=device;this.permissions=new Map(permissions)
    if(!isE2EESupported())throw new Error('This runtime cannot encrypt SFU media.')
    for(const peer of snapshot.participants)this.expected.set(peer.device_key+'-'+peer.incarnation,peer.device_key)
    this.ownIdentity=device+'-'+snapshot.participants.find(peer=>peer.device_key===device)!.incarnation
    this.relayOnly=snapshot.relay_only;this.updated=updated;this.failed=failed;this.status=status
    this.worker=new EncryptionWorker()
    this.room=new Room({encryption:{keyProvider:this.provider,worker:this.worker},adaptiveStream:false,dynacast:false,stopLocalTrackOnUnpublish:true})
    this.worker.addEventListener('error',()=>{if(!this.ended)this.failed('worker')})
    this.room.on(RoomEvent.EncryptionError,error=>{if((error as {reason?:number}).reason===CryptorErrorReason.MissingKey)this.missingKeys++;else{this.failures++;if(!this.ended)this.failed('encryption')}})
    this.room.on(RoomEvent.TrackPublished,(publication,participant)=>this.subscribe(publication,participant))
    this.room.on(RoomEvent.TrackSubscribed,(track,publication,participant)=>{
      const source=this.source(publication),device=this.expected.get(participant.identity)
      if(this.ended||!device||!source||!this.allowed(device,source)||!publication.isEncrypted){publication.setSubscribed(false);track.detach();if(!this.ended)this.failed('unexpected-track');return}
      this.subscriptions.set(publication.trackSid,{device,source,track})
      void(async()=>{if(this.relayOnly){let verified=false;for(let i=0;i<30;i++){this.check();if((await this.routes())[1].selectedRelay){verified=true;break}await pause(100)}if(!verified)throw new Error('SFU subscriber route unavailable')}this.check();this.updated(device,source,track.mediaStreamTrack)})().catch(()=>{if(!this.ended)this.failed('subscriber-route')})
    })
    this.room.on(RoomEvent.TrackUnsubscribed,(_,publication)=>{const prior=this.subscriptions.get(publication.trackSid);if(prior){this.subscriptions.delete(publication.trackSid);this.updated(prior.device,prior.source,null)}})
    this.room.on(RoomEvent.Disconnected,reason=>{if(!this.ended)this.failed('disconnected',reason)})
    // A reconnect cannot continue publication under unchecked routing/token state.
    // The owning room stops/rejoins on this bounded preview failure path.
    this.room.on(RoomEvent.Reconnecting,()=>{for(const track of this.tracks.values())track.enabled=false;this.status(false);if(!this.ended)this.failed('reconnecting')})
  }
  private check(){if(this.ended)throw new Error('SFU session ended')}
  private source(publication:RemoteTrackPublication){return (Object.keys(sources) as SfuSource[]).find(source=>sources[source]===publication.source)}
  private allowed(device:string,source:SfuSource){return !!((this.permissions.get(device)??MEDIA_PERMISSIONS)&(source==='microphone'?Permission.speak:source==='camera'?Permission.camera:Permission.screen))}
  private subscribe(publication:RemoteTrackPublication,participant:RemoteParticipant){
    const device=this.expected.get(participant.identity),source=this.source(publication)
    if(this.ended||!device||!source||!this.allowed(device,source)||!publication.isEncrypted){publication.setSubscribed(false);return}
    if(this.installed.has(participant.identity))publication.setSubscribed(true)
  }
  async install(device:string,key:Uint8Array<ArrayBuffer>){
    this.check();const identity=[...this.expected].find(([,peer])=>peer===device)?.[0]
    if(!identity)throw new Error('Unknown SFU participant')
    await this.provider.install(identity,key);this.check();this.installed.add(identity)
    const remote=this.room.remoteParticipants.get(identity)
    if(remote)for(const publication of remote.trackPublications.values())this.subscribe(publication,remote)
  }
  async start(access:SfuAccess,key:Uint8Array<ArrayBuffer>,ice:RTCIceServer[],microphone:(()=>Promise<MediaStream>)|null){
    this.stage='keys';this.check();if(access.identity!==this.ownIdentity)throw new Error('Unexpected SFU identity')
    try{await this.provider.install(this.ownIdentity,key)}finally{key.fill(0)}this.check()
    await this.room.setE2EEEnabled(true);this.check()
    this.stage='transport'
    await this.room.connect(access.url,access.token,{autoSubscribe:false,rtcConfig:{...(ice.length?{iceServers:ice}:{}),iceTransportPolicy:this.relayOnly?'relay':'all'}});this.check()
    this.stage='encryption'
    const deadline=Date.now()+10_000
    let proof=false
    while(Date.now()<deadline){
      this.check()
      if(this.room.isE2EEEnabled){
        try{
          // Local worker challenge only: it proves the sender key has actually
          // installed before capture. No data packet is sent to the SFU.
          const encrypted=await bounded(this.room.engine.e2eeManager!.encryptData(new Uint8Array([1])),1000);encrypted.payload.fill(0);encrypted.iv.fill(0);proof=true;break
        }catch{ /* Worker installation is asynchronous. */ }
      }
      await pause(50)
    }
    if(!proof)throw new Error('SFU encryption did not become ready')
    this.ready=true
    this.stage='capture'
    if(microphone){
    const stream=await microphone()
    if(this.ended){stream.getTracks().forEach(track=>track.stop());throw new Error('SFU session ended during microphone capture')}
    const track=stream.getAudioTracks()[0]
    if(!track||stream.getTracks().length!==1){stream.getTracks().forEach(track=>track.stop());throw new Error('Invalid SFU microphone')}
    this.stage='publishing'
    await this.publish('microphone',track);this.check()
    }
    this.stage='route'
    if(this.relayOnly){
      let verified=false
      for(let attempt=0;attempt<40;attempt++){this.check();const route=await this.routes();if(route[0].selectedRelay){verified=true;break}await pause(100)}
      if(!verified)throw new Error('SFU relay route could not be verified')
    }
    for(const participant of this.room.remoteParticipants.values())for(const publication of participant.trackPublications.values())this.subscribe(publication,participant)
    this.stage='ready';this.status(true)
  }
  async publish(source:SfuSource,track:MediaStreamTrack|null){
    const version=++this.versions[source],previous=this.tracks.get(source);this.tracks.delete(source)
    if(source==='microphone')this.microphoneTrack=null
    previous?.stop()
    if(previous)await this.room.localParticipant.unpublishTrack(previous,true).catch(()=>{})
    if(!track)return
    try{
      this.check();if(!this.allowed(this.ownDevice,source)||!this.ready||!this.room.isE2EEEnabled||track.readyState!=='live'||track.kind!==(source==='microphone'||source==='system'?'audio':'video')||version!==this.versions[source])throw new Error('SFU publication is not ready')
      this.tracks.set(source,track)
      let publicationTrack:MediaStreamTrack|LocalAudioTrack=track
      if(source==='microphone'){
        this.microphoneMuted??=!track.enabled
        // The SDK otherwise wraps a raw disabled track as an unmuted source.
        // Set its mute state before it can acquire a sender during a rekey.
        this.microphoneTrack=new LocalAudioTrack(track,undefined,true)
        publicationTrack=this.microphoneTrack
        await this.syncMute();this.check()
      }
      const publication=await this.room.localParticipant.publishTrack(publicationTrack,{source:sources[source],videoCodec:'vp8',simulcast:false,dtx:false,red:false});this.check()
      if(version!==this.versions[source]||!publication.isEncrypted||!this.room.isE2EEEnabled)throw new Error('SFU publication encryption changed')
    }catch(error){track.stop();if(this.tracks.get(source)===track)this.tracks.delete(source);throw error}
  }
  mute(muted:boolean){this.microphoneMuted=muted;const track=this.tracks.get('microphone');if(track)track.enabled=!muted;void this.syncMute().catch(()=>{if(!this.ended)this.failed('mute')})}
  private syncMute(){
    this.muteQueue=this.muteQueue.then(async()=>{
      const track=this.microphoneTrack
      if(!track||this.ended)return
      let muted:boolean
      do{muted=!!this.microphoneMuted;await(muted?track.mute():track.unmute());track.mediaStreamTrack.enabled=!this.microphoneMuted&&!this.ended}while(!this.ended&&track===this.microphoneTrack&&muted!==this.microphoneMuted)
    })
    return this.muteQueue
  }
  private routes(){return sfuRoutes(this.room.engine.pcManager)}
  async diagnostics(){
    const inbound=await Promise.all([...this.subscriptions.values()].map(async({device,source,track})=>{
      const stats=await track.getRTCStatsReport();let packets=0,frames=0,samples=0,bytes=0
      stats?.forEach(report=>{if(report.type==='inbound-rtp'){packets+=report.packetsReceived??0;frames+=report.framesDecoded??0;samples+=report.totalSamplesReceived??0;bytes+=report.bytesReceived??0}})
      return {device,source,packets,frames,samples,bytes}
    }))
    const stats=await this.room.engine.pcManager?.publisher.getStats();let outboundBytes=0,outboundPackets=0
    stats?.forEach(report=>{if(report.type==='outbound-rtp'){outboundBytes+=report.bytesSent??0;outboundPackets+=report.packetsSent??0}})
    return {sfu:true,connectionMode:this.room.engine.pcManager?.mode,encryptionEnabled:this.room.isE2EEEnabled,publishedSources:[...this.tracks.keys()],inbound,outboundBytes,outboundPackets,workerErrors:this.failures,missingKeyEvents:this.missingKeys,routes:await this.routes()}
  }
  close(){
    if(this.ended)return;this.ended=true;this.ready=false
    for(const source of Object.keys(this.versions) as SfuSource[])this.versions[source]++
    for(const track of this.tracks.values())track.stop();this.tracks.clear();this.microphoneTrack=null
    for(const {track} of this.subscriptions.values())track.detach();this.subscriptions.clear()
    this.room.removeAllListeners();void this.room.disconnect(true).catch(()=>{});this.worker.terminate();this.installed.clear();this.expected.clear()
  }
}
