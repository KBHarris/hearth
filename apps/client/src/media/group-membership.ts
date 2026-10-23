import type {CallSignal} from '@hearth/sdk'
import type {GroupContext,GroupKeyState} from './group-admission.ts'

/** Invited devices are fixed; participation is independent. Contributions and
 * departures are MLS-authenticated broadcasts to that selected roster. Public
 * round tombstones prevent delayed controls from resurrecting departed media.
 */
export class GroupMembership implements GroupKeyState {
  readonly context:GroupContext
  readonly own:string
  private keys=new Map<string,{key:string;round:number;left:boolean;at:number}>()
  private consented=false
  private ended=false
  private revision=0
  private created:number
  private onceConnected=false
  reason=''
  constructor(context:GroupContext,own:string,now=Date.now()){
    this.context=Object.freeze({...context,participants:Object.freeze([...context.participants])});this.own=own;this.created=now
    if(!context.participants.includes(own))throw new Error('This device is not invited')
  }
  get generation(){return this.revision}
  get stopped(){return this.ended}
  get hasConsent(){return this.consented}
  get readyPeers(){return this.context.participants.filter(device=>device!==this.own&&!!this.keys.get(device)?.key&&!this.keys.get(device)!.left)}
  get canPublish(){return !this.ended&&this.consented&&this.readyPeers.length>0}
  resume(){
    this.checkTime()
    if(this.ended||this.consented||!this.readyPeers.length)throw new Error('This call is no longer available')
    const next=new GroupMembership(this.context,this.own,this.created)
    next.keys=new Map([...this.keys].map(([device,member])=>[device,{...member}]))
    next.onceConnected=this.onceConnected;return next
  }
  status(device:string){return device===this.own?(this.consented?'You':'Invited'):this.keys.get(device)?.left?'Left':this.keys.get(device)?.key?'Joined':'Invited'}
  private signal(kind:string,description:string|null,now:number):CallSignal {
    const c=this.context
    return {call_id:c.id,group_id:c.id,participants:[...c.participants],epoch:c.epoch,from_device:this.own,to_device:c.participants.find(device=>device!==this.own)!,kind,description,relay_only:c.relayOnly,expires_at:now+60_000}
  }
  private consent(key:string,now:number){
    this.checkTime(now)
    if(this.ended||this.consented||!/^04[a-f0-9]{128}$/.test(key))throw new Error('This call cannot be joined')
    const previous=this.keys.get(this.own),round=(previous?.round??0)+1
    if(round>32||previous?.key===key)throw new Error('Start a new call to continue.')
    this.consented=true;this.keys.set(this.own,{key,round,left:false,at:now});this.revision++
    if(this.readyPeers.length)this.onceConnected=true
  }
  invite(key:string,now=Date.now()){
    if(this.own!==this.context.host)throw new Error('Only the caller can invite')
    this.consent(key,now)
    return [this.signal('group-invite',null,now),...this.heartbeat(now)]
  }
  answer(key:string,now=Date.now()){this.consent(key,now);return this.heartbeat(now)}
  receive(signal:CallSignal,now=Date.now()):CallSignal[] {
    const c=this.context
    if(this.ended||signal.call_id!==c.id||signal.group_id!==c.id||signal.epoch!==c.epoch||signal.relay_only!==c.relayOnly||
      signal.from_device===this.own||!c.participants.includes(signal.from_device)||!c.participants.includes(signal.to_device)||
      JSON.stringify(signal.participants)!==JSON.stringify(c.participants)||signal.expires_at<=now||signal.expires_at>now+65_000)return []
    const peer=this.keys.get(signal.from_device)
    const member=signal.kind==='group-member'?/^(0[1-9]|[12][0-9]|3[0-2]):(joined|left):(04[a-f0-9]{128})$/.exec(signal.description??''):null
    if(member){
      const round=Number(member[1]),left=member[2]==='left',key=member[3]
      if(peer&&(round<peer.round||round===peer.round&&peer.left))return []
      if(peer&&round===peer.round&&peer.key!==key){this.end('A participant changed their call key.');return []}
      if(!peer||round!==peer.round||left!==peer.left)this.revision++
      this.keys.set(signal.from_device,{key,round,left,at:now})
      if(this.consented&&!left)this.onceConnected=true
    }else if(signal.kind==='group-heartbeat'&&signal.description===null&&peer?.key&&!peer.left){peer.at=now
    }else if(signal.kind==='group-decline'&&signal.description===null&&!peer){
      this.keys.set(signal.from_device,{key:'',round:0,left:true,at:now})
    }
    return []
  }
  heartbeat(now=Date.now()){
    this.checkTime(now)
    const own=this.keys.get(this.own)
    return this.consented&&!this.ended&&own?[this.memberSignal(own,false,now)]:[]
  }
  private memberSignal(member:{key:string;round:number},left:boolean,now:number){return this.signal('group-member',`${String(member.round).padStart(2,'0')}:${left?'left':'joined'}:${member.key}`,now)}
  checkTime(now=Date.now()){
    if(this.ended)return
    // Known public contributions remain in the transcript as tombstones; keys
    // after leave therefore differ from both the old and pre-join pair keys.
    for(const [device,peer] of this.keys)if(device!==this.own&&!peer.left&&peer.key&&now-peer.at>=30_000){peer.left=true;this.revision++}
    if(now-this.created>=50*60_000||this.consented&&!this.onceConnected&&now-this.created>=60_000||!this.consented&&now-this.created>=60_000&&!this.readyPeers.length)this.end('Group call timed out.')
  }
  transcript(){
    if(!this.canPublish)throw new Error('Join the call before deriving media keys')
    return this.context.participants.map(device=>{const peer=this.keys.get(device);return [device,peer?.key?(peer.left?'left:':'')+peer.key:'',String(peer?.round??0)]})
  }
  leave(now=Date.now()){
    if(this.ended)return []
    const own=this.keys.get(this.own)
    const controls=this.consented&&own?[this.memberSignal(own,true,now)]:own?[]:[this.signal('group-decline',null,now)]
    if(own&&!own.left){own.left=true;this.revision++}
    this.consented=false;return controls
  }
  stop(now=Date.now()){const controls=this.leave(now);this.end('You left the group call.');return controls}
  end(reason:string){this.ended=true;this.reason=reason;this.revision++;this.keys.clear();this.consented=false}
}
