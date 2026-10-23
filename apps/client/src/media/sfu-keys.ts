import type {CallSignal,WrappedMediaKey} from '@hearth/sdk'
import {GroupKeyAgreement} from './group-admission.ts'
import type {VoiceMembership} from './voice-membership.ts'
const hex=(value:Uint8Array)=>Array.from(value,byte=>byte.toString(16).padStart(2,'0')).join('')
const bytes=(value:string)=>new Uint8Array(value.match(/../g)!.map(byte=>parseInt(byte,16)))
const encoder=new TextEncoder()
const failure=(name:string,message:string)=>Object.assign(new Error(message),{name})

/** Per-publisher keys: no leader, all-answer barrier, SFU key service or plaintext
 * key in MLS. Each selected recipient additionally proves its ephemeral ECDH. */
export class SfuKeys {
  private ownEnvelope:CallSignal|null=null
  private received=new Map<string,string>()
  private ended=false
  private agreement:GroupKeyAgreement
  private membership:VoiceMembership
  private exporter:(signal:CallSignal)=>Promise<string>
  constructor(agreement:GroupKeyAgreement,membership:VoiceMembership,exporter:(signal:CallSignal)=>Promise<string>){this.agreement=agreement;this.membership=membership;this.exporter=exporter}
  private check(){if(this.ended)throw failure('SfuKeysClosed','SFU key generation ended');if(!this.membership.canPublish)throw failure('SfuLeaseExpired','SFU admission expired');if(!this.membership.context.sfu)throw failure('SfuModeChanged','SFU mode changed')}
  private aad(from:string,to:string){return encoder.encode(JSON.stringify(['hearth/v1/sfu-key-wrap',this.membership.context.id,from,to]))}
  private async wrapping(signal:CallSignal,peer:string){
    this.check();const base=await this.exporter(signal);this.check()
    const key=await this.agreement.derive(this.membership,peer,base)
    try{this.check();return await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt','decrypt'])}finally{key.fill(0)}
  }
  async create():Promise<{key:Uint8Array<ArrayBuffer>;signal:CallSignal}>{
    this.check();if(this.ownEnvelope)throw new Error('SFU publisher key already exists')
    const context=this.membership.context,own=this.membership.own,peers=context.participants.filter(peer=>peer!==own)
    const entries:WrappedMediaKey[]=peers.map(recipient=>({recipient,nonce:'0'.repeat(24),ciphertext:'0'.repeat(96)}))
    const template:CallSignal={call_id:context.id,group_id:context.id,voice_room:context.voiceRoom,epoch:context.epoch,participants:[...context.participants],from_device:own,to_device:peers[0],kind:'sfu-key',description:JSON.stringify(entries),relay_only:context.relayOnly,expires_at:Date.now()+60_000}
    const random=crypto.getRandomValues(new Uint8Array(32));let salt:Uint8Array<ArrayBuffer>=new Uint8Array(0)
    let key:Uint8Array<ArrayBuffer>|undefined
    try{
      salt=bytes(await this.exporter(template))
      this.check();const material=await crypto.subtle.importKey('raw',random,'HKDF',false,['deriveBits'])
      key=new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode(JSON.stringify(['hearth/v1/sfu-publisher',context.id,own]))},material,256));this.check()
      for(const entry of entries){
        const wrapping=await this.wrapping({...template,to_device:entry.recipient},entry.recipient),nonce=crypto.getRandomValues(new Uint8Array(12))
        entry.nonce=hex(nonce);entry.ciphertext=hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:this.aad(own,entry.recipient)},wrapping,key)));this.check()
      }
      const signal={...template,expires_at:Date.now()+60_000,description:JSON.stringify(entries)};this.ownEnvelope=signal
      const result=key;key=undefined;return {key:result,signal}
    }finally{random.fill(0);salt.fill(0);key?.fill(0)}
  }
  repeat(){this.check();if(!this.ownEnvelope)throw new Error('No SFU publisher key');return {...this.ownEnvelope,expires_at:Date.now()+60_000}}
  async receive(signal:CallSignal):Promise<Uint8Array<ArrayBuffer>|null>{
    this.check();const context=this.membership.context,own=this.membership.own
    if(signal.kind!=='sfu-key'||signal.group_id!==context.id||signal.call_id!==context.id||signal.voice_room!==context.voiceRoom||signal.epoch!==context.epoch||signal.relay_only!==context.relayOnly||JSON.stringify(signal.participants)!==JSON.stringify(context.participants)||!context.participants.includes(signal.from_device)||signal.from_device===own||signal.expires_at<=Date.now()||signal.expires_at>Date.now()+65_000||!signal.description)throw failure('SfuKeyContext','Unexpected SFU key context')
    const previous=this.received.get(signal.from_device)
    if(previous){if(previous!==signal.description)throw failure('SfuKeyConflict','Conflicting SFU publisher key');return null}
    const entries=JSON.parse(signal.description) as WrappedMediaKey[],expected=context.participants.filter(peer=>peer!==signal.from_device)
    if(entries.length!==expected.length||entries.some((entry,index)=>entry.recipient!==expected[index]||!/^[a-f0-9]{24}$/.test(entry.nonce)||!/^[a-f0-9]{96}$/.test(entry.ciphertext)))throw new Error('Invalid wrapped SFU keys')
    const entry=entries.find(entry=>entry.recipient===own)!,key=await this.wrapping({...signal,to_device:own},signal.from_device)
    const material=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(entry.nonce),additionalData:this.aad(signal.from_device,own)},key,bytes(entry.ciphertext)))
    try{this.check();if(material.length!==32)throw new Error('Invalid SFU publisher key');this.received.set(signal.from_device,signal.description);return material.slice()}finally{material.fill(0)}
  }
  close(){this.ended=true;this.ownEnvelope=null;this.received.clear()}
}
