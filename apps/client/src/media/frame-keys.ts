import {SFrameCipher,sframeKeyId} from '@hearth/sdk/sframe'
export class MediaKeys {
  readonly stats={encrypted:0,decrypted:0,rejected:0,authenticationFailures:0,replayed:0,malformed:0,unexpectedStream:0,emptyDropped:0,pausedDropped:0,staleDropped:0}
  private send:SFrameCipher[]=[]
  private receive:({kid:bigint;cipher:SFrameCipher}|undefined)[]=[]
  private retired=new Set<bigint>()
  private base:Uint8Array|null=null
  private revision=0
  private enabled=false
  private epoch=-1
  private installed=''
  private role:number
  private slots:number
  get generation(){return this.revision}
  constructor(role:number,slots=3){if((role!==0&&role!==1)||![3,4].includes(slots))throw new Error('Invalid media role');this.role=role;this.slots=slots}
  pause(){
    this.revision++;this.enabled=false;this.installed=''
    for(const value of this.receive)if(value)this.retired.add(value.kid)
    this.send=[];this.receive=[];this.base?.fill(0);this.base=null
  }
  async install(key:string,epoch:number,id:string){
    if(this.enabled||!Number.isSafeInteger(epoch)||epoch<=this.epoch||!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid media key update')
    this.pause();const revision=this.revision
    const base=new Uint8Array(key.match(/../g)!.map(value=>parseInt(value,16)))
    try{
      const send=await Promise.all(Array.from({length:this.slots},(_,slot)=>{
        const random=crypto.getRandomValues(new Uint32Array(2))
        const kid=(((BigInt(random[0])<<32n)|BigInt(random[1]))&0x7ffffffffffffffcn)|(BigInt(this.role)<<63n)|BigInt(slot)
        return SFrameCipher.create(base,kid)
      }))
      if(revision!==this.revision)throw new Error('Media key update superseded')
      this.base=base.slice();this.send=send;this.epoch=epoch;this.installed=id
    }finally{base.fill(0)}
  }
  resume(id:string){if(id!==this.installed||!this.base||this.send.length!==this.slots)throw new Error('Media key update not ready');this.enabled=true}
  async frame(direction:'send'|'receive',slot:number,wire:Uint8Array):Promise<Uint8Array|null>{
    if(!this.enabled){this.stats.pausedDropped++;return null}
    if(!wire.length){this.stats.emptyDropped++;return null}
    const revision=this.revision
    try{
      if(!this.send[slot])throw new Error('Wrong media stream')
      let result:Uint8Array
      if(direction==='send')result=await this.send[slot].encrypt(wire)
      else{
        const kid=sframeKeyId(wire)
        if(this.retired.has(kid)){this.stats.staleDropped++;return null}
        if(Number(kid>>63n)!==1-this.role||Number(kid&3n)!==slot||(this.receive[slot]&&this.receive[slot]!.kid!==kid))throw new Error('Wrong media stream')
        const cipher=this.receive[slot]?.cipher??await SFrameCipher.create(this.base!,kid)
        if(revision!==this.revision||!this.enabled){this.stats.pausedDropped++;return null}
        result=await cipher.decrypt(wire)
        if(revision===this.revision&&this.enabled)this.receive[slot]??={kid,cipher}
      }
      if(revision!==this.revision||!this.enabled){this.stats.pausedDropped++;return null}
      if(direction==='send')this.stats.encrypted++;else this.stats.decrypted++
      return result
    }catch(error){
      if(revision!==this.revision||!this.enabled){this.stats.pausedDropped++;return null}
      this.stats.rejected++
      const reason=error instanceof Error?error.message:''
      if(reason==='Rejected SFrame')this.stats.replayed++
      else if(reason==='Wrong media stream')this.stats.unexpectedStream++
      else if(['Invalid SFrame','Noncanonical SFrame'].includes(reason))this.stats.malformed++
      else this.stats.authenticationFailures++
      if(direction==='send')throw new Error('Media encryption failed')
      return null
    }
  }
}
