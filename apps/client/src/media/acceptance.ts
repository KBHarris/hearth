// Development/explicit native acceptance entry, excluded from normal production builds.
import {HearthClient,type DeviceEnrollment,type Session} from '@hearth/sdk'
import {AuthCrypto} from '../crypto/client'
import {MessagingSession,initialChat,type ChatState} from '../crypto/messaging-session'
import {DirectCall,callCapability} from './direct-call'
import {mountCallPanels} from './acceptance-ui'
import {runGroupAcceptance} from './group-acceptance'
import {runSfuAcceptance} from './sfu-acceptance'
import {runVoiceAcceptance} from './voice-acceptance'
import {runDistributedSfu} from './distributed-sfu-acceptance'
if(!import.meta.env.DEV&&!__HEARTH_CALL_ACCEPTANCE__)throw new Error('Explicit call acceptance build required')
type Install={crypto:AuthCrypto;session:Session;device:DeviceEnrollment;service:MessagingSession;state:ChatState}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const status=(text:string)=>{document.getElementById('status')!.textContent=text}
const require=(value:unknown)=>{if(!value)throw new Error('Call acceptance assertion failed')}
async function until(test:()=>boolean|Promise<boolean>,label:string){for(let i=0;i<300;i++){if(await test())return;await pause(100)}throw new Error(label)}
async function run(config:{origin:string;setupCode:string;turn?:boolean;rekey?:boolean;group?:boolean;groupRevoke?:boolean;groupRejoin?:boolean;groupVideo?:boolean;groupEpoch?:boolean;rooms?:boolean;roomRevoke?:boolean;roomVideo?:boolean;sfu?:boolean;sfuCount?:number;sfuPolicy?:boolean;sfuConflict?:boolean;sfuConnect?:boolean;stageCycle?:boolean;stageRevoke?:boolean;sfuObserver?:{origin:string;token:string};sfuCapacityProfile?:boolean;distributedSfu?:boolean}){
  if(config.distributedSfu)return runDistributedSfu(config)
  if(config.sfu)return runSfuAcceptance(config)
  if(config.rooms)return runVoiceAcceptance(config)
  if(config.group)return runGroupAcceptance(config)
  const checks:Record<string,boolean>={},installs:Install[]=[],calls:DirectCall[]=[],contexts:AudioContext[]=[],timers:ReturnType<typeof setInterval>[]=[]
  let stage='capabilities'
  let measuredPeak=0,captures=0
  const connections:RTCPeerConnection[]=[],OriginalConnection=window.RTCPeerConnection
  window.RTCPeerConnection=class extends OriginalConnection{constructor(config?:RTCConfiguration){super(config);connections.push(this)}}
  let panels:ReturnType<typeof mountCallPanels>|undefined
  const wire:string[]=[],secrets:string[]=[]
  const originalFetch=window.fetch.bind(window),OriginalSocket=window.WebSocket
  const originalPlay=HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play=function(){this.volume=0;return originalPlay.call(this)}
  window.fetch=(input,init)=>{if(typeof init?.body==='string')wire.push(init.body);return originalFetch(input,init)}
  window.WebSocket=class extends OriginalSocket {constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>wire.push(String(event.data)))}}
  try{
    require(callCapability());checks.encryption_capability_required=true
    const client=new HearthClient(config.origin),server=(await client.wellKnown()).server_key,password='HEARTH_SYNTHETIC_CALL_PASSWORD_private_only'
    async function login(username:string,owner=false){
      const crypto=new AuthCrypto()
      const startMessage=await crypto.request('registrationStart',password)
      const start=owner?await client.ownerStart({username,message:startMessage,setup_code:config.setupCode}):await client.registerStart({username,message:startMessage,invite_code:null})
      const upload=await crypto.request('registrationFinish',password,start.message,username,server)
      if(owner)await client.ownerFinish({username,message:upload,setup_code:config.setupCode});else await client.registerFinish({username,message:upload,invite_code:null})
      const auth=await client.loginStart({username,message:await crypto.request('loginStart',password)})
      const session=await client.loginFinish({exchange_id:auth.exchange_id,message:await crypto.request('loginFinish',password,auth.message,username,server)})
      const identity=JSON.parse(await crypto.request('prepareIdentity','',undefined,session.account.id,server)) as {enrollment:DeviceEnrollment}
      await client.enrollFirstDevice(session.token,identity.enrollment);await crypto.request('commitIdentity','')
      const install={} as Install
      Object.assign(install,{crypto,session,device:identity.enrollment,state:initialChat,service:new MessagingSession(crypto,session,identity.enrollment,server,config.origin,state=>{install.state=state})})
      installs.push(install);return install
    }
    stage='accounts';status(stage)
    const alice=await login('call_alice',true)
    await client.configureServer(alice.session.token,{server_name:'Local encrypted call test',registration_mode:'open'})
    const bob=await login('call_bob')
    for(const install of installs){
      const send=install.service.send.bind(install.service),key=install.service.callKey.bind(install.service)
      install.service.send=(id,content)=>send(id,content.kind==='call'&&['offer','answer'].includes(content.signal.kind)&&content.signal.description?{...content,signal:{...content.signal,description:content.signal.description+'a=x-hearth-test:HEARTH_PRIVATE_CALL_SDP_CANARY\r\n'}}:content)
      install.service.callKey=async(id,signal)=>{const value=await key(id,signal);secrets.push(value);return value}
    }
    await alice.service.start();await bob.service.start()
    await until(()=>installs.every(i=>i.state.connection==='Connected'),'gateway')
    const id=await alice.service.create(['call_bob'])
    await until(()=>bob.state.joined.includes(id),'MLS welcome')
    checks.real_accounts_approved_devices_and_mls_delivery=true
    stage='ICE authorization';status(stage)
    const configResponse=await fetch(config.origin+'/api/v1/chat/media/'+alice.device.device_key)
    require(configResponse.status===401)
    const wrongDevice=await fetch(config.origin+'/api/v1/chat/media/'+bob.device.device_key,{headers:{Authorization:'Bearer '+alice.session.token}})
    require(wrongDevice.status===403)
    const ice=await alice.service.callConfiguration();require(config.turn?ice.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(url=>/^turns?:/.test(url))):ice.length===0)
    checks.ice_configuration_requires_session_and_own_approved_device=true
    function synthetic(constraints:MediaStreamConstraints):Promise<MediaStream>{
      captures++
      if(constraints.video){
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
        const context=canvas.getContext('2d')!;let frame=0
        const timer=setInterval(()=>{context.fillStyle=frame++%2?'#e79567':'#6379c0';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.fillText('Encrypted synthetic camera '+frame,20,80)},100);timers.push(timer)
        return Promise.resolve(canvas.captureStream(10))
      }
      const audio=new AudioContext();contexts.push(audio)
      const oscillator=audio.createOscillator(),gain=audio.createGain(),output=audio.createMediaStreamDestination()
      oscillator.frequency.value=440;gain.gain.value=.1;oscillator.connect(gain).connect(output)
      const sourceClock=audio.createGain();sourceClock.gain.value=0;gain.connect(sourceClock).connect(audio.destination)
      oscillator.start();void audio.resume()
      return Promise.resolve(output.stream)
    }
    const update=()=>panels?.render()
    async function display(withAudio=false){const video=await synthetic({video:true});if(withAudio){const audio=await synthetic({audio:true});return new MediaStream([...video.getTracks(),...audio.getTracks()])}return video}
    const first=new DirectCall(alice.service,update,synthetic,display),second=new DirectCall(bob.service,update,synthetic,display);calls.push(first,second)
    panels=mountCallPanels(calls,installs.slice(),(await alice.service.authorizeCall(id)))
    stage='start invitation';status(stage)
    await until(()=>second.state.phase==='incoming','incoming call')
    require(second.state.local===null);checks.incoming_call_does_not_capture_before_answer=true
    stage='answer invitation';status(stage)
    await until(()=>first.state.phase==='connected'&&second.state.phase==='connected','connected call')
    if(config.turn){require(first.state.relayOnly&&second.state.relayOnly);checks.selected_relay_candidates_verified_on_both_peers=true}
    stage='audio decryption';status(stage)
    const audio=new AudioContext();contexts.push(audio);await audio.resume()
    const audioPlayback=document.createElement('audio');audioPlayback.autoplay=true;audioPlayback.volume=0;audioPlayback.srcObject=second.state.remote;document.body.append(audioPlayback);await audioPlayback.play()
    const analyser=audio.createAnalyser(),silent=audio.createGain();silent.gain.value=0
    audio.createMediaStreamSource(second.state.remote!).connect(analyser);analyser.connect(silent).connect(audio.destination)
    const samples=new Float32Array(analyser.fftSize)
    await until(async()=>{analyser.getFloatTimeDomainData(samples);measuredPeak=Math.max(...samples.map(Math.abs));return measuredPeak>.03&&(await second.diagnostics()).decrypted>10},'decrypted audio PCM')
    checks.product_call_decodes_encrypted_audio_over_peer_connection=true
    first.mute();require(first.state.muted);first.mute();require(!first.state.muted);checks.microphone_mute_controls_track_enabled=true
    stage='camera';status(stage)
    await until(()=>first.state.camera,'camera UI action')
    await until(async()=>{const video=document.querySelector<HTMLVideoElement>('#call-fixture-1 .call-video');return !!video&&video.videoWidth>0&&video.currentTime>0&&(await second.diagnostics()).decodedVideoFrames>10},'camera UI decoded frames')
    const captureCount=captures,keyCount=secrets.length,originalTracks=first.state.local!.getTracks()
    if(!config.rekey){
    const ufrag=()=>connections[0].localDescription!.sdp.match(/^a=ice-ufrag:(.+)$/m)![1]
    const initialUfrag=ufrag()
    first.mute();require(first.state.muted)
    stage='caller ICE restart';status(stage)
    await first.reconnect()
    await until(async()=>calls.every(call=>call.state.phase==='connected')&&(await first.diagnostics()).completedRestarts===1&&(await second.diagnostics()).completedRestarts===1,'caller restart completes')
    require(ufrag()!==initialUfrag&&first.state.muted&&originalTracks.every(track=>track.enabled===false&&track.readyState==='live'))
    first.mute()
    checks.caller_restart_changes_ice_credentials_and_preserves_muted_capture=true
    stage='callee ICE restart';status(stage)
    await second.reconnect()
    await until(async()=>calls.every(call=>call.state.phase==='connected')&&(await first.diagnostics()).completedRestarts===2&&(await second.diagnostics()).completedRestarts===2,'callee restart completes')
    checks.callee_can_restart_the_existing_encrypted_connection=true
    stage='simultaneous ICE restart';status(stage)
    await Promise.all(calls.map(call=>call.reconnect()))
    await until(async()=>calls.every(call=>call.state.phase==='connected')&&(await first.diagnostics()).completedRestarts===3&&(await second.diagnostics()).completedRestarts===3,'simultaneous restart converges')
    const afterRestartVideo=(await second.diagnostics()).decodedVideoFrames
    await until(async()=>(await second.diagnostics()).decodedVideoFrames>afterRestartVideo+10,'camera continues after recovery')
    await until(()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))>.03},'audio PCM continues after recovery')
    require(captures===captureCount&&secrets.length===keyCount&&connections.length===2&&connections.every(pc=>pc.getTransceivers().length===4)&&originalTracks.every(track=>first.state.local!.getTracks().includes(track)&&track.readyState==='live')&&first.state.camera)
    checks.simultaneous_restarts_keep_workers_keys_camera_and_capture=true
    stage='automatic disconnect-event recovery';status(stage)
    // Inject only the state event, keeping the real ICE/DTLS/SFrame connection.
    // This validates automatic triggering, not an actual network outage.
    const beforeAutomatic=ufrag()
    Object.defineProperty(connections[0],'connectionState',{configurable:true,value:'disconnected'})
    connections[0].dispatchEvent(new Event('connectionstatechange'))
    require(first.state.phase==='reconnecting')
    Reflect.deleteProperty(connections[0],'connectionState')
    await until(async()=>calls.every(call=>call.state.phase==='connected')&&(await first.diagnostics()).completedRestarts===4&&(await second.diagnostics()).completedRestarts===4,'automatic recovery triggered by disconnect event')
    require(ufrag()!==beforeAutomatic&&captures===captureCount&&secrets.length===keyCount)
    checks.disconnect_state_event_automatically_restarts_without_new_capture=true
    }
    if(config.rekey){
    stage='approved linked-device key rotation';status(stage)
    first.mute();require(first.state.muted)
    const link=JSON.parse(await alice.crypto.request('linkOffer','',undefined,alice.session.account.id,server)) as {id:string;device_key:string;envelope:string;signature:string;code:string}
    stage='offer linked device';status(stage)
    await client.offerDeviceLink(alice.session.token,{id:link.id,device_key:link.device_key,envelope:link.envelope,signature:link.signature})
    const linkedCrypto=new AuthCrypto()
    stage='linked device login';status(stage)
    const linkedAuth=await client.loginStart({username:'call_alice',message:await linkedCrypto.request('loginStart',password)})
    const linkedSession=await client.loginFinish({exchange_id:linkedAuth.exchange_id,message:await linkedCrypto.request('loginFinish',password,linkedAuth.message,'call_alice',server)})
    stage='restore linked identity';status(stage)
    const linkedIdentity=JSON.parse(await linkedCrypto.request('restoreIdentity',link.code,link.envelope,alice.session.account.id,server)) as {enrollment:DeviceEnrollment}
    await client.restoreDevice(linkedSession.token,{enrollment:linkedIdentity.enrollment,link_id:link.id});await linkedCrypto.request('commitIdentity','')
    const linked={} as Install
    Object.assign(linked,{crypto:linkedCrypto,session:linkedSession,device:linkedIdentity.enrollment,state:initialChat,service:new MessagingSession(linkedCrypto,linkedSession,linkedIdentity.enrollment,server,config.origin,state=>{linked.state=state})})
    installs.push(linked);stage='start linked messaging';status(stage);await linked.service.start()
    // Run the same serialized maintenance used by the product timer. No test
    // command or synthetic epoch bypass is exposed by the application.
    const maintenance=alice.service as unknown as {enqueue:<T>(action:()=>Promise<T>)=>Promise<T>;refresh:()=>Promise<void>}
    stage='linked device MLS maintenance';status(stage);await maintenance.enqueue(()=>maintenance.refresh())
    stage='confirm media key update';status(stage)
    await until(async()=>calls.every(call=>call.state.phase==='connected')&&(await first.diagnostics()).completedRekeys===1&&(await second.diagnostics()).completedRekeys===1,'new MLS epoch confirmed by both media workers')
    require(first.state.muted&&originalTracks.every(track=>!track.enabled&&track.readyState==='live')&&captures===captureCount&&connections.length===2&&first.state.camera)
    require(secrets.length===keyCount+2&&secrets[keyCount]===secrets[keyCount+1]&&secrets[keyCount]!==secrets[0])
    first.mute()
    const afterRekeyVideo=(await second.diagnostics()).decodedVideoFrames
    await until(async()=>(await second.diagnostics()).decodedVideoFrames>afterRekeyVideo+10,'camera decodes with new epoch keys')
    await until(()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))>.03},'audio decodes with new epoch keys')
    checks.approved_device_join_rotates_media_keys_without_recapture=true
    checks.new_epoch_keys_match_only_on_clients_and_preserve_muted_camera=true
    }
    stage='camera off';status(stage);await until(()=>!first.state.camera,'camera off UI action')
    checks.camera_enable_decode_and_stop_use_same_encryption_worker=true
    stage='include computer audio';status(stage);await pause(700)
    stage='screen share';status(stage)
    const prior=(await second.diagnostics()).decodedVideoFrames
    await until(()=>first.state.sharing,'screen UI action')
    await until(async()=>(await second.diagnostics()).decodedVideoFrames>prior+10,'screen decoded frames')
    await until(()=>!!first.state.systemAudio&&!!second.state.remoteSystemAudio,'screen audio source')
    const systemAnalyser=audio.createAnalyser(),systemSilent=audio.createGain();systemSilent.gain.value=0
    audio.createMediaStreamSource(new MediaStream([second.state.remoteSystemAudio!])).connect(systemAnalyser);systemAnalyser.connect(systemSilent).connect(audio.destination)
    const systemSamples=new Float32Array(systemAnalyser.fftSize),systemPeak=()=>{systemAnalyser.getFloatTimeDomainData(systemSamples);return Math.max(...systemSamples.map(Math.abs))}
    await until(()=>systemPeak()>.03,'separate encrypted computer audio PCM')
    first.mute();await until(()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))<.005&&systemPeak()>.03},'microphone mute independent of computer audio');first.mute()
    checks.computer_audio_decodes_separately_and_survives_microphone_mute=true
    stage='stop screen share';status(stage);await until(()=>!first.state.sharing,'stop screen share UI action')
    await until(()=>!first.state.systemAudio&&systemPeak()<.005,'screen stop also stops shared audio')
    checks.synthetic_screen_share_decodes_and_stops=true
    const metrics=await Promise.all(calls.map(call=>call.diagnostics()))
    require(metrics.every(m=>m.encrypted>10&&m.decrypted>10&&m.rejected===0))
    checks.both_directions_use_sframe_without_matching_key_rejections=true
    stage='hangup';status(stage)
    const tracks=calls.flatMap(call=>call.state.local?.getTracks()??[])
    await until(()=>first.state.phase==='ended'&&second.state.phase==='ended','hangup UI action and peer notification')
    require(tracks.every(track=>track.readyState==='ended'));checks.hangup_stops_capture_and_notifies_peer=true
    stage='relay-only without TURN';status(stage)
    let rejected=false;try{await first.start(id,bob.device.device_key,true,[])}catch{rejected=true}
    require(rejected);checks.relay_only_without_turn_never_creates_direct_call=true
    require(installs.every(i=>i.state.messages.length===0));checks.sdp_and_call_controls_never_appear_as_chat_messages=true
    require(wire.length>0&&secrets.length>=2&&['HEARTH_PRIVATE_CALL_SDP_CANARY',...secrets].every(secret=>wire.every(frame=>!frame.includes(secret))))
    checks.sdp_and_media_keys_absent_from_http_bodies_and_gateway=true
    if(!config.rekey){
    stage='active call permission revocation';status(stage)
    await first.start(id,bob.device.device_key,!!config.turn,await alice.service.callConfiguration())
    await until(()=>second.state.phase==='incoming','second incoming call');await second.answer(await bob.service.callConfiguration())
    await until(()=>first.state.phase==='connected'&&second.state.phase==='connected','second connected call')
    const revokedTracks=calls.flatMap(call=>call.state.local?.getTracks()??[])
    await client.setBlock(alice.session.token,bob.session.account.id,true)
    await until(()=>calls.every(call=>call.state.phase==='ended'),'block revokes active call')
    require(revokedTracks.every(track=>track.readyState==='ended'));checks.block_revokes_active_call_and_stops_both_captures=true
    }
    return {outcome:'pass',scope:'Local product UI/WASM/accounts/MLS and two peer connections in Chromium; synthetic microphone/camera/screen/computer audio',checks,metrics,audioPeak:measuredPeak,physicalDevicePermissionsValidated:false,internetValidated:false,turnValidated:!!config.turn,railwayValidated:false}
  }catch(error){return {outcome:'fail',stage,failureClass:error instanceof Error?error.name:'untyped',httpStatus:typeof(error as {status?:unknown})?.status==='number'?(error as {status:number}).status:undefined,checks,phases:calls.map(call=>call.state.phase),metrics:await Promise.all(calls.map(call=>call.diagnostics().catch(()=>({unavailable:true})))),measuredPeak}}
  finally{window.RTCPeerConnection=OriginalConnection;window.fetch=originalFetch;window.WebSocket=OriginalSocket;HTMLMediaElement.prototype.play=originalPlay;wire.length=0;secrets.length=0;for(const call of calls)call.close();panels?.close();for(const install of installs){install.service.close();install.crypto.close()}for(const timer of timers)clearInterval(timer);for(const audio of contexts)await audio.close().catch(()=>{})}
}
;(window as unknown as {runCallAcceptance:typeof run}).runCallAcceptance=run
status('Ready')
