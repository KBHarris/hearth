// Explicit development/native acceptance entry; excluded from the normal bundle.
import {HearthClient,type DeviceEnrollment,type Session,type CallSignal} from '@hearth/sdk'
import {AuthCrypto} from '../crypto/client'
import {MessagingSession,initialChat,type ChatState} from '../crypto/messaging-session'
import {GroupCall} from './group-call'
import {GroupKeyAgreement} from './group-admission'
import {callCapability} from './direct-call'
import {mountGroupPanels} from './acceptance-ui'
type Install={crypto:AuthCrypto;session:Session;device:DeviceEnrollment;service:MessagingSession;state:ChatState}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const status=(text:string)=>{document.getElementById('status')!.textContent=text}
const require=(value:unknown)=>{if(!value)throw new Error('Group call acceptance assertion failed')}
async function until(test:()=>boolean|Promise<boolean>,label:string){for(let i=0;i<600;i++){if(await test())return;await pause(100)}throw new Error(label)}
export async function runGroupAcceptance(config:{origin:string;setupCode:string;turn?:boolean;groupRevoke?:boolean;groupRejoin?:boolean;groupVideo?:boolean}){
  const checks:Record<string,boolean>={},installs:Install[]=[],calls:GroupCall[]=[],originals:MediaStreamTrack[]=[],wire:string[]=[],secrets:string[]=[],connections:RTCPeerConnection[]=[]
  let stage='group capabilities',captures=0,panels:ReturnType<typeof mountGroupPanels>|undefined,audio:AudioContext|undefined,replay:CallSignal|undefined
  const videoTimers:ReturnType<typeof setInterval>[]=[]
  const originalFetch=window.fetch.bind(window),OriginalSocket=window.WebSocket,OriginalConnection=window.RTCPeerConnection,originalDerive=GroupKeyAgreement.prototype.derive,originalPlay=HTMLMediaElement.prototype.play
  const sources=new Map<string,MediaStreamTrack>(),oldMembers:CallSignal[]=[],peaks:number[]=[]
  const failures:Record<string,number>={}
  window.fetch=(input,init)=>{if(typeof init?.body==='string')wire.push(init.body);return originalFetch(input,init).then(response=>{if(response.status>=400)failures[String(response.status)]=(failures[String(response.status)]??0)+1;return response})}
  window.WebSocket=class extends OriginalSocket{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>wire.push(String(event.data)))}}
  window.RTCPeerConnection=class extends OriginalConnection{constructor(config?:RTCConfiguration){super(config);connections.push(this)}}
  HTMLMediaElement.prototype.play=function(){this.volume=0;return originalPlay.call(this)}
  GroupKeyAgreement.prototype.derive=async function(...args){const key=await originalDerive.apply(this,args);secrets.push(Array.from(key,byte=>byte.toString(16).padStart(2,'0')).join(''));return key}
  try{
    require(callCapability());checks.encrypted_transform_capability_required=true
    const client=new HearthClient(config.origin),server=(await client.wellKnown()).server_key,password='HEARTH_GROUP_SYNTHETIC_PASSWORD_private_only'
    async function login(username:string,owner=false){
      const crypto=new AuthCrypto(),registration=await crypto.request('registrationStart',password)
      const start=owner?await client.ownerStart({username,message:registration,setup_code:config.setupCode}):await client.registerStart({username,message:registration,invite_code:null})
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
    stage='group accounts';status(stage)
    const alice=await login('group_alice',true)
    await client.configureServer(alice.session.token,{server_name:'Local group voice acceptance',registration_mode:'open'})
    const bob=await login('group_bob'),charlie=await login('group_charlie')
    const currentConfiguration=charlie.service.callConfiguration.bind(charlie.service)
    // Model a legacy client announcing only the old format, with real approved
    // credentials and MLS delivery; only its capability announcement is changed.
    charlie.service.callConfiguration=async()=>{
      const config=await client.callConfiguration(charlie.session.token,charlie.device.device_key)
      return config.ice_servers.map(server=>({urls:server.urls,...(server.username&&server.credential?{username:server.username,credential:server.credential}:{})}))
    }
    for(const person of installs){
      const send=person.service.send.bind(person.service),key=person.service.callKey.bind(person.service)
      person.service.send=(id,content)=>{
        if(person===installs[0]&&content.kind==='call'&&content.signal.kind==='group-member'&&content.signal.description?.startsWith('01:'))oldMembers.push({...content.signal})
        if(content.kind==='call'&&content.signal.kind==='group-invite'&&!replay)replay={...content.signal}
        return send(id,content.kind==='call'&&['offer','answer'].includes(content.signal.kind)&&content.signal.description?{...content,signal:{...content.signal,description:content.signal.description+'a=x-hearth-test:HEARTH_PRIVATE_GROUP_SDP_CANARY\r\n'}}:content)
      }
      person.service.callKey=async(id,signal)=>{const material=await key(id,signal);secrets.push(material);return material}
      await person.service.start()
    }
    await until(()=>installs.every(person=>person.state.connection==='Connected'),'group gateways')
    const id=await alice.service.create(['group_bob','group_charlie'])
    await until(()=>installs.every(person=>person.state.joined.includes(id)),'group MLS welcomes')
    let legacyBlocked=false
    try{await alice.service.authorizeGroupCall(id)}catch(error){legacyBlocked=(error as {message:string}).message.includes('current Hearth')}
    require(legacyBlocked);checks.legacy_direct_only_lease_blocks_group_signaling=true
    charlie.service.callConfiguration=currentConfiguration;await currentConfiguration()
    require((await fetch(config.origin+'/api/v1/chat/media/'+alice.device.device_key+'?group=true')).status===401)
    require((await fetch(config.origin+'/api/v1/chat/media/'+bob.device.device_key+'?group=true',{headers:{Authorization:'Bearer '+alice.session.token}})).status===403)
    checks.group_configuration_requires_session_and_own_device=true
    await fetch(config.origin+'/api/v1/chat/media/'+alice.device.device_key+'?group=true',{headers:{Authorization:'Bearer '+alice.session.token}})
    let oldGroupBlocked=false
    try{await alice.service.authorizeGroupCall(id)}catch(error){oldGroupBlocked=(error as {message:string}).message.includes('current Hearth')}
    require(oldGroupBlocked);await alice.service.callConfiguration()
    checks.previous_group_format_cannot_send_round_controls=true
    audio=new AudioContext();await audio.resume()
    const synthetic=async()=>{
      const index=captures++,oscillator=audio!.createOscillator(),gain=audio!.createGain(),output=audio!.createMediaStreamDestination(),clock=audio!.createGain()
      oscillator.frequency.value=380+index*110;gain.gain.value=.1;clock.gain.value=0
      oscillator.connect(gain).connect(output);gain.connect(clock).connect(audio!.destination);oscillator.start();void audio!.resume()
      originals.push(...output.stream.getTracks());return output.stream
    }
    function picture(screen=false,withAudio=false){
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d')!;let frame=0
      const paint=()=>{context.fillStyle=screen?'#2040d0':'#d04020';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.fillText(String(frame++),20,80)};paint();videoTimers.push(setInterval(paint,100))
      const stream=canvas.captureStream(10);if(withAudio){const oscillator=audio!.createOscillator(),gain=audio!.createGain(),output=audio!.createMediaStreamDestination();oscillator.frequency.value=1200;gain.gain.value=.1;oscillator.connect(gain).connect(output);oscillator.start();stream.addTrack(output.stream.getAudioTracks()[0])}originals.push(...stream.getTracks());return stream
    }
    for(const person of installs)calls.push(new GroupCall(person.service,server,()=>panels?.render(),async constraints=>{if(constraints.video)return picture();const stream=await synthetic();sources.set(person.device.device_key,stream.getAudioTracks()[0]);return stream},()=>true,async withAudio=>picture(true,!!withAudio)))
    const conversation=await alice.service.authorizeGroupCall(id)
    panels=mountGroupPanels(calls,installs.slice(),conversation)
    checks.real_three_account_group_and_approved_devices=true
    stage='group start invitation';status(stage)
    await until(()=>calls[1].state.phase==='incoming'&&calls[2].state.phase==='incoming','two group invitations')
    require(captures===0&&connections.length===0);checks.invitations_never_acquire_capture=true
    stage='group first answer';status(stage)
    await until(()=>calls[0].state.phase==='connected'&&calls[1].state.phase==='connected','first two people connect')
    require(captures===2&&connections.length===2&&calls[2].state.phase==='incoming');checks.two_people_connect_while_third_has_not_answered=true
    const collectedTracks=connections.flatMap(connection=>connection.getSenders().map(sender=>sender.track).filter((track):track is MediaStreamTrack=>!!track))
    const initialSecrets=secrets.slice()
    stage='group second answer';status(stage)
    await until(()=>calls.every(call=>call.state.phase==='connected'),'three group connections')
    require(captures===3&&connections.length===8);checks.late_third_join_rekeys_pairs_without_recapturing_existing_microphones=true
    stage='group all six audio paths';status(stage)
    const analysers=calls.flatMap(call=>call.state.participants.filter(person=>person.remote).map(person=>{
      const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0
      audio!.createMediaStreamSource(person.remote!).connect(analyser);analyser.connect(silent).connect(audio!.destination)
      return {analyser,samples:new Float32Array(analyser.fftSize),account:person.account}
    }))
    require(analysers.length===6)
    await until(async()=>{
      peaks.length=0
      for(const {analyser,samples} of analysers){analyser.getFloatTimeDomainData(samples);peaks.push(Math.max(...samples.map(Math.abs)))}
      return peaks.every(peak=>peak>.03)&&(await Promise.all(calls.map(call=>call.diagnostics()))).flat().every(metric=>metric.decrypted>10)
    },'all six decrypted audio PCM paths')
    checks.all_six_directed_audio_paths_decrypt_and_decode=true
    const metrics=await Promise.all(calls.map(call=>call.diagnostics()))
    require(metrics.flat().every(metric=>metric.encrypted>10&&metric.decrypted>10&&metric.rejected===0))
    checks.all_pairs_use_sframe_without_matching_key_rejections=true
    // Each edge exports one base and derives one additional ephemeral pair key
    // at both endpoints: six bases and six resulting keys, three of each kind.
    require(secrets.length===16&&new Set(secrets).size===8&&secrets.slice(4).every(secret=>!initialSecrets.includes(secret)))
    checks.pair_keys_match_at_two_endpoints_and_differ_across_pairs=true
    if(config.turn){require(calls.every(call=>call.state.relayOnly)&&metrics.flat().every(metric=>metric.connectivity.selectedRelay&&metric.connectivity.hostCandidates===0));checks.every_edge_selects_relay_with_no_host_candidates=true}
    if(config.groupVideo){
      stage='group camera';status(stage);await until(()=>calls[0].state.camera,'Private group camera consent')
      stage='group include audio';status(stage);await pause(700)
      stage='group screen';status(stage);await until(()=>calls[0].state.sharing&&calls[0].state.systemAudio,'Private group screen/audio consent')
      const sender=alice.device.device_key
      await until(()=>calls.slice(1).every(call=>{const peer=call.state.participants.find(peer=>peer.device===sender);return peer?.camera&&peer.sharing&&peer.systemAudio&&peer.cameraTrack&&peer.screenTrack&&peer.systemAudioTrack}),'Private group authenticated media slots')
      function meter(track:MediaStreamTrack){const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0;audio!.createMediaStreamSource(new MediaStream([track])).connect(analyser);analyser.connect(silent).connect(audio!.destination);const samples=new Float32Array(analyser.fftSize);return()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))}}
      const system=calls.slice(1).map(call=>meter(call.state.participants.find(peer=>peer.device===sender)!.systemAudioTrack!)),microphones=calls.slice(1).map(call=>meter(call.state.participants.find(peer=>peer.device===sender)!.remote!.getAudioTracks()[0]))
      await until(()=>system.every(read=>read()>.03),'Private group computer audio PCM');calls[0].mute();await until(()=>microphones.every(read=>read()<.005)&&system.every(read=>read()>.03),'Private group independent microphone mute');checks.private_camera_screen_and_separate_computer_audio_decode=true
      await pause(65000)
      const previous=sources.get(sender)!;await calls[0].changeDevice('audio','fixture-microphone');require(previous.readyState==='ended'&&calls[0].state.muted&&sources.get(sender)!.enabled===false);checks.microphone_switch_preserves_mute_and_stops_previous_source=true
      await pause(65000)
      const beforeEpoch=installs[0].state.conversations.find(group=>group.id===id)!.epoch,beforeKeys=secrets.slice(),beforeCaptures=captures,retained=originals.filter(track=>track.readyState==='live')
      stage='private group linked-device epoch';status(stage)
      const link=JSON.parse(await alice.crypto.request('linkOffer','',undefined,alice.session.account.id,server)) as {id:string;device_key:string;envelope:string;signature:string;code:string}
      await client.offerDeviceLink(alice.session.token,{id:link.id,device_key:link.device_key,envelope:link.envelope,signature:link.signature})
      const linkedCrypto=new AuthCrypto(),auth=await client.loginStart({username:'group_alice',message:await linkedCrypto.request('loginStart',password)})
      const session=await client.loginFinish({exchange_id:auth.exchange_id,message:await linkedCrypto.request('loginFinish',password,auth.message,'group_alice',server)})
      const identity=JSON.parse(await linkedCrypto.request('restoreIdentity',link.code,link.envelope,alice.session.account.id,server)) as {enrollment:DeviceEnrollment}
      await client.restoreDevice(session.token,{enrollment:identity.enrollment,link_id:link.id});await linkedCrypto.request('commitIdentity','')
      const linked={} as Install;Object.assign(linked,{crypto:linkedCrypto,session,device:identity.enrollment,state:initialChat,service:new MessagingSession(linkedCrypto,session,identity.enrollment,server,config.origin,state=>{linked.state=state})});installs.push(linked);await linked.service.start();await linked.service.callConfiguration()
      const maintenance=alice.service as unknown as {enqueue:<T>(action:()=>Promise<T>)=>Promise<T>;refresh:()=>Promise<void>};await maintenance.enqueue(()=>maintenance.refresh())
      await until(()=>installs.slice(0,3).every(person=>person.state.conversations.find(group=>group.id===id)!.epoch>beforeEpoch)&&calls.every(call=>call.state.phase==='connected'),'Private group MLS recovery')
      require(captures===beforeCaptures&&calls[0].state.muted&&retained.every(track=>track.readyState==='live')&&secrets.slice(beforeKeys.length).every(key=>!beforeKeys.includes(key)))
      await until(async()=>calls.slice(1).every(call=>call.state.participants.find(peer=>peer.device===sender)?.systemAudioTrack)&&(await Promise.all(calls.slice(1).map(call=>call.diagnostics()))).every(edges=>edges.some(edge=>edge.decodedVideoFrames>20)),'Private group restored video and audio')
      const restored=calls.slice(1).map(call=>meter(call.state.participants.find(peer=>peer.device===sender)!.systemAudioTrack!));await until(()=>restored.every(read=>read()>.03),'Private group computer audio after MLS recovery');checks.private_group_epoch_uses_fresh_keys_preserves_consent_mute_and_media=true
      stage='group screen off';status(stage);await until(()=>!calls[0].state.sharing&&!calls[0].state.systemAudio,'Private group screen/audio cleanup');require(calls[0].state.camera)
      for(const call of calls)call.hangup();require(originals.every(track=>track.readyState==='ended'));checks.private_group_leave_stops_all_originals=true
      require(['HEARTH_PRIVATE_GROUP_SDP_CANARY',...secrets].every(secret=>wire.every(body=>!body.includes(secret))));checks.media_keys_and_plaintext_sdp_absent_from_http_and_gateway=true
      return {outcome:'pass',scope:'Three-account private group with production media controls, synthetic camera/screen/computer audio, microphone switch and real linked-device MLS epoch recovery',checks,physicalDevicePermissionsValidated:false,internetValidated:false}
    }
    stage='group mute';status(stage)
    await until(()=>calls[0].state.muted,'group mute UI')
    await until(()=>analysers.filter(item=>item.account===alice.session.account.id).every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))<.005}),'mute reaches both peers')
    checks.mute_silences_both_outgoing_audio_paths=true
    stage='group unmute';status(stage)
    await until(()=>!calls[0].state.muted,'group unmute UI');require(captures===3)
    collectedTracks.push(...connections.flatMap(connection=>connection.getSenders().map(sender=>sender.track).filter((track):track is MediaStreamTrack=>!!track)))
    if(config.groupRevoke){
      stage='group permission revocation';status(stage)
      await client.setBlock(bob.session.token,charlie.session.account.id,true)
      await until(()=>calls.every(call=>call.state.phase==='ended'),'whole group ends after pair block')
      checks.block_between_two_peers_ends_everyone_and_all_capture=true
    }else{
      calls[1].mute()
      stage='group leave';status(stage)
      await until(async()=>calls[0].state.phase==='ended'&&calls.slice(1).every(call=>call.state.phase==='connected'&&call.state.participants.find(person=>person.account===alice.session.account.id)?.phase==='Left')&&(await Promise.all(calls.slice(1).map(call=>call.diagnostics()))).every(edges=>edges.length===1)&&secrets.length===20,'original caller leaves and two people remain connected with fresh keys')
      require(captures===3&&calls[1].state.muted&&connections.length===10)
      const remaining=await Promise.all(calls.slice(1).map(call=>call.diagnostics()))
      require(remaining.flat().every(metric=>metric.decrypted>0&&metric.encrypted>0&&metric.rejected===0))
      require(secrets.length===20&&new Set(secrets).size===10)
      checks.original_caller_can_leave_and_two_people_keep_talking=true
      checks.leave_installs_fresh_pair_keys_and_preserves_source_and_mute=true
      collectedTracks.push(...connections.flatMap(connection=>connection.getSenders().map(sender=>sender.track).filter((track):track is MediaStreamTrack=>!!track)))
      calls[1].mute()
      const survivors=calls.slice(1).flatMap(call=>call.state.participants.filter(person=>person.remote).map(person=>{
        const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0
        audio!.createMediaStreamSource(person.remote!).connect(analyser);analyser.connect(silent).connect(audio!.destination)
        return {analyser,samples:new Float32Array(analyser.fftSize)}
      }))
      require(survivors.length===2)
      await until(()=>survivors.every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))>.03}),'two remaining peers decode audible audio after leave and unmute')
      checks.remaining_pair_decodes_audio_after_rekey_and_unmute=true
      if(config.turn)require(remaining.flat().every(metric=>metric.connectivity.selectedRelay&&metric.connectivity.hostCandidates===0))
      if(config.groupRejoin){
        const departed=sources.get(alice.device.device_key)!,survivorSources=installs.slice(1).map(person=>sources.get(person.device.device_key)!)
        require(calls[0].state.canRejoin&&!calls[0].busy&&departed.readyState==='ended')
        checks.leave_releases_capture_and_call_slot_before_explicit_rejoin=true
        calls[1].mute()
        const beforeRejoin=secrets.slice()
        stage='group rejoin';status(stage)
        await until(()=>calls.every(call=>call.state.phase==='connected')&&captures===4&&connections.length===16&&secrets.length===32,'departed caller explicitly rejoins with fresh mesh')
        require(calls[1].state.muted&&survivorSources.every((track,index)=>track.readyState==='live'&&sources.get(installs[index+1].device.device_key)===track)&&sources.get(alice.device.device_key)!==departed)
        require(new Set(secrets).size===16&&secrets.slice(20).every(secret=>!beforeRejoin.includes(secret)))
        checks.rejoin_uses_fresh_keys_without_recapturing_or_unmuting_survivors=true
        calls[1].mute()
        const rejoined=calls.flatMap(call=>call.state.participants.filter(person=>person.remote).map(person=>{
          const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0
          audio!.createMediaStreamSource(person.remote!).connect(analyser);analyser.connect(silent).connect(audio!.destination)
          return {analyser,samples:new Float32Array(analyser.fftSize)}
        }))
        require(rejoined.length===6)
        await until(()=>rejoined.every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))>.03}),'all six directions decode after rejoin')
        const rejoinedMetrics=(await Promise.all(calls.map(call=>call.diagnostics()))).flat()
        require(rejoinedMetrics.every(metric=>metric.encrypted>0&&metric.decrypted>0&&metric.rejected===0))
        if(config.turn)require(rejoinedMetrics.every(metric=>metric.connectivity.selectedRelay&&metric.connectivity.hostCandidates===0))
        checks.rejoined_six_paths_decode_and_preserve_relay_policy=true
        const oldJoin=oldMembers.find(signal=>signal.description?.startsWith('01:joined:'))!,oldLeave=oldMembers.find(signal=>signal.description?.startsWith('01:left:'))!
        require(oldJoin&&oldLeave)
        for(const signal of [oldJoin,oldLeave])await alice.service.send(id,{kind:'call',signal:{...signal,expires_at:Date.now()+60_000}})
        await pause(1200);require(calls.every(call=>call.state.phase==='connected')&&captures===4&&connections.length===16)
        checks.authenticated_delayed_old_join_and_leave_cannot_replace_rejoined_round=true
        collectedTracks.push(...connections.flatMap(connection=>connection.getSenders().map(sender=>sender.track).filter((track):track is MediaStreamTrack=>!!track)))
        calls[0].hangup()
        await until(()=>calls.slice(1).every(call=>call.state.phase==='connected'&&call.state.participants.find(person=>person.account===alice.session.account.id)?.phase==='Left')&&secrets.length===36,'survivors continue after the rejoined caller leaves again')
        require(connections.length===18&&captures===4&&new Set(secrets).size===18)
        checks.second_leave_refreshes_survivors_without_restoring_old_keys=true
      }
      // Closing the departed caller's messaging session cannot own the room's
      // lifetime. Format support is a durable capability, distinct from presence.
      alice.service.close();await client.groupCallReady(bob.session.token,id,bob.device.device_key)
      checks.departed_callers_session_is_not_required_to_keep_call_open=true
      calls[1].hangup()
      await until(()=>calls[2].state.phase==='outgoing'&&originals.every(track=>track.readyState==='ended'),'last remaining person releases microphone while waiting')
      checks.last_person_waits_without_holding_microphone_capture=true
      calls[2].hangup()
    }
    require([...originals,...collectedTracks].every(track=>track.readyState==='ended'));checks.original_and_cloned_tracks_stop_on_every_device=true
    if(!config.groupRevoke&&replay){await bob.service.send(id,{kind:'call',signal:{...replay,from_device:bob.device.device_key,to_device:charlie.device.device_key,expires_at:Date.now()+60_000}});await pause(600);require(calls.every(call=>call.state.phase==='ended')&&captures===(config.groupRejoin?4:3));checks.late_invitation_cannot_reopen_an_ended_room=true}
    let rejected=false;try{await calls[0].start(id,installs.map(person=>person.device.device_key),true,[])}catch{rejected=true}
    require(rejected&&connections.length===(config.groupRevoke?8:config.groupRejoin?18:10));checks.relay_only_without_turn_never_opens_direct_connections=true
    require(installs.every(person=>person.state.messages.length===0));checks.group_controls_and_sdp_do_not_enter_chat_history=true
    require(wire.length>0&&['HEARTH_PRIVATE_GROUP_SDP_CANARY',...secrets].every(secret=>wire.every(body=>!body.includes(secret))))
    checks.media_keys_and_plaintext_sdp_absent_from_http_and_gateway=true
    return {outcome:'pass',scope:'Three real product accounts/MLS and group UI in one local runtime; six encrypted peer links with synthetic audio only',checks,metrics,audioPeaks:peaks,physicalDevicePermissionsValidated:false,internetValidated:false,turnValidated:!!config.turn,railwayValidated:false}
  }catch(error){return {outcome:'fail',stage,failureClass:error instanceof Error?error.name:'untyped',httpStatus:typeof(error as {status?:unknown})?.status==='number'?(error as {status:number}).status:undefined,checks,failures,deliveryErrors:installs.map(person=>person.state.error),phases:calls.map(call=>call.state.phase),messages:calls.map(call=>call.state.message),faults:calls.map(call=>call.failureDiagnostics()),captures,connections:connections.length,metrics:await Promise.all(calls.map(call=>call.diagnostics().catch(()=>[])))}}
  finally{
    window.fetch=originalFetch;window.WebSocket=OriginalSocket;window.RTCPeerConnection=OriginalConnection;HTMLMediaElement.prototype.play=originalPlay;GroupKeyAgreement.prototype.derive=originalDerive
    for(const call of calls)call.close();for(const timer of videoTimers)clearInterval(timer);panels?.close();for(const person of installs){person.service.close();person.crypto.close()}await audio?.close().catch(()=>{});wire.length=0;secrets.length=0
  }
}
