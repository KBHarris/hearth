import type {LocalMessage} from '@hearth/sdk'

export function Poll({message,account,disabled,canClose,onVote,onClose}:{message:LocalMessage;account:string;disabled:boolean;canClose:boolean;onVote:(choices:number[])=>void;onClose:()=>void}) {
  const poll=message.poll
  if(!poll)return null
  const selected=poll.votes[account]??[]
  return <section className="message-poll" aria-label="Poll">
    <p className="muted">{poll.closed?'Voting closed':poll.multiple?'Choose one or more options':'Choose one option'} · {Object.keys(poll.votes).length} voters</p>
    {poll.options.map((option,index)=><button key={index} aria-pressed={selected.includes(index)} disabled={disabled||poll.closed} onClick={()=>onVote(selected.includes(index)?selected.filter(choice=>choice!==index):poll.multiple?[...selected,index].sort((a,b)=>a-b):[index])}><span>{option}</span><strong>{Object.values(poll.votes).filter(vote=>vote.includes(index)).length}</strong></button>)}
    <small>Votes are visible to people in this encrypted conversation.</small>
    {!poll.closed&&canClose&&<button disabled={disabled} onClick={onClose}>Close poll</button>}
  </section>
}
