// Explicit acceptance-only endpoint, isolated in its own browser site/renderer.
import {HearthClient,type DeviceEnrollment,type Session} from '@hearth/sdk'
import {AuthCrypto} from '../crypto/client'
import {MessagingSession,initialChat,type ChatState} from '../crypto/messaging-session'
import {VoiceRoomCall} from './voice-room'
import {SfuKeys} from './sfu-keys'
import {verifyIndependentLease} from './lease-acceptance'
import {mediaWirePrivate} from './media-wire-audit'
import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {Playback} from '../CallPanel'
if(!import.meta.env.DEV&&!__HEARTH_CALL_ACCEPTANCE__)throw new Error('Acceptance build required')
const parentOrigin=new URL(document.referrer).origin
if(parentOrigin!=='http://127.0.0.1:5176'||parent===window)throw new Error('Disposable coordinator required')
let nonce='',cryptoClient:AuthCrypto,session:Session,device:DeviceEnrollment,service:MessagingSession,client:HearthClient,server='',call:VoiceRoomCall,audio:AudioContext,state:ChatState=initialChat,mics=0,cameras=0,screens=0,system=0
const keys=new Set<string>(),wire:string[]=[],tracks:MediaStreamTrack[]=[],timers:ReturnType<typeof setInterval>[]=[],failures:Record<string,number>={},contexts=new Map<string,string>()
const timings:Record<string,{count:number;maxMs:number}>={}
function measured(name:string,started:number){const previous=timings[name]??{count:0,maxMs:0};timings[name]={count:previous.count+1,maxMs:Math.max(previous.maxMs,Math.round(performance.now()-started))}}
const hex=(key:Uint8Array)=>Array.from(key,byte=>byte.toString(16).padStart(2,'0')).join('')
const originalCreate=SfuKeys.prototype.create
SfuKeys.prototype.create=async function(){const result=await originalCreate.call(this);keys.add(hex(result.key));contexts.set(result.signal.group_id!,hex(result.key));return result}
const originalFetch=fetch.bind(window),OriginalSocket=WebSocket
window.fetch=(input,init)=>{const started=performance.now();if(typeof init?.body==='string')wire.push(init.body);return originalFetch(input,init).then(response=>{if(response.status>=400)failures[String(response.status)]=(failures[String(response.status)]??0)+1;return response}).finally(()=>measured('http',started))}
window.WebSocket=class extends OriginalSocket {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>wire.push(String(event.data)))}}
function own(track:MediaStreamTrack){tracks.push(track);const clone=track.clone.bind(track);track.clone=()=>{const child=clone();tracks.push(child);return child}}
function tone(frequency:number){const oscillator=audio.createOscillator(),gain=audio.createGain(),output=audio.createMediaStreamDestination(),silent=audio.createGain();gain.gain.value=.1;silent.gain.value=0;oscillator.frequency.value=frequency;oscillator.connect(gain).connect(output);gain.connect(silent).connect(audio.destination);oscillator.start();output.stream.getTracks().forEach(own);return output.stream}
function picture(screen:boolean,withAudio=false){if(screen)screens++;else cameras++;const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d')!;let frame=0;const paint=()=>{context.fillStyle=screen?'#2040d0':'#d04020';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.fillText(String(frame++),20,80)};paint();timers.push(setInterval(paint,100));const stream=canvas.captureStream(10);stream.getTracks().forEach(own);if(withAudio){system++;stream.addTrack(tone(1200).getAudioTracks()[0])}return stream}
const meters=new Map<string,{read:()=>number;close:()=>void}>(),videos=new Map<string,HTMLVideoElement>()
const playbackContainer=document.createElement('div');document.body.append(playbackContainer)
const playbackRoot=createRoot(playbackContainer),originalPlay=HTMLMediaElement.prototype.play
// Use the product playback path. A statistics-only MediaStreamAudioSourceNode
// does not start Chromium's remote WebRTC audio decoder in these isolated sites.
HTMLMediaElement.prototype.play=function(){this.volume=0;return originalPlay.call(this)}
function peak(track:MediaStreamTrack){let meter=meters.get(track.id);if(!meter){const analyser=audio.createAnalyser(),silent=audio.createGain(),source=audio.createMediaStreamSource(new MediaStream([track]));analyser.fftSize=256;silent.gain.value=0;source.connect(analyser);analyser.connect(silent).connect(audio.destination);const samples=new Float32Array(analyser.fftSize);meter={read:()=>{analyser.getFloatTimeDomainData(samples);let peak=0;for(const sample of samples)peak=Math.max(peak,Math.abs(sample));return peak},close:()=>{source.disconnect();analyser.disconnect();silent.disconnect()}};meters.set(track.id,meter)}return meter.read()}
function render(){
  if(!call)return
  document.getElementById('status')!.textContent=call.state.phase+' · '+call.state.participants.length
  playbackRoot.render(createElement('div',{},call.state.participants.flatMap(peer=>[...(peer.remote?[createElement(Playback,{key:peer.remote.getAudioTracks()[0]?.id,stream:peer.remote,kind:'audio'})]:[]),...(peer.systemAudioTrack?[createElement(Playback,{key:peer.systemAudioTrack.id,stream:new MediaStream([peer.systemAudioTrack]),kind:'audio'})]:[])])))
  const active=new Set<string>()
  const activeAudio=new Set(call.state.participants.flatMap(peer=>[...(peer.remote?.getAudioTracks().map(track=>track.id)??[]),...(peer.systemAudioTrack?[peer.systemAudioTrack.id]:[])]))
  for(const [id,meter] of meters)if(!activeAudio.has(id)){meter.close();meters.delete(id)}
  for(const peer of call.state.participants)for(const track of [peer.cameraTrack,peer.screenTrack])if(track){active.add(track.id);if(!videos.has(track.id)){const video=document.createElement('video');video.muted=true;video.playsInline=true;video.width=120;video.srcObject=new MediaStream([track]);document.getElementById('videos')!.append(video);videos.set(track.id,video);void video.play().catch(()=>{})}}
  for(const [id,video] of videos)if(!active.has(id)){video.srcObject=null;video.remove();videos.delete(id)}
}
async function operation(name:string,data:Record<string,unknown>){
  const id=String(data.id??'')
  switch(name){
    case 'init':{
      if(nonce)throw new Error('Already initialized');nonce=String(data.nonce);if(!/^[a-f0-9]{64}$/.test(nonce))throw new Error('Invalid coordinator')
      client=new HearthClient(String(data.origin));server=(await client.wellKnown()).server_key
      const username=String(data.username),owner=data.owner===true,password='HEARTH_DISTRIBUTED_SFU_SYNTHETIC_PASSWORD',setup=String(data.setupCode??'')
      cryptoClient=new AuthCrypto()
      const message=cryptoClient.message.bind(cryptoClient);cryptoClient.message=(...args)=>{const started=performance.now();return message(...args).finally(()=>measured(args[0],started))}
      const registration=await cryptoClient.request('registrationStart',password),start=owner?await client.ownerStart({username,message:registration,setup_code:setup}):await client.registerStart({username,message:registration,invite_code:null}),upload=await cryptoClient.request('registrationFinish',password,start.message,username,server)
      if(owner)await client.ownerFinish({username,message:upload,setup_code:setup});else await client.registerFinish({username,message:upload,invite_code:null})
      const auth=await client.loginStart({username,message:await cryptoClient.request('loginStart',password)});session=await client.loginFinish({exchange_id:auth.exchange_id,message:await cryptoClient.request('loginFinish',password,auth.message,username,server)})
      const identity=JSON.parse(await cryptoClient.request('prepareIdentity','',undefined,session.account.id,server)) as {enrollment:DeviceEnrollment};device=identity.enrollment;await client.enrollFirstDevice(session.token,device);await cryptoClient.request('commitIdentity','')
      service=new MessagingSession(cryptoClient,session,device,server,String(data.origin),value=>{state=value})
      for(const name of ['voiceRoom','voicePresence','renewVoicePresence','send'] as const){const original=service[name].bind(service) as (...args:never[])=>Promise<unknown>;Object.assign(service,{[name]:(...args:never[])=>{const started=performance.now();return original(...args).finally(()=>measured('session_'+name,started))}})}
      // Clock actual generated/decoded PCM without consuming a hardware output
      // for each synthetic client in this one-browser capacity fixture.
      audio=new AudioContext({sinkId:{type:'none'}} as AudioContextOptions);await audio.resume()
      call=new VoiceRoomCall(service,server,render,async constraints=>{if(constraints.video)return picture(false);mics++;return tone(300+Number(data.index)*40)},()=>true,async withAudio=>picture(true,!!withAudio))
      return {token:session.token,account:session.account,device,server}
    }
    case 'start':await service.start();return true
    case 'gatewayIsolation':{
      // Hold actual durable work, then require a fresh authenticated gateway to
      // resume before releasing it. This probes the production control handler.
      const internal=service as unknown as {tail:Promise<unknown>;socket:WebSocket|null;reconnect:ReturnType<typeof setTimeout>|undefined;openGateway:()=>void}
      await internal.tail
      const old=internal.socket;if(old){old.close();await new Promise(resolve=>old.addEventListener('close',resolve,{once:true}))}
      clearTimeout(internal.reconnect)
      let release!:()=>void;internal.tail=new Promise<void>(resolve=>{release=resolve})
      const started=performance.now()
      try{internal.openGateway();while(state.connection!=='Connected'&&performance.now()-started<4000)await new Promise(resolve=>setTimeout(resolve,20));if(state.connection!=='Connected')throw new Error('Gateway control waited for durable work');return {authenticatedWhileDurableQueueHeld:true,durationMs:Math.round(performance.now()-started)}}finally{release();await internal.tail}
    }
    case 'secureCommunity':await service.secureCommunity(id);return true
    case 'secureChannel':await service.secureChannel(id);await service.openChannel(id);return true
    case 'invite':return service.createInvite(id,3600,26)
    case 'joinCommunity':await client.joinCommunity(session.token,String(data.code));await service.secureJoin(id,String(data.code));await service.openChannel(String(data.channel));return true
    case 'approve':await service.approveMember(id,String(data.account),String(data.identity));return true
    case 'room':return service.voiceRoom(id)
    case 'join':await call.join(id);return true
    case 'leaseIsolation':return verifyIndependentLease(service,call)
    case 'video':await call.video(data.kind==='camera'?'camera':'screen',data.audio===true);return true
    case 'mute':call.mute();return true
    case 'access':return service.sfuAccess(id,Number(data.revision))
    case 'configuration':return service.callConfiguration()
    case 'revoke':{const view=await service.loadGovernance(id),roster=await client.channelRoster(session.token,String(data.channel));const policy=view.governance??{community_id:id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:roster.authority!.owner,signature:''};await service.saveGovernance(id,{...policy,revision:policy.revision+1,overrides:[...policy.overrides,{channel_id:String(data.channel),kind:'member',target_id:String(data.account),allow:0,deny:2}]});return true}
    case 'metrics':return call.sfuDiagnostics()
    case 'snapshot':return {phase:call.state.phase,message:call.state.message,fault:call.failureDiagnostics(),participants:call.state.participants.map(peer=>({device:peer.device,remote:!!peer.remote,camera:peer.camera,screen:peer.sharing,system:peer.systemAudio,micPeak:peer.remote?.getAudioTracks()[0]?peak(peer.remote.getAudioTracks()[0]):null,systemPeak:peer.systemAudioTrack?peak(peer.systemAudioTrack):null})),muted:call.state.muted,camera:call.state.camera,screen:call.state.sharing,system:call.state.systemAudio,mics,cameras,screens,systemCaptures:system,joined:state.joined,epoch:state.conversations.find(group=>group.id===id)?.epoch,deliveryError:state.error,failures,ownedTracks:tracks.length,allStopped:tracks.every(track=>track.readyState==='ended'),keyContexts:contexts.size,wireFrames:wire.length,wirePrivate:mediaWirePrivate(wire,keys),historyEmpty:state.messages.length===0,timings}
    case 'leave':call.leave();return true
    case 'close':call.close();playbackRoot.unmount();playbackContainer.remove();service.close();cryptoClient.close();for(const timer of timers)clearInterval(timer);for(const video of videos.values()){video.srcObject=null;video.remove()}await audio.close();keys.clear();wire.length=0;contexts.clear();return true
    default:throw new Error('Unknown fixture operation')
  }
}
addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==parentOrigin||event.data?.type!=='hearth-sfu-fixture'||nonce&&event.data.nonce!==nonce)return
  const {request,name,data}=event.data
  void operation(name,data??{}).then(value=>parent.postMessage({type:'hearth-sfu-fixture-reply',nonce,request,value},parentOrigin),error=>parent.postMessage({type:'hearth-sfu-fixture-reply',nonce,request,error:{name:error instanceof Error?error.name:'untyped',status:(error as {status?:number})?.status,kind:(error as {kind?:string})?.kind}},parentOrigin))
})
