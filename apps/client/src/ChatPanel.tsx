import {useEffect,useRef,useState,type FormEvent} from 'react'
import {type Session,type DeviceEnrollment,type LocalMessage} from '@hearth/sdk'
import {AuthCrypto} from './crypto/client'
import {MessagingSession,initialChat} from './crypto/messaging-session'

export function ChatPanel({crypto,session,device,server,url}:{crypto:AuthCrypto;session:Session;device:DeviceEnrollment;server:string;url:string}) {
  const [state,setState]=useState(initialChat)
  const [selected,setSelected]=useState('')
  const [draft,setDraft]=useState('')
  const [recipients,setRecipients]=useState('')
  const [reply,setReply]=useState<LocalMessage|null>(null)
  const [editing,setEditing]=useState('')
  const [editText,setEditText]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [now,setNow]=useState(Date.now)
  const service=useRef<MessagingSession|null>(null)
  const bottom=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{
    let active=true
    const client=new MessagingSession(crypto,session,device,server,url,next=>{if(active)setState(next)})
    service.current=client
    void client.start().catch(()=>{})
    const clock=setInterval(()=>setNow(Date.now()),1000)
    return ()=>{active=false;clearInterval(clock);client.close();service.current=null}
  },[crypto,session,device,server,url])
  const activeId=selected || state.conversations[0]?.id || ''
  const active=state.conversations.find(conversation=>conversation.id===activeId)
  const joined=state.joined.includes(activeId)
  const messages=state.messages.filter(message=>message.conversation_id===activeId)
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'})},[messages.length,activeId])
  const name=(id:string)=>id===session.account.id?session.account.username:state.people[id]?.account.username ?? id.slice(0,8)
  async function create(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const names=recipients.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)
      if(!names.length || names.some(value=>!/^[a-z0-9_]{3,32}$/.test(value)))throw new Error('Enter usernames separated by commas.')
      const id=await service.current?.create(names)
      if(id){setSelected(id);setRecipients('');setReply(null);setDraft('')}
    }catch(error){setError(error instanceof Error?error.message:'The conversation could not be created.')}
    finally {setBusy(false)}
  }
  async function send(event:FormEvent) {
    event.preventDefault();if(!activeId || !draft.trim())return
    setBusy(true);setError('')
    try {
      if(new TextEncoder().encode(draft).length>16000)throw new Error('Use a message of no more than 16,000 bytes.')
      await service.current?.send(activeId,{kind:'text',text:draft,reply_to:reply?.id ?? null})
      setDraft('');setReply(null)
    }catch(error){setError(error instanceof Error?error.message:'The message could not be sent.')}
    finally {setBusy(false)}
  }
  async function edit(event:FormEvent) {
    event.preventDefault();if(!editing || !editText.trim())return
    setBusy(true);setError('')
    try {
      if(new TextEncoder().encode(editText).length>16000)throw new Error('Use a message of no more than 16,000 bytes.')
      await service.current?.send(activeId,{kind:'edit',id:editing,text:editText});setEditing('');setEditText('')
    }catch(error){setError(error instanceof Error?error.message:'The edit could not be sent.')}
    finally {setBusy(false)}
  }
  async function remove(message:LocalMessage) {
    setBusy(true);setError('')
    try {await service.current?.send(activeId,{kind:'delete',id:message.id})}
    catch(error){setError(error instanceof Error?error.message:'The deletion could not be sent.')}
    finally {setBusy(false)}
  }
  const typing=(state.typing[activeId] ?? []).filter(peer=>peer.until>now)
  return <section className="chat-panel" aria-labelledby="chat-heading">
    <header className="chat-header"><h2 id="chat-heading">Direct messages</h2><small role="status">{state.connection}{state.pending>0 && ` · ${state.pending} queued`}</small></header>
    <form className="new-conversation" onSubmit={event=>void create(event)}>
      <label htmlFor="dm-recipients">Start a conversation</label>
      <div><input id="dm-recipients" value={recipients} onChange={event=>setRecipients(event.target.value)} placeholder="username, another_username" spellCheck={false} autoComplete="off" required disabled={busy || state.fatal}/><button type="submit" className="primary-button" disabled={busy || state.fatal}>Start</button></div>
      <small>Add one person for a DM, or several for a group DM.</small>
    </form>
    <div className="chat-layout">
      <nav className="conversation-list" aria-label="Direct conversations">
        {state.conversations.length===0 && <p>No conversations yet.</p>}
        {state.conversations.map(conversation=><button key={conversation.id} className={conversation.id===activeId?'selected':''} aria-current={conversation.id===activeId?'page':undefined} onClick={()=>{setSelected(conversation.id);setReply(null);setEditing('');setDraft('')}}>{conversation.accounts.filter(id=>id!==session.account.id).map(name).join(', ')}<small>{state.joined.includes(conversation.id)?'Encrypted':'Preparing this device…'}</small></button>)}
      </nav>
      <div className="conversation">
        {!active ? <div className="chat-empty">Start a conversation to send your first encrypted message.</div> : <>
          <header className="conversation-header"><strong>{active.accounts.filter(id=>id!==session.account.id).map(name).join(', ')}</strong><details><summary>Check identities</summary>{active.accounts.map(id=><p key={id}>{name(id)}<code>{(state.people[id]?.devices[0]?.identity_key ?? active.members.find(member=>member.account_id===id)?.enrollment.identity_key)?.match(/.{1,4}/g)?.join(' ')}</code></p>)}<small>Compare these fingerprints with your recipients using a trusted channel.</small></details></header>
          {!joined && <p className="input-help">Waiting for a participant’s linked device to update encryption. Keep an existing device signed in. Old history isn’t copied to this install.</p>}
          <div className="message-log" role="log" aria-label="Encrypted messages" aria-live="polite" aria-relevant="additions text">
            {joined && messages.length===0 && <p className="chat-empty">New messages will appear here. Your server stores only ciphertext.</p>}
            {messages.map(message=><article key={message.id} className="chat-message">
              <header><strong>{name(message.author_id)}</strong>{message.edited && !message.deleted && <small>edited</small>}</header>
              {message.reply_to && <blockquote>Reply to {state.messages.find(original=>original.id===message.reply_to)?.text.slice(0,100) || 'an earlier message'}</blockquote>}
              {editing===message.id ? <form onSubmit={event=>void edit(event)}><label htmlFor="edit-message">Edit message</label><textarea id="edit-message" value={editText} onChange={event=>setEditText(event.target.value)} maxLength={16000} required/><button type="submit" disabled={busy || state.fatal}>Save edit</button><button type="button" onClick={()=>setEditing('')}>Cancel</button></form> : <p>{message.deleted?<em>Message deleted</em>:message.text}</p>}
              {!message.deleted && joined && !state.fatal && <div className="message-actions"><button disabled={busy} onClick={()=>setReply(message)} aria-label={`Reply to ${name(message.author_id)}`}>Reply</button>{message.author_id===session.account.id && <><button disabled={busy} onClick={()=>{setEditing(message.id);setEditText(message.text)}}>Edit</button><button disabled={busy} onClick={()=>void remove(message)}>Delete</button></>}</div>}
            </article>)}
            <div ref={bottom}/>
          </div>
          <div className="typing-status" aria-live="polite">{typing.length>0?`${typing.map(peer=>name(peer.account)).join(', ')} ${typing.length===1?'is':'are'} typing…`:''}</div>
          {reply && <div className="reply-bar">Replying to {name(reply.author_id)}<button type="button" onClick={()=>setReply(null)}>Cancel reply</button></div>}
          <form className="message-composer" onSubmit={event=>void send(event)}>
            <label htmlFor="message-text">Message</label><textarea id="message-text" rows={2} value={draft} onChange={event=>{setDraft(event.target.value);service.current?.typing(activeId,!!event.target.value)}} placeholder={joined?'Write a message…':'Waiting for encryption…'} maxLength={16000} disabled={!joined || busy || state.fatal} required/>
            <button type="submit" className="primary-button" disabled={!joined || busy || state.fatal || !draft.trim()}>Send</button>
          </form>
        </>}
      </div>
    </div>
    {(error || state.error) && <p className="input-error" role="alert">{error || state.error}</p>}
  </section>
}
