import {useEffect,useRef,useState,type FormEvent} from 'react'
import {createPortal} from 'react-dom'

import {HearthClient,HearthError,resolveInviteCode,resolveSetupTarget,type Community,type CommunityStructure,type Session,type CommunityInvite,type Governance,type GovernanceView,type HearthInvite} from '@hearth/sdk'

import {Modal} from './Modal'
import {ShareInvite} from './ShareInvite'

import {Icon,type IconName} from './Icons'

import {GovernancePanel} from './GovernancePanel'

import {OwnershipPanel,type OwnershipActions} from './OwnershipPanel'

type Removal={kind:'channel'|'category'|'community';id:string;name:string;channels:string[]}
const ignoreRemoved=(_ids:string[])=>{}
const kinds:Record<string,{icon:IconName;label:string}>={text:{icon:'hash',label:'Text channel'},announcement:{icon:'megaphone',label:'Announcement channel'},forum:{icon:'forum',label:'Forum channel'},voice:{icon:'volume',label:'Voice room'},stage:{icon:'microphone',label:'Stage room'}}



export function CommunityPanel({home=false,onCommunity,onPick,session,url,onOpenChannel,onSecure,onInvite,activeChannel,onGovernance,onLoadGovernance,ownership,serverKey,pendingInvite,onInviteDone,onRemoved=ignoreRemoved}:{home?:boolean;onCommunity?:(id:string)=>void;onPick?:()=>void;onRemoved?:(ids:string[])=>void;serverKey:string;pendingInvite?:HearthInvite|null;onInviteDone?:()=>void;ownership:OwnershipActions;onLoadGovernance:(id:string)=>Promise<GovernanceView>;onGovernance:(id:string,policy:Governance)=>Promise<Governance>;session:Session;url:string;activeChannel?:string;onOpenChannel:(id:string)=>Promise<void>;onSecure:(kind:'community'|'channel'|'join',id:string,code?:string)=>Promise<void>;onInvite:(id:string,expiry:number,uses:number)=>Promise<CommunityInvite>}) {

  const [panel,setPanel]=useState<'create'|'join'|'manage'|null>(null)

  const [tab,setTab]=useState<'channels'|'categories'|'invites'|'governance'|'ownership'>('channels')

  const [communities,setCommunities]=useState<Community[]>([])

  const [selected,setSelected]=useState('')

  const [structure,setStructure]=useState<CommunityStructure|null>(null)

  const [error,setError]=useState('')
  const [refreshError,setRefreshError]=useState('')

  const [loading,setLoading]=useState(true)

  const [listFailed,setListFailed]=useState(false)

  const [structureFailed,setStructureFailed]=useState(false)

  const [retry,setRetry]=useState(0)

  const [busy,setBusy]=useState(false)
  const [removal,setRemoval]=useState<Removal|null>(null),[confirmation,setConfirmation]=useState(''),[notice,setNotice]=useState('')
  const deleteTrigger=useRef<HTMLButtonElement|null>(null)

  const [invite,setInvite]=useState('')
  const [accountInvite,setAccountInvite]=useState('')
  const [joinedNotice,setJoinedNotice]=useState(false)
  // Preserve a successful one-use claim if local admission work needs retrying.
  const claimedInvite=useRef<{code:string;community:Community}|null>(null)

  const lifetime=useRef<AbortController|null>(null)
  // The community tiles live in the app rail, outside this sidebar section.
  const [rail,setRail]=useState<HTMLElement|null>(null)
  useEffect(()=>{setRail(document.getElementById('rail-communities'))},[])
  useEffect(()=>{onCommunity?.(selected)},[selected,onCommunity])

  const selection=useRef<AbortController|null>(null)

  useEffect(()=>{

    const controller=new AbortController();lifetime.current=controller

    setCommunities([]);setStructure(null);setInvite('');setLoading(true);setListFailed(false);setError('');setBusy(false)

    void new HearthClient(url).communities(session.token,{signal:controller.signal}).then(next=>{if(!controller.signal.aborted){setCommunities(next);setSelected(current=>next.some(c=>c.id===current)?current:next[0]?.id??'')}}).catch(error=>{if(!controller.signal.aborted){setListFailed(true);setError(error instanceof HearthError?error.message:'Could not load communities.')}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})

    return ()=>{controller.abort();selection.current?.abort()}

  },[url,session.token,retry])

  useEffect(()=>{

    setStructure(null);setInvite('');setStructureFailed(false);setPanel(null);setRemoval(null)

    if(!selected)return

    const controller=new AbortController();selection.current=controller;setError('')

    void new HearthClient(url).communityStructure(session.token,selected,{signal:controller.signal}).then(next=>{if(!controller.signal.aborted)setStructure(next)}).catch(error=>{if(!controller.signal.aborted){setStructureFailed(true);setError(error instanceof HearthError?error.message:'Could not load this community.')}})

    return ()=>controller.abort()

  },[selected,url,session.token,retry])

  // Changes made on another device should appear without closing a panel or
  // resetting its form. Abort stale reads while a local action changes structure.
  useEffect(()=>{
    setRefreshError('')
    if(!selected||busy)return
    const controller=new AbortController(),client=new HearthClient(url)
    let pending=false
    const timer=setInterval(()=>{
      if(pending)return
      pending=true
      void client.communityStructure(session.token,selected,{signal:controller.signal}).then(next=>{
        if(!controller.signal.aborted){setStructure(previous=>previous?.community.id===selected?next:previous);setRefreshError('')}
      }).catch(error=>{if(!controller.signal.aborted){if(error instanceof HearthError&&[403,404].includes(error.status)){onRemoved(structure?.channels.map(channel=>channel.id)??[]);setCommunities(list=>list.filter(community=>community.id!==selected));setSelected('');setStructure(null);setNotice('This community is no longer available.')}else setRefreshError('The channel list could not refresh. Your current view is preserved.')}}).finally(()=>{pending=false})
    },15000)
    return()=>{clearInterval(timer);controller.abort()}
  },[selected,url,session.token,busy,retry,structure,onRemoved])

  async function action(event:FormEvent<HTMLFormElement>,kind:'create'|'join'|'category'|'channel'|'invite') {

    event.preventDefault()

    const form=event.currentTarget, data=new FormData(form), controller=lifetime.current

    if(!controller || controller.signal.aborted)return

    const client=new HearthClient(url), options={signal:controller.signal}, current=selected

    setBusy(true);setError('')
    if(kind==='invite'){setInvite('');setAccountInvite('')}

    try {

      if(kind==='create' || kind==='join') {
        let joinCode=String(data.get('code')).trim()
        if(kind==='join' && !/^[a-f0-9]{64}$/.test(joinCode)) {
          const resolved=/^hearth:/i.test(joinCode)?(await resolveSetupTarget(joinCode,options)).invite:await resolveInviteCode(url,joinCode,options)
          if(!resolved || resolved.server!==url || resolved.serverKey!==serverKey || !resolved.community)throw new Error('Use a community invite for this server. Join a different server from the server menu.')
          joinCode=resolved.community
        }
        const result=kind==='create'?await client.createCommunity(session.token,String(data.get('name')).trim(),options):await client.joinCommunity(session.token,joinCode,options)

        if(kind==='create')await onSecure('community',result.id)

        if(kind==='join')await onSecure('join',result.id,joinCode)

        const next=await client.communities(session.token,options)

        if(!controller.signal.aborted){setCommunities(next);setSelected(result.id);form.reset();setPanel(null)}

      } else if(kind==='invite') {

        const result=await onInvite(current,Number(data.get('expiry')),Number(data.get('uses')))

        if(!controller.signal.aborted){setInvite(result.code);setAccountInvite('')}
        if(data.get('include-account')==='on' && session.account.owner){
          try {
            const account=await client.accountInvite(session.token,options)
            if(!controller.signal.aborted)setAccountInvite(account.code)
          } catch {
            throw new Error('The community invite was created, but a new account could not be included. This invite can only be shared with an existing account. Try creating a new invite to include account setup.')
          }
        }

      } else {

        const name=String(data.get('name')).trim()

        if(kind==='category')await client.createCategory(session.token,current,name,options)

        else {const channel=await client.createChannel(session.token,current,{name,category_id:String(data.get('category'))||null,kind:data.get('kind')==='stage'?'stage':data.get('kind')==='voice'?'voice':data.get('kind')==='forum'?'forum':data.get('kind')==='announcement'?'announcement':'text'},options);await onSecure('channel',channel.id)}

        const next=await client.communityStructure(session.token,current,options)

        // Selecting another community cancels its read and ignores this old result.

        if(!controller.signal.aborted && selection.current && !selection.current.signal.aborted && next.community.id===current){setStructure(previous=>previous?.community.id===current?next:previous);form.reset()}

      }

    } catch(error) { if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not complete the action. Refresh and try again.') }

    finally {if(!controller.signal.aborted)setBusy(false)}

  }

  async function joinInvitedCommunity() {
    const code=pendingInvite?.community,controller=lifetime.current
    if(!code || !controller || controller.signal.aborted || busy)return
    setBusy(true);setError('');setJoinedNotice(false)
    try {
      const client=new HearthClient(url),options={signal:controller.signal}
      const community=claimedInvite.current?.code===code?claimedInvite.current.community:await client.joinCommunity(session.token,code,options)
      claimedInvite.current={code,community}
      await onSecure('join',community.id,code)
      const next=await client.communities(session.token,options)
      if(!controller.signal.aborted){setCommunities(next);setSelected(community.id);setJoinedNotice(true);claimedInvite.current=null;onInviteDone?.()}
    } catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not join this community. Try again.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }

  async function openChannel(id:string) {

    const controller=lifetime.current

    if(!controller || controller.signal.aborted)return

    setBusy(true);setError('')

    try {await onOpenChannel(id)}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not open this channel.')}

    finally{if(!controller.signal.aborted)setBusy(false)}

  }

  const owner=structure?.community.owner_id===session.account.id

  function askDelete(kind:Removal['kind'],id:string,name:string,trigger:HTMLButtonElement){
    if(!owner||busy)return
    deleteTrigger.current=trigger;setConfirmation('');setError('');setRemoval({kind,id,name,channels:kind==='community'?structure!.channels.map(channel=>channel.id):kind==='channel'?[id]:[]})
  }
  function cancelDelete(){setRemoval(null);setError('');requestAnimationFrame(()=>deleteTrigger.current?.isConnected&&deleteTrigger.current.focus())}
  async function remove(event:FormEvent){
    event.preventDefault();const target=removal,controller=lifetime.current
    if(!target||!owner||busy||!controller||controller.signal.aborted||confirmation!==target.name)return
    setBusy(true);setError('')
    try{
      const client=new HearthClient(url),options={signal:controller.signal}
      if(target.kind==='community')await client.deleteCommunity(session.token,selected,target.name,options)
      else if(target.kind==='category')await client.deleteCategory(session.token,selected,target.id,target.name,options)
      else await client.deleteChannel(session.token,selected,target.id,target.name,options)
      if(controller.signal.aborted)return
      onRemoved(target.channels);setRemoval(null);setNotice(`${target.name} deleted.`)
      if(target.kind==='community'){setCommunities(list=>list.filter(community=>community.id!==target.id));setSelected('');setStructure(null);setPanel(null)}
      else{const next=await client.communityStructure(session.token,selected,options);if(!controller.signal.aborted)setStructure(next)}
    }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'The item could not be deleted. Refresh and try again.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }

  const channels=(category:string|null)=>structure?.channels.filter(c=>c.category_id===category).map(c=><li key={c.id}><button data-channel-name={c.name} title={(kinds[c.kind]??kinds.text).label} disabled={busy} className={activeChannel===c.id?'selected':''} aria-current={activeChannel===c.id?'page':undefined} onClick={()=>void openChannel(c.id)}><Icon name={(kinds[c.kind]??kinds.text).icon}/><span className="visually-hidden">{(kinds[c.kind]??kinds.text).label}: </span> {c.name}</button></li>)

  function closePanel(){setPanel(null);setInvite('');setAccountInvite('')}

  const tiles=<nav className="community-rail" aria-label="Your communities">{communities.map(c=><button key={c.id} disabled={busy} className={`community-link rail-tile ${selected===c.id&&!home?'selected':''}`} title={c.name} aria-label={c.name} aria-current={selected===c.id&&!home?'page':undefined} onClick={()=>{setSelected(c.id);onPick?.()}}>{c.name.trim().slice(0,2).toUpperCase()}</button>)}<button className="rail-tile add-community" aria-label="Create or join a community" title="Create or join a community" onClick={()=>setPanel('join')}><Icon name="plus" /></button></nav>

  return <section className="community-panel" aria-labelledby="communities-heading" aria-busy={loading || busy}>

    <h2 id="communities-heading" className="visually-hidden">Communities</h2>
    {rail&&createPortal(tiles,rail)}
    {pendingInvite?.community && <div className="pending-invite"><strong>You have a community invite</strong><p>Join now. Its channels open once a member who is already in is online.</p><button type="button" className="primary-button" disabled={busy||loading} onClick={()=>void joinInvitedCommunity()}>Join invited community</button><button type="button" disabled={busy} onClick={()=>onInviteDone?.()}>Discard invite</button></div>}
    {joinedNotice && <p className="navigation-empty" role="status">You joined. If channels stay closed, ask a member who is already in to open Hearth.</p>}
    {notice&&<p className="navigation-empty" role="status">{notice}</p>}

    {(error||refreshError) && !panel && <p className="input-error" role="alert">{error||refreshError} <button disabled={busy} onClick={()=>setRetry(value=>value+1)}>Refresh communities</button></p>}

    {loading?<p className="navigation-empty" role="status">Loading communities…</p>:listFailed?<p className="navigation-empty">Communities could not be loaded.</p>:communities.length===0?<div className="navigation-empty community-empty"><strong>Communities</strong><p>A community is a group space with its own channels. Start one for your friends, or join one with an invite.</p><button onClick={()=>setPanel('join')}>Join a community</button><button onClick={()=>setPanel('create')}>Create one</button></div>:null}

    <div className="community-structure">

      {home?null:structure?<><header className="navigation-heading community-heading"><h3>{structure.community.name}</h3><button className="icon-button" aria-label={owner?'Manage community':'Community settings'} title="Community settings" onClick={()=>{if(!owner)setTab('ownership');setPanel('manage')}}><Icon name="settings" /></button></header>

        <ul className="channel-directory">{channels(null)}</ul>

        {structure.categories.map(category=><section key={category.id}><h4>{category.name}</h4><ul className="channel-directory">{channels(category.id)}</ul></section>)}

        {structure.channels.length===0 && <div className="navigation-empty"><p>No channels yet. Channels are the rooms where people talk.</p>{owner && <button onClick={()=>{setTab('channels');setPanel('manage')}}>Add a channel</button>}</div>}

      </>:selected?<p className="navigation-empty" role="status">{structureFailed?'Community could not be loaded.':'Loading channels…'}</p>:null}

    </div>

    {panel && <Modal title={removal?`Delete ${removal.kind}?`:panel==='create'?'Create a community':panel==='join'?'Join a community':`${structure?.community.name ?? 'Community'} settings`} onClose={()=>{if(removal){if(!busy)cancelDelete()}else closePanel()}}

      description={removal?undefined:panel==='manage'?'Set up channels and invite people who already have an account on this server.':'A community is your group’s space on this server. Channels are the rooms inside it, like #general or #announcements.'}>

      <div hidden={!!removal} style={removal?{display:'none'}:undefined}>

      {panel!=='manage' && <div className="panel-tabs" aria-label="Community setup"><button aria-pressed={panel==='join'} onClick={()=>{setPanel('join');setError('')}}>Join with an invite</button><button aria-pressed={panel==='create'} onClick={()=>{setPanel('create');setError('')}}>Create a community</button></div>}

      {panel==='create' && <form onSubmit={event=>void action(event,'create')}><label htmlFor="community-name">Community name</label><input id="community-name" name="name" maxLength={80} required disabled={busy} placeholder="Weekend friends" autoFocus/><small>You will be its owner. You can add channels and invite people next.</small><button className="primary-button" type="submit" disabled={busy || loading}>Create community</button></form>}

      {panel==='join' && <form onSubmit={event=>void action(event,'join')}><label htmlFor="community-code">Community invite code</label><input id="community-code" name="code" required maxLength={2048} type="text" spellCheck={false} autoComplete="off" disabled={busy} autoFocus/><small>Paste the invite someone from that community sent you. It only works on the server it was made for.</small><button className="primary-button" type="submit" disabled={busy || loading}>Join community</button></form>}

      {panel==='manage'&&structure&&<>{owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='channels'} onClick={()=>setTab('channels')}>Channels</button><button aria-pressed={tab==='categories'} onClick={()=>setTab('categories')}>Categories</button><button aria-pressed={tab==='invites'} onClick={()=>setTab('invites')}>Invites</button><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Roles & moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{!owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{tab==='ownership'&&<OwnershipPanel id={structure.community.id} session={session} url={url} actions={ownership} onLoadGovernance={onLoadGovernance} onChanged={()=>{const client=new HearthClient(url);void Promise.all([client.communityStructure(session.token,selected),client.communities(session.token)]).then(([next,list])=>{setStructure(next);setCommunities(list)}).catch(e=>setError(e instanceof Error?e.message:'Refresh communities to see the new owner.'))}}/>}</>}

      {panel==='manage'&&!owner&&structure&&<>{tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}</>}

      {panel==='manage' && owner && <>



        {tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}

        {tab==='categories' && <form onSubmit={event=>void action(event,'category')}><label htmlFor="category-name">Category name</label><input id="category-name" name="name" required maxLength={80} disabled={busy} placeholder="Hangouts"/><small>A category is a heading that groups related channels in the sidebar.</small><button className="primary-button" type="submit" disabled={busy}>Add category</button></form>}
        {tab==='categories'&&structure&&<ul className="structure-management">{structure.categories.map(category=><li key={category.id}><span>{category.name}</span><button className="danger-button" disabled={busy} aria-label={`Delete category ${category.name}`} onClick={event=>askDelete('category',category.id,category.name,event.currentTarget)}>Delete</button></li>)}</ul>}

        {tab==='channels' && <form onSubmit={event=>void action(event,'channel')}><label htmlFor="channel-name">Channel name</label><input id="channel-name" name="name" required maxLength={80} disabled={busy} placeholder="general"/><label htmlFor="channel-kind">What is it for?</label><select id="channel-kind" name="kind" disabled={busy}><option value="text">Text: everyone can chat</option><option value="announcement">Announcements: only the owner posts</option><option value="forum">Forum: posts that each get their own replies</option><option value="voice">Voice: drop in and talk</option><option value="stage">Stage: a few speakers, everyone else listens</option></select>{structure.categories.length>0?<><label htmlFor="channel-category">Category</label><select id="channel-category" name="category" disabled={busy}><option value="">No category</option>{structure.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></>:<input type="hidden" name="category" value=""/>}<button className="primary-button" type="submit" disabled={busy}>Add channel</button></form>}
        {tab==='channels'&&structure&&structure.channels.length>0&&<><h3>Your channels</h3><ul className="structure-management">{structure.channels.map(channel=><li key={channel.id}><span><Icon name={(kinds[channel.kind]??kinds.text).icon}/>{channel.name}</span><button className="danger-button" disabled={busy} aria-label={`Delete channel ${channel.name}`} onClick={event=>askDelete('channel',channel.id,channel.name,event.currentTarget)}>Delete</button></li>)}</ul></>}

        {tab==='invites' && <><form onSubmit={event=>void action(event,'invite')}><label htmlFor="community-invite-expiry">Invite stops working after</label><select id="community-invite-expiry" name="expiry" disabled={busy}><option value="86400">24 hours</option><option value="3600">1 hour</option><option value="604800">7 days</option></select><label htmlFor="community-invite-uses">How many people can use it</label><input id="community-invite-uses" name="uses" type="number" min={1} max={1000} defaultValue={1} required disabled={busy}/>{session.account.owner && <label><input name="include-account" type="checkbox" disabled={busy} /> They are new here: also let them create an account on this server (one person, 24 hours)</label>}<button className="primary-button" type="submit" disabled={busy}>Create community invite</button></form>

          {busy && <p role="status">Preparing invite…</p>}
          {invite && !busy && <div className="invite-result"><ShareInvite key={invite+accountInvite} token={session.token} invite={{server:url,serverKey,community:invite,...(accountInvite?{account:accountInvite}:{})}}/><button onClick={()=>{setInvite('');setAccountInvite('')}}>Hide code</button></div>}</>}

      </>}

      {panel==='manage'&&owner&&structure&&tab==='ownership'&&<section className="structure-delete-community"><h3>Delete community</h3><p>Removes this community and all its channels for everyone. Messages and files people already saved, and backups, are not erased.</p><button className="danger-button" disabled={busy} onClick={event=>askDelete('community',structure.community.id,structure.community.name,event.currentTarget)}>Delete community</button></section>}
      </div>
      {removal&&<form className="structure-delete-confirmation" onSubmit={event=>void remove(event)}><p>{removal.kind==='category'?<>Delete <strong>{removal.name}</strong>? Its channels will be kept and moved out of this category.</>:<>Delete <strong>{removal.name}</strong>{removal.kind==='community'?' and all its channels':''}? People lose access, and new messages and calls stop. Messages and files people already saved, and backups, are not erased.</>}</p><label htmlFor="delete-structure-name">Type {removal.name} to confirm</label><input id="delete-structure-name" autoFocus autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy}/><div className="form-actions"><button type="button" disabled={busy} onClick={cancelDelete}>Cancel</button><button type="submit" className="danger-button" disabled={busy||!owner||confirmation!==removal.name}>{busy?'Deleting…':`Delete ${removal.kind}`}</button></div></form>}

      {error && <p className="input-error" role="alert">{error}</p>}

    </Modal>}

  </section>

}
