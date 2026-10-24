import {deliveryBatch} from './delivery-batch'
import {verifiedVoiceSnapshot} from './voice-snapshot'
import {MediaWork} from './media-work'
import {currentRoomKeyContext} from './room-key-context'
import type {ReportKey,ReportEvidence,QueuedReport,ReportEnvelope} from '@hearth/sdk'
export type ReportReview=QueuedReport&{evidence?:ReportEvidence;error?:string}
import {permissions,mediaPermissions,withMediaPermissions,Permission,HearthClient,HearthError,PROTOCOL_VERSION,validateDeliveryEvent,type Session,type DeviceEnrollment,type Conversation,type LocalMessage,type KeyPackageRecord,type CommitUpload,type MessageUpload,type MessageContent,type Person,type DeliveryEvent,type ChannelRoster} from '@hearth/sdk'
import {AuthCrypto} from './client'
import {messageScope,readMessages,writeMessages} from './message-store'
import {storageDeadline} from './vault-store'
import type {CommunityAuthority,CommunityAdmission,CommunityInvitation,ChannelPolicy,ChannelAuthorization,CommunityInvite,HistoryPolicy} from '@hearth/sdk'
import type {Governance,GovernanceView,LocalProfile,LocalPresence} from '@hearth/sdk'
import type {LocalAttachment} from '@hearth/sdk'
import type {OwnershipState,OwnershipHandoff,OwnershipAcceptance} from '@hearth/sdk'
import {MAX_FILE,hex,unhex,thumbnail} from './file-tools'
import {cachedFile,cacheFile} from './file-cache'
import type {CallSignal,LocalCallSignal} from '@hearth/sdk'
import {callCapability} from '../media/direct-call'
import {CallObservers} from '../media/call-observers'
import {groupContext} from '../media/group-admission'
import type {VoiceRoom,VoicePresence,SfuAccess} from '@hearth/sdk'

export function admitted(roster:ChannelRoster,person:Person):boolean {
  const key=person.devices[0]?.identity_key
  return !!key && ((person.account.id===roster.authority?.owner.account_id && key===roster.authority.owner.enrollment.identity_key)||roster.admissions.some(g=>g.account_id===person.account.id&&g.identity_key===key))
}

type Pending={kind:'commit';conversation_id:string;upload:CommitUpload}|{kind:'message';conversation_id:string;upload:MessageUpload}
type EngineView={last_seq:number;governance_epochs:Record<string,number>;messages:LocalMessage[];groups:Conversation[];pending:Pending[];pending_packages:KeyPackageRecord[];profiles:Record<string,LocalProfile>;presence:Record<string,LocalPresence>;read:Record<string,Record<string,string>>;history_backfill:string[];history_waiting:string[];emoji:Record<string,Record<string,LocalAttachment>>}
export type ChatState={blocked:string[];conversations:Conversation[];channels:Record<string,ChannelRoster>;joined:string[];messages:LocalMessage[];people:Record<string,Person>;typing:Record<string,{account:string;until:number}[]>;pending:number;connection:string;error:string;fatal:boolean;profiles:Record<string,LocalProfile>;presence:Record<string,LocalPresence>;read:Record<string,Record<string,string>>;history_waiting:string[];emoji:Record<string,Record<string,LocalAttachment>>}
const initialView:EngineView={last_seq:0,governance_epochs:{},messages:[],groups:[],pending:[],pending_packages:[],profiles:{},presence:{},read:{},history_backfill:[],history_waiting:[],emoji:{}}
export const initialChat:ChatState={blocked:[],conversations:[],channels:{},joined:[],messages:[],people:{},typing:{},pending:0,connection:'Opening encrypted storage…',error:'',fatal:false,profiles:{},presence:{},read:{},history_waiting:[],emoji:{}}

/** One serialized stream owns the in-memory ratchets; CAS detects competing tabs/processes. */
export class MessagingSession {
  private callObservers=new CallObservers()
  onCall(listener:(event:LocalCallSignal)=>void,locked:(conversation?:string)=>void,epochChanged?:(conversation:string,epoch?:number)=>void|Promise<void>){return this.callObservers.add(listener,locked,epochChanged)}
  private lockCalls(conversation?:string){this.callObservers.lock(conversation)}
  private changeCallEpoch(conversation:string,epoch?:number){return this.callObservers.changeEpoch(conversation,epoch)}
  get callDevice(){return this.device.device_key}
  get callAccount(){return this.session.account.id}
  async callConfiguration():Promise<RTCIceServer[]>{
    const config=await this.client.groupCallConfiguration(this.session.token,this.device.device_key,this.options)
    return config.ice_servers.map(server=>({urls:server.urls,...(server.username&&server.credential?{username:server.username,credential:server.credential}:{})}))
  }
  callKey(id:string,signal:CallSignal):Promise<string>{return this.enqueueMedia(()=>{currentRoomKeyContext(signal,this.view.groups.find(group=>group.id===id),this.mediaRosters.get(id),this.device.device_key,Date.now(),this.view.governance_epochs[id]??0);return this.operation<string>('call_key',{id,signal})},false)}
  authorizeCall(id:string,signal?:CallSignal):Promise<Conversation>{return this.authorizeMedia(id,signal,false)}
  authorizeGroupCall(id:string,signal?:CallSignal):Promise<Conversation>{return this.authorizeMedia(id,signal,true)}
  private async voiceAccess(id:string){
    // Gateway delivery already serializes MLS updates. A newer server epoch in
    // the room response fails verification before media; avoid a second inbox
    // pull for every lease read/renewal in addition to the fresh signed policy.
    const roster=await this.prepareChannel(id)
    const local=this.view.groups.find(group=>group.id===id)
    const person=roster.people.find(person=>person.account.id===this.session.account.id)
    if(!['voice','stage'].includes(roster.channel.kind)||!local||local.channel_id!==id||!person||!admitted(roster,person)||
      (mediaPermissions(roster.governance,permissions(roster.governance,roster.community.owner_id,this.session.account.id,id,Date.now(),roster.admissions.find(grant=>grant.account_id===this.session.account.id)?.invitation?.issued_at??null),roster.channel.kind==='stage',roster.community.owner_id===this.session.account.id)&(Permission.connect|Permission.listen))!==(Permission.connect|Permission.listen)||roster.rules_accepted===false)throw new Error('Your role or community rules prevent joining this voice room.')
    const grants=Object.fromEntries(local.members.map(peer=>[peer.enrollment.device_key,mediaPermissions(roster.governance,permissions(roster.governance,roster.community.owner_id,peer.account_id,id,Date.now(),roster.admissions.find(grant=>grant.account_id===peer.account_id)?.invitation?.issued_at??null),roster.channel.kind==='stage',peer.account_id===roster.community.owner_id)]))
    return {conversation:local,permissions:grants,stage:roster.channel.kind==='stage'}
  }
  private async verifyPeers(peers:Conversation['members']){
    if(await this.operation<boolean>('verify_peers',peers))await this.persist()
  }
  private async readVoiceRoom(id:string){
    let view=await this.voiceAccess(id),room=await this.client.voiceRoom(this.session.token,id,this.device.device_key,this.options)
    if(room.epoch!==view.conversation.epoch){await this.synchronize();view=await this.voiceAccess(id);room=await this.client.voiceRoom(this.session.token,id,this.device.device_key,this.options)}
    if(room.epoch!==view.conversation.epoch)throw Object.assign(new Error('Room encryption is updating.'),{status:409})
    return {room,...view}
  }
  voiceRoom(id:string):Promise<{room:VoiceRoom;conversation:Conversation;permissions:Record<string,number>;stage:boolean}>{return this.enqueueMedia(()=>verifiedVoiceSnapshot(()=>this.readVoiceRoom(id),(value,now)=>this.operation('verify_voice_room',{room:value.room,now})))}
  voicePresence(value:VoicePresence):Promise<{room:VoiceRoom;conversation:Conversation;permissions:Record<string,number>;stage:boolean}>{return this.enqueueMedia(async()=>{
    const view=await this.voiceAccess(value.channel_id)
    if(value.epoch!==view.conversation.epoch)throw Object.assign(new Error('Room encryption is updating.'),{status:409})
    const signed=await this.operation<VoicePresence>('sign_voice_presence',value)
    const room=await this.client.voicePresence(this.session.token,signed,this.options)
    if(room.epoch!==view.conversation.epoch)throw Object.assign(new Error('Room encryption is updating.'),{status:409})
    let initial=true
    return verifiedVoiceSnapshot(async()=>{if(initial){initial=false;return {room,...view}}return this.readVoiceRoom(value.channel_id)},(value,now)=>this.operation('verify_voice_room',{room:value.room,now}))
  })}
  async renewVoicePresence(value:VoicePresence):Promise<number>{
    // A keepalive only signs the existing contribution. It neither mutates MLS
    // nor authorizes media, so durable message work must not delay it. The
    // backend still checks current approval and signed permissions on this POST.
    // Callers must retain their separate, fresh-policy authorization watchdog.
    if(this.closed)throw new Error('Messaging is locked. Sign in again.')
    const signed=await this.operation<VoicePresence>('sign_voice_presence',value)
    if(this.closed)throw new Error('Messaging is locked. Sign in again.')
    const room=await this.client.voicePresence(this.session.token,signed,this.options)
    const own=room.participants.find(peer=>peer.device_key===this.device.device_key)
    if(room.channel_id!==signed.channel_id||room.room_id!==signed.room_id||room.epoch!==signed.epoch||!own||!Object.entries(signed).every(([key,value])=>own[key as keyof VoicePresence]===value))throw Object.assign(new Error('Room participation is updating.'),{status:409})
    return signed.expires_at
  }
  sfuAccess(id:string,revision:number):Promise<SfuAccess>{return this.enqueueMedia(async()=>{
    await this.voiceAccess(id)
    return this.client.sfuAccess(this.session.token,id,this.device.device_key,revision,this.options)
  })}
  private authorizeMedia(id:string,signal:CallSignal|undefined,group:boolean):Promise<Conversation>{return this.enqueue(async()=>{
    await this.synchronize()
    const conversations=await this.client.conversations(this.session.token,this.options)
    const current=conversations.find(c=>c.id===id),local=this.view.groups.find(c=>c.id===id)
    if(!current||current.channel_id||current.accounts.length!==(group?3:2)||!local||current.epoch!==local.epoch||!current.members.some(m=>m.enrollment.device_key===this.device.device_key))throw new Error(group?'Open an up-to-date private conversation with exactly three people.':'Open an up-to-date private conversation with one person first.')
    // Authenticate the current conversation credentials locally. The fresh
    // readiness request below checks every approved device and both directions
    // of blocking for all participants; separate directory/block HTTP reads
    // would repeat that same authorization and can race the final admission.
    const peers=current.members
    await this.verifyPeers(peers)
    const devices=signal?(group?signal.participants??[]:[signal.from_device,signal.to_device]):[this.device.device_key]
    if(group&&signal){
      if(!signal.group_id||!signal.participants||!signal.participants.includes(this.device.device_key))throw new Error('This device is not invited.')
      groupContext(this.server,current,signal.group_id,signal.from_device,signal.participants,signal.relay_only)
    }
    if(signal&&signal.epoch!==current.epoch)throw new Error('Encryption changed. Start a new call.')
    if(devices.some(key=>!peers.some(p=>p.enrollment.device_key===key)||!local.members.some(p=>p.enrollment.device_key===key)))throw new Error('A call device is no longer approved. Start a new call after linking it.')
    try{await (group?this.client.groupCallReady(this.session.token,id,this.device.device_key,this.options):this.client.callReady(this.session.token,id,this.device.device_key,this.options))}catch(error){if(error instanceof HearthError&&error.status===409)throw new Error(group?'Open current Hearth clients on each device in this conversation once to enable group calling. Devices can then be offline without blocking the call.':'Open current Hearth clients on every device in this conversation before calling. This protects older clients from incompatible call messages.');throw error}
    return current
  })}
  private crypto:AuthCrypto
  private session:Session
  private device:DeviceEnrollment
  private changed:(state:ChatState)=>void
  private client:HearthClient
  private scope:string
  private controller=new AbortController()
  private revision=0
  private view:EngineView=initialView
  private state:ChatState=initialChat
  private tail:Promise<unknown>=Promise.resolve()
  private mediaWork=new MediaWork()
  private mediaRosters=new Map<string,ChannelRoster>()
  private socket:WebSocket|null=null
  private heartbeat:ReturnType<typeof setInterval>|undefined
  private maintenance:ReturnType<typeof setInterval>|undefined
  private reconnect:ReturnType<typeof setTimeout>|undefined
  private heartbeatAt=0
  private initialized=false
  private lastTyping=0
  private closed=false
  private refreshing=false
  private deliveryInbox:DeliveryEvent[]=[]
  private deliveryScheduled=false
  constructor(crypto:AuthCrypto,session:Session,device:DeviceEnrollment,server:string,url:string,changed:(state:ChatState)=>void) {
    this.crypto=crypto;this.session=session;this.device=device;this.changed=changed
    this.client=new HearthClient(url);this.scope=messageScope(session.account.id,server,device.device_key)
    this.server=server
  }
  private server:string
  private get options(){return {signal:this.controller.signal}}
  private enqueue<T>(action:()=>Promise<T>):Promise<T> {
    const result=this.tail.then(async()=>{await this.mediaWork.drain();if(this.closed)throw new Error('Messaging is locked. Sign in again.');return action()})
    this.tail=result.catch(()=>{})
    return result
  }
  private enqueueMedia<T>(action:()=>Promise<T>,authorization=true):Promise<T>{
    const result=this.mediaWork.add(async()=>{if(this.closed)throw new Error('Messaging is locked. Sign in again.');return action()},authorization)
    // A normal marker guarantees service even when there is no durable inbox.
    // Existing tasks also drain at their next saved batch boundary.
    void this.enqueue(async()=>{}).catch(()=>{})
    return result
  }
  private publish(patch:Partial<ChatState>={}) {
    if(this.closed && !patch.fatal)return
    const now=Date.now()
    const typing=Object.fromEntries(Object.entries(this.state.typing).map(([id,peers])=>[id,peers.filter(peer=>peer.until>now)]))
    this.state={...this.state,typing,...patch,messages:this.view.messages,profiles:this.view.profiles,presence:this.view.presence,read:this.view.read,history_waiting:this.view.history_waiting,emoji:this.view.emoji,joined:this.view.groups.map(g=>g.id),pending:this.view.pending.length+this.view.pending_packages.length}
    this.changed(this.state)
  }
  private async inspect() {
    const previous=this.view.groups
    this.view=JSON.parse(await this.crypto.message('view')) as EngineView
    for(const group of previous)if(!this.view.groups.some(current=>current.id===group.id))this.lockCalls(group.id)
    for(const group of this.view.groups)if(previous.some(old=>old.id===group.id&&old.epoch!==group.epoch))void this.changeCallEpoch(group.id,group.epoch).catch(()=>this.close())
  }
  private async persist() {
    const sealed=await this.crypto.message('seal')
    try {
      const saved=await storageDeadline(writeMessages(this.scope,this.revision,sealed),this.controller.signal)
      if(this.closed)throw new Error('Messaging is locked.')
      this.revision=saved.revision
      await this.inspect()
      // A durable checkpoint can service urgent authorization without waiting
      // for the rest of a long outbox/maintenance operation. Delivery batches
      // hold this drain until their saved prefix has also been exposed in order.
      await this.mediaWork.drain()
    }catch(error){
      // A normal sign-out/close can cancel a pending native write. The native
      // fixture/store barrier drains it; the closed view must not become a failure.
      if(this.closed)throw error
      this.close();this.publish({fatal:true,connection:'Encrypted storage needs attention',error:error instanceof Error?error.message:'Encrypted storage could not be saved. Sign in again.'});throw error
    }
  }
  private async operation<T>(name:string,input:unknown=''):Promise<T> {try{
    if(name==='add'&&typeof input==='object'&&input!==null&&'id' in input)await this.changeCallEpoch(String(input.id))
    return JSON.parse(await this.crypto.message(name,input)) as T
  }catch(error){if(error instanceof Error)Object.assign(error,{cryptoOperation:name});if(import.meta.env.DEV)console.warn('Encrypted operation failed: '+name+(name==='receive'&&typeof input==='object'&&input!==null&&'data' in input?'/'+String((input as {data:{kind?:string}}).data.kind):''));throw error}}
  async start() {
    return this.enqueue(async()=>{
      const saved=await storageDeadline(readMessages(this.scope),this.controller.signal)
      if(this.closed)return
      this.revision=saved?.revision ?? 0
      await this.crypto.openMessages(saved?.envelope,this.session.account.id,this.server)
      await this.inspect()
      if(!saved)await this.persist()
      this.initialized=true
      if(callCapability())await this.callConfiguration().catch(()=>{})
      await this.synchronize()
      await this.refresh()
      this.openGateway()
      this.maintenance=setInterval(()=>{if(this.closed || this.refreshing)return;this.refreshing=true;void this.enqueue(()=>this.refresh()).catch(error=>this.report(error)).finally(()=>{this.refreshing=false})},30000)
    }).catch(error=>{if(!this.closed){this.close();this.publish({fatal:true,error:error instanceof Error?error.message:'Could not open encrypted messaging.',connection:'Messaging could not start'})}throw error})
  }
  private async flush() {
    let rejected=false
    await this.inspect()
    for(const packageRecord of this.view.pending_packages) {
      await this.client.uploadPackage(this.session.token,packageRecord,this.options)
      await this.operation('accept',packageRecord.package_hash);await this.persist()
    }
    for(const pending of this.view.pending) {
      try {
        if(pending.kind==='commit')await this.client.uploadCommit(this.session.token,pending.conversation_id,pending.upload,this.options)
        else await this.client.uploadMessage(this.session.token,pending.conversation_id,pending.upload,this.options)
        await this.operation('accept',pending.upload.operation_id);await this.persist()
      }catch(error){
        if(error instanceof HearthError && [400,403,409].includes(error.status)) {
          // A prior successful request can lose its reply just before policy changes.
          // Consume authenticated ordered delivery while the pending proof is retained.
          for(;;){const backlog=await this.client.events(this.session.token,this.device.device_key,this.view.last_seq,this.options);await this.receiveBatch(backlog);if(backlog.length<128)break}
          if(!this.view.pending.some(p=>p.upload.operation_id===pending.upload.operation_id))continue
          await this.operation('reject',pending.upload.operation_id);await this.persist()
          this.publish({error:'Encryption or permissions changed. The queued operation was rejected; retry after updates arrive.'})
          rejected=true
        }else throw error
      }
    }
    return rejected
  }
  private async receiveBatch(events:readonly DeliveryEvent[]){
    for(let offset=0;offset<events.length;){const started=performance.now();const consumed=await this.mediaWork.batch(()=>deliveryBatch(events.slice(offset,offset+16),this.view.last_seq,{
      before:async event=>{if(event.data.kind==='commit'&&event.data.upload.expected_epoch>=(this.view.groups.find(group=>group.id===event.conversation_id)?.epoch??0))await this.changeCallEpoch(event.conversation_id)},
      receive:async event=>{const typing=await this.operation<[string,boolean]|null>('receive',event),calls=await this.operation<LocalCallSignal[]>('take_calls');return {typing,calls}},
      persist:()=>this.persist(),
      // Slow crypto must not hold sixteen envelopes ahead of an access check.
      // Save and publish the accepted prefix before yielding the single owner.
      yield:()=>this.mediaWork.waiting||performance.now()-started>=250,
      emit:items=>{for(const {event,value:{typing,calls}} of items){
        for(const call of calls)if(call.signal.epoch===this.view.groups.find(group=>group.id===call.conversation_id)?.epoch)this.callObservers.emit(call)
        if(typing){const peers=this.state.typing[event.conversation_id]?.filter(peer=>peer.account!==typing[0])??[];if(typing[1])peers.push({account:typing[0],until:Date.now()+8000});this.state={...this.state,typing:{...this.state.typing,[event.conversation_id]:peers}}}
      }this.publish()},
    }));offset+=consumed;await this.mediaWork.drain()}
  }
  private drainDelivery(socket:WebSocket){
    if(this.deliveryScheduled||this.socket!==socket||this.closed)return
    this.deliveryScheduled=true
    void this.enqueue(async()=>{
      if(this.socket!==socket)return
      const events=this.deliveryInbox.splice(0,16);await this.receiveBatch(events)
      if(this.socket===socket&&!this.closed)socket.send(JSON.stringify({op:'ack',d:{last_seq:this.view.last_seq}}))
    }).catch(error=>{this.report(error);socket.close()}).finally(()=>{this.deliveryScheduled=false;if(this.socket===socket&&this.deliveryInbox.length)this.drainDelivery(socket)})
  }
  private async synchronize() {
    await this.flush()
    for(;;){
      const backlog=await this.client.events(this.session.token,this.device.device_key,this.view.last_seq,this.options)
      await this.receiveBatch(backlog)
      if(backlog.length<128)break
    }
  }
  refreshBlocks():Promise<void>{return this.enqueue(async()=>{this.publish({blocked:(await this.client.blocks(this.session.token,this.options)).map(person=>person.id)})})}
  private async refresh() {
    if(callCapability())await this.callConfiguration().catch(()=>{})
    // Drain the preceding epoch before adding a device. A commit must not discard
    // application secrets for messages still waiting in the ordered backlog.
    await this.synchronize()
    const conversations=await this.client.conversations(this.session.token,this.options)
    await this.mediaWork.drain()
    const ids=new Set(conversations.filter(conversation=>!conversation.channel_id).flatMap(conversation=>conversation.accounts))
    const people={...this.state.people}
    for(const id of ids){people[id]=await this.client.personById(this.session.token,id,this.options);await this.mediaWork.drain()}
    const channels:Record<string,ChannelRoster>={}
    for(const conversation of conversations.filter(c=>c.channel_id)) {
      const roster=await this.prepareChannel(conversation.id)
      await this.mediaWork.drain()
      if(roster.channel.id!==conversation.id || !roster.people.some(p=>p.account.id===this.session.account.id))throw new Error('The channel roster could not be verified.')
      channels[conversation.id]=roster
      for(const person of roster.people)people[person.account.id]=person
    }
    const peers=Object.values(people).flatMap(person=>person.devices.map(enrollment=>({account_id:person.account.id,enrollment})))
    try {for(let offset=0;offset<peers.length;offset+=128)await this.verifyPeers(peers.slice(offset,offset+128))}
    catch {throw new Error('A participant’s identity changed or could not be verified. Saved fingerprints were preserved. Compare identities using a trusted channel before adding devices.')}
    const blocked=(await this.client.blocks(this.session.token,this.options)).map(person=>person.id);await this.mediaWork.drain()
    this.publish({conversations,people,channels,blocked})
    const count=await this.client.packageCount(this.session.token,this.device.device_key,this.options)
    await this.mediaWork.drain()
    if(count.available<4 && this.view.pending_packages.length===0){
      for(let available=count.available;available<4;available++){await this.operation('package');await this.persist();await this.flush()}
    }
    // Any current member may add an approved new device of an existing DM participant.
    for(const conversation of conversations){
      const local=this.view.groups.find(group=>group.id===conversation.id)
      if(!local || local.epoch!==conversation.epoch || this.view.pending.some(p=>p.conversation_id===conversation.id))continue
      if(conversation.channel_id && local.members.some(m=>channels[conversation.id].departures?.some(d=>d.member.account_id===m.account_id&&d.member.enrollment.identity_key===m.enrollment.identity_key)||!(permissions(channels[conversation.id].governance,channels[conversation.id].community.owner_id,m.account_id,conversation.id,Number.MAX_SAFE_INTEGER,channels[conversation.id].admissions.find(a=>a.account_id===m.account_id)?.invitation?.issued_at??null)&Permission.read))) {
        const pruned=await this.operation<CommitUpload|null>('prune_channel',conversation.id);await this.persist();if(pruned)await this.flush();continue
      }
      if(conversation.channel_id && channels[conversation.id].community.owner_id===this.session.account.id && (this.view.governance_epochs?.[conversation.id]??0)!==(channels[conversation.id].governance?.revision??0)) {
        await this.operation('add_channel',{id:conversation.id,packages:[],create:false});await this.persist();await this.flush();continue
      }
      const known=new Set(local.members.map(member=>member.enrollment.device_key))
      const packages:KeyPackageRecord[]=[]
      const audience=conversation.channel_id?channels[conversation.id].people.filter(p=>admitted(channels[conversation.id],p)).map(p=>p.account.id):conversation.accounts
      for(const account of audience){
        for(const proof of people[account]?.devices ?? []) {
          if(conversation.channel_id && packages.length>=8)break
          if(known.has(proof.device_key))continue
          if(known.size+packages.length>= (conversation.channel_id?128:32))throw new Error('This encrypted group has reached its device limit.')
          try {
            const claimed=await this.client.claimPackages(this.session.token,[proof.device_key],this.options)
            this.verifyClaim(claimed,account,proof);packages.push(...claimed)
          }catch(error){if(!(error instanceof HearthError) || ![404,409].includes(error.status))throw error}
        }
      }
      if(packages.length){
        await this.operation(conversation.channel_id?'add_channel':'add',{id:conversation.id,packages,create:false});await this.persist();await this.flush()
      }
    }
    for(const roster of Object.values(channels))if(roster.community.owner_id===this.session.account.id && this.view.groups.some(g=>g.id===roster.channel.id)) {
      const offered=await this.operation<MessageUpload|null>('offer_history',roster.channel.id);await this.persist();if(offered)await this.flush()
    }
    for(const id of this.view.history_backfill){
      let cursor=0
      for(let page=0;page<128;page++) {
        const archive=await this.client.history(this.session.token,id,this.device.device_key,cursor,this.options)
        if(archive.items.length && archive.next<=cursor)throw new Error('History did not advance. Retry the request.')
        await this.operation('import_history',{id,uploads:archive.items});await this.persist();cursor=archive.next
        if(archive.items.length<128){await this.operation('finish_history',id);await this.persist();break}
        if(page===127)throw new Error('History exceeds the current device backfill limit.')
      }
    }
    this.publish()
  }
  private verifyClaim(packages:KeyPackageRecord[],account:string,proof:DeviceEnrollment){
    if(packages.length!==1 || packages[0].member.account_id!==account || Object.keys(proof).some(key=>packages[0].member.enrollment[key as keyof DeviceEnrollment]!==proof[key as keyof DeviceEnrollment]))throw new Error('A recipient device changed. Compare fingerprints before trying again.')
  }
  private async prepareCommunity(id:string):Promise<CommunityAuthority> {
    const structure=await this.client.communityStructure(this.session.token,id,this.options)
    let root=structure.authority
    if(!root) {
      if(structure.community.owner_id!==this.session.account.id)throw new Error('The community owner needs to prepare its encryption identity.')
      root=await this.operation<CommunityAuthority>('sign_authority',id);await this.persist()
      root=await this.client.communityAuthority(this.session.token,id,root,this.options)
    }
    if(root.owner.account_id!==structure.community.owner_id)throw new Error('The community owner identity did not match. Compare fingerprints before continuing.')
    await this.operation('verify_authority',root);await this.persist()
    return root
  }
  loadGovernance(id:string):Promise<GovernanceView>{return this.enqueue(async()=>{
    await this.synchronize()
    const authority=await this.prepareCommunity(id),view=await this.client.governance(this.session.token,id,this.options)
    await this.operation('pin_governance',{authority,policy:view.governance});await this.persist();return view
  })}
  loadOwnership(id:string):Promise<OwnershipState>{return this.enqueue(async()=>{
    await this.synchronize()
    await this.prepareCommunity(id);const state=await this.client.ownership(this.session.token,id,this.options)
    await this.operation('verify_authority',state.authority)
    if(state.offer){if(JSON.stringify(state.offer.previous)!==JSON.stringify(state.authority))throw new Error('The ownership offer is stale. Ask the owner to prepare it again.');await this.operation('verify_ownership',state.offer)}
    await this.persist();return state
  })}
  offerOwnership(id:string,account:string,deviceKey?:string):Promise<void>{return this.enqueue(async()=>{
    await this.refresh();const authority=await this.prepareCommunity(id),state=await this.client.ownership(this.session.token,id,this.options),person=await this.client.personById(this.session.token,account,this.options)
    const structure=await this.client.communityStructure(this.session.token,id,this.options),conversations=await this.client.conversations(this.session.token,this.options)
    const eligible=person.devices.filter(d=>structure.channels.every(c=>conversations.find(g=>g.id===c.id)?.members.some(m=>m.enrollment.device_key===d.device_key)))
    if(!deviceKey&&eligible.length>1)throw new Error("Choose the member’s device for this transfer.")
    const enrollment=eligible.find(d=>!deviceKey||d.device_key===deviceKey)
    if(!enrollment)throw new Error('Ask this member to open every channel on the same approved device before offering ownership.')
    const successor={account_id:account,enrollment};const offer=await this.operation<OwnershipHandoff>('offer_ownership',{authority,successor,endorsed:state.endorsed});await this.persist()
    await this.client.offerOwnership(this.session.token,id,offer,this.options)
  })}
  acceptOwnership(id:string):Promise<void>{return this.enqueue(async()=>{
    await this.synchronize();const authority=await this.prepareCommunity(id),state=await this.client.ownership(this.session.token,id,this.options),view=await this.client.governance(this.session.token,id,this.options)
    if(!state.offer)throw new Error('There is no pending ownership transfer.')
    await this.operation('pin_governance',{authority,policy:view.governance});await this.persist()
    const old=view.governance??{community_id:id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:authority.owner,signature:''}
    const acceptance=await this.operation<OwnershipAcceptance>('accept_ownership',{offer:state.offer,policy:{...old,revision:old.revision+1}});await this.persist()
    const root=await this.client.acceptOwnership(this.session.token,id,acceptance,this.options)
    await this.operation('pin_governance',{authority:root,policy:acceptance.governance});await this.persist();await this.refresh()
  })}
  cancelOwnership(id:string):Promise<void>{return this.enqueue(async()=>{await this.client.cancelOwnership(this.session.token,id,this.options)})}
  async stageSpeaker(channel:string,account:string,speaker:boolean):Promise<void>{
    const roster=await this.enqueue(()=>this.prepareChannel(channel))
    if(roster.channel.kind!=='stage'||roster.community.owner_id!==this.session.account.id||!roster.authority)throw new Error('Only the community owner can change stage speakers.')
    const view=await this.loadGovernance(roster.community.id),structure=await this.client.communityStructure(this.session.token,roster.community.id,this.options)
    const policy=withMediaPermissions(view.governance??{community_id:roster.community.id,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:roster.authority.owner,signature:''},structure.channels.filter(channel=>channel.kind==='stage').map(channel=>channel.id))
    const publication=Permission.speak|Permission.camera|Permission.screen,overrides=[...policy.overrides]
    const index=overrides.findIndex(item=>item.channel_id===channel&&item.kind==='member'&&item.target_id===account)
    const previous=index>=0?overrides.splice(index,1)[0]:{channel_id:channel,kind:'member' as const,target_id:account,allow:0,deny:0}
    overrides.push({...previous,allow:(previous.allow&~publication)|(speaker?publication:0),deny:(previous.deny&~publication)|(speaker?0:publication)})
    await this.saveGovernance(roster.community.id,{...policy,revision:policy.revision+1,overrides})
  }
  saveGovernance(id:string,policy:Governance):Promise<Governance>{return this.enqueue(async()=>{
    await this.synchronize();const authority=await this.prepareCommunity(id)
    const signed=await this.operation<Governance>('sign_governance',{authority,policy});await this.persist()
    const saved=await this.client.setGovernance(this.session.token,id,signed,this.options)
    await this.refresh();return saved
  })}
  acceptRules(id:string,expectedRules:string):Promise<void>{return this.enqueue(async()=>{
    const authority=await this.prepareCommunity(id),view=await this.client.governance(this.session.token,id,this.options)
    await this.operation('pin_governance',{authority,policy:view.governance});await this.persist()
    if(!view.governance?.screening||view.governance.rules!==expectedRules)throw new Error('The rules changed. Read the updated rules before accepting.')
    const digest=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(expectedRules))),b=>b.toString(16).padStart(2,'0')).join('')
    await this.client.acceptRules(this.session.token,id,digest,this.options);await this.refresh()
  })}
  secureCommunity(id:string):Promise<void>{return this.enqueue(async()=>{await this.prepareCommunity(id)})}
  secureJoin(id:string,code:string):Promise<void>{return this.enqueue(async()=>{await this.flush();const authority=await this.prepareCommunity(id);const invitation=await this.client.memberInvitation(this.session.token,id,this.options);if(!invitation)throw new Error('Ask the owner for a signed community invite.');const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==invitation.invite_id)return;const policy=(await this.client.governance(this.session.token,id,this.options)).governance;const rejoining=policy?.sanctions.some(s=>s.account_id===this.session.account.id&&s.kind==='kick'&&s.kick_after!=null&&invitation.issued_at>s.kick_after);await this.operation(rejoining?'rejoin_invitation':'pin_invitation',{authority,code,invitation,policy});await this.persist()})}
  async createInvite(id:string,expires_in_seconds:number,max_uses:number):Promise<CommunityInvite>{
    const structure=await this.client.communityStructure(this.session.token,id,this.options)
    for(const channel of structure.channels)if(!this.view.groups.some(g=>g.id===channel.id))await this.openChannel(channel.id)
    return this.enqueue(async()=>{
      const authority=await this.prepareCommunity(id);await this.refresh()
      const history_from:Record<string,number>={}
      for(const channel of structure.channels){
        if(!this.view.groups.some(g=>g.id===channel.id))throw new Error('Keep an existing owner device online until this device joins every channel.')
        await this.operation('add_channel',{id:channel.id,packages:[],create:false});await this.persist();if(await this.flush())throw new Error('An epoch rotation was rejected. Retry creating the invite.');history_from[channel.id]=this.view.groups.find(g=>g.id===channel.id)!.epoch
      }
      const [code,authorization]=await this.operation<[string,CommunityInvitation]>('sign_invitation',{authority,history_from,issued_at:Date.now()});await this.persist()
      return this.client.createCommunityInvite(this.session.token,id,{code,authorization,expires_in_seconds,max_uses},this.options)
    })
  }
  setHistory(id:string,history:HistoryPolicy):Promise<void>{return this.enqueue(async()=>{await this.flush();const roster=await this.prepareChannel(id);if(roster.community.owner_id!==this.session.account.id || !roster.authority || !roster.policy)throw new Error('Only the community owner can change history.');const policy=await this.operation<ChannelPolicy>('sign_policy',{authority:roster.authority,channel_id:id,kind:roster.channel.kind,history,revision:roster.policy.revision+1});await this.persist();await this.client.channelPolicy(this.session.token,id,policy,this.options);await this.prepareChannel(id);await this.operation('add_channel',{id,packages:[],create:false});await this.persist();await this.flush();await this.refresh()})}
  requestHistory(id:string):Promise<void>{return this.enqueue(async()=>{await this.flush();await this.operation('request_history',id);await this.persist();await this.flush();await this.refresh()})}
  secureChannel(id:string):Promise<void>{return this.enqueue(async()=>{await this.prepareChannel(id)})}
  private async prepareChannel(id:string):Promise<ChannelRoster> {
    let roster=await this.client.channelRoster(this.session.token,id,this.options)
    const root=roster.authority ?? await this.prepareCommunity(roster.community.id)
    if(root.owner.account_id!==roster.community.owner_id || root.community_id!==roster.community.id)throw new Error('The channel owner identity could not be verified.')
    if(!roster.policy) {
      if(root.owner.account_id!==this.session.account.id)throw new Error('This channel needs its owner to prepare encryption.')
      const policy=await this.operation<ChannelPolicy>('sign_policy',{authority:root,channel_id:id,kind:roster.channel.kind,history:'none',revision:1,created_at:Date.now(),history_open_for:[...new Set(roster.invitations.map(i=>i.invitation.invite_id))]});await this.persist()
      await this.client.channelPolicy(this.session.token,id,policy,this.options)
      roster=await this.client.channelRoster(this.session.token,id,this.options)
    }
    if(!roster.authority||!roster.policy)throw new Error('The channel encryption policy is incomplete.')
    const authorization:ChannelAuthorization={authority:roster.authority,policy:roster.policy,admissions:roster.admissions,governance:roster.governance,departures:roster.departures}
    const changed=await this.operation<boolean>('authorize_channel',{id,authorization})
    if(!this.mediaRosters.has(id)&&this.mediaRosters.size>=128)this.mediaRosters.delete(this.mediaRosters.keys().next().value!)
    this.mediaRosters.set(id,roster)
    if(changed)await this.persist()
    return roster
  }
  approveMember(channel:string,account:string,expectedKey:string):Promise<void>{return this.enqueue(async()=>{
    const roster=await this.prepareChannel(channel)
    if(roster.community.owner_id!==this.session.account.id || !roster.authority)throw new Error('Only the community owner can approve a new member.')
    const person=roster.people.find(p=>p.account.id===account)
    if(!person?.devices.length || person.devices.some(d=>d.identity_key!==expectedKey))throw new Error('The member identity changed. Compare fingerprints before trying again.')
    await this.verifyPeers(person.devices.map(enrollment=>({account_id:account,enrollment})))
    const history_from=Object.fromEntries(Object.values(this.state.channels).filter(r=>r.community.id===roster.community.id).map(r=>[r.channel.id,this.state.conversations.find(c=>c.id===r.channel.id)?.epoch ?? 0]))
    const invitation=roster.invitations.find(i=>i.account_id===account)?.invitation
    const grant=await this.operation<CommunityAdmission>('sign_admission',{authority:roster.authority,account_id:account,identity_key:expectedKey,history_from,invitation});await this.persist()
    await this.client.communityAdmission(this.session.token,roster.community.id,grant,this.options)
    await this.refresh()
  })}
  async openChannel(id:string):Promise<string> {
    return this.enqueue(async()=>{
      await this.synchronize()
      const roster=await this.prepareChannel(id)
      if(roster.channel.id!==id || !roster.people.some(p=>p.account.id===this.session.account.id))throw new Error('The channel roster could not be verified.')
      const peers=roster.people.flatMap(p=>p.devices.map(enrollment=>({account_id:p.account.id,enrollment})))
      for(let offset=0;offset<peers.length;offset+=128)await this.verifyPeers(peers.slice(offset,offset+128))
      // A Welcome may arrive before the directory refresh adds this new channel.
      // Check current routing and the crypto store before attempting group creation.
      const conversations=await this.client.conversations(this.session.token,this.options)
      if(!conversations.some(c=>c.id===id) && !this.view.groups.some(g=>g.id===id) && admitted(roster,roster.people.find(p=>p.account.id===this.session.account.id)!)) {
        const packages:KeyPackageRecord[]=[]
        for(const person of roster.people.filter(p=>admitted(roster,p)))for(const proof of person.devices) {
          if(packages.length>=8)break
          if(proof.device_key===this.device.device_key)continue
          if(packages.length>=127)throw new Error('This channel has reached its device limit.')
          try {const claimed=await this.client.claimPackages(this.session.token,[proof.device_key],this.options);this.verifyClaim(claimed,person.account.id,proof);packages.push(...claimed)}
          catch(error){if(!(error instanceof HearthError) || ![404,409].includes(error.status))throw error}
        }
        await this.operation('add_channel',{id,packages,create:true});await this.persist();await this.flush()
      }
      await this.refresh()
      return id
    })
  }
  async create(usernames:string[]):Promise<string> {
    return this.enqueue(async()=>{
      const people=await Promise.all([...new Set([this.session.account.username,...usernames])].map(username=>this.client.person(this.session.token,username,this.options)))
      if(people.length<2 || people.length>10)throw new Error('Choose one to nine other people for this conversation.')
      const peers=people.flatMap(person=>person.devices.map(enrollment=>({account_id:person.account.id,enrollment})))
      try {for(let offset=0;offset<peers.length;offset+=128)await this.verifyPeers(peers.slice(offset,offset+128))}
      catch {throw new Error('A recipient’s identity changed or could not be verified. Saved fingerprints were preserved. Compare identities using a trusted channel before trying again.')}
      const audience=people.map(person=>person.account.id).sort().join(':')
      const existing=this.state.conversations.find(conversation=>!conversation.channel_id && [...conversation.accounts].sort().join(':')===audience)
      if(existing)return existing.id
      const packages:KeyPackageRecord[]=[]
      for(const person of people){
        for(const proof of person.devices){
          if(proof.device_key===this.device.device_key)continue
          try {
            const claimed=await this.client.claimPackages(this.session.token,[proof.device_key],this.options)
            this.verifyClaim(claimed,person.account.id,proof);packages.push(...claimed)
          }catch(error){if(!(error instanceof HearthError) || error.status!==409)throw error}
        }
        if(person.account.id!==this.session.account.id && !packages.some(p=>p.member.account_id===person.account.id))throw new Error(`${person.account.username} needs to sign in and prepare an encrypted device first.`)
      }
      const bytes=new Uint8Array(32);globalThis.crypto.getRandomValues(bytes);const id=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')
      await this.operation('add',{id,packages,create:true});await this.persist();await this.flush();await this.refresh()
      return id
    })
  }
  async send(id:string,content:MessageContent):Promise<'sent'|'queued'> {
    return this.enqueue(async()=>{
      await this.flush()
      if(content.kind==='call')currentRoomKeyContext(content.signal,this.view.groups.find(group=>group.id===id),this.mediaRosters.get(id),this.device.device_key,Date.now(),this.view.governance_epochs[id]??0)
      await this.operation('send',{id,content});await this.persist()
      try {
        if(await this.flush())throw new Error('The message was rejected after an encryption or permission update. Retry after updates arrive.')
        this.publish({error:''});return 'sent' as const
      }catch(error){
        if(error instanceof HearthError && [0,429,503].includes(error.status) && !this.closed){this.publish({error:'Saved in your encrypted outbox. Delivery will retry when the connection returns.'});return 'queued' as const}
        throw error
      }
    })
  }
  deleteAccount():Promise<void>{return this.enqueue(async()=>{await this.flush();const proof=await this.operation<import('@hearth/sdk').AccountDeparture>('sign_departure');await this.persist();await this.client.deleteAccount(this.session.token,proof,this.options);this.close()})}
  reportKeys(id:string):Promise<ReportKey[]>{return this.enqueue(async()=>{await this.prepareChannel(id);return this.client.reportKeys(this.session.token,id,this.options)})}
  reportPreview(id:string,selected:string[],reason:string):Promise<ReportEvidence>{return this.enqueue(()=>this.operation('report_preview',{id,selected,reason}))}
  submitReport(id:string,selected:string[],reason:string,key:ReportKey):Promise<void>{return this.enqueue(async()=>{await this.prepareChannel(id);const envelope=await this.operation<ReportEnvelope>('prepare_report',{id,selected,reason,key});await this.client.submitReport(this.session.token,id,envelope,this.options)})}
  reportQueue(id:string):Promise<ReportReview[]>{return this.enqueue(async()=>{const roster=await this.prepareChannel(id),key=await this.operation<ReportKey>('report_key',roster.community.id);await this.client.registerReportKey(this.session.token,id,key,this.options);const reports=await this.client.reportQueue(this.session.token,id,this.options);return Promise.all(reports.map(async report=>{try{return {...report,evidence:await this.operation<ReportEvidence>('open_report',report.envelope)}}catch{return {...report,error:'This report could not be verified on this device. It may belong to another approved device.'}}}))})}
  resolveReport(id:string,report:string):Promise<void>{return this.enqueue(async()=>{await this.client.resolveReport(this.session.token,id,report,this.options)})}
  search(query:string,conversation:string|null):Promise<LocalMessage[]>{return this.enqueue(()=>this.operation<LocalMessage[]>('search',{query,conversation}))}
  async removeAttachment(id:string,file:LocalAttachment){
    if(!this.session.account.owner)throw new Error('Only the server owner can remove hosted files.')
    // Remove previews as well; each opaque removal is independently retryable.
    for(const part of [...(file.thumbnail?[file.thumbnail]:[]),file]) {
      try { await this.client.removeBlob(this.session.token,id,part.id,this.device.device_key,this.options) }
      catch(error) { if(!(error instanceof HearthError)||![404,410].includes(error.status))throw error }
    }
  }
  async sendAttachment(id:string,file:File,text:string,emoji?:string,signal?:AbortSignal){
    if(!file.size||file.size>MAX_FILE)throw new Error('Choose a file between 1 byte and 50 MB.')
    const uploadSignal=signal?AbortSignal.any([this.controller.signal,signal]):this.controller.signal
    uploadSignal.throwIfAborted()
    if(new TextEncoder().encode(file.name).length>160||/[\u0000-\u001f/\\]/.test(file.name))throw new Error('Rename this file using no more than 160 bytes and no control characters.')
    if(emoji&&!/^[a-z0-9_]{1,32}$/.test(emoji))throw new Error('Use a custom emoji name of 1–32 lowercase letters, numbers or underscores.')
    const preview=await thumbnail(file)
    if(emoji&&!preview)throw new Error('Custom emoji must be a PNG, JPEG or WebP image.')
    return this.enqueue(async()=>{
      const prepare=async(blob:Blob,name:string,mime:string)=>{
        uploadSignal.throwIfAborted()
        const result=await this.operation<{file:LocalAttachment;ciphertext:string}>('prepare_file',{id,name,mime,plaintext:hex(new Uint8Array(await blob.arrayBuffer()))})
        await this.persist()
        uploadSignal.throwIfAborted()
        const reserved=await this.client.reserveBlob(this.session.token,id,{id:result.file.id,device_key:this.device.device_key,cipher_bytes:result.file.cipher_bytes,digest:result.file.digest},{signal:uploadSignal})
        this.checkBlobUrl(reserved.url,id,result.file.id)
        const encrypted=unhex(result.ciphertext)
        const response=await fetch(reserved.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:new Blob([encrypted as BlobPart]),credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.any([uploadSignal,AbortSignal.timeout(300000)])})
        if(!response.ok)throw new Error('Encrypted file upload failed. Try again.')
        await this.client.completeBlob(this.session.token,id,result.file.id,this.device.device_key,{signal:uploadSignal})
        await cacheFile(`${this.scope}:${id}:${result.file.id}`,encrypted).catch(()=>{})
        return result.file.id
      }
      const asset=await prepare(emoji?preview!:file,emoji?`${emoji}.png`:file.name,emoji?'image/png':file.type)
      const thumb=!emoji&&preview?await prepare(preview,'preview.png','image/png'):null
      await this.synchronize()
      uploadSignal.throwIfAborted()
      await this.operation('send_file',{id,file:asset,thumbnail:thumb,text,emoji:emoji??null});await this.persist()
      if(await this.flush())throw new Error('Encryption changed during upload. Retry when channel updates arrive.')
      this.publish({error:''})
    })
  }
  private checkBlobUrl(value:string,id:string,file:string){if(new URL(value).pathname!==`/hearth-blobs/${id}/${file}`)throw new Error('The encrypted file URL does not match this attachment.')}
  async downloadAttachment(id:string,file:LocalAttachment):Promise<Blob>{
    const scope=`${this.scope}:${id}:${file.id}`
    let encrypted=await cachedFile(scope).catch(()=>null)
    if(!encrypted){
      const result=await this.client.downloadBlob(this.session.token,id,file.id,this.device.device_key,this.options);this.checkBlobUrl(result.url,id,file.id)
      const response=await fetch(result.url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(300000)])})
      if(!response.ok||Number(response.headers.get('content-length'))!==file.cipher_bytes)throw new Error('Encrypted file download failed or its size changed.')
      const reader=response.body?.getReader();if(!reader)throw new Error('Encrypted download has no body.')
      const chunks:Uint8Array[]=[];let count=0
      try{for(;;){const result=await reader.read();if(result.done)break;count+=result.value.length;if(count>file.cipher_bytes)throw new Error('Encrypted file exceeds its declared size.');chunks.push(result.value)}}finally{await reader.cancel()}
      if(count!==file.cipher_bytes)throw new Error('Encrypted file was truncated.')
      encrypted=new Uint8Array(count);let offset=0;for(const chunk of chunks){encrypted.set(chunk,offset);offset+=chunk.length}
    }
    const ciphertext=encrypted
    const plaintext=await this.enqueue(()=>this.operation<string>('open_file',{id,file:file.id,ciphertext:hex(ciphertext)}))
    await cacheFile(scope,ciphertext).catch(()=>{})
    return new Blob([unhex(plaintext) as BlobPart],{type:file.mime})
  }
  async updateProfile(display_name:string,bio:string){for(const group of this.view.groups)await this.send(group.id,{kind:'profile',display_name,bio})}
  async setPresence(state:'online'|'idle'|'offline'){for(const group of this.view.groups)await this.send(group.id,{kind:'presence',state,until:Date.now()+90000})}
  typing(id:string,active:boolean){
    if(Date.now()-this.lastTyping<2000 || this.closed || !this.initialized)return
    this.lastTyping=Date.now();void this.send(id,{kind:'typing',active}).catch(error=>this.report(error))
  }
  private openGateway(){
    if(this.closed)return
    const socket=new WebSocket(this.client.baseUrl.replace(/^http/,'ws')+'/gateway');this.socket=socket
    this.publish({connection:'Connecting…'})
    socket.onmessage=event=>{
      let input:{op:string;d?:Record<string,unknown>}
      try{input=JSON.parse(String(event.data))}catch{this.report(new Error('Invalid gateway frame.'));socket.close();return}
      if(this.socket!==socket)return
      if(input.op==='event'){
        const delivery=input.d?.event
        if(!validateDeliveryEvent(delivery)||input.d?.seq!==delivery.seq||this.deliveryInbox.length>=128){this.report(new Error('Invalid or overloaded encrypted gateway delivery.'));socket.close();return}
        this.deliveryInbox.push(delivery);this.drainDelivery(socket);return
      }
      // Gateway control never mutates MLS state. Do not queue its challenge,
      // resume or liveness acknowledgements behind durable delivery/network
      // work: the server's short authentication deadline still applies.
      // The signing RPC is read-only and the resume cursor is the last view
      // published after a successful durable save, not an in-flight engine cursor.
      void (async()=>{
      if(this.socket!==socket)return
      const frame=input
      if(frame.op==='hello'){
        if(frame.d?.protocol!==PROTOCOL_VERSION)throw new Error('The gateway protocol changed. Update Hearth.')
      }else if(frame.op==='challenge'){
        if(typeof frame.d?.challenge!=='string')throw new Error('Invalid gateway challenge.')
        const signature=await this.operation<string>('gateway',{token:this.session.token,challenge:frame.d.challenge})
        if(this.closed||this.socket!==socket)return
        socket.send(JSON.stringify({op:'identify',d:{protocol:PROTOCOL_VERSION,token:this.session.token,device_key:this.device.device_key,signature}}))
      }else if(frame.op==='ready'){
        if(typeof frame.d?.session_id!=='string')throw new Error('Invalid gateway session.')
        socket.send(JSON.stringify({op:'resume',d:{session_id:frame.d.session_id,last_seq:this.view.last_seq}}))
        this.heartbeatAt=Date.now();this.publish({connection:'Connected'})
        this.heartbeat=setInterval(()=>{if(this.socket!==socket || this.closed)return;if(Date.now()-this.heartbeatAt>65000){socket.close();return}socket.send(JSON.stringify({op:'heartbeat',d:{last_seq:this.view.last_seq}}));this.publish()},30000)
      }else if(frame.op==='heartbeat_ack')this.heartbeatAt=Date.now()
      else if(frame.op==='invalid_session')throw new Error('The gateway session was rejected. Sign in again if reconnecting does not help.')
    })().catch(error=>{if(this.socket===socket)this.report(error);socket.close()})}
    socket.onclose=()=>{
      if(this.socket!==socket)return
      this.socket=null;this.deliveryInbox=[];clearInterval(this.heartbeat)
      if(this.closed)return
      this.publish({connection:'Disconnected · retrying'})
      this.reconnect=setTimeout(()=>{void this.enqueue(async()=>{await this.synchronize();this.openGateway()}).catch(error=>{this.report(error);this.scheduleReconnect()})},2000)
    }
    socket.onerror=()=>socket.close()
  }
  private scheduleReconnect(){
    if(this.closed || this.socket)return
    this.reconnect=setTimeout(()=>{void this.enqueue(async()=>{await this.synchronize();this.openGateway()}).catch(error=>{this.report(error);this.scheduleReconnect()})},5000)
  }
  private report(error:unknown){if(!this.closed)this.publish({error:error instanceof Error?error.message:'Encrypted delivery failed. Retry or sign in again.'})}
  close(){this.closed=true;this.lockCalls();this.controller.abort();clearInterval(this.heartbeat);clearInterval(this.maintenance);clearTimeout(this.reconnect);const socket=this.socket;this.socket=null;this.deliveryInbox=[];socket?.close()}
}
