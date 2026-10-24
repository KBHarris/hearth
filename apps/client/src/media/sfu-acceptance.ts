// Explicit disposable SFU acceptance; excluded from production assets.
import {HearthClient,HearthError,Permission,withMediaPermissions,type DeviceEnrollment,type Session} from '@hearth/sdk'
import {AuthCrypto} from '../crypto/client'
import {MessagingSession,initialChat,type ChatState} from '../crypto/messaging-session'
import {VoiceRoomCall} from './voice-room'
import {SfuKeys} from './sfu-keys'
import {voiceContext} from './voice-membership'
import {mountVoicePanels} from './acceptance-ui'
import {verifySfuObserver} from './sfu-observer'
import {verifyIndependentLease} from './lease-acceptance'
type Install={crypto:AuthCrypto;session:Session;device:DeviceEnrollment;service:MessagingSession;state:ChatState}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms)),status=(text:string)=>{document.getElementById('status')!.textContent=text}
const require=(value:unknown)=>{if(!value)throw new Error('SFU acceptance assertion failed')}
async function until(test:()=>boolean|Promise<boolean>,label:string,timeout=90000){for(let i=0;i<timeout/100;i++){if(await test())return;await pause(100)}throw new Error(label)}
export async function runSfuAcceptance(config:{origin:string;setupCode:string;turn?:boolean;sfuCount?:number;sfuPolicy?:boolean;sfuConflict?:boolean;sfuConnect?:boolean;stageCycle?:boolean;stageRevoke?:boolean;sfuObserver?:{origin:string;token:string};sfuCapacityProfile?:boolean;stage?:boolean}){
  const count=config.sfuCount??6,installs:Install[]=[],calls:VoiceRoomCall[]=[],checks:Record<string,boolean>={},failures:Record<string,number>={},wire:string[]=[],secrets:{device:string;context:string;key:string}[]=[],tracks:MediaStreamTrack[]=[],connections:RTCPeerConnection[]=[],videoTimers:ReturnType<typeof setInterval>[]=[]
  let stage='SFU accounts',panels:ReturnType<typeof mountVoicePanels>|undefined,audio:AudioContext|undefined,micCaptures=0,cameraCaptures=0,screenCaptures=0,systemCaptures=0
  let pcmDiagnostics:{receiver:number;publisher:number;muted:boolean;peak:number}[]=[]
  const workTraces:Record<string,unknown>[][]=[]
  const connectionTransitions:Record<string,unknown>[][]=[]
  const videoOriginals:MediaStreamTrack[]=[]
  const OriginalConnection=window.RTCPeerConnection,originalFetch=window.fetch.bind(window),OriginalSocket=window.WebSocket,originalCreate=SfuKeys.prototype.create,originalPlay=HTMLMediaElement.prototype.play
  window.RTCPeerConnection=class extends OriginalConnection{constructor(config?:RTCConfiguration){super(config);connections.push(this);const trace:Record<string,unknown>[]=[];connectionTransitions.push(trace);const record=(event?:Event)=>{trace.push({at:Math.round(performance.now()),connection:this.connectionState,ice:this.iceConnectionState,signaling:this.signalingState,errorCode:(event as RTCPeerConnectionIceErrorEvent|undefined)?.errorCode});if(trace.length>24)trace.shift()};for(const name of ['connectionstatechange','iceconnectionstatechange','signalingstatechange','icecandidateerror'])this.addEventListener(name,record);record()}}
  window.fetch=(input,init)=>{if(typeof init?.body==='string')wire.push(init.body);return originalFetch(input,init).then(response=>{if(response.status>=400)failures[String(response.status)]=(failures[String(response.status)]??0)+1;return response})}
  window.WebSocket=class extends OriginalSocket{constructor(url:string|URL,protocols?:string|string[]){super(url,protocols);this.addEventListener('message',event=>wire.push(String(event.data)))}}
  SfuKeys.prototype.create=async function(){const bundle=await originalCreate.call(this);secrets.push({device:bundle.signal.from_device,context:bundle.signal.group_id!,key:Array.from(bundle.key,byte=>byte.toString(16).padStart(2,'0')).join('')});return bundle}
  HTMLMediaElement.prototype.play=function(){this.volume=0;return originalPlay.call(this)}
  try{
    const client=new HearthClient(config.origin),server=(await client.wellKnown()).server_key,password='HEARTH_SFU_SYNTHETIC_PASSWORD'
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
      if(config.stage){
        const trace:Record<string,unknown>[]=[];workTraces.push(trace)
        const raw=install.service as unknown as Record<string,unknown>
        for(const name of ['operation','prepareChannel','persist','flush','synchronize','refresh','voiceRoom']){
          const original=raw[name] as (...args:unknown[])=>Promise<unknown>
          raw[name]=async(...args:unknown[])=>{
            const operation=name==='operation'?String(args[0]):name
            const record=(event:string)=>{trace.push({at:Math.round(performance.now()),operation,event});if(trace.length>64)trace.shift()}
            record('start');try{const value=await original.apply(install.service,args);record('done');return value}catch(error){record('error');throw error}
          }
        }
      }
      installs.push(install);return install
    }

    status(stage);const owner=await login('sfu_owner',true)
    await client.configureServer(owner.session.token,{server_name:'Disposable encrypted SFU acceptance',registration_mode:'open'})
    for(let i=1;i<=count;i++){if(i%16===0){stage='SFU account budget boundary';status(stage);await pause(60000)}stage='SFU identity '+i;status(stage);await login('sfu_person_'+i)}
    for(const person of installs){await person.service.start();if(count===25)await pause(2000)}
    const community=await client.createCommunity(owner.session.token,'SFU community');await owner.service.secureCommunity(community.id)
    const channel=await client.createChannel(owner.session.token,community.id,{name:'room',category_id:null,kind:config.stage?'stage':'voice'});await owner.service.secureChannel(channel.id);await owner.service.openChannel(channel.id)
    const invite=await owner.service.createInvite(community.id,3600,count)
    for(const [index,person] of installs.slice(1).entries()){
      stage='SFU admission '+index;status(stage);await client.joinCommunity(person.session.token,invite.code);await person.service.secureJoin(community.id,invite.code);await person.service.openChannel(channel.id);await owner.service.approveMember(channel.id,person.session.account.id,person.device.identity_key)
      await until(()=>person.state.joined.includes(channel.id),'SFU channel welcome')
        if(count===25)await pause(2000)
      if(index%6===5&&index<count-1)await pause(60000)
    }
    await until(()=>installs.every(person=>person.state.conversations.find(c=>c.id===channel.id)?.members.length===count+1)&&new Set(installs.map(person=>person.state.conversations.find(c=>c.id===channel.id)?.epoch)).size===1,'SFU stable channel MLS audience')
    stage='SFU setup budget boundary';status(stage);await pause(60000)
    const initial=await owner.service.voiceRoom(channel.id);require(initial.room.sfu===true&&initial.room.capacity===25&&initial.room.participants.length===0)
    const unjoined=installs[count],headers={Authorization:'Bearer '+unjoined.session.token},path=config.origin+'/api/v1/chat/voice/'+channel.id+'/'+unjoined.device.device_key+'/sfu?revision='+initial.room.revision
    require((await fetch(path)).status===401);require((await fetch(path,{headers})).status===403);checks.token_requires_authenticated_approved_joined_device=true
    const roster=await client.channelRoster(owner.session.token,channel.id)
    audio=new AudioContext();await audio.resume()
    function own(track:MediaStreamTrack){tracks.push(track);const clone=track.clone.bind(track);track.clone=()=>{const child=clone();tracks.push(child);return child}}
    function tone(frequency:number){const oscillator=audio!.createOscillator(),gain=audio!.createGain(),output=audio!.createMediaStreamDestination(),silent=audio!.createGain();gain.gain.value=.1;silent.gain.value=0;oscillator.frequency.value=frequency;oscillator.connect(gain).connect(output);gain.connect(silent).connect(audio!.destination);oscillator.start();output.stream.getTracks().forEach(own);return output.stream}
    function picture(kind:'camera'|'screen',index:number,withAudio=false){
      if(kind==='camera')cameraCaptures++;else screenCaptures++
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const context=canvas.getContext('2d')!;let frame=0
      const paint=()=>{context.fillStyle=kind==='camera'?'#df3428':'#2435dc';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.fillText(kind+' '+index+' '+frame++,20,80)};paint();videoTimers.push(setInterval(paint,100))
      const stream=canvas.captureStream(10);videoOriginals.push(...stream.getTracks());stream.getTracks().forEach(own);if(withAudio){systemCaptures++;stream.addTrack(tone(1200+index*100).getAudioTracks()[0])}return stream
    }
    const originalSources=new Map<string,MediaStreamTrack>()
    for(const [index,person] of installs.entries())calls.push(new VoiceRoomCall(person.service,server,()=>panels?.render(),async constraints=>{if(constraints.video)return picture('camera',index);micCaptures++;const stream=tone(300+index*60);originalSources.set(person.device.device_key,stream.getAudioTracks()[0]);return stream},()=>true,async withAudio=>picture('screen',index,!!withAudio)))
    panels=mountVoicePanels(calls,installs,roster)
    for(let i=0;i<count;i++){
      if(count===25&&i>0)await pause(10000)
      stage='voice join '+i;status(stage)
      if(i===0){await until(()=>calls[0].state.phase==='waiting','solo SFU room');require(micCaptures===0&&connections.length===0);checks.solo_room_captures_nothing_and_does_not_ring=true}
      else await until(()=>calls.slice(0,i+1).every(call=>call.state.phase==='connected'&&call.state.participants.length===i+1),'SFU participant join '+i,count===25?180000:90000)
      if(i===1&&!config.sfuPolicy&&!config.sfuConnect){await verifyIndependentLease(owner.service,calls[0]);checks.presence_renewal_bypasses_durable_work_without_extending_authorization=true}
    }
    if(config.stage){
      async function policyChange(label:string,action:()=>Promise<unknown>){
        stage=label;status(stage);let settled=false,failure:unknown
        void action().then(()=>{settled=true},error=>{failure=error;settled=true})
        await until(()=>settled,label+' operation did not settle',30000);if(failure)throw failure
      }
      stage='Stage audience';status(stage)
      await until(()=>calls.slice(1,count).every(call=>call.state.participants.some(peer=>peer.device===owner.device.device_key&&peer.remote)),'Stage audience subscribes to owner')
      const meters=calls.slice(1,count).map(call=>analyser(call.state.participants.find(peer=>peer.device===owner.device.device_key)!.remote!.getAudioTracks()[0]))
      await until(()=>meters.every(read=>read()>.03),'Stage audience decodes the speaker')
      require(micCaptures===1&&calls.slice(1,count).every(call=>!call.canSpeak&&!call.speaking));checks.audience_listens_without_microphone_capture=true
      if(config.stageRevoke){
        await policyChange('Focused stage listening revocation',async()=>{
          const governance=await owner.service.loadGovernance(community.id),authority=roster.authority!,base=governance.governance??{community_id:community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''},policy=withMediaPermissions(base,[channel.id])
          await owner.service.saveGovernance(community.id,{...policy,revision:policy.revision+1,overrides:[...policy.overrides,{channel_id:channel.id,kind:'member',target_id:installs[1].session.account.id,allow:0,deny:Permission.listen}]})
        })
        await until(()=>calls[1].state.phase==='ended'&&[calls[0],calls[2]].every(call=>call.state.phase==='connected'&&call.state.participants.length===2),'Focused stage listening removal and surviving pair')
        require(micCaptures===1);checks.listening_revocation_removes_only_restricted_audience_member=true
        await until(()=>calls[2].state.participants.some(peer=>peer.device===owner.device.device_key&&peer.remote),'Surviving listener subscribes after rekey')
        const read=analyser(calls[2].state.participants.find(peer=>peer.device===owner.device.device_key)!.remote!.getAudioTracks()[0]);await until(()=>read()>.03,'Surviving listener decodes after listen revocation');checks.surviving_audience_decodes_after_listening_revocation=true
        for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.stage_leave_stops_all_owned_tracks=true
        require(secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));checks.stage_frame_keys_absent_from_server_wire=true
        return {outcome:'pass',scope:'Focused three-person stage listening-permission removal with real MLS and decoded survivor audio',checks,failures,physicalDevicePermissionsValidated:false,internetValidated:false}
      }
      await policyChange('Stage promotion',()=>owner.service.stageSpeaker(channel.id,installs[1].session.account.id,true))
      await until(()=>calls.slice(0,count).every(call=>call.state.phase==='connected')&&calls[1].canSpeak,'Stage speaker grant and MLS recovery')
      require(micCaptures===1&&!calls[1].speaking);checks.promotion_requires_separate_speaking_consent=true
      stage='stage start speaking 1';status(stage)
      await until(()=>calls[1].speaking&&micCaptures===2&&calls[0].state.participants.some(peer=>peer.device===installs[1].device.device_key&&peer.remote),'Promoted speaker explicitly starts microphone')
      const speakerSource=originalSources.get(installs[1].device.device_key)!
      // Exercise each owner operation across the unchanged request budget.
      // Repeated policy edits also consume the bounded MLS recovery budget.
      await pause(65000)
      await policyChange('Stage demotion',()=>owner.service.stageSpeaker(channel.id,installs[1].session.account.id,false))
      await until(()=>calls.slice(0,count).every(call=>call.state.phase==='connected')&&!calls[1].canSpeak,'Stage demotion and rekey')
      require(speakerSource.readyState==='ended'&&micCaptures===2&&!calls[1].speaking);checks.demotion_stops_publication_and_preserves_audience=true
      if(config.stageCycle){
        for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.stage_leave_stops_all_owned_tracks=true
        require(secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));checks.stage_frame_keys_absent_from_server_wire=true
        return {outcome:'pass',scope:'Focused three-person SFU stage promotion and demotion with explicit microphone consent',checks,failures,physicalDevicePermissionsValidated:false,internetValidated:false}
      }
      await pause(65000)
      await policyChange('Stage repeat promotion',()=>owner.service.stageSpeaker(channel.id,installs[1].session.account.id,true))
      await until(()=>calls.slice(0,count).every(call=>call.state.phase==='connected')&&calls[1].canSpeak,'Stage repeat grant')
      require(!calls[1].speaking&&micCaptures===2);checks.repeated_promotion_cannot_reopen_microphone=true
      await pause(65000)
      await policyChange('Stage listening revocation',async()=>{
        const governance=await owner.service.loadGovernance(community.id),policy=governance.governance!
        const overrides=policy.overrides.filter(item=>!(item.channel_id===channel.id&&item.kind==='member'&&item.target_id===installs[1].session.account.id))
        overrides.push({channel_id:channel.id,kind:'member',target_id:installs[1].session.account.id,allow:0,deny:Permission.listen})
        await owner.service.saveGovernance(community.id,{...policy,revision:policy.revision+1,overrides})
      })
      await until(()=>calls[1].state.phase==='ended'&&calls[0].state.phase==='connected'&&calls[2].state.phase==='connected','Stage listening permission enforcement')
      checks.listening_revocation_removes_only_restricted_participant=true
      for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.stage_leave_stops_all_owned_tracks=true
      require(secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));checks.stage_frame_keys_absent_from_server_wire=true
      return {outcome:'pass',scope:'Three-person local SFU stage with real accounts, MLS permissions and production speaker consent controls; synthetic audio',checks,failures,participants:count,micCaptures,ownedCaptureTracks:tracks.length,physicalDevicePermissionsValidated:false,internetValidated:false}
    }
    stage='SFU audio paths';status(stage)
    function analyser(track:MediaStreamTrack){const analyser=audio!.createAnalyser(),silent=audio!.createGain();silent.gain.value=0;audio!.createMediaStreamSource(new MediaStream([track])).connect(analyser);analyser.connect(silent).connect(audio!.destination);const samples=new Float32Array(analyser.fftSize);return ()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))}}
    async function decoded(selected:VoiceRoomCall[]){await until(()=>selected.every(call=>call.state.participants.filter(peer=>peer.remote?.getAudioTracks()[0]).length===selected.length-1),'SFU remote audio subscriptions');const meters=selected.flatMap(call=>call.state.participants.filter(peer=>peer.remote).map(peer=>{const publisher=installs.findIndex(person=>person.device.device_key===peer.device);return {receiver:calls.indexOf(call),publisher,read:analyser(peer.remote!.getAudioTracks()[0]),muted:calls[publisher].state.muted}}));await until(()=>{pcmDiagnostics=meters.map(({read,...meter})=>({...meter,peak:read()}));return pcmDiagnostics.every(({peak,muted})=>muted?peak<.005:peak>.03)},'SFU all directed PCM paths');return meters.length}
    const audioPaths=await decoded(calls.slice(0,count));require(audioPaths===count*(count-1)&&micCaptures===count&&calls[count].state.phase==='idle')
    require(connections.filter(pc=>pc.connectionState!=='closed').length<=2*count);if(count>4)checks.more_than_four_people_use_one_publisher_subscriber_pair_each=true;checks.all_joined_participants_decode_encrypted_audio=true;checks.unjoined_mls_member_receives_no_call_or_capture=true
    if(config.sfuConnect){
      const metrics=await Promise.all(calls.slice(0,count).map(call=>call.sfuDiagnostics()))
      require(metrics.every(metric=>metric?.encryptionEnabled&&metric.workerErrors===0));checks.encryption_enabled_before_publication=true
      if(config.turn){require(metrics.every(metric=>metric!.routes.every(side=>side.selectedRelay&&side.hostCandidates===0)));checks.every_connection_selects_relay_without_host_candidates=true}
      for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.all_owned_tracks_stop=true
      require(secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));checks.publisher_keys_absent_from_server_wire=true
      return {outcome:'pass',scope:'Focused two-person SFU encrypted connection and decoded synthetic audio',checks,metrics,physicalDevicePermissionsValidated:false,internetValidated:false}
    }
    if(config.sfuPolicy){
      const beforeKeys=secrets.slice(),captureCount=micCaptures
      calls[0].mute()
      stage='SFU focused authorization revocation';status(stage)
      const governance=await owner.service.loadGovernance(community.id),authority=roster.authority!,policy=governance.governance??{community_id:community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
      let injectedConflicts=0
      if(config.sfuConflict){
        const internal=installs[2].service as unknown as {client:HearthClient;view:{governance_epochs:Record<string,number>}}
        const upload=internal.client.uploadMessage.bind(internal.client)
        internal.client.uploadMessage=(...args)=>{
          if(!injectedConflicts&&(internal.view.governance_epochs[channel.id]??0)>=policy.revision+1){injectedConflicts++;return Promise.reject(new HearthError(409,'Synthetic room upload conflict'))}
          return upload(...args)
        }
      }
      await owner.service.saveGovernance(community.id,{...policy,revision:policy.revision+1,overrides:[...policy.overrides,{channel_id:channel.id,kind:'member',target_id:installs[1].session.account.id,allow:0,deny:config.sfuConflict?Permission.send:Permission.read}]})
      await until(()=>calls[1].state.phase==='ended'&&[calls[0],calls[2]].every(call=>call.state.phase==='connected'&&call.state.participants.length===2),'Focused SFU restriction and survivors')
      require(originalSources.get(installs[1].device.device_key)!.readyState==='ended'&&calls[0].state.muted&&micCaptures===captureCount)
      checks.revoked_participant_stops_and_survivors_retain_capture_and_mute=true
      calls[0].mute();await decoded([calls[0],calls[2]])
      checks.remaining_pair_decodes_audio_after_permission_rekey=true
      if(config.sfuConflict){require(injectedConflicts===1);checks.serialized_room_upload_conflict_recovers_with_verified_admission=true}
      require(secrets.length>beforeKeys.length&&secrets.slice(beforeKeys.length).every(secret=>beforeKeys.every(old=>old.key!==secret.key)))
      checks.permission_rotation_uses_fresh_publisher_keys=true
      for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.all_owned_tracks_stop=true
      require(secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));checks.publisher_keys_absent_from_server_wire=true
      require(!failures['429']);checks.default_request_limits_remain_unchanged=true
      return {outcome:'pass',scope:config.sfuConflict?'Three-person SFU permission removal and MLS recovery with one simulated HTTP 409 after room-control serialization; real crypto and decoded synthetic survivor audio':'Focused three-person local SFU read-permission removal, MLS rekey and survivor audio with real accounts and synthetic capture',checks,failures,physicalDevicePermissionsValidated:false,internetValidated:false}
    }
    const beforeRoom=(await owner.service.voiceRoom(channel.id)).room,beforeContext=await voiceContext(server,beforeRoom)
    require(calls.slice(0,count).every(call=>secrets.some(secret=>secret.device===installs[calls.indexOf(call)].device.device_key&&secret.context===beforeContext.id)))
    stage='voice camera on 0';status(stage);await until(()=>calls[0].state.camera,'SFU camera consent')
    stage='SFU include audio';status(stage)
    await pause(700)
    stage='voice screen on 0';status(stage);await until(()=>calls[0].state.sharing&&calls[0].state.systemAudio,'SFU screen and computer audio consent')
    stage='SFU screen audio paths';status(stage)
    await until(()=>calls.slice(1,count).every(call=>{const peer=call.state.participants.find(peer=>peer.device===owner.device.device_key);return peer?.camera&&peer.sharing&&peer.systemAudio&&peer.cameraTrack&&peer.screenTrack&&peer.systemAudioTrack}),'SFU authenticated camera screen and audio tracks')
    const systemMeters=calls.slice(1,count).map(call=>analyser(call.state.participants.find(peer=>peer.device===owner.device.device_key)!.systemAudioTrack!))
    await until(()=>systemMeters.every(read=>read()>.03),'SFU decoded shared computer audio')
    const microphoneMeters=calls.slice(1,count).map(call=>analyser(call.state.participants.find(peer=>peer.device===owner.device.device_key)!.remote!.getAudioTracks()[0]))
    calls[0].mute();await until(()=>microphoneMeters.every(read=>read()<.005)&&systemMeters.every(read=>read()>.03),'microphone mute preserves shared audio');calls[0].mute();checks.computer_audio_is_encrypted_separate_and_independent_of_mic_mute=true
    await until(()=>{const videos=[...document.querySelectorAll<HTMLVideoElement>('.voice-room-region .call-video')];return videos.length>=2*count&&videos.every(video=>video.videoWidth>0&&video.currentTime>0)},'SFU camera and screen tiles decode')
    stage='SFU video ready';status(stage)
    const beforeLoad=await Promise.all(calls.slice(0,count).map(call=>call.sfuDiagnostics())),loadStart=performance.now();await pause(32000)
    require(cameraCaptures===1&&screenCaptures===1&&systemCaptures===1);checks.camera_screen_and_computer_audio_capture_once_per_publisher=true
    const activeMetrics=await Promise.all(calls.slice(0,count).map(call=>call.sfuDiagnostics()));require(activeMetrics.every(metric=>metric?.encryptionEnabled&&metric.workerErrors===0));checks.sfu_media_is_enabled_before_any_publication=true
    const loadSeconds=(performance.now()-loadStart)/1000,uploadBitsPerSecond=activeMetrics.map((metric,index)=>Math.max(0,metric!.outboundBytes-beforeLoad[index]!.outboundBytes)*8/loadSeconds),activePeerConnections=connections.filter(pc=>pc.connectionState!=='closed').length
    const receivedBytes=(metric:typeof activeMetrics[number])=>metric?.inbound.reduce((sum,track)=>sum+track.bytes,0)??0
    const recipientBitsPerSecond=activeMetrics.map((metric,index)=>Math.max(0,receivedBytes(metric)-receivedBytes(beforeLoad[index]))*8/loadSeconds)
    const sfuEgressBitsPerSecond=recipientBitsPerSecond.reduce((sum,rate)=>sum+rate,0),sfuEgressDecimalGigabytesPerHour=sfuEgressBitsPerSecond*3600/8/1e9
    if(config.turn){require(activeMetrics.every(metric=>metric!.routes.every(side=>side.selectedRelay&&side.hostCandidates===0)));checks.all_sfu_connections_select_relays_without_host_candidates=true}
    stage='SFU wrong-key subscriber';status(stage)
    require(config.sfuObserver)
    const observer=await verifySfuObserver(config.sfuObserver!, (await owner.service.sfuAccess(channel.id,beforeRoom.revision)).room,audio,count+3,await owner.service.callConfiguration(),!!config.turn)
    checks.routing_authorized_observer_without_media_keys_decodes_nothing=true
    const cameraSource=videoOriginals[0],screenSource=videoOriginals[1],captureCount=micCaptures
    const leaving=count-1;calls[1].mute();calls[leaving].leave()
    stage='SFU membership rekey';status(stage);await until(()=>calls.slice(0,leaving).every(call=>call.state.phase==='connected'&&call.state.participants.length===count-1),'SFU survivors rekey')
    await decoded(calls.slice(0,leaving));require(cameraSource.readyState==='live'&&screenSource.readyState==='live'&&calls[0].state.camera&&calls[0].state.sharing&&calls[0].state.systemAudio&&calls[1].state.muted&&micCaptures===captureCount)
    await until(()=>calls.slice(1,leaving).every(call=>{const peer=call.state.participants.find(peer=>peer.device===owner.device.device_key);return peer?.camera&&peer.sharing&&peer.systemAudio&&peer.cameraTrack&&peer.screenTrack&&peer.systemAudioTrack}),'SFU restored shared sources')
    const restoredAudio=calls.slice(1,leaving).map(call=>analyser(call.state.participants.find(peer=>peer.device===owner.device.device_key)!.systemAudioTrack!))
    await until(()=>restoredAudio.every(read=>read()>.03),'SFU shared audio after rekey')
    await until(async()=>{const metrics=await Promise.all(calls.slice(1,leaving).map(call=>call.sfuDiagnostics()));return metrics.every(metric=>['camera','screen'].every(source=>metric?.inbound.some(track=>track.device===owner.device.device_key&&track.source===source&&track.frames>10)))},'SFU shared video after rekey')
    const afterRoom=(await owner.service.voiceRoom(channel.id)).room,afterContext=await voiceContext(server,afterRoom);require(afterContext.id!==beforeContext.id)
    await until(()=>calls.slice(0,leaving).every((_,index)=>secrets.some(secret=>secret.device===installs[index].device.device_key&&secret.context===afterContext.id)),'fresh SFU publisher keys')
    for(const person of installs.slice(0,leaving)){const old=secrets.find(secret=>secret.device===person.device.device_key&&secret.context===beforeContext.id)!,fresh=secrets.find(secret=>secret.device===person.device.device_key&&secret.context===afterContext.id)!;require(old.key!==fresh.key)}
    calls[1].mute();checks.membership_rotation_uses_fresh_keys_preserves_capture_and_mute=true;checks.camera_screen_and_computer_audio_decode_after_membership_rotation=true
    stage='voice screen off 0';status(stage);await until(()=>!calls[0].state.sharing&&!calls[0].state.systemAudio,'SFU shared capture stops')
    require(screenSource.readyState==='ended'&&cameraSource.readyState==='live');checks.screen_stop_preserves_camera_and_stops_computer_audio=true
    stage='SFU authorization revocation';status(stage)
    const governance=await owner.service.loadGovernance(community.id),authority=roster.authority!,policy=governance.governance??{community_id:community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
    await owner.service.saveGovernance(community.id,{...policy,revision:policy.revision+1,overrides:[...policy.overrides,{channel_id:channel.id,kind:'member',target_id:installs[1].session.account.id,allow:0,deny:2}]})
    await until(()=>calls[1].state.phase==='ended'&&calls.slice(0,leaving).filter((_,index)=>index!==1).every(call=>call.state.phase==='connected'&&call.state.participants.length===count-2),'SFU policy change removes the restricted participant and rekeys survivors')
    require(originalSources.get(installs[1].device.device_key)!.readyState==='ended');checks.permission_loss_removes_only_the_restricted_participant=true
    for(const call of calls)call.leave();require(tracks.every(track=>track.readyState==='ended'));checks.permission_loss_and_explicit_leave_stop_all_owned_tracks=true
    require(wire.length>0&&secrets.every(secret=>wire.every(body=>!body.includes(secret.key))));require(installs.every(person=>person.state.messages.length===0));checks.publisher_keys_absent_from_server_wire_and_controls_absent_from_history=true
    require(!failures['429']);checks[config.sfuCapacityProfile?'explicit_larger_room_capacity_profile_completes_without_throttling':'default_request_limits_remain_unchanged']=true
    return {outcome:'pass',scope:'Real local accounts, approved MLS devices and signed occupancy through a disposable SFU with synthetic microphone/camera/screen/computer audio and production room controls',checks,failures,requestProfile:config.sfuCapacityProfile?'sfu25':'standard',participants:count,audioPaths,activeMetrics,observer,loadSeconds,uploadBitsPerSecond,recipientBitsPerSecond,sfuEgressBitsPerSecond,sfuEgressDecimalGigabytesPerHour,trafficEstimateScope:'Measured synthetic sources only; excludes protocol overhead, admission/rekey bursts and provider charges',activePeerConnections,ownedCaptureTracks:tracks.length,micCaptures,cameraCaptures,screenCaptures,systemCaptures,physicalDevicePermissionsValidated:false,internetValidated:false,railwayValidated:false}
  }catch(error){return {outcome:'fail',stage,failureClass:error instanceof Error?error.name:'untyped',requestFailureKind:(error as {kind?:string})?.kind,observerDiagnostics:(error as {observerDiagnostics?:unknown})?.observerDiagnostics,httpStatus:(error as {status?:number})?.status,locations:error instanceof Error?error.stack?.split('\n').map(line=>line.match(/(?:sfu-acceptance|sfu-session|sfu-keys|voice-room|messaging-session)\.ts:\d+:\d+/)?.[0]).filter(Boolean):[],checks,failures,phases:calls.map(call=>call.state.phase),messages:calls.map(call=>call.state.message),faults:calls.map(call=>call.failureDiagnostics()),micCaptures,cameraCaptures,screenCaptures,systemCaptures,pcmDiagnostics,connectionTransitions,workTraces,metrics:await Promise.all(calls.map(call=>call.sfuDiagnostics().catch(()=>null)))}}
  finally{for(const call of calls)call.close();for(const timer of videoTimers)clearInterval(timer);panels?.close();for(const person of installs){person.service.close();person.crypto.close()}await audio?.close().catch(()=>{});window.RTCPeerConnection=OriginalConnection;window.fetch=originalFetch;window.WebSocket=OriginalSocket;SfuKeys.prototype.create=originalCreate;HTMLMediaElement.prototype.play=originalPlay;secrets.length=0;wire.length=0}
}
