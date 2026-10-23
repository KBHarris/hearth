// Explicit local/native acceptance; excluded from normal production assets.
import {HearthClient,type DeviceEnrollment,type Session,type VoicePresence} from '@hearth/sdk'
import {AuthCrypto} from '../crypto/client'
import {MessagingSession,initialChat,type ChatState} from '../crypto/messaging-session'
import {VoiceRoomCall} from './voice-room'
import {GroupKeyAgreement} from './group-admission'
import {mountVoicePanels} from './acceptance-ui'
type Install={crypto:AuthCrypto;session:Session;device:DeviceEnrollment;service:MessagingSession;state:ChatState}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
const status=(text:string)=>{document.getElementById('status')!.textContent=text}
const require=(value:unknown)=>{if(!value)throw new Error('Voice room acceptance assertion failed')}
async function until(test:()=>boolean|Promise<boolean>,label:string){for(let i=0;i<600;i++){if(await test())return;await pause(100)}throw new Error(label)}
export async function runVoiceAcceptance(config:{origin:string;setupCode:string;turn?:boolean;roomRevoke?:boolean;roomVideo?:boolean}){
  const httpFailures:Record<string,number>={},checks:Record<string,boolean>={},installs:Install[]=[],calls:VoiceRoomCall[]=[],connections:RTCPeerConnection[]=[],sources=new Map<string,MediaStreamTrack>(),tracks:MediaStreamTrack[]=[],wire:string[]=[],secrets:string[]=[],publics:VoicePresence[]=[]
  let stage='voice accounts',captures=0,panels:ReturnType<typeof mountVoicePanels>|undefined,audio:AudioContext|undefined
  let cameraCaptures=0,screenCaptures=0
  const videoSources:MediaStreamTrack[]=[],videoClones:MediaStreamTrack[]=[],videoTimers:ReturnType<typeof setInterval>[]=[],videoElements:HTMLVideoElement[]=[]
  const sharedSources:MediaStreamTrack[]=[],sharedClones:MediaStreamTrack[]=[]
  const OriginalConnection=window.RTCPeerConnection,originalFetch=window.fetch.bind(window),OriginalSocket=window.WebSocket,originalDerive=GroupKeyAgreement.prototype.derive,originalPlay=HTMLMediaElement.prototype.play
  window.RTCPeerConnection=class extends OriginalConnection{constructor(config?:RTCConfiguration){super(config);connections.push(this)}}
  window.fetch=(input,init)=>{if(typeof init?.body==='string')wire.push(init.body);return originalFetch(input,init).then(response=>{if(response.status>=400)httpFailures[String(response.status)]=(httpFailures[String(response.status)]??0)+1;return response})}
  window.WebSocket=class extends OriginalSocket{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>wire.push(String(event.data)))}}
  HTMLMediaElement.prototype.play=function(){this.volume=0;return originalPlay.call(this)}
  GroupKeyAgreement.prototype.derive=async function(...args){const key=await originalDerive.apply(this,args);secrets.push(Array.from(key,byte=>byte.toString(16).padStart(2,'0')).join(''));return key}
  try{
    const client=new HearthClient(config.origin),server=(await client.wellKnown()).server_key,password='HEARTH_VOICE_SYNTHETIC_PASSWORD'
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
    status(stage)
    const alice=await login('voice_alice',true)
    await client.configureServer(alice.session.token,{server_name:'Local community voice acceptance',registration_mode:'open'})
    for(const name of ['voice_bob','voice_charlie','voice_dana','voice_eve'])await login(name)
    for(const person of installs){
      const send=person.service.send.bind(person.service),key=person.service.callKey.bind(person.service),presence=person.service.voicePresence.bind(person.service)
      person.service.send=(id,content)=>send(id,content.kind==='call'&&content.signal.description&&['offer','answer'].includes(content.signal.kind)?{...content,signal:{...content.signal,description:content.signal.description+'a=x-hearth-test:HEARTH_PRIVATE_ROOM_SDP_CANARY\r\n'}}:content)
      person.service.callKey=async(id,signal)=>{const material=await key(id,signal);secrets.push(material);return material}
      person.service.voicePresence=async value=>{publics.push({...value});return presence(value)}
      await person.service.start()
    }
    stage='voice community setup';status(stage)
    const community=await client.createCommunity(alice.session.token,'Voice community')
    stage='voice community authority';status(stage)
    await alice.service.secureCommunity(community.id)
    const channel=await client.createChannel(alice.session.token,community.id,{name:'lounge',category_id:null,kind:'voice'})
    stage='voice channel encryption';status(stage)
    await alice.service.secureChannel(channel.id);await alice.service.openChannel(channel.id)
    stage='voice community invitation';status(stage)
    const invite=await alice.service.createInvite(community.id,3600,4)
    for(const person of installs.slice(1)){
      stage='voice admission '+person.session.account.username;status(stage)
      await client.joinCommunity(person.session.token,invite.code);await person.service.secureJoin(community.id,invite.code);await person.service.openChannel(channel.id)
      await alice.service.approveMember(channel.id,person.session.account.id,person.device.identity_key)
      await until(()=>person.state.joined.includes(channel.id),'community welcome')
    }
    await until(()=>installs.every(person=>person.state.conversations.find(c=>c.id===channel.id)?.members.length===5)&&new Set(installs.map(person=>person.state.conversations.find(c=>c.id===channel.id)?.epoch)).size===1,'stable five-member channel audience')
    stage='voice account setup budget boundary';status(stage)
    // Provisioning five identities/admissions is a synthetic setup burst. Keep
    // media acceptance in a fresh default request window, without raising limits.
    await pause(60_000)
    stage='voice initial room directory';status(stage)
    if(config.roomVideo){
      const legacy=installs[4],headers={Authorization:'Bearer '+legacy.session.token}
      require((await fetch(config.origin+'/api/v1/chat/media/'+legacy.device.device_key+'?group=true&format=3',{headers})).ok)
      require((await fetch(config.origin+'/api/v1/chat/voice/'+channel.id+'/'+alice.device.device_key,{headers:{Authorization:'Bearer '+alice.session.token}})).status===409&&captures===0&&connections.length===0)
      await legacy.service.callConfiguration()
      checks.audio_only_format_three_blocks_room_before_any_capture=true
    }
    const initial=await alice.service.voiceRoom(channel.id)
    require(initial.room.participants.length===0);checks.persistent_voice_channel_uses_signed_community_admission=true
    require((await fetch(config.origin+'/api/v1/chat/voice/'+channel.id+'/'+alice.device.device_key)).status===401)
    require((await fetch(config.origin+'/api/v1/chat/voice/'+channel.id+'/'+installs[1].device.device_key,{headers:{Authorization:'Bearer '+alice.session.token}})).status===403)
    checks.occupancy_requires_session_and_approved_own_device=true
    const roster=await client.channelRoster(alice.session.token,channel.id)
    audio=new AudioContext();await audio.resume()
    function videoSource(index:number,kind:'camera'|'screen',withAudio=false){
      if(kind==='camera')cameraCaptures++;else screenCaptures++
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
      const context=canvas.getContext('2d')!,rgb=kind==='camera'?[220,50+index*40,40]:[40,60+index*40,220]
      let frame=0
      const paint=()=>{context.fillStyle=`rgb(${rgb.join(',')})`;context.fillRect(0,0,320,180);context.fillStyle='#fff';context.fillText(kind+' '+index+' '+frame++,20,80)}
      paint();videoTimers.push(setInterval(paint,100))
      const stream=canvas.captureStream(10);tracks.push(...stream.getTracks());videoSources.push(...stream.getTracks())
      const track=stream.getVideoTracks()[0],clone=track.clone.bind(track)
      track.clone=()=>{const child=clone();videoClones.push(child);return child}
      if(withAudio){
        const oscillator=audio!.createOscillator(),gain=audio!.createGain(),output=audio!.createMediaStreamDestination(),silent=audio!.createGain();oscillator.frequency.value=1000+index*100;gain.gain.value=.1;silent.gain.value=0;oscillator.connect(gain).connect(output);gain.connect(silent).connect(audio!.destination);oscillator.start()
        const shared=output.stream.getAudioTracks()[0],copy=shared.clone.bind(shared);sharedSources.push(shared);tracks.push(shared);shared.clone=()=>{const child=copy();sharedClones.push(child);return child};stream.addTrack(shared)
      }
      return stream
    }
    for(const [index,person] of installs.entries())calls.push(new VoiceRoomCall(person.service,server,()=>panels?.render(),async constraints=>{
      if(constraints.video){require(config.roomVideo);return videoSource(index,'camera')}
      captures++;const oscillator=audio!.createOscillator(),gain=audio!.createGain(),output=audio!.createMediaStreamDestination(),silent=audio!.createGain()
      oscillator.frequency.value=360+captures*80;gain.gain.value=.1;silent.gain.value=0
      oscillator.connect(gain).connect(output);gain.connect(silent).connect(audio!.destination);oscillator.start();await audio!.resume()
      tracks.push(...output.stream.getTracks());sources.set(person.device.device_key,output.stream.getAudioTracks()[0]);return output.stream
    },()=>true,async withAudio=>{require(config.roomVideo);return videoSource(index,'screen',!!withAudio)}))
    panels=mountVoicePanels(calls,installs,roster)
    stage='voice join 0';status(stage)
    await until(()=>calls[0].state.phase==='waiting','first person waits in room')
    require(captures===0&&connections.length===0&&calls.slice(1).every(call=>call.state.phase==='idle'));checks.empty_room_holds_no_capture_and_never_rings_other_members=true
    stage='voice join 1';status(stage)
    await until(()=>calls.slice(0,2).every(call=>call.state.phase==='connected'),'first room pair')
    require(captures===2&&connections.length===2);checks.two_people_connect_without_other_members_joining=true
    stage='voice join 2';status(stage)
    await until(()=>calls.slice(0,3).every(call=>call.state.phase==='connected'),'third room participant')
    require(captures===3&&connections.length===8);checks.third_join_refreshes_mesh_without_recapturing_sources=true
    stage='voice join 3';status(stage)
    await until(()=>calls.slice(0,4).every(call=>call.state.phase==='connected'),'four room participants')
    require(captures===4&&connections.length===20);checks.four_people_join_a_larger_channel_audience=true
    stage='voice twelve audio paths';status(stage)
    async function decoded(selected:VoiceRoomCall[]){
      const analysers=selected.flatMap(call=>call.state.participants.filter(peer=>peer.remote).map(peer=>{const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0;audio!.createMediaStreamSource(peer.remote!).connect(analyser);analyser.connect(silent).connect(audio!.destination);return {analyser,samples:new Float32Array(analyser.fftSize),account:peer.account}}))
      await until(()=>analysers.every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))>.03}),'decoded room audio')
      return analysers
    }
    const analysers=await decoded(calls.slice(0,4));require(analysers.length===12)
    const metrics=await Promise.all(calls.slice(0,4).map(call=>call.diagnostics()))
    require(metrics.flat().every(metric=>metric.encrypted>10&&metric.decrypted>10&&metric.rejected===0));checks.all_twelve_paths_encrypt_decrypt_and_decode=true
    require(secrets.length===40&&new Set(secrets).size===20);checks.six_distinct_pairs_agree_without_reusing_earlier_mesh_keys=true
    if(config.turn){require(metrics.flat().every(metric=>metric.connectivity.selectedRelay&&metric.connectivity.hostCandidates===0));checks.all_twelve_connections_use_relays_without_host_candidates=true}
    stage='voice steady encrypted heartbeat';status(stage)
    await pause(32_000)
    require(calls.slice(0,4).every(call=>call.state.phase==='connected')&&captures===4&&secrets.length===40&&!httpFailures['429'])
    checks.room_heartbeats_and_leases_survive_watchdog_without_rate_limits=true
    let full=false;try{await calls[4].join(channel.id,!!config.turn,await installs[4].service.callConfiguration())}catch(error){full=(error as {status?:number}).status===409}
    require(full&&captures===4&&calls[4].state.phase==='ended');checks.fifth_participant_is_rejected_before_capture=true
    const own=calls[0].state.participants.find(peer=>peer.device===alice.device.device_key);require(own)
    const current=publics.find(value=>value.device_key===alice.device.device_key&&value.active)!
    const signed=JSON.parse(await alice.crypto.message('sign_voice_presence',{...current,issued_at:Date.now(),expires_at:Date.now()+30000})) as VoicePresence
    require((await fetch(config.origin+'/api/v1/chat/voice/'+channel.id+'/'+alice.device.device_key,{method:'POST',headers:{Authorization:'Bearer '+alice.session.token,'Content-Type':'application/json'},body:JSON.stringify({...signed,incarnation:'f'.repeat(64)})})).status===400)
    checks.server_rejects_modified_device_signed_presence=true
    calls[0].mute();await until(()=>analysers.filter(item=>item.account===alice.session.account.id).every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))<.005}),'mute all three outgoing room streams')
    calls[0].mute();checks.mute_silences_every_outgoing_room_path=true
    let videoMetrics:Awaited<ReturnType<VoiceRoomCall['diagnostics']>>[]=[]
    if(config.roomVideo){
      require(cameraCaptures===0&&screenCaptures===0&&calls.every(call=>!call.state.camera&&!call.state.sharing))
      checks.room_join_does_not_capture_camera_or_screen=true
      for(const index of [0,1]){
        stage='voice camera on '+index;status(stage);await until(()=>calls[index].state.camera,'room camera consent')
        stage='voice include audio '+index;status(stage);await pause(700)
        stage='voice screen on '+index;status(stage);await until(()=>calls[index].state.sharing,'room screen consent')
      }
      stage='voice twelve video paths';status(stage)
      const expected=installs.slice(0,2).flatMap((person,index)=>calls.slice(0,4).filter(call=>call!==calls[index]).flatMap(call=>['camera','screen'].map(kind=>({call,device:person.device.device_key,kind,rgb:kind==='camera'?[220,50+index*40,40]:[40,60+index*40,220]}))))
      require(expected.length===12&&cameraCaptures===2&&screenCaptures===2&&captures===4)
      await until(()=>expected.every(({call,device,kind})=>{const peer=call.state.participants.find(peer=>peer.device===device);return kind==='camera'?peer?.camera&&peer.cameraTrack:peer?.sharing&&peer.screenTrack}),'authenticated room video state')
      const decoded=expected.map(({call,device,kind,rgb})=>{
        const peer=call.state.participants.find(peer=>peer.device===device)!,track=kind==='camera'?peer.cameraTrack:peer.screenTrack
        const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([track!]);document.body.append(video);videoElements.push(video);void video.play()
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;return {video,context:canvas.getContext('2d',{willReadFrequently:true})!,rgb}
      })
      await until(()=>decoded.every(({video,context,rgb})=>{if(!video.videoWidth||video.currentTime===0)return false;context.drawImage(video,0,0,16,16);const pixel=context.getImageData(0,0,1,1).data;return rgb.every((value,index)=>Math.abs(pixel[index]-value)<30)}),'all twelve distinct camera and screen pixels')
      videoMetrics=await Promise.all(calls.slice(0,4).map(call=>call.diagnostics()))
      require(videoMetrics.flat().every(metric=>metric.rejected===0&&metric.authenticationFailures===0)&&captures===4)
      checks.two_cameras_and_two_shares_decode_on_all_twelve_video_paths=true
      const sharedExpected=installs.slice(0,2).flatMap((person,index)=>calls.slice(0,4).filter(call=>call!==calls[index]).map(call=>({call,device:person.device.device_key})))
      await until(()=>sharedExpected.every(({call,device})=>{const peer=call.state.participants.find(peer=>peer.device===device);return peer?.systemAudio&&peer.systemAudioTrack}),'authenticated mesh shared-audio slots')
      const sharedMeters=sharedExpected.map(({call,device})=>{const track=call.state.participants.find(peer=>peer.device===device)!.systemAudioTrack!,analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0;audio!.createMediaStreamSource(new MediaStream([track])).connect(analyser);analyser.connect(silent).connect(audio!.destination);const samples=new Float32Array(analyser.fftSize);return ()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))}})
      await until(()=>sharedMeters.every(read=>read()>.03),'all six encrypted mesh shared-audio PCM paths')
      calls[0].mute();await until(()=>analysers.filter(item=>item.account===alice.session.account.id).every(({analyser,samples})=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))<.005})&&sharedMeters.every(read=>read()>.03),'mesh mute independent of shared audio');calls[0].mute()
      require(sharedSources.length===2&&sharedClones.length===6);checks.computer_audio_decodes_on_six_separate_paths_independent_of_mic_mute=true
      require(videoSources.length===4&&videoSources.every(track=>track.readyState==='live')&&videoClones.length===12&&videoClones.every(track=>track.readyState==='live'))
      checks.one_source_per_camera_or_screen_is_shared_across_three_peers=true
      stage='voice camera off 0';status(stage);await until(()=>!calls[0].state.camera,'room camera stops independently')
      await until(()=>calls.slice(1,4).every(call=>!call.state.participants.find(peer=>peer.device===alice.device.device_key)?.camera),'remote camera hides after authenticated stop')
      require(videoSources[0].readyState==='ended'&&videoSources.slice(1).every(track=>track.readyState==='live')&&videoClones.slice(0,3).every(track=>track.readyState==='ended')&&videoClones.slice(3).every(track=>track.readyState==='live')&&calls[0].state.sharing&&captures===4)
      checks.camera_stop_hides_remote_tiles_and_preserves_shares_and_audio=true
    }
    if(config.roomRevoke){
      stage='voice permission revocation';status(stage)
      const survivors=[calls[0],calls[2],calls[3]],survivorSources=[0,2,3].map(index=>sources.get(installs[index].device.device_key)!)
      calls[2].mute()
      const view=await alice.service.loadGovernance(community.id),authority=roster.authority!
      const policy=view.governance??{community_id:community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
      await alice.service.saveGovernance(community.id,{...policy,revision:policy.revision+1,overrides:[...policy.overrides,{channel_id:channel.id,kind:'member',target_id:installs[1].session.account.id,allow:0,deny:2}]})
      await until(()=>calls[1].state.phase==='ended'&&survivors.every(call=>call.state.phase==='connected'&&call.state.participants.length===3),'revoked member leaves while authorized members refresh keys')
      require(sources.get(installs[1].device.device_key)!.readyState==='ended'&&survivorSources.every(track=>track.readyState==='live')&&calls[2].state.muted)
      let denied=false;try{await calls[1].join(channel.id)}catch{denied=true}
      require(denied&&captures===4);checks.signed_permission_update_stops_capture_and_denies_rejoin=true
      calls[2].mute();await decoded(survivors);checks.permission_loss_preserves_authorized_sources_mute_and_decoded_audio=true
      if(config.roomVideo){require(videoSources[1].readyState==='live'&&videoSources.slice(2).every(track=>track.readyState==='ended')&&sharedSources[0].readyState==='live'&&sharedSources[1].readyState==='ended'&&calls[0].state.sharing&&!calls[1].state.camera&&!calls[1].state.sharing);checks.permission_loss_stops_revoked_video_and_preserves_authorized_share=true}
      for(const call of calls)call.leave()
      await until(async()=>(await alice.service.voiceRoom(channel.id)).room.participants.length===0,'revocation fixture releases survivor leases')
      if(config.roomVideo)require([...videoSources,...videoClones,...sharedSources,...sharedClones].every(track=>track.readyState==='ended'))
    }else{
      const original=sources.get(alice.device.device_key)!,continuing=installs.slice(1,4).map(person=>sources.get(person.device.device_key)!)
      calls[1].mute()
      stage='voice leave 0';status(stage)
      await until(()=>calls[0].state.phase==='ended'&&calls.slice(1,4).every(call=>call.state.phase==='connected'&&call.state.participants.length===3)&&secrets.length===52,'owner leaves while three remain')
      require(original.readyState==='ended'&&continuing.every((track,index)=>sources.get(installs[index+1].device.device_key)===track)&&calls[1].state.muted&&captures===4)
      calls[1].mute();await decoded(calls.slice(1,4));checks.owner_leave_preserves_survivor_sources_mute_and_decoded_audio=true
      if(config.roomVideo){require(videoSources.slice(0,2).every(track=>track.readyState==='ended')&&videoSources.slice(2).every(track=>track.readyState==='live')&&sharedSources[0].readyState==='ended'&&sharedSources[1].readyState==='live'&&!calls[0].state.camera&&!calls[0].state.sharing&&calls[1].state.camera&&calls[1].state.sharing);checks.membership_change_replaces_clones_and_preserves_survivor_capture=true}
      stage='voice rejoin 0';status(stage)
      await until(()=>calls.slice(0,4).every(call=>call.state.phase==='connected'&&call.state.participants.length===4)&&secrets.length===76,'owner rejoins community room')
      require(captures===5&&sources.get(alice.device.device_key)!==original&&new Set(secrets).size===38)
      await decoded(calls.slice(0,4));checks.rejoin_uses_fresh_contribution_and_all_twelve_paths_decode_again=true
      if(config.roomVideo){require(cameraCaptures===2&&screenCaptures===2&&!calls[0].state.camera&&!calls[0].state.sharing&&calls[1].state.camera&&calls[1].state.sharing);checks.rejoining_does_not_resume_departed_camera_or_screen_without_fresh_consent=true}
      for(const call of calls)call.leave()
      await until(async()=>(await installs[1].service.voiceRoom(channel.id)).room.participants.length===0,'all room leases released')
      require(tracks.every(track=>track.readyState==='ended'));checks.everyone_can_leave_without_deleting_the_room=true
      const empty=await installs[1].service.voiceRoom(channel.id);require(empty.room.room_id===initial.room.room_id&&empty.room.revision>initial.room.revision)
      alice.service.close()
      await calls[1].join(channel.id,!!config.turn,await installs[1].service.callConfiguration());require(calls[1].state.phase==='waiting'&&captures===5)
      await calls[2].join(channel.id,!!config.turn,await installs[2].service.callConfiguration())
      await until(()=>calls.slice(1,3).every(call=>call.state.phase==='connected'),'room reused after everyone left and owner closed')
      await decoded(calls.slice(1,3));checks.empty_room_can_be_reused_without_the_owner_or_an_invitation=true
      calls[1].leave();calls[2].leave()
    }
    require(tracks.every(track=>track.readyState==='ended'));checks.all_original_capture_tracks_stop=true
    require(installs.every(person=>person.state.messages.length===0));checks.room_controls_and_sdp_do_not_enter_message_history=true
    require(wire.length>0&&['HEARTH_PRIVATE_ROOM_SDP_CANARY',...secrets].every(secret=>wire.every(body=>!body.includes(secret))));checks.media_keys_and_plaintext_sdp_absent_from_server_wire=true
    return {outcome:'pass',scope:'Persistent four-person community room, real accounts/admissions/MLS and production interface with generated media in one runtime',checks,httpFailures,metrics,videoMetrics,cameraCaptures,screenCaptures,videoCloneCount:videoClones.length,sharedAudioSources:sharedSources.length,sharedAudioClones:sharedClones.length,physicalDevicePermissionsValidated:false,internetValidated:false,turnValidated:!!config.turn,railwayValidated:false}
  }catch(error){return {outcome:'fail',stage,failureClass:error instanceof Error?error.name:'untyped',failureCategory:error instanceof Error?['Your role or community rules prevent joining this voice room.','The channel roster could not be verified.','A participant’s identity changed or could not be verified. Saved fingerprints were preserved. Compare identities using a trusted channel before adding devices.'].indexOf(error.message):-1,httpStatus:(error as {status?:number})?.status,locations:error instanceof Error?error.stack?.split('\n').map(line=>line.match(/(?:voice-acceptance|voice-room|messaging-session|group-admission|direct-call)\.ts:\d+:\d+/)?.[0]).filter(Boolean):[],checks,httpFailures,faults:calls.map(call=>call.failureDiagnostics()),phases:calls.map(call=>call.state.phase),messages:calls.map(call=>call.state.message),captures,connections:connections.length,serviceFatal:installs.map(person=>person.state.fatal),metrics:await Promise.all(calls.map(call=>call.diagnostics().catch(()=>[])))}}
  finally{for(const call of calls)call.close();for(const timer of videoTimers)clearInterval(timer);for(const video of videoElements){video.pause();video.srcObject=null;video.remove()}panels?.close();for(const person of installs){person.service.close();person.crypto.close()}await audio?.close().catch(()=>{});window.RTCPeerConnection=OriginalConnection;window.fetch=originalFetch;window.WebSocket=OriginalSocket;HTMLMediaElement.prototype.play=originalPlay;GroupKeyAgreement.prototype.derive=originalDerive;secrets.length=0;wire.length=0}
}
