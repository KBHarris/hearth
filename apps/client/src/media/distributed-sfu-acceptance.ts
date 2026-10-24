// Coordinates real product endpoints on distinct localhost sites. Each site has
// its own renderer/event loop, account, WASM worker, storage and media workers.
import {HearthClient,type DeviceEnrollment,type Account} from '@hearth/sdk'
import type {VoiceRoomCall} from './voice-room'
import {verifySfuObserver} from './sfu-observer'
type Info={token:string;account:Account;device:DeviceEnrollment;server:string}
type Metric=NonNullable<Awaited<ReturnType<VoiceRoomCall['sfuDiagnostics']>>>
type Snapshot={phase:string;message:string;fault:unknown;participants:{device:string;remote:boolean;camera:boolean;screen:boolean;system:boolean;micPeak:number|null;systemPeak:number|null}[];muted:boolean;camera:boolean;screen:boolean;system:boolean;mics:number;cameras:number;screens:number;systemCaptures:number;joined:string[];epoch:number;deliveryError:string;failures:Record<string,number>;ownedTracks:number;allStopped:boolean;keyContexts:number;wirePrivate:boolean;historyEmpty:boolean;timings:Record<string,{count:number;maxMs:number}>}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
type BridgeReply={index:number;nonce:string;request:number;value?:unknown;error?:{name?:string;status?:number;kind?:string}}
type BrowserBridge={jobs:{index:number;nonce:string;request:number;name:string;data:Record<string,unknown>}[];receive:(replies:BridgeReply[])=>void}
class Endpoint {
  frame=document.createElement('iframe');origin:string;nonce=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');counter=0
  pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>}>()
  listener:(event:MessageEvent)=>void
  readonly index:number
  private bridge:BrowserBridge
  constructor(index:number,bridge:BrowserBridge){
    this.index=index;this.bridge=bridge
    this.origin='https://media'+index+'.localhost:5177';this.frame.src=this.origin+'/sfu-endpoint.html';this.frame.allow='autoplay';this.frame.style.cssText='width:190px;height:140px;border:1px solid #555'
    this.listener=event=>{if(event.origin!==this.origin||event.source!==this.frame.contentWindow||event.data?.type!=='hearth-sfu-fixture-reply')return;this.reply(event.data)}
    addEventListener('message',this.listener)
  }
  reply(value:BridgeReply){if(value.nonce!==this.nonce)return;const request=this.pending.get(value.request);if(!request)return;clearTimeout(request.timer);this.pending.delete(value.request);if(value.error)request.reject(Object.assign(new Error('Isolated endpoint operation failed'),value.error));else request.resolve(value.value)}
  async open(){if(this.index>=13){await this.request('__open');return}await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Isolated endpoint did not load')),15000);this.frame.onload=()=>{clearTimeout(timer);resolve()};document.getElementById('endpoint-grid')!.append(this.frame)})}
  request<T>(name:string,data:Record<string,unknown>={}):Promise<T>{const request=++this.counter;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(request);reject(new Error('Isolated endpoint request timed out: '+name))},60000);this.pending.set(request,{resolve:value=>resolve(value as T),reject,timer});const payload={...data,...(name==='init'?{nonce:this.nonce}:{})};if(this.index>=13)this.bridge.jobs.push({index:this.index,nonce:this.nonce,request,name,data:payload});else this.frame.contentWindow!.postMessage({type:'hearth-sfu-fixture',nonce:this.nonce,request,name,data:payload},this.origin)})}
  dispose(){removeEventListener('message',this.listener);for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new Error('Fixture closed'))}this.pending.clear();this.frame.remove()}
}
export async function runDistributedSfu(config:{origin:string;setupCode:string;sfuObserver?:{origin:string;token:string}}){
  const count=25,endpoints:Endpoint[]=[],people:Info[]=[],checks:Record<string,boolean>={};let stage='Distributed SFU accounts',latest:Snapshot[]=[],channel='',audio:AudioContext|undefined
  const bridge:BrowserBridge={jobs:[],receive:replies=>{for(const reply of replies)endpoints[reply.index]?.reply(reply)}}
  const host=window as unknown as {__hearthSfuBrowserBridge?:BrowserBridge};host.__hearthSfuBrowserBridge=bridge
  const status=(value:string)=>{stage=value;document.getElementById('status')!.textContent=value},require=(value:unknown)=>{if(!value)throw new Error('Distributed SFU assertion failed')}
  const grid=document.createElement('div');grid.id='endpoint-grid';grid.style.cssText='display:grid;grid-template-columns:repeat(5,190px);gap:2px';document.body.append(grid)
  async function snapshots(){return Promise.all(endpoints.map(endpoint=>endpoint.request<Snapshot>('snapshot',{id:channel})))}
  async function until(test:()=>Promise<boolean>|boolean,label:string,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await test())return;await pause(500)}throw new Error(label)}
  async function connected(number:number){await until(async()=>{latest=await snapshots();return latest.slice(0,number).every(view=>view.phase==='connected'&&view.participants.length===number)},'Distributed participants connect')}
  async function decoded(number:number,muted=-1){await until(async()=>{latest=await snapshots();if(latest.slice(0,number).some(view=>view.phase==='ended'))throw new Error('Distributed audio endpoint ended');return latest.slice(0,number).every(view=>view.participants.filter(peer=>peer.remote).length===number-1&&view.participants.filter(peer=>peer.remote).every(peer=>people[muted]?.device.device_key===peer.device?peer.micPeak!==null&&peer.micPeak<.005:peer.micPeak!==null&&peer.micPeak>.03))},'Distributed directed PCM paths');return number*(number-1)}
  try{
    const client=new HearthClient(config.origin)
    for(let index=0;index<=count;index++){
      if(index&&index%16===0){status('Distributed account budget boundary');await pause(60000)}
      status('Distributed SFU account '+index);const endpoint=new Endpoint(index,bridge);endpoints.push(endpoint);await endpoint.open()
      const info=await endpoint.request<Info>('init',{origin:endpoint.origin,index,username:'distributed_sfu_'+index,owner:index===0,setupCode:index===0?config.setupCode:''});people.push(info)
      if(index===0)await client.configureServer(info.token,{server_name:'Disposable isolated-renderer SFU acceptance',registration_mode:'open'})
      await endpoint.request('start');await pause(1000)
      if(index===0){await endpoint.request('gatewayIsolation');checks.gateway_authentication_does_not_wait_for_durable_message_work=true}
    }
    const owner=endpoints[0],community=await client.createCommunity(people[0].token,'Distributed SFU community');await owner.request('secureCommunity',{id:community.id})
    const roomChannel=await client.createChannel(people[0].token,community.id,{name:'room',category_id:null,kind:'voice'});channel=roomChannel.id;await owner.request('secureChannel',{id:channel})
    const invite=await owner.request<{code:string}>('invite',{id:community.id})
    for(let index=1;index<=count;index++){
      status('Distributed SFU admission '+index)
      await endpoints[index].request('joinCommunity',{id:community.id,code:invite.code,channel})
      await owner.request('approve',{id:channel,account:people[index].account.id,identity:people[index].device.identity_key})
      await until(async()=>(await endpoints[index].request<Snapshot>('snapshot',{id:channel})).joined.includes(channel),'Distributed MLS welcome')
      if(index%6===0&&index<count)await pause(60000)
    }
    await until(async()=>{latest=await snapshots();return latest.every(view=>view.joined.includes(channel))&&new Set(latest.map(view=>view.epoch)).size===1},'Distributed stable MLS audience')
    status('Distributed setup budget boundary');await pause(60000)
    for(let index=0;index<count;index++){
      status('Distributed voice join '+index);await endpoints[index].request('join',{id:channel})
      if(index===0){latest=await snapshots();require(latest[0].phase==='waiting'&&latest.every(view=>view.mics===0));checks.solo_endpoint_holds_no_microphone=true}
      else await connected(index+1)
      if(index===1){await owner.request('leaseIsolation');checks.presence_renewal_bypasses_durable_work_without_extending_authorization=true}
      if(index<count-1)await pause(10000)
    }
    status('Distributed PCM matrix');const audioPaths=await decoded(count);checks.all_600_directed_microphone_paths_decode=true
    latest=await snapshots();require(latest.slice(0,count).every(view=>view.mics===1)&&latest[count].phase==='idle'&&latest[count].mics===0);checks.unjoined_mls_device_holds_no_media_capture=true
    status('Distributed camera publication');await owner.request('video',{kind:'camera'});status('Distributed screen publication');await owner.request('video',{kind:'screen',audio:true})
    status('Distributed camera and screen')
    await until(async()=>{latest=await snapshots();return latest.slice(1,count).every(view=>{const peer=view.participants.find(peer=>peer.device===people[0].device.device_key);return peer?.camera&&peer.screen&&peer.system&&peer.systemPeak!==null&&peer.systemPeak>.03})},'Distributed encrypted video and system audio')
    await until(async()=>(await Promise.all(endpoints.slice(1,count).map(endpoint=>endpoint.request<Metric>('metrics')))).every(metric=>['camera','screen'].every(source=>metric.inbound.some(track=>track.device===people[0].device.device_key&&track.source===source&&track.frames>10))),'Distributed decoded camera/screen frames')
    await owner.request('mute');await until(async()=>{latest=await snapshots();return latest.slice(1,count).every(view=>{const peer=view.participants.find(peer=>peer.device===people[0].device.device_key);return peer?.micPeak!==null&&peer?.micPeak!==undefined&&peer.micPeak<.005&&peer.systemPeak!==null&&peer.systemPeak>.03})},'Distributed independent microphone mute');await owner.request('mute');checks.screen_audio_is_separate_from_microphone_mute=true
    status('SFU video ready');const before=await Promise.all(endpoints.slice(0,count).map(endpoint=>endpoint.request<Metric>('metrics'))),start=performance.now();await pause(32000)
    const activeMetrics=await Promise.all(endpoints.slice(0,count).map(endpoint=>endpoint.request<Metric>('metrics'))),loadSeconds=(performance.now()-start)/1000,uploadBitsPerSecond=activeMetrics.map((metric,index)=>Math.max(0,metric.outboundBytes-before[index].outboundBytes)*8/loadSeconds),received=(metric:Metric)=>metric.inbound.reduce((sum,track)=>sum+track.bytes,0),recipientBitsPerSecond=activeMetrics.map((metric,index)=>Math.max(0,received(metric)-received(before[index]))*8/loadSeconds),sfuEgressBitsPerSecond=recipientBitsPerSecond.reduce((sum,rate)=>sum+rate,0)
    require(activeMetrics.every(metric=>metric.encryptionEnabled&&metric.workerErrors===0));checks.every_publisher_has_encryption_and_no_worker_errors=true
    status('SFU wrong-key subscriber');audio=new AudioContext({sinkId:{type:'none'}} as AudioContextOptions);await audio.resume();require(config.sfuObserver)
    const room=await owner.request<{room:{revision:number}}>('room',{id:channel}),access=await owner.request<{room:string}>('access',{id:channel,revision:room.room.revision})
    const observer=await verifySfuObserver(config.sfuObserver!,access.room,audio,count+3,await owner.request<RTCIceServer[]>('configuration'),false);checks.routing_authorized_observer_has_no_media_keys_or_decoded_frames=true
    const beforeKeys=latest.slice(0,count-1).map(view=>view.keyContexts);await endpoints[1].request('mute');await endpoints[count-1].request('leave');status('Distributed membership rotation');await connected(count-1);await decoded(count-1,1)
    latest=await snapshots();require(latest[0].camera&&latest[0].screen&&latest[0].system&&latest[1].muted&&latest.slice(0,count-1).every((view,index)=>view.mics===1&&view.keyContexts>beforeKeys[index]));checks.membership_change_rekeys_without_recapture_or_unmute=true
    await until(async()=>{latest=await snapshots();return latest.slice(1,count-1).every(view=>{const peer=view.participants.find(peer=>peer.device===people[0].device.device_key);return peer?.systemPeak!==null&&peer?.systemPeak!==undefined&&peer.systemPeak>.03})},'Distributed shared audio after rotation');checks.shared_audio_continues_after_rekey=true
    await owner.request('video',{kind:'screen'});await endpoints[1].request('mute');status('Distributed permission revocation');await owner.request('revoke',{id:community.id,channel,account:people[1].account.id})
    await until(async()=>{latest=await snapshots();return latest[1].phase==='ended'&&latest.slice(0,count-1).filter((_,index)=>index!==1).every(view=>view.phase==='connected'&&view.participants.length===count-2)},'Distributed permission enforcement');checks.revocation_removes_only_restricted_participant=true
    await Promise.all(endpoints.map(endpoint=>endpoint.request('leave')));latest=await snapshots();require(latest.every(view=>view.allStopped&&view.wirePrivate&&view.historyEmpty));checks.all_owned_tracks_stop_and_actual_media_keys_are_absent_from_wire=true
    const failures=latest.reduce<Record<string,number>>((all,view)=>{for(const [status,count] of Object.entries(view.failures))all[status]=(all[status]??0)+count;return all},{})
    require(!failures['429']);checks.unchanged_per_account_and_login_limits_pass=true
    return {outcome:'pass',scope:'26 isolated localhost sites/renderers split across two disposable browsers with real accounts/WASM/MLS; 25 joined SFU endpoints and one unjoined device; synthetic microphone/camera/screen/computer audio',checks,participants:count,audioPaths,loadSeconds,uploadBitsPerSecond,recipientBitsPerSecond,sfuEgressBitsPerSecond,sfuEgressDecimalGigabytesPerHour:sfuEgressBitsPerSecond*3600/8/1e9,activeMetrics,observer,failures,requestProfile:'sfu25',physicalDevicePermissionsValidated:false,internetValidated:false,railwayValidated:false}
  }catch(error){latest=await snapshots().catch(()=>latest);return {outcome:'fail',stage,failureClass:error instanceof Error?error.name:'untyped',requestFailureKind:(error as {kind?:string})?.kind,httpStatus:(error as {status?:number})?.status,checks,endpoints:latest.map(view=>({phase:view.phase,message:view.message,fault:view.fault,failures:view.failures,mics:view.mics,camera:view.camera,screen:view.screen,system:view.system,remoteCameras:view.participants.filter(peer=>peer.remote&&peer.camera).length,remoteScreens:view.participants.filter(peer=>peer.remote&&peer.screen).length,decodedSystemAudio:view.participants.filter(peer=>peer.remote&&peer.systemPeak!==null&&peer.systemPeak>.03).length,participants:view.participants.length,deliveryError:view.deliveryError,timings:view.timings}))}}
  finally{await Promise.all(endpoints.map(endpoint=>endpoint.request('close').catch(()=>{})));for(const endpoint of endpoints)endpoint.dispose();delete host.__hearthSfuBrowserBridge;await audio?.close().catch(()=>{});grid.remove();people.length=0}
}
