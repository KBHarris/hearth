import {HearthClient,HearthError,PROTOCOL_VERSION,validateDeliveryEvent,type Session,type DeviceEnrollment,type Conversation,type LocalMessage,type KeyPackageRecord,type CommitUpload,type MessageUpload,type MessageContent,type Person,type DeliveryEvent,type ChannelRoster} from '@hearth/sdk'
import {AuthCrypto} from './client'
import {messageScope,readMessages,writeMessages} from './message-store'
import {storageDeadline} from './vault-store'

type Pending={kind:'commit';conversation_id:string;upload:CommitUpload}|{kind:'message';conversation_id:string;upload:MessageUpload}
type EngineView={last_seq:number;messages:LocalMessage[];groups:Conversation[];pending:Pending[];pending_packages:KeyPackageRecord[]}
export type ChatState={conversations:Conversation[];channels:Record<string,ChannelRoster>;joined:string[];messages:LocalMessage[];people:Record<string,Person>;typing:Record<string,{account:string;until:number}[]>;pending:number;connection:string;error:string;fatal:boolean}
const initialView:EngineView={last_seq:0,messages:[],groups:[],pending:[],pending_packages:[]}
export const initialChat:ChatState={conversations:[],channels:{},joined:[],messages:[],people:{},typing:{},pending:0,connection:'Opening encrypted storage…',error:'',fatal:false}

/** One serialized stream owns the in-memory ratchets; CAS detects competing tabs/processes. */
export class MessagingSession {
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
  private socket:WebSocket|null=null
  private heartbeat:ReturnType<typeof setInterval>|undefined
  private maintenance:ReturnType<typeof setInterval>|undefined
  private reconnect:ReturnType<typeof setTimeout>|undefined
  private heartbeatAt=0
  private initialized=false
  private lastTyping=0
  private closed=false
  private refreshing=false
  constructor(crypto:AuthCrypto,session:Session,device:DeviceEnrollment,server:string,url:string,changed:(state:ChatState)=>void) {
    this.crypto=crypto;this.session=session;this.device=device;this.changed=changed
    this.client=new HearthClient(url);this.scope=messageScope(session.account.id,server,device.device_key)
    this.server=server
  }
  private server:string
  private get options(){return {signal:this.controller.signal}}
  private enqueue<T>(action:()=>Promise<T>):Promise<T> {
    const result=this.tail.then(()=>{if(this.closed)throw new Error('Messaging is locked. Sign in again.');return action()})
    this.tail=result.catch(()=>{})
    return result
  }
  private publish(patch:Partial<ChatState>={}) {
    if(this.closed && !patch.fatal)return
    const now=Date.now()
    const typing=Object.fromEntries(Object.entries(this.state.typing).map(([id,peers])=>[id,peers.filter(peer=>peer.until>now)]))
    this.state={...this.state,typing,...patch,messages:this.view.messages,joined:this.view.groups.map(g=>g.id),pending:this.view.pending.length+this.view.pending_packages.length}
    this.changed(this.state)
  }
  private async inspect() {this.view=JSON.parse(await this.crypto.message('view')) as EngineView}
  private async persist() {
    const sealed=await this.crypto.message('seal')
    try {
      const saved=await storageDeadline(writeMessages(this.scope,this.revision,sealed),this.controller.signal)
      if(this.closed)throw new Error('Messaging is locked.')
      this.revision=saved.revision
      await this.inspect()
    }catch(error){
      this.close();this.publish({fatal:true,connection:'Encrypted storage needs attention',error:error instanceof Error?error.message:'Encrypted storage could not be saved. Sign in again.'});throw error
    }
  }
  private async operation<T>(name:string,input:unknown=''):Promise<T> {return JSON.parse(await this.crypto.message(name,input)) as T}
  async start() {
    return this.enqueue(async()=>{
      const saved=await storageDeadline(readMessages(this.scope),this.controller.signal)
      if(this.closed)return
      this.revision=saved?.revision ?? 0
      await this.crypto.openMessages(saved?.envelope,this.session.account.id,this.server)
      await this.inspect()
      if(!saved)await this.persist()
      this.initialized=true
      await this.synchronize()
      await this.refresh()
      this.openGateway()
      this.maintenance=setInterval(()=>{if(this.closed || this.refreshing)return;this.refreshing=true;void this.enqueue(()=>this.refresh()).catch(error=>this.report(error)).finally(()=>{this.refreshing=false})},15000)
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
          await this.operation('reject',pending.upload.operation_id);await this.persist()
          this.publish({error:'Encryption or permissions changed. The queued operation was rejected; retry after updates arrive.'})
          rejected=true
        }else throw error
      }
    }
    return rejected
  }
  private async receive(event:DeliveryEvent) {
    // HTTP backlog and a live gateway can overlap. Previously persisted deliveries
    // are safe to acknowledge, but must never advance an MLS ratchet twice.
    if(event.seq<=this.view.last_seq)return
    const typing=await this.operation<[string,boolean]|null>('receive',event)
    await this.persist()
    if(typing){
      const peers=this.state.typing[event.conversation_id]?.filter(peer=>peer.account!==typing[0]) ?? []
      if(typing[1])peers.push({account:typing[0],until:Date.now()+8000})
      this.state={...this.state,typing:{...this.state.typing,[event.conversation_id]:peers}}
    }
    this.publish()
  }
  private async synchronize() {
    await this.flush()
    for(;;){
      const backlog=await this.client.events(this.session.token,this.device.device_key,this.view.last_seq,this.options)
      for(const event of backlog)await this.receive(event)
      if(backlog.length<128)break
    }
  }
  private async refresh() {
    // Drain the preceding epoch before adding a device. A commit must not discard
    // application secrets for messages still waiting in the ordered backlog.
    await this.synchronize()
    const conversations=await this.client.conversations(this.session.token,this.options)
    const ids=new Set(conversations.filter(conversation=>!conversation.channel_id).flatMap(conversation=>conversation.accounts))
    const people={...this.state.people}
    for(const id of ids)people[id]=await this.client.personById(this.session.token,id,this.options)
    const channels:Record<string,ChannelRoster>={}
    for(const conversation of conversations.filter(c=>c.channel_id)) {
      const roster=await this.client.channelRoster(this.session.token,conversation.id,this.options)
      if(roster.channel.id!==conversation.id || !roster.people.some(p=>p.account.id===this.session.account.id))throw new Error('The channel roster could not be verified.')
      channels[conversation.id]=roster
      for(const person of roster.people)people[person.account.id]=person
    }
    const peers=Object.values(people).flatMap(person=>person.devices.map(enrollment=>({account_id:person.account.id,enrollment})))
    try {for(let offset=0;offset<peers.length;offset+=128)await this.operation('verify_peers',peers.slice(offset,offset+128))}
    catch {throw new Error('A participant’s identity changed or could not be verified. Saved fingerprints were preserved. Compare identities using a trusted channel before adding devices.')}
    await this.persist()
    this.publish({conversations,people,channels})
    const count=await this.client.packageCount(this.session.token,this.device.device_key,this.options)
    if(count.available===0 && this.view.pending_packages.length===0){
      await this.operation('package');await this.persist();await this.flush()
    }
    // Any current member may add an approved new device of an existing DM participant.
    for(const conversation of conversations){
      const local=this.view.groups.find(group=>group.id===conversation.id)
      if(!local || local.epoch!==conversation.epoch || this.view.pending.some(p=>p.conversation_id===conversation.id))continue
      const known=new Set(local.members.map(member=>member.enrollment.device_key))
      const packages:KeyPackageRecord[]=[]
      const audience=conversation.channel_id?channels[conversation.id].people.map(p=>p.account.id):conversation.accounts
      for(const account of audience){
        for(const proof of people[account]?.devices ?? []) {
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
    this.publish()
  }
  private verifyClaim(packages:KeyPackageRecord[],account:string,proof:DeviceEnrollment){
    if(packages.length!==1 || packages[0].member.account_id!==account || Object.keys(proof).some(key=>packages[0].member.enrollment[key as keyof DeviceEnrollment]!==proof[key as keyof DeviceEnrollment]))throw new Error('A recipient device changed. Compare fingerprints before trying again.')
  }
  async openChannel(id:string):Promise<string> {
    return this.enqueue(async()=>{
      await this.refresh()
      const roster=await this.client.channelRoster(this.session.token,id,this.options)
      if(roster.channel.id!==id || !roster.people.some(p=>p.account.id===this.session.account.id))throw new Error('The channel roster could not be verified.')
      const peers=roster.people.flatMap(p=>p.devices.map(enrollment=>({account_id:p.account.id,enrollment})))
      for(let offset=0;offset<peers.length;offset+=128)await this.operation('verify_peers',peers.slice(offset,offset+128))
      await this.persist()
      if(!this.state.conversations.some(c=>c.id===id)) {
        const packages:KeyPackageRecord[]=[]
        for(const person of roster.people)for(const proof of person.devices) {
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
      try {for(let offset=0;offset<peers.length;offset+=128)await this.operation('verify_peers',peers.slice(offset,offset+128))}
      catch {throw new Error('A recipient’s identity changed or could not be verified. Saved fingerprints were preserved. Compare identities using a trusted channel before trying again.')}
      await this.persist()
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
  typing(id:string,active:boolean){
    if(Date.now()-this.lastTyping<2000 || this.closed || !this.initialized)return
    this.lastTyping=Date.now();void this.send(id,{kind:'typing',active}).catch(error=>this.report(error))
  }
  private openGateway(){
    if(this.closed)return
    const socket=new WebSocket(this.client.baseUrl.replace(/^http/,'ws')+'/gateway');this.socket=socket
    this.publish({connection:'Connecting…'})
    socket.onmessage=event=>{void this.enqueue(async()=>{
      if(this.socket!==socket)return
      const frame=JSON.parse(String(event.data)) as {op:string;d?:Record<string,unknown>}
      if(frame.op==='hello'){
        if(frame.d?.protocol!==PROTOCOL_VERSION)throw new Error('The gateway protocol changed. Update Hearth.')
      }else if(frame.op==='challenge'){
        if(typeof frame.d?.challenge!=='string')throw new Error('Invalid gateway challenge.')
        const signature=await this.operation<string>('gateway',{token:this.session.token,challenge:frame.d.challenge})
        socket.send(JSON.stringify({op:'identify',d:{protocol:PROTOCOL_VERSION,token:this.session.token,device_key:this.device.device_key,signature}}))
      }else if(frame.op==='ready'){
        if(typeof frame.d?.session_id!=='string')throw new Error('Invalid gateway session.')
        socket.send(JSON.stringify({op:'resume',d:{session_id:frame.d.session_id,last_seq:this.view.last_seq}}))
        this.heartbeatAt=Date.now();this.publish({connection:'Connected'})
        this.heartbeat=setInterval(()=>{if(this.socket!==socket || this.closed)return;if(Date.now()-this.heartbeatAt>65000){socket.close();return}socket.send(JSON.stringify({op:'heartbeat',d:{last_seq:this.view.last_seq}}));this.publish()},30000)
      }else if(frame.op==='heartbeat_ack')this.heartbeatAt=Date.now()
      else if(frame.op==='event'){
        const event=frame.d?.event
        if(!validateDeliveryEvent(event) || frame.d?.seq!==event.seq)throw new Error('Invalid encrypted gateway event.')
        await this.receive(event)
        if(this.socket===socket && !this.closed)socket.send(JSON.stringify({op:'ack',d:{last_seq:this.view.last_seq}}))
      }else if(frame.op==='invalid_session')throw new Error('The gateway session was rejected. Sign in again if reconnecting does not help.')
    }).catch(error=>{this.report(error);socket.close()})}
    socket.onclose=()=>{
      if(this.socket!==socket)return
      this.socket=null;clearInterval(this.heartbeat)
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
  close(){this.closed=true;this.controller.abort();clearInterval(this.heartbeat);clearInterval(this.maintenance);clearTimeout(this.reconnect);const socket=this.socket;this.socket=null;socket?.close()}
}
