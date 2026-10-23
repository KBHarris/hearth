import type {CallSignal,Conversation} from '@hearth/sdk'

const identifier=/^[a-f0-9]{64}$/
const publicKey=/^04[a-f0-9]{128}$/
const hex=(bytes:Uint8Array)=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')
const bytes=(value:string)=>new Uint8Array(value.match(/../g)!.map(byte=>parseInt(byte,16)))
export type GroupContext=Readonly<{
  server:string;conversation:string;id:string;epoch:number;host:string
  participants:readonly string[];relayOnly:boolean;voiceRoom?:string;sfu?:true
}>
export interface GroupKeyState {
  readonly context:GroupContext;readonly own:string;readonly generation:number;readonly canPublish:boolean;readonly stopped:boolean
  transcript:()=>string[][];checkTime:(now?:number)=>void;end:(reason:string)=>void
}
type GroupKind='group-invite'|'group-join'|'group-decline'|'group-leave'|'group-ready'|'group-key'|'group-start'|'group-heartbeat'

function checked(context:GroupContext):GroupContext {
  const selected=[...context.participants]
  if(![context.server,context.conversation,context.id,context.host,...selected].every(value=>identifier.test(value))||
    (context.voiceRoom?(!identifier.test(context.voiceRoom)||selected.length<1||selected.length>(context.sfu?25:4)):selected.length!==3)||selected.some((value,index)=>index>0&&selected[index-1]>=value)||!selected.includes(context.host)||
    !Number.isSafeInteger(context.epoch)||context.epoch<0||typeof context.relayOnly!=='boolean')throw new Error('Invalid group call context')
  return Object.freeze({...context,participants:Object.freeze(selected)})
}

/** The conversation must already have passed device-certificate and live access checks. */
export function groupContext(server:string,conversation:Conversation,id:string,host:string,selected:readonly string[],relayOnly=false):GroupContext {
  const accounts=new Set(conversation.accounts),participants=[...selected].sort()
  if(conversation.channel_id||accounts.size!==3||conversation.accounts.length!==3)throw new Error('Group voice requires a private conversation with exactly three people.')
  const chosen=participants.map(device=>conversation.members.find(member=>member.enrollment.device_key===device)?.account_id)
  if(chosen.some(account=>!account||!accounts.has(account))||new Set(chosen).size!==3)throw new Error('Choose one approved device for each person.')
  return checked({server,conversation:conversation.id,id,host,participants,epoch:conversation.epoch,relayOnly})
}

const binding=(context:GroupContext)=>JSON.stringify([
  'hearth/v1/group-call',context.server,context.conversation,context.id,context.epoch,
  context.host,context.participants,context.relayOnly,...(context.voiceRoom?[context.voiceRoom]:[]),...(context.sfu?['sfu']:[]),
])

/** Pure admission state. It never acquires capture, creates WebRTC or sends messages.
 * receive() accepts only events already authenticated by the MLS engine. The caller
 * must send every returned control through that same encrypted messaging session.
 */
export class GroupAdmission {
  readonly context:GroupContext
  readonly own:string
  private keys=new Map<string,string>()
  private joined=new Set<string>()
  private consented=false
  private ready=false
  private started=false
  private ended=false
  private created:number
  private peers=new Map<string,number>()
  private revision=0
  reason=''
  constructor(context:GroupContext,own:string,now=Date.now()){
    this.context=checked(context);this.own=own;this.created=now
    if(!context.participants.includes(own))throw new Error('This device is not invited.')
  }
  get generation(){return this.revision}
  get stopped(){return this.ended}
  // Consent barrier only: callers must also finish key derivation and await
  // encoded-transform readiness before acquiring/publishing any capture.
  get canPublish(){return !this.ended&&this.consented&&this.ready&&this.started&&this.keys.size===3}
  private others(){return this.context.participants.filter(device=>device!==this.own)}
  private control(to:string,kind:GroupKind,description:string|null,now:number):CallSignal {
    return {call_id:this.context.id,group_id:this.context.id,participants:[...this.context.participants],epoch:this.context.epoch,
      from_device:this.own,to_device:to,kind,description,relay_only:this.context.relayOnly,expires_at:now+60_000}
  }
  private broadcast(kind:GroupKind,description:string|null,now:number){return this.others().map(to=>this.control(to,kind,description,now))}
  private consent(key:string,now:number){
    if(this.ended||this.consented||now-this.created>=60_000||!publicKey.test(key))throw new Error('This invitation cannot be answered.')
    this.consented=true;this.keys.set(this.own,key);this.joined.add(this.own)
    for(const device of this.others())this.peers.set(device,now)
  }
  invite(key:string,now=Date.now()){
    if(this.own!==this.context.host)throw new Error('Only the caller can invite participants.')
    this.consent(key,now);return this.broadcast('group-invite',null,now)
  }
  answer(key:string,now=Date.now()){
    if(this.own===this.context.host)throw new Error('The caller must start the invitation.')
    this.consent(key,now);return [this.control(this.context.host,'group-join',null,now)]
  }
  private advance(now:number):CallSignal[] {
    if(this.own===this.context.host&&this.ready&&this.keys.size===3&&!this.started){
      this.started=true;return this.broadcast('group-start',null,now)
    }
    return []
  }
  receive(signal:CallSignal,now=Date.now()):CallSignal[] {
    this.checkTime(now)
    const c=this.context
    if(this.ended||signal.call_id!==c.id||signal.group_id!==c.id||signal.epoch!==c.epoch||signal.relay_only!==c.relayOnly||
      signal.to_device!==this.own||signal.from_device===this.own||!c.participants.includes(signal.from_device)||
      JSON.stringify(signal.participants)!==JSON.stringify(c.participants)||!Number.isSafeInteger(signal.expires_at)||
      signal.expires_at<=now||signal.expires_at>now+65_000)return []
    const from=signal.from_device
    if(signal.kind==='group-decline'||signal.kind==='group-leave'){
      if(signal.description===null)this.end(signal.kind==='group-decline'?'A participant declined.':'A participant left.')
      return []
    }
    if(!this.consented)return []
    // Public keys are accepted only directly from their authenticated device.
    // Even a dishonest host cannot substitute another participant's contribution.
    if(signal.kind==='group-key'){
      if(!signal.description||!publicKey.test(signal.description))return []
      const pinned=this.keys.get(from)
      if(pinned&&pinned!==signal.description){this.end('A participant changed their call key.');return []}
      this.keys.set(from,signal.description);this.peers.set(from,now);return this.advance(now)
    }
    if(signal.description!==null)return []
    if(signal.kind==='group-join'&&this.own===c.host){
      this.joined.add(from);this.peers.set(from,now)
      if(this.joined.size===3&&!this.ready){
        this.ready=true
        return [...this.broadcast('group-ready',null,now),...this.broadcast('group-key',this.keys.get(this.own)!,now),...this.advance(now)]
      }
    }else if(signal.kind==='group-ready'&&from===c.host&&!this.ready){
      this.ready=true;this.peers.set(from,now)
      return [...this.broadcast('group-key',this.keys.get(this.own)!,now),...this.advance(now)]
    }else if(signal.kind==='group-start'&&from===c.host){
      this.started=true;this.peers.set(from,now)
    }else if(signal.kind==='group-heartbeat')this.peers.set(from,now)
    return []
  }
  heartbeat(now=Date.now()){
    this.checkTime(now)
    return this.consented&&!this.ended?this.broadcast('group-heartbeat',null,now):[]
  }
  checkTime(now=Date.now()){
    if(this.ended)return
    if(now-this.created>=50*60_000||!this.canPublish&&now-this.created>=60_000)this.end('Group call timed out.')
    else if(this.canPublish&&this.others().some(device=>now-(this.peers.get(device)??this.created)>=30_000))this.end('A participant stopped responding.')
  }
  stop(now=Date.now()){
    if(this.ended)return []
    const controls=this.broadcast(this.consented?'group-leave':'group-decline',null,now)
    this.end('Group call ended.');return controls
  }
  end(reason:string){this.ended=true;this.reason=reason;this.revision++;this.keys.clear();this.joined.clear();this.peers.clear();this.consented=false;this.ready=false;this.started=false}
  /** Public transcript only. Secret key material is never part of this state. */
  transcript(){
    if(!this.canPublish)throw new Error('Every participant must answer before media keys become available.')
    return this.context.participants.map(device=>[device,this.keys.get(device)!])
  }
}

/** Fresh, nonextractable per-device ECDH key. MLS membership alone does not grant
 * a call key: each admitted pair also needs its ephemeral private contribution.
 * Dispose this object and stop capture on leave, access loss or any MLS change.
 */
export class GroupKeyAgreement {
  readonly publicKey:string
  private secret:CryptoKey|null
  private context:GroupContext
  private own:string
  private constructor(context:GroupContext,own:string,secret:CryptoKey,key:string){this.context=context;this.own=own;this.secret=secret;this.publicKey=key}
  static async create(context:GroupContext,own:string){
    const stable=checked(context)
    if(!stable.participants.includes(own))throw new Error('This device is not invited.')
    const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])
    return new GroupKeyAgreement(stable,own,pair.privateKey,hex(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey))))
  }
  /** Keep the current room contribution across occupancy changes, with separate
   * disposable wrappers for each mesh. Never rebind a private call or room epoch. */
  forkForRoom(context:GroupContext){
    const next=checked(context)
    if(!this.secret||!next.voiceRoom||next.voiceRoom!==this.context.voiceRoom||next.sfu!==this.context.sfu||next.server!==this.context.server||next.conversation!==this.context.conversation||next.epoch!==this.context.epoch||!next.participants.includes(this.own))throw new Error('Voice room encryption changed')
    return new GroupKeyAgreement(next,this.own,this.secret,this.publicKey)
  }
  async derive(admission:GroupKeyState,peer:string,mlsBase:string):Promise<Uint8Array<ArrayBuffer>> {
    const secret=this.secret,generation=admission.generation
    if(!secret||!identifier.test(mlsBase)||admission.own!==this.own||binding(admission.context)!==binding(this.context)||peer===this.own||!this.context.participants.includes(peer))throw new Error('Invalid group media key request')
    const transcript=admission.transcript()
    if(transcript.find(([device])=>device===this.own)?.[1]!==this.publicKey)throw new Error('Local call key does not match consent')
    if(!publicKey.test(transcript.find(([device])=>device===peer)?.[1]??''))throw new Error('The peer has not joined this call')
    const current=()=>{admission.checkTime();if(this.secret!==secret||!admission.canPublish||admission.generation!==generation)throw new Error('Group call ended during key agreement')}
    let shared:Uint8Array<ArrayBuffer>|undefined,output:Uint8Array<ArrayBuffer>|undefined
    const salt=bytes(mlsBase)
    try{
      const imported=await crypto.subtle.importKey('raw',bytes(transcript.find(([device])=>device===peer)![1]),{name:'ECDH',namedCurve:'P-256'},false,[])
      current()
      shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:imported},secret,256));current()
      const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveBits']);current()
      // Hash the full canonical transcript so the HKDF info field is fixed-size
      // across browser/Node WebCrypto implementations, including Node's 1 KiB cap.
      const info=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['hearth/v1/group-call/media',binding(this.context),[this.own,peer].sort(),transcript])))
      current()
      output=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},material,256));current()
      const result=output;output=undefined;return result
    }catch(error){
      // A normal membership change cancels an obsolete derivation without
      // destroying the private contribution needed by the continuing call.
      if(admission.generation===generation){admission.end('Group key agreement failed.');this.close()}
      else if(admission.stopped)this.close()
      throw error
    }
    finally{shared?.fill(0);salt.fill(0);output?.fill(0)}
  }
  close(){this.secret=null}
}
