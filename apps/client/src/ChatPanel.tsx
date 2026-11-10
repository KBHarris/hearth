import {ActivityComposer} from './ActivityComposer'
import {ActivityCard} from './ActivityCard'
import {VoiceRoomPanel} from './VoiceRoomPanel'
import {VoiceRoomCall,idleVoice} from './media/voice-room'
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from 'react'
import {createPortal} from 'react-dom'
import {Permission,permissions,type HearthInvite,type Session,type DeviceEnrollment,type LocalMessage,type HistoryPolicy} from '@hearth/sdk'
import {AuthCrypto} from './crypto/client'
import {DirectCall,idleCall} from './media/direct-call'
import {CallPanel} from './CallPanel'
import {GroupCall,idleGroup} from './media/group-call'
import {GroupCallPanel} from './GroupCallPanel'
import {MessagingSession,initialChat,admitted} from './crypto/messaging-session'
import {CommunityPanel} from './CommunityPanel'
import {Modal} from './Modal'
import {Icon} from './Icons'
import {Menu} from './Menu'
import {MessageBody} from './MessageBody'
import {ReportPanel,ModeratorReports} from './ReportPanel'
import {AccountData} from './AccountData'
import {BlockedPeople} from './BlockedPeople'
import {Poll} from './Poll'
import {LinkPreview} from './LinkPreview'
import {localLinkPreview} from './local-link-preview'
import {conversationMembers} from './members'
import {MemberList,MemberModal} from './MemberList'
import {Attachment,EncryptedImage,type FileDownloader} from './Attachment'
import {isTauri} from '@tauri-apps/api/core'
import {messageScope,recoverMessages} from './crypto/message-store'
import {missingLocalHistory} from './crypto/message-storage-error'

export function ChatPanel({crypto,session,device,server,url,onAccount,onServerSettings,onSignOut,invite,onInviteDone}:{crypto:AuthCrypto;session:Session;device:DeviceEnrollment;server:string;url:string;onAccount:()=>void;onServerSettings?:()=>void;onSignOut:()=>void;invite?:HearthInvite|null;onInviteDone?:()=>void}) {
  // The rail shows Home (direct messages) and one tile per community; the sidebar lists whichever is open.
  const [home,setHome]=useState(false)
  const [communityId,setCommunityId]=useState('')
  const [railHome,setRailHome]=useState<HTMLElement|null>(null)
  useEffect(()=>{setRailHome(document.getElementById('rail-home'))},[])
  const pickCommunity=useCallback(()=>{setHome(false);setNavigationOpen(true)},[])
  const buttonsSetting='hearth.message-buttons'
  const [alwaysButtons,setAlwaysButtons]=useState(()=>{try{return localStorage.getItem(buttonsSetting)==='always'}catch{return false}})
  const [navigationOpen,setNavigationOpen]=useState(!!invite?.community)
  const [membersOpen,setMembersOpen]=useState(()=>window.matchMedia('(min-width: 1150px)').matches)
  const [memberId,setMemberId]=useState('')
  const membersButton=useRef<HTMLButtonElement|null>(null)
  const closeMembers=useCallback(()=>{setMembersOpen(false);membersButton.current?.focus()},[])
  useEffect(()=>{const wide=window.matchMedia('(min-width: 1150px)');const collapse=()=>{if(!wide.matches)setMembersOpen(false)};wide.addEventListener('change',collapse);return()=>wide.removeEventListener('change',collapse)},[])
  const [panel,setPanel]=useState<'dm'|'profile'|'search'|'access'|'channel'|'rules'|'post'|'poll'|'event'|'playback'|'privacy'|null>(null)
  const [state,setState]=useState(initialChat)
  const [recoveringHistory,setRecoveringHistory]=useState(false)
  const [selected,setSelected]=useState('')
  const [draft,setDraft]=useState('')
  const [postTitle,setPostTitle]=useState('')
  const [postBody,setPostBody]=useState('')
  const [pollQuestion,setPollQuestion]=useState('')
  const [pollOptions,setPollOptions]=useState('')
  const [pollMultiple,setPollMultiple]=useState(false)
  const [recipients,setRecipients]=useState('')
  const [reply,setReply]=useState<LocalMessage|null>(null)
  const [reportTarget,setReportTarget]=useState('')
  const [reportsOpen,setReportsOpen]=useState(false)
  const [editing,setEditing]=useState('')
  const [editText,setEditText]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [attempt,setAttempt]=useState(0)
  const [now,setNow]=useState(Date.now)
  const [thread,setThread]=useState('')
  const [pins,setPins]=useState(false)
  const [query,setQuery]=useState('')
  const [results,setResults]=useState<LocalMessage[]|null>(null)
  const [displayName,setDisplayName]=useState('')
  const [bio,setBio]=useState('')
  const [presence,setPresence]=useState<'online'|'idle'|'offline'>('online')
  const previewSetting=`hearth.link-previews:${server}:${session.account.id}`
  const [previewsEnabled,setPreviewsEnabled]=useState(()=>{try{return localStorage.getItem(previewSetting)!=='off'}catch{return true}})
  const [dismissedPreview,setDismissedPreview]=useState('')
  const [file,setFile]=useState<File|null>(null)
  const fileInput=useRef<HTMLInputElement|null>(null)
  const uploadAbort=useRef<AbortController|null>(null)
  const [emojiAlias,setEmojiAlias]=useState('')
  const [emojiFile,setEmojiFile]=useState<File|null>(null)
  const draftPreview=previewsEnabled&&!file&&!thread?localLinkPreview(draft):null
  const sendPreview=draftPreview?.url===dismissedPreview?null:draftPreview
  const searchThread=useRef<string|null>(null)
  const service=useRef<MessagingSession|null>(null)
  const onChannelsRemoved=useCallback((ids:string[])=>service.current?.channelsRemoved(ids),[])
  const [callBinding,setCallBinding]=useState<{calls:DirectCall;groups:GroupCall;rooms:VoiceRoomCall;messages:MessagingSession}|null>(null)
  const [callState,setCallState]=useState(idleCall)
  const [groupState,setGroupState]=useState(idleGroup)
  const [voiceState,setVoiceState]=useState(idleVoice)
  const loadGovernance=useCallback((id:string)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.loadGovernance(id)},[])
  const ownership=useMemo(()=>({deviceKey:device.device_key,load:(id:string)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.loadOwnership(id)},offer:(id:string,account:string,targetDevice?:string)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.offerOwnership(id,account,targetDevice)},accept:(id:string)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.acceptOwnership(id)},cancel:(id:string)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.cancelOwnership(id)}}),[device.device_key])
  const download=useCallback<FileDownloader>((id,file)=>{if(!service.current)return Promise.reject(new Error('Messaging is opening.'));return service.current.downloadAttachment(id,file)},[])
  const removeFile=useCallback((id:string,file:import('@hearth/sdk').LocalAttachment)=>{if(!service.current)return Promise.reject(new Error('Messaging is opening.'));return service.current.removeAttachment(id,file)},[])
  const bottom=useRef<HTMLDivElement|null>(null)
  useEffect(()=>{
    let active=true
    setState(initialChat)
    const client=new MessagingSession(crypto,session,device,server,url,next=>{if(active)setState(next)})
    service.current=client
    const idle=()=>['idle','ended'].includes(calls.state.phase)&&!rooms.busy
    const rooms=new VoiceRoomCall(client,server,next=>{if(active)setVoiceState(next)},undefined,()=>['idle','ended'].includes(calls.state.phase)&&!groups.busy)
    const groups=new GroupCall(client,server,next=>{if(active)setGroupState(next)},undefined,idle)
    const calls=new DirectCall({callDevice:client.callDevice,callAccount:client.callAccount,onCall:client.onCall.bind(client),send:client.send.bind(client),callKey:client.callKey.bind(client),authorizeCall:async(id,signal)=>{
      if(groups.busy||rooms.busy)throw new Error('End the group call first.')
      const current=await client.authorizeCall(id,signal)
      if(groups.busy||rooms.busy)throw new Error('End the group call first.')
      return current
    }},next=>{if(active)setCallState(next)})
    setCallBinding({calls,groups,rooms,messages:client});setCallState(idleCall);setGroupState(idleGroup);setVoiceState(idleVoice)
    void client.start().catch(()=>{})
    const clock=setInterval(()=>setNow(Date.now()),1000)
    return ()=>{active=false;clearInterval(clock);uploadAbort.current?.abort();rooms.close();groups.close();calls.close();client.close();service.current=null}
  },[crypto,session,device,server,url,attempt])
  const activeId=selected || (state.unavailable.length&&(draft||file||reply||editing)?'':state.conversations[0]?.id??'')
  const channelUnavailable=state.unavailable.includes(activeId)
  const active=state.conversations.find(conversation=>conversation.id===activeId)
  const channel=state.channels[activeId]
  const members=useMemo(()=>conversationMembers(active,channel,state.people,state.profiles),[active,channel,state.people,state.profiles])
  const member=members.find(person=>person.id===memberId)
  const forum=channel?.channel.kind==='forum'
  const needsRules=!!channel?.governance?.screening&&channel.rules_accepted===false&&channel.community.owner_id!==session.account.id
  const access=(channel?permissions(channel.governance,channel.community.owner_id,session.account.id,activeId,now,channel.admissions.find(a=>a.account_id===session.account.id)?.invitation?.issued_at??null):1023)&(needsRules?~30:1023)
  const canWrite=!!(access&Permission.send)&&(!channel || channel.channel.kind!=='announcement' || channel.community.owner_id===session.account.id)
  const joined=state.joined.includes(activeId)
  const channelMessages=state.messages.filter(message=>!channelUnavailable&&message.conversation_id===activeId)
  const messages=channelMessages.filter(message=>!state.blocked.includes(message.author_id)).filter(message=>pins?message.pinned:thread?message.thread===thread || message.id===thread:!message.thread)
  const participants=Object.fromEntries(Object.values(state.people).map(person=>[person.account.username,person.account.id]))
  useEffect(()=>{setThread(searchThread.current??'');searchThread.current=null;setPins(false)},[activeId])
  useEffect(()=>{const clock=setInterval(()=>{if(service.current)void service.current.setPresence(document.hidden && presence==='online'?'idle':presence).catch(()=>{})},45000);return()=>clearInterval(clock)},[presence])
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'})},[messages.length,activeId])
  const name=(id:string)=>{const username=id===session.account.id?session.account.username:state.people[id]?.account.username ?? id.slice(0,8);const display=state.profiles[id]?.display_name;return display && display!==username?`${display} (@${username})`:username}
  async function runSearch(event:FormEvent){event.preventDefault();setError('');try{setResults(await service.current?.search(query,null) ?? [])}catch(error){setError(error instanceof Error?error.message:'Search failed.')}}
  async function control(content:Parameters<MessagingSession['send']>[1]){setBusy(true);setError('');try{await service.current?.send(activeId,content)}catch(error){setError(error instanceof Error?error.message:'The update could not be sent.')}finally{setBusy(false)}}
  async function createSpecial(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{if(!service.current)throw new Error('Messaging is opening.');await service.current.send(activeId,panel==='post'?{kind:'forum_post',title:postTitle.trim(),text:postBody.trim()}:{kind:'poll',question:pollQuestion.trim(),options:pollOptions.split('\n').map(value=>value.trim()).filter(Boolean),multiple:pollMultiple,parent:thread||null});setPanel(null);setPostTitle('');setPostBody('');setPollQuestion('');setPollOptions('')}catch(error){setError(error instanceof Error?error.message:'The post could not be sent.')}finally{setBusy(false)}}
  async function history(policy?:HistoryPolicy){setBusy(true);setError('');try{if(!service.current)throw new Error('Messaging is opening.');if(policy)await service.current.setHistory(activeId,policy);else await service.current.requestHistory(activeId)}catch(error){setError(error instanceof Error?error.message:'History could not be prepared.')}finally{setBusy(false)}}
  async function create(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('')
    try {
      const names=recipients.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)
      if(!names.length || names.some(value=>!/^[a-z0-9_]{3,32}$/.test(value)))throw new Error('Enter usernames separated by commas.')
      const id=await service.current?.create(names)
      if(id){setSelected(id);setHome(true);setRecipients('');setReply(null);setDraft('');setPanel(null)}
    }catch(error){setError(error instanceof Error?error.message:'The conversation could not be created.')}
    finally {setBusy(false)}
  }
  async function send(event:FormEvent) {
    event.preventDefault();if(!canWrite || !activeId || (!draft.trim()&&!file))return
    setBusy(true);setError('')
    try {
      if(new TextEncoder().encode(draft).length>16000)throw new Error('Use a message of no more than 16,000 bytes.')
      if(file){if(thread)throw new Error('Send this file outside a thread.');uploadAbort.current=new AbortController();await service.current?.sendAttachment(activeId,file,draft,undefined,uploadAbort.current.signal);setFile(null);if(fileInput.current)fileInput.current.value=''}else await service.current?.send(activeId,thread?{kind:'thread',text:draft,parent:thread}:sendPreview?{kind:'rich_text',text:draft,reply_to:reply?.id??null,embed:sendPreview}:{kind:'text',text:draft,reply_to:reply?.id ?? null})
      setDraft('');setReply(null);setDismissedPreview('')
    }catch(error){setError(uploadAbort.current?.signal.aborted?'Upload cancelled. Your draft and selected file are preserved.':error instanceof Error?error.message:'The message could not be sent.')}
    finally {uploadAbort.current=null;setBusy(false)}
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
  const pendingAccess=Object.values(state.channels).filter((r,index,all)=>r.community.owner_id===session.account.id && all.findIndex(other=>other.community.id===r.community.id)===index).reduce((total,r)=>total+r.people.filter(p=>!admitted(r,p)).length,0)
  const directMessages=state.conversations.filter(conversation=>!conversation.channel_id&&!conversation.accounts.some(id=>state.blocked.includes(id)))
  const showHome=home||!communityId
  const me=session.account.id
  const initials=(id:string)=>(state.profiles[id]?.display_name||(id===me?session.account.username:state.people[id]?.account.username)||id).slice(0,2).toUpperCase()
  const status=(id:string)=>state.presence[id]?.until>now?state.presence[id].state:''
  const title=channel?`# ${channel.channel.name}`:active?active.accounts.filter(id=>id!==me).map(name).join(', '):'Your messages'
  const locked=!joined||!canWrite||busy||state.fatal
  const canLoadHistory=!!channel && channel.policy?.history!=='none' && channel.community.owner_id!==me
  const canMarkRead=joined && messages.length>0
  const canModerate=!!channel&&!!(access&Permission.moderate)
  const openProfile=()=>{setDisplayName(state.profiles[me]?.display_name??'');setBio(state.profiles[me]?.bio??'');setPanel('profile')}
  const openConversation=(id:string)=>{setSelected(id);setNavigationOpen(false);setReply(null);setEditing('');setDraft('');setFile(null);setDismissedPreview('')}
  return <div className="chat-workspace" data-navigation-open={navigationOpen} data-members-open={membersOpen&&!!active} data-message-buttons={alwaysButtons?'always':'hover'}>
    {railHome&&createPortal(<button className={`rail-tile home-tile ${showHome?'selected':''}`} aria-label="Direct messages" title="Direct messages" aria-current={showHome?'page':undefined} onClick={()=>{setHome(true);setNavigationOpen(true)}}><Icon name="message" /></button>,railHome)}
    {navigationOpen && <button className="navigation-backdrop" aria-label="Close conversations" onClick={()=>setNavigationOpen(false)}/>}
    <aside id="chat-navigation" className="chat-sidebar" aria-label="Chat navigation">
      <div className="sidebar-title"><h2 className="visually-hidden">Your conversations</h2><button className="sidebar-action sidebar-search" onClick={()=>setPanel('search')}><Icon name="search" />Search messages</button><button className="mobile-navigation-button" onClick={()=>setNavigationOpen(false)}>Close navigation</button></div>
      {showHome && <section className="direct-navigation"><header className="navigation-heading"><h2>Direct messages</h2><button className="icon-button" aria-label="New direct message" title="New direct message" onClick={()=>setPanel('dm')}><Icon name="plus" /></button></header>
        <nav className="conversation-list" aria-label="Direct messages">
          {directMessages.length===0 && <div className="navigation-empty"><p>No direct messages yet. Message someone privately, or start a small group chat.</p><button onClick={()=>setPanel('dm')}>New message</button></div>}
          {directMessages.map(conversation=><button key={conversation.id} className={conversation.id===activeId?'selected':''} aria-current={conversation.id===activeId?'page':undefined} onClick={()=>openConversation(conversation.id)}><span className="conversation-avatar" data-status={conversation.accounts.length===2?status(conversation.accounts.find(id=>id!==me)??me):undefined}>{initials(conversation.accounts.find(id=>id!==me)??me)}</span><span className="conversation-name">{conversation.accounts.filter(id=>id!==me).map(name).join(', ')}{!state.joined.includes(conversation.id)&&<small>Getting ready…</small>}</span></button>)}
        </nav>
      </section>}
<CommunityPanel home={showHome} onCommunity={setCommunityId} onPick={pickCommunity} onRemoved={onChannelsRemoved} serverKey={server} pendingInvite={invite} onInviteDone={onInviteDone} ownership={ownership} onLoadGovernance={loadGovernance} onGovernance={(id,policy)=>{if(!service.current)throw new Error('Messaging is opening.');return service.current.saveGovernance(id,policy)}} activeChannel={active?.channel_id ?? undefined} session={session} url={url} onSecure={async(kind,id,code)=>{if(!service.current)throw new Error('Messaging is opening. Retry shortly.');await (kind==='community'?service.current.secureCommunity(id):kind==='join'?service.current.secureJoin(id,code??''):service.current.secureChannel(id))}} onInvite={(id,expiry,uses)=>{if(!service.current)throw new Error('Messaging is opening. Retry shortly.');return service.current.createInvite(id,expiry,uses)}} onOpenChannel={async id=>{setBusy(true);try{const opened=await service.current?.openChannel(id);if(!opened)throw new Error('Encrypted messaging is still opening. Retry shortly.');setSelected(opened);setNavigationOpen(false);setDraft('');setReply(null);setEditing('');setFile(null);setDismissedPreview('')}finally{setBusy(false)}}}/>
      <div className="sidebar-bottom">{pendingAccess>0 && <button className="sidebar-action access-action" onClick={()=>setPanel('access')}><Icon name="users" />{pendingAccess===1?'1 person is':`${pendingAccess} people are`} waiting to join <span className="count-badge">{pendingAccess}</span></button>}
        <div className="account-controls">
          <button className="account-button" aria-label="Account & devices" title="Account & devices" onClick={onAccount}><span className="account-avatar" data-status={presence}>{initials(me)}</span><span className="account-label"><strong>{state.profiles[me]?.display_name||session.account.username}</strong><small>{presence==='online'?'Online':presence==='idle'?'Idle':'Appearing offline'}{session.account.owner?' · Server owner':''}</small></span></button>
          <Menu label="Settings" icon={<Icon name="settings" />} placement="top-end">
            <button role="menuitem" onClick={openProfile}><Icon name="user" />Profile & status</button>
            <button role="menuitem" onClick={()=>setPanel('privacy')}><Icon name="shield" />Privacy & blocked people</button>
            <button role="menuitem" onClick={onAccount}><Icon name="device" />Devices & backup</button>
            {onServerSettings&&<button role="menuitem" onClick={onServerSettings}><Icon name="server" />Server settings</button>}
            <hr/>
            <button role="menuitem" className="danger-button" onClick={onSignOut}><Icon name="logout" />Sign out</button>
          </Menu>
        </div>
      </div>
    </aside>
    <section className="chat-panel" aria-labelledby="chat-heading">
      {invite?.community && !navigationOpen && <div className="mobile-invite-handoff"><button type="button" onClick={()=>setNavigationOpen(true)}>View community invite</button></div>}
      <div className="conversation">
        <header className="conversation-header"><button className="mobile-navigation-button" aria-expanded={navigationOpen} aria-controls="chat-navigation" onClick={()=>setNavigationOpen(value=>!value)}>Conversations</button><div className="conversation-title"><h2 id="chat-heading"><strong>{title}</strong></h2>{active&&<small>{channel?channel.community.name:active.accounts.length>2?'Group chat':'Direct message'}</small>}</div>
          <div className="conversation-header-actions">{active && <>{forum&&!thread&&<button className="primary-button" disabled={locked} onClick={()=>setPanel('post')}>New post</button>}<button className="icon-button" aria-label="Pinned messages" title={pins?'Show all messages':'Pinned messages'} aria-pressed={pins} onClick={()=>{setPins(value=>!value);setThread('')}}><Icon name="pin" /></button><button ref={membersButton} className="icon-button" aria-label={channel?'Members':'People in this chat'} title={channel?'Members':'People in this chat'} aria-expanded={membersOpen} aria-controls="server-members" onClick={()=>setMembersOpen(value=>!value)}><Icon name="users" /></button>{channel && channel.community.owner_id===me && <button className="icon-button" aria-label="Channel settings" title="Channel settings" onClick={()=>setPanel('channel')}><Icon name="settings" /></button>}
            {(canMarkRead||canLoadHistory||canModerate)&&<Menu label="More" icon={<Icon name="more" />}>
              {canMarkRead && <button role="menuitem" disabled={busy} onClick={()=>void control({kind:'read',id:messages.at(-1)!.id})}><Icon name="check" />Mark as read</button>}
              {canLoadHistory && <button role="menuitem" disabled={!joined||busy||state.fatal||state.history_waiting.includes(activeId)} onClick={()=>void history()}><Icon name="refresh" />{state.history_waiting.includes(activeId)?'Waiting for the owner’s device…':'Load earlier messages'}</button>}
              {canModerate && <button role="menuitem" onClick={()=>setReportsOpen(true)}><Icon name="alert" />Reports</button>}
            </Menu>}</>}</div>
        </header>
        <CallPanel call={callBinding?.calls??null} state={callState} service={callBinding?.messages??null} conversation={joined&&!state.blocked.some(id=>active?.accounts.includes(id))?active:undefined} account={session.account.id} name={name} unavailable={!['idle','ended'].includes(groupState.phase)||!['idle','ended'].includes(voiceState.phase)}/>
        <GroupCallPanel call={callBinding?.groups??null} state={groupState} service={callBinding?.messages??null} conversation={joined&&!state.blocked.some(id=>active?.accounts.includes(id))?active:undefined} account={session.account.id} name={name} unavailable={!['idle','ended'].includes(callState.phase)||!['idle','ended'].includes(voiceState.phase)}/>
        <VoiceRoomPanel call={callBinding?.rooms??null} state={voiceState} service={callBinding?.messages??null} channel={joined?channel:undefined} name={name} unavailable={!['idle','ended'].includes(callState.phase)||!['idle','ended'].includes(groupState.phase)}/>
        <div className="messaging-status" role="status" data-quiet={!state.fatal&&state.connection==='Connected'&&state.pending===0}><span className={`dot ${state.fatal?'error':state.connection==='Connected'?'ok':'loading'}`} />{state.connection}{state.pending>0 && ` · ${state.pending} waiting to send`}</div>
        {!active ? <div className="chat-empty"><Icon name="message" /><h3>Nothing open yet.</h3><p>Pick a channel on the left, or message someone directly.</p><button className="primary-button" onClick={()=>setPanel('dm')}>New direct message</button><p className="muted">A community is a group of people. Channels are the rooms inside it.</p></div> : <>
          {(thread||pins)&&<div className="conversation-tools">{pins?<><span><Icon name="pin" />Pinned messages</span><button onClick={()=>setPins(false)}>Show all messages</button></>:<><span>{forum?'Replies to this post':'Thread'}</span><button onClick={()=>setThread('')}>{forum?'Back to forum':'Back to channel'}</button></>}</div>}
          {!joined && <p className="input-help">{channel && !admitted(channel,{account:session.account,devices:[device]})?'Waiting for the community owner to let you in. They approve new members from their own device.':'This device is still being added to the chat. That happens when someone already in it is online, so keep one of your other devices signed in if you have one. Earlier messages are not copied to this device.'}</p>}
          <div className="message-log" role="log" aria-label="Encrypted messages" aria-live="polite" aria-relevant="additions text">
            {joined && messages.length===0 && <p className="chat-empty">{pins?'Nothing is pinned here yet.':'No messages yet. Say hello!'}<span className="muted">Only the people in this chat can read what is written here. The server cannot.</span></p>}
            {messages.map(message=><article key={message.id} className={`chat-message ${forum&&!thread?'forum-post':''}`}><span className="message-avatar" data-status={status(message.author_id)||undefined} aria-hidden="true">{initials(message.author_id)}</span><div className="message-main">{message.topic&&!message.deleted&&<h3><button onClick={()=>{setThread(message.id);setPins(false);setDraft('');setReply(null)}}>{message.topic}</button></h3>}
              <header><strong>{name(message.author_id)}</strong>{status(message.author_id)==='idle' && <small className="presence">idle</small>}{message.pinned && <small>Pinned</small>}{message.edited && !message.deleted && <small>edited</small>}</header>
              {message.reply_to && <blockquote>Reply to {state.messages.find(original=>original.id===message.reply_to)?.text.slice(0,100) || 'an earlier message'}</blockquote>}
              {editing===message.id ? <form className="message-edit" onSubmit={event=>void edit(event)}><label htmlFor="edit-message">Edit message</label><textarea id="edit-message" value={editText} onChange={event=>setEditText(event.target.value)} maxLength={16000} required/><div className="form-actions"><button type="submit" className="primary-button" disabled={busy || state.fatal}>Save edit</button><button type="button" onClick={()=>setEditing('')}>Cancel</button></div></form> : message.deleted?<p><em>Message deleted</em></p>:<MessageBody text={message.text} participants={participants} emoji={Object.keys(state.emoji[activeId]??{})} renderEmoji={alias=><EncryptedImage conversation={activeId} file={state.emoji[activeId][alias]} download={download} emoji/>}/>}
              {!message.deleted&&(message.event||message.playback)&&<ActivityCard message={message} account={session.account.id} disabled={busy||state.fatal||!joined||!canWrite} canRespond={!!(access&Permission.react)} send={activity=>control({kind:'activity',activity})}/>}
              {!message.deleted&&message.poll&&<Poll message={message} account={session.account.id} disabled={busy||state.fatal||!joined||!(access&Permission.react)} canClose={message.author_id===session.account.id&&canWrite} onVote={choices=>void control({kind:'poll_vote',id:message.id,choices})} onClose={()=>void control({kind:'poll_close',id:message.id})}/> }
              {!message.deleted&&previewsEnabled&&(message.embed??localLinkPreview(message.text))&&<LinkPreview embed={(message.embed??localLinkPreview(message.text))!}/>}
              {!message.deleted && message.attachments.map(file=><Attachment key={file.id} conversation={activeId} file={file} download={download} remove={session.account.owner?removeFile:undefined}/>)}
              {!message.deleted && joined && Object.keys(message.reactions).length>0 && <div className="message-reactions">{Object.entries(message.reactions).map(([emoji,actors])=><button key={emoji} aria-pressed={actors.includes(session.account.id)} disabled={busy || state.fatal || !(access&Permission.react)} onClick={()=>void control({kind:'reaction',id:message.id,emoji,active:!actors.includes(session.account.id)})}>{state.emoji[activeId]?.[emoji.replace(/^:|:$/g,'')]?<EncryptedImage conversation={activeId} file={state.emoji[activeId][emoji.replace(/^:|:$/g,'')]} download={download} emoji/>:emoji} {actors.length}</button>)}</div>}
              {Object.entries(state.read[activeId]??{}).filter(([id,target])=>id!==session.account.id && target===message.id).length>0 && <small className="read-by">Read by {Object.entries(state.read[activeId]??{}).filter(([id,target])=>id!==session.account.id && target===message.id).map(([id])=>name(id)).join(', ')}</small>}</div>
              {!message.deleted && joined && <div className="message-actions"><button aria-label="React with thumbs up" title="React with a thumbs up" disabled={busy || state.fatal || !(access&Permission.react)} onClick={()=>void control({kind:'reaction',id:message.id,emoji:'👍',active:!message.reactions['👍']?.includes(session.account.id)})}>👍</button>{canWrite && !state.fatal && <>{!forum&&<button disabled={busy} onClick={()=>setReply(message)} aria-label={`Reply to ${name(message.author_id)}`}>Reply</button>}<button title={forum?'See the replies to this post':'Start or open a side conversation about this message'} onClick={()=>{setThread(message.thread??message.id);setPins(false);setDraft('');setReply(null)}}>{forum?'Open replies':'Open thread'}{channelMessages.some(child=>child.thread===message.id)?` (${channelMessages.filter(child=>child.thread===message.id).length})`:''}</button></>}{!!(access&Permission.pin) && <button disabled={busy || state.fatal} title={message.pinned?'Remove from pinned messages':'Keep this message easy to find'} onClick={()=>void control({kind:'pin',id:message.id,active:!message.pinned})}>{message.pinned?'Unpin':'Pin'}</button>}{canWrite && !state.fatal && message.author_id===session.account.id && <>{!message.event&&!message.playback&&<button disabled={busy} onClick={()=>{setEditing(message.id);setEditText(message.text)}}>Edit</button>}<button disabled={busy} onClick={()=>void remove(message)}>Delete</button></>}{channel&&<button className="message-report" title="Report this message to a moderator" onClick={()=>setReportTarget(message.id)}>Report</button>}</div>}
            </article>)}
            <div ref={bottom}/>
          </div>
          <div className="typing-status" aria-live="polite">{typing.length>0?`${typing.map(peer=>name(peer.account)).join(', ')} ${typing.length===1?'is':'are'} typing…`:''}</div>
          {reply && <div className="reply-bar">Replying to {name(reply.author_id)}<button type="button" onClick={()=>setReply(null)}>Cancel reply</button></div>}
          <>{needsRules&&<div className="rules-screening"><p>Read and accept this community’s rules to post, react or attach files.</p><button onClick={()=>setPanel('rules')}>Review community rules</button></div>}{!canWrite && !needsRules && <p className="input-help">{channel?.channel.kind==='announcement'?'Only the community owner can post announcements here.':'You cannot post here right now, because of your role or a timeout.'}</p>}{(!forum||thread)&&<form className="message-composer" onSubmit={event=>void send(event)}>
            <label htmlFor="message-text">Message</label>
            {!thread&&<input id="message-file" tabIndex={-1} ref={fileInput} type="file" className="visually-hidden" aria-label="Choose an attachment" disabled={!joined||!canWrite||!(access&Permission.attach)||busy||state.fatal} onChange={event=>setFile(event.target.files?.[0]??null)}/>}
            <Menu className="composer-menu" label="Add to your message" icon={<Icon name="plus" />} placement="top-start">
              {!thread&&<button type="button" role="menuitem" className="attachment-button" aria-label="Attach a file" title="Up to 50 MB" disabled={!joined||!canWrite||!(access&Permission.attach)||busy||state.fatal} onClick={()=>fileInput.current?.click()}><Icon name="paperclip"/>Attach a file</button>}
              <button type="button" role="menuitem" disabled={locked} onClick={()=>setPanel('poll')}><Icon name="poll"/>Create poll</button>
              {!forum&&<><button type="button" role="menuitem" disabled={locked} onClick={()=>setPanel('event')}><Icon name="calendar"/>Schedule event</button><button type="button" role="menuitem" disabled={locked} onClick={()=>setPanel('playback')}><Icon name="play"/>Watch or listen together</button></>}
            </Menu>
            <textarea id="message-text" rows={1} value={draft} onChange={event=>{setDraft(event.target.value);service.current?.typing(activeId,!!event.target.value)}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&window.matchMedia('(hover: hover)').matches){event.preventDefault();if(draft.trim()||file)event.currentTarget.form?.requestSubmit()}}} placeholder={joined?thread?'Reply in this thread…':channel?`Message #${channel.channel.name}`:'Write a message…':'Getting this chat ready…'} title="Enter sends. Shift+Enter starts a new line. On a touch screen, use the Send button." maxLength={16000} disabled={!joined || !canWrite || busy || state.fatal} required={!file}/>
            <button type="submit" className="primary-button send-message" disabled={!joined || !canWrite || busy || state.fatal || (!draft.trim()&&!file)}>Send</button>
            {busy&&uploadAbort.current&&<button type="button" onClick={()=>uploadAbort.current?.abort()}>Cancel upload</button>}
            {file&&<div className="composer-attachment"><Icon name="paperclip"/><span>{file.name}</span><button type="button" className="icon-button" aria-label="Remove attachment" onClick={()=>{setFile(null);if(fileInput.current)fileInput.current.value=''}}><Icon name="close"/></button></div>}
            {sendPreview&&<div className="composer-preview"><LinkPreview embed={sendPreview}/><button type="button" className="icon-button" aria-label="Remove link preview" onClick={()=>setDismissedPreview(sendPreview.url)}><Icon name="close"/></button></div>}
          </form>}{Object.keys(state.emoji[activeId]??{}).length>0&&<div className="emoji-picker">{Object.entries(state.emoji[activeId]).map(([alias,file])=><button key={alias} type="button" disabled={!canWrite||busy||state.fatal} title={`Add :${alias}: to your message`} onClick={()=>setDraft(value=>`${value}:${alias}:`)}><EncryptedImage conversation={activeId} file={file} download={download} emoji/> :{alias}:</button>)}</div>}</>
        </>}
      </div>
      {channelUnavailable&&<p role="status">This channel is no longer available. Your unsent draft has been kept.</p>}
      {(error || state.error) && <p className="input-error" role="alert">{error || state.error}</p>}
      {state.fatal && isTauri() && state.error===missingLocalHistory && <div className="input-help"><p>Hearth can look for your saved messages on this computer. Nothing existing will be overwritten, and the key that unlocks them stays in Windows.</p><button className="retry-button" disabled={recoveringHistory} onClick={()=>{setRecoveringHistory(true);setError('');void recoverMessages(messageScope(session.account.id,server,device.device_key)).then(()=>setAttempt(value=>value+1)).catch(error=>setError(error instanceof Error?error.message:'History recovery could not finish. Original data was preserved.')).finally(()=>setRecoveringHistory(false))}}>{recoveringHistory?'Recovering encrypted history…':'Recover existing history'}</button></div>}
      {state.fatal && <button className="retry-button" disabled={recoveringHistory} onClick={()=>setAttempt(value=>value+1)}>Retry messaging</button>}
    </section>
    {active&&membersOpen&&<><button className="member-backdrop" aria-label="Close member list" onClick={closeMembers}/><MemberList members={members} channel={!!channel} onClose={closeMembers} onSelect={setMemberId}/></>}
    {member&&<MemberModal key={member.id} member={member} onClose={()=>setMemberId('')}/>}
    {service.current&&reportTarget&&<ReportPanel service={service.current} channel={activeId} target={reportTarget} messages={messages} name={name} onClose={()=>setReportTarget('')}/>}
    {service.current&&reportsOpen&&<ModeratorReports service={service.current} channel={activeId} name={name} onClose={()=>setReportsOpen(false)}/>}
    {panel && <Modal title={panel==='event'?'Schedule an event':panel==='playback'?'Watch or listen together':panel==='privacy'?'Privacy & blocked people':panel==='post'?'New forum post':panel==='poll'?'Create poll':panel==='dm'?'New direct message':panel==='profile'?'Profile & status':panel==='search'?'Search messages':panel==='access'?'People waiting to join':panel==='channel'?'Channel settings':panel==='rules'?'Community rules':'People in this chat'} onClose={()=>{setPanel(null);setResults(null)}}
      description={panel==='dm'?'Message one person privately, or add several people for a group chat. You need their usernames on this server.':panel==='search'?'Finds messages saved on this device. Your search never leaves it.':panel==='access'?'Before you let someone in, check that the safety code shown here matches the one their app shows them. Do it in person or on a call, not by message.':undefined}>
      {panel==='privacy'&&<><section className="preference-section"><h3>Message display</h3><label><input type="checkbox" checked={previewsEnabled} onChange={event=>{setPreviewsEnabled(event.target.checked);try{localStorage.setItem(previewSetting,event.target.checked?'on':'off')}catch{/* The preference still applies for this session. */}}}/>Show automatic link previews</label><p>Shows a small card for links you paste. Hearth builds it from the link itself and never contacts the website.</p><label><input type="checkbox" checked={alwaysButtons} onChange={event=>{setAlwaysButtons(event.target.checked);try{localStorage.setItem(buttonsSetting,event.target.checked?'always':'hover')}catch{/* The preference still applies for this session. */}}}/>Always show the buttons under each message</label><p>Reply, Pin and the other message buttons normally appear when you point at a message.</p></section><BlockedPeople url={url} session={session} onChanged={()=>void service.current?.refreshBlocks()}/><AccountData onDelete={async()=>{if(!service.current)throw new Error('Messaging is opening.');await service.current.deleteAccount();try{localStorage.removeItem(`hearth.last-username:${url}`)}catch{/* The name is only a sign-in convenience. */}}} url={url} session={session} messages={state.messages} device={device}/></>}
      {panel==='post'&&<form onSubmit={event=>void createSpecial(event)}><label htmlFor="post-title">Post title</label><input id="post-title" maxLength={160} required value={postTitle} onChange={event=>setPostTitle(event.target.value)}/><label htmlFor="post-body">Message</label><textarea id="post-body" maxLength={16000} required rows={6} value={postBody} onChange={event=>setPostBody(event.target.value)}/><p>Each post gets its own replies. Titles and messages are encrypted like everything else.</p><button className="primary-button" disabled={busy||!canWrite}>Publish post</button></form>}
      {(panel==='event'||panel==='playback')&&<ActivityComposer kind={panel} disabled={busy||!canWrite} send={async activity=>{if(!service.current)throw new Error('Messaging is opening.');await service.current.send(activeId,{kind:'activity',activity});setPanel(null)}}/>}
      {panel==='poll'&&<form onSubmit={event=>void createSpecial(event)}><label htmlFor="poll-question">Question</label><input id="poll-question" maxLength={512} required value={pollQuestion} onChange={event=>setPollQuestion(event.target.value)}/><label htmlFor="poll-options">Answers, one per line (2 to 10)</label><textarea id="poll-options" rows={5} required value={pollOptions} onChange={event=>setPollOptions(event.target.value)}/><label><input type="checkbox" checked={pollMultiple} onChange={event=>setPollMultiple(event.target.checked)}/>Let people pick more than one answer</label><p>Everyone in the chat can see who voted for what. You can close the poll later.</p><button className="primary-button" disabled={busy||!canWrite}>Publish poll</button></form>}
      {panel==='rules'  && channel?.governance && <><div className="community-rules">{channel.governance.rules}</div><p>The server keeps a record that you accepted. These rules were written by the community owner.</p><button className="primary-button" disabled={busy} onClick={()=>{setBusy(true);setError('');void service.current?.acceptRules(channel.community.id,channel.governance!.rules).then(()=>setPanel(null)).catch(error=>setError(error instanceof Error?error.message:'Rules could not be accepted.')).finally(()=>setBusy(false))}}>I agree to these rules</button></>}
      {panel==='dm' &&     <form className="new-conversation" onSubmit={event=>void create(event)}>
      <label htmlFor="dm-recipients">Who do you want to message?</label>
      <div><input id="dm-recipients" value={recipients} onChange={event=>setRecipients(event.target.value)} placeholder="username, another_username" spellCheck={false} autoComplete="off" required disabled={busy || state.fatal}/><button type="submit" className="primary-button" disabled={busy || state.fatal}>Start</button></div>
      <small>One username for a private chat. Separate several with commas for a group chat.</small>
    </form>}
      {panel==='profile' &&     <div className="local-profile"><form onSubmit={event=>{event.preventDefault();setBusy(true);void service.current?.updateProfile(displayName,bio).catch(error=>setError(error instanceof Error?error.message:'Profile could not be saved.')).finally(()=>setBusy(false))}}><label htmlFor="profile-name">Display name</label><input id="profile-name" maxLength={80} value={displayName} onChange={event=>setDisplayName(event.target.value)}/><label htmlFor="profile-bio">About you</label><textarea id="profile-bio" maxLength={512} value={bio} onChange={event=>setBio(event.target.value)}/><button className="primary-button" disabled={busy || state.fatal || !state.joined.length}>Save profile</button></form><label htmlFor="presence-state">Status</label><select id="presence-state" value={presence} onChange={event=>{const value=event.target.value as typeof presence;setPresence(value);void service.current?.setPresence(value).catch(error=>setError(error instanceof Error?error.message:'Presence could not be shared.'))}}><option value="online">Online</option><option value="idle">Idle (away from the keyboard)</option><option value="offline">Appear offline</option></select><small>Only people you share a chat with can see your profile and status.</small></div>}
      {panel==='search' &&     <form className="local-search" onSubmit={event=>void runSearch(event)}><label htmlFor="message-search">Search for</label><input id="message-search" value={query} onChange={event=>setQuery(event.target.value)} maxLength={256} required autoFocus/><button className="primary-button" disabled={state.fatal}>Search</button>{results!==null && <><button type="button" onClick={()=>setResults(null)}>Close results</button><p>{results.length} local matches{results.length===100?' (first 100)':''}</p><ul>{results.map(message=><li key={message.id}><button type="button" onClick={()=>{if(activeId!==message.conversation_id)searchThread.current=message.thread??'';setSelected(message.conversation_id);setPins(false);setThread(message.thread??'');setResults(null);setPanel(null)}}>{name(message.author_id)}: {message.text.slice(0,140)}</button></li>)}</ul></>}</form>}
      {panel==='access' && <>{pendingAccess===0 && <p>Nobody is waiting right now.</p>}    <div className="admission-requests">{Object.values(state.channels).filter((r,index,all)=>r.community.owner_id===session.account.id && all.findIndex(other=>other.community.id===r.community.id)===index).flatMap(roster=>roster.people.filter(p=>!admitted(roster,p)).map(person=><div key={roster.community.id+person.account.id}><p><strong>{person.account.username}</strong> wants to join {roster.community.name}.</p><code>{person.devices[0]?.identity_key.match(/.{1,4}/g)?.join(' ') ?? 'Waiting for their first device'}</code><p className="input-help">This is their safety code. Make sure it matches what their app shows before you approve.</p><button className="primary-button" disabled={busy || state.fatal || !person.devices.length} onClick={()=>{setBusy(true);void service.current?.approveMember(roster.channel.id,person.account.id,person.devices[0].identity_key).catch(error=>setError(error instanceof Error?error.message:'Member approval failed.')).finally(()=>setBusy(false))}}>Approve {person.account.username}</button></div>))}</div></>}
      {panel==='channel' && <><h3>{channel?.channel.name}</h3>          {channel && <div className="history-controls"><label htmlFor="channel-history">What new members can read</label>{channel.community.owner_id===session.account.id?<select id="channel-history" value={channel.policy?.history??'none'} disabled={!joined||busy||state.fatal} onChange={event=>void history(event.target.value as HistoryPolicy)}><option value="none">Only messages sent after they join</option><option value="since_invite">Messages since they were invited</option><option value="full">All saved messages</option></select>:<span>{channel.policy?.history==='full'?'All saved messages':channel.policy?.history==='since_invite'?'Messages since they were invited':'Only messages sent after they join'}</span>}{channel.policy?.history!=='none' && <button disabled={!joined||busy||state.fatal||state.history_waiting.includes(activeId)} onClick={()=>void history()}>{state.history_waiting.includes(activeId)?'Waiting for the owner’s device…':'Load earlier messages'}</button>}<small>Earlier messages are handed over when one of the owner’s devices is online. Messages sent before this was turned on cannot be recovered, and messages already shared cannot be taken back.</small></div>}{channel&&joined&&channel.community.owner_id===session.account.id&&<section className="emoji-settings"><h3>Custom emoji for this channel</h3><p>People who join later will not have these emoji until you publish them again.</p><form onSubmit={event=>{event.preventDefault();if(!service.current||!emojiFile)return;setBusy(true);setError('');void service.current.sendAttachment(activeId,emojiFile,'',emojiAlias).then(()=>setEmojiAlias('')).catch(error=>setError(error instanceof Error?error.message:'Emoji could not be published.')).finally(()=>setBusy(false))}}><label htmlFor="emoji-alias">Emoji name</label><input id="emoji-alias" pattern="[a-z0-9_]{1,32}" maxLength={32} required value={emojiAlias} onChange={event=>setEmojiAlias(event.target.value)}/><label htmlFor="emoji-file">Emoji image</label><input id="emoji-file" type="file" accept="image/png,image/jpeg,image/webp" required onChange={event=>setEmojiFile(event.target.files?.[0]??null)}/><button disabled={busy||state.fatal||!emojiAlias||!emojiFile}>Publish emoji</button></form></section>}</>}
      {error && <p className="input-error" role="alert">{error}</p>}
    </Modal>}
  </div>
}
