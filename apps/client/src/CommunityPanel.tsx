import {useEffect,useRef,useState,type FormEvent} from 'react'

import {HearthClient,HearthError,type Community,type CommunityStructure,type Session,type CommunityInvite,type Governance,type GovernanceView} from '@hearth/sdk'

import {Modal} from './Modal'

import {Icon} from './Icons'

import {GovernancePanel} from './GovernancePanel'

import {OwnershipPanel,type OwnershipActions} from './OwnershipPanel'



export function CommunityPanel({session,url,onOpenChannel,onSecure,onInvite,activeChannel,onGovernance,onLoadGovernance,ownership}:{ownership:OwnershipActions;onLoadGovernance:(id:string)=>Promise<GovernanceView>;onGovernance:(id:string,policy:Governance)=>Promise<Governance>;session:Session;url:string;activeChannel?:string;onOpenChannel:(id:string)=>Promise<void>;onSecure:(kind:'community'|'channel'|'join',id:string,code?:string)=>Promise<void>;onInvite:(id:string,expiry:number,uses:number)=>Promise<CommunityInvite>}) {

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

  const [invite,setInvite]=useState('')

  const lifetime=useRef<AbortController|null>(null)

  const selection=useRef<AbortController|null>(null)

  useEffect(()=>{

    const controller=new AbortController();lifetime.current=controller

    setCommunities([]);setStructure(null);setInvite('');setLoading(true);setListFailed(false);setError('');setBusy(false)

    void new HearthClient(url).communities(session.token,{signal:controller.signal}).then(next=>{if(!controller.signal.aborted){setCommunities(next);setSelected(current=>next.some(c=>c.id===current)?current:next[0]?.id??'')}}).catch(error=>{if(!controller.signal.aborted){setListFailed(true);setError(error instanceof HearthError?error.message:'Could not load communities.')}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})

    return ()=>{controller.abort();selection.current?.abort()}

  },[url,session.token,retry])

  useEffect(()=>{

    setStructure(null);setInvite('');setStructureFailed(false);setPanel(null)

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
      }).catch(()=>{if(!controller.signal.aborted)setRefreshError('The channel list could not refresh. Your current view is preserved.')}).finally(()=>{pending=false})
    },15000)
    return()=>{clearInterval(timer);controller.abort()}
  },[selected,url,session.token,busy,retry])

  async function action(event:FormEvent<HTMLFormElement>,kind:'create'|'join'|'category'|'channel'|'invite') {

    event.preventDefault()

    const form=event.currentTarget, data=new FormData(form), controller=lifetime.current

    if(!controller || controller.signal.aborted)return

    const client=new HearthClient(url), options={signal:controller.signal}, current=selected

    setBusy(true);setError('')

    try {

      if(kind==='create' || kind==='join') {

        const result=kind==='create'?await client.createCommunity(session.token,String(data.get('name')).trim(),options):await client.joinCommunity(session.token,String(data.get('code')).trim(),options)

        if(kind==='create')await onSecure('community',result.id)

        if(kind==='join')await onSecure('join',result.id,String(data.get('code')).trim())

        const next=await client.communities(session.token,options)

        if(!controller.signal.aborted){setCommunities(next);setSelected(result.id);form.reset();setPanel(null)}

      } else if(kind==='invite') {

        const result=await onInvite(current,Number(data.get('expiry')),Number(data.get('uses')))

        if(!controller.signal.aborted)setInvite(result.code)

      } else {

        const name=String(data.get('name')).trim()

        if(kind==='category')await client.createCategory(session.token,current,name,options)

        else {const channel=await client.createChannel(session.token,current,{name,category_id:String(data.get('category'))||null,kind:data.get('kind')==='forum'?'forum':data.get('kind')==='announcement'?'announcement':'text'},options);await onSecure('channel',channel.id)}

        const next=await client.communityStructure(session.token,current,options)

        // Selecting another community cancels its read and ignores this old result.

        if(!controller.signal.aborted && selection.current && !selection.current.signal.aborted && next.community.id===current){setStructure(previous=>previous?.community.id===current?next:previous);form.reset()}

      }

    } catch(error) { if(!controller.signal.aborted)setError(error instanceof HearthError?error.message:'Could not complete the action. Refresh and try again.') }

    finally {if(!controller.signal.aborted)setBusy(false)}

  }

  async function openChannel(id:string) {

    const controller=lifetime.current

    if(!controller || controller.signal.aborted)return

    setBusy(true);setError('')

    try {await onOpenChannel(id)}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Could not open this channel.')}

    finally{if(!controller.signal.aborted)setBusy(false)}

  }

  const owner=structure?.community.owner_id===session.account.id

  const channels=(category:string|null)=>structure?.channels.filter(c=>c.category_id===category).map(c=><li key={c.id}><button data-channel-name={c.name} title={c.kind==='forum'?'Forum channel':c.kind==='announcement'?'Announcement channel':'Text channel'} disabled={busy} className={activeChannel===c.id?'selected':''} aria-current={activeChannel===c.id?'page':undefined} onClick={()=>void openChannel(c.id)}><span aria-hidden="true">{c.kind==='forum'?'▤':c.kind==='announcement'?'◈':'#'}</span> {c.name}</button><small>{c.kind==='forum'?'Forum':c.kind==='announcement'?'Announcements':''}</small></li>)

  function closePanel(){setPanel(null);setInvite('')}

  return <section className="community-panel" aria-labelledby="communities-heading" aria-busy={loading || busy}>

    <header className="navigation-heading"><h2 id="communities-heading">Communities</h2><button className="icon-button" aria-label="Create or join a community" title="Create or join a community" onClick={()=>setPanel('join')}><Icon name="plus" /></button></header>

    {(error||refreshError) && !panel && <p className="input-error" role="alert">{error||refreshError} <button disabled={busy} onClick={()=>setRetry(value=>value+1)}>Refresh communities</button></p>}

    <nav aria-label="Your communities">

      {loading?<p className="navigation-empty" role="status">Loading communities…</p>:listFailed?<p className="navigation-empty">Communities could not be loaded.</p>:communities.length===0?<div className="navigation-empty"><p>Your groups live here.</p><button onClick={()=>setPanel('join')}>Join a community</button></div>:communities.map(c=><button key={c.id} disabled={busy} className={`community-link ${selected===c.id?'selected':''}`} aria-current={selected===c.id?'page':undefined} onClick={()=>setSelected(c.id)}><Icon name="users" />{c.name}</button>)}

    </nav>

    <div className="community-structure">

      {structure?<><header className="navigation-heading"><h3>{structure.community.name}</h3><button className="icon-button" aria-label={owner?'Manage community':'Community settings'} title="Community settings" onClick={()=>{if(!owner)setTab('ownership');setPanel('manage')}}><Icon name="settings" /></button></header>

        <ul className="channel-directory">{channels(null)}</ul>

        {structure.categories.map(category=><section key={category.id}><h4>{category.name}</h4><ul className="channel-directory">{channels(category.id)}</ul></section>)}

        {structure.channels.length===0 && <div className="navigation-empty"><p>No channels yet.</p>{owner && <button onClick={()=>{setTab('channels');setPanel('manage')}}>Add a channel</button>}</div>}

      </>:selected?<p className="navigation-empty" role="status">{structureFailed?'Community could not be loaded.':'Loading channels…'}</p>:null}

    </div>

    {panel && <Modal title={panel==='create'?'Create a community':panel==='join'?'Join a community':`${structure?.community.name ?? 'Community'} settings`} onClose={closePanel}

      description={panel==='manage'?'Organize this group’s channels and invite people who already have an account on this server.':'A community is your group’s space on this server. Channels are rooms inside it, such as #general or #announcements.'}>

      {panel!=='manage' && <div className="panel-tabs" aria-label="Community setup"><button aria-pressed={panel==='join'} onClick={()=>{setPanel('join');setError('')}}>Join with an invite</button><button aria-pressed={panel==='create'} onClick={()=>{setPanel('create');setError('')}}>Create a community</button></div>}

      {panel==='create' && <form onSubmit={event=>void action(event,'create')}><label htmlFor="community-name">Community name</label><input id="community-name" name="name" maxLength={80} required disabled={busy} placeholder="Weekend friends" autoFocus/><small>You’ll manage this community. Add channels after creating it.</small><button className="primary-button" type="submit" disabled={busy || loading}>Create community</button></form>}

      {panel==='join' && <form onSubmit={event=>void action(event,'join')}><label htmlFor="community-code">Community invite code</label><input id="community-code" name="code" required pattern="[a-f0-9]{64}" type="password" autoComplete="off" disabled={busy} autoFocus/><small>Ask a community owner for this code. To create a server account, use an account invite on the sign-in screen.</small><button className="primary-button" type="submit" disabled={busy || loading}>Join community</button></form>}

      {panel==='manage'&&structure&&<>{owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='channels'} onClick={()=>setTab('channels')}>Channels</button><button aria-pressed={tab==='categories'} onClick={()=>setTab('categories')}>Categories</button><button aria-pressed={tab==='invites'} onClick={()=>setTab('invites')}>Invites</button><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Roles & moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{!owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{tab==='ownership'&&<OwnershipPanel id={structure.community.id} session={session} url={url} actions={ownership} onLoadGovernance={onLoadGovernance} onChanged={()=>{const client=new HearthClient(url);void Promise.all([client.communityStructure(session.token,selected),client.communities(session.token)]).then(([next,list])=>{setStructure(next);setCommunities(list)}).catch(e=>setError(e instanceof Error?e.message:'Refresh communities to see the new owner.'))}}/>}</>}

      {panel==='manage'&&!owner&&structure&&<>{tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}</>}

      {panel==='manage' && owner && <>



        {tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}

        {tab==='categories' && <form onSubmit={event=>void action(event,'category')}><label htmlFor="category-name">Category name</label><input id="category-name" name="name" required maxLength={80} disabled={busy} placeholder="Hangouts"/><small>Categories group related channels in the sidebar.</small><button className="primary-button" type="submit" disabled={busy}>Add category</button></form>}

        {tab==='channels' && <form onSubmit={event=>void action(event,'channel')}><label htmlFor="channel-name">Channel name</label><input id="channel-name" name="name" required maxLength={80} disabled={busy} placeholder="general"/><label htmlFor="channel-category">Category</label><select id="channel-category" name="category" disabled={busy}><option value="">No category</option>{structure.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label htmlFor="channel-kind">Channel type</label><select id="channel-kind" name="kind" disabled={busy}><option value="text">Text — everyone can chat</option><option value="announcement">Announcement — only the owner can post</option><option value="forum">Forum — posts with dedicated replies</option></select><button className="primary-button" type="submit" disabled={busy}>Add channel</button></form>}

        {tab==='invites' && <><form onSubmit={event=>void action(event,'invite')}><label htmlFor="community-invite-expiry">Invite expires in</label><select id="community-invite-expiry" name="expiry" disabled={busy}><option value="86400">24 hours</option><option value="3600">1 hour</option><option value="604800">7 days</option></select><label htmlFor="community-invite-uses">Maximum new members</label><input id="community-invite-uses" name="uses" type="number" min={1} max={1000} defaultValue={1} required disabled={busy}/><button className="primary-button" type="submit" disabled={busy}>Create community invite</button></form>

          {invite && <div className="invite-result"><label htmlFor="created-community-invite">Community invite code</label><input id="created-community-invite" readOnly value={invite} onFocus={event=>event.currentTarget.select()}/><small>Share with someone who already has an account on this server. If they need an account, the server owner can create an account invite in Server settings.</small><button onClick={()=>setInvite('')}>Hide code</button></div>}</>}

      </>}

      {error && <p className="input-error" role="alert">{error}</p>}

    </Modal>}

  </section>

}
