// The transaction marker travels inside the existing authenticated, MLS-encrypted
// SDP. It binds each answer to one outstanding restart without changing call keys.
const marker='a=x-hearth-restart:'
export function restartId(description:string):string|undefined {
  const lines=description.split(/\r?\n/).filter(line=>line.startsWith('a=x-hearth-restart'))
  if(!lines.length)return undefined
  if(lines.length!==1||!new RegExp('^'+marker+'[a-f0-9]{64}$').test(lines[0]))throw new Error('Invalid call recovery transaction')
  return lines[0].slice(marker.length)
}
export function restartDescription(description:string,id:string){
  if(!/^[a-f0-9]{64}$/.test(id)||restartId(description))throw new Error('Invalid call recovery transaction')
  return description.replace(/\r?\n?$/,'\r\n')+marker+id+'\r\n'
}
export class RecoveryHandshake {
  pending:string|undefined
  private seen=new Set<string>()
  private attempts:number[]=[]
  private polite:boolean
  constructor(polite:boolean){this.polite=polite}
  private consume(id:string,now:number){
    if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid call recovery transaction')
    if(this.seen.has(id))return false
    this.attempts=this.attempts.filter(at=>now-at<60_000)
    if(this.attempts.length>=6)throw new Error('Too many connection recovery attempts. Start a new call.')
    this.attempts.push(now);this.seen.add(id)
    // No call can outlive 50 minutes; keep the entire accepted transaction set
    // for that call so an evicted identifier can never become a fresh offer.
    return true
  }
  start(id:string,now=Date.now()){
    if(this.pending||!this.consume(id,now))throw new Error('Call recovery already pending')
    this.pending=id
  }
  incoming(id:string,now=Date.now()):'ignore'|'answer'|'rollback'{
    if(!this.consume(id,now))return 'ignore'
    if(this.pending&&!this.polite)return 'ignore'
    const action=this.pending?'rollback':'answer';this.pending=undefined;return action
  }
  answer(id:string){if(this.pending!==id)return false;this.pending=undefined;return true}
}
