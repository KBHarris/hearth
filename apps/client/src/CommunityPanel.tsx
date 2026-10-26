import {useEffect,useRef,useState,type FormEvent} from 'react'

import {HearthClient,HearthError,resolveInviteCode,resolveSetupTarget,type Community,type CommunityStructure,type Session,type CommunityInvite,type Governance,type GovernanceView,type HearthInvite} from '@hearth/sdk'

import {Modal} from './Modal'
import {ShareInvite} from './ShareInvite'

import {Icon} from './Icons'

import {GovernancePanel} from './GovernancePanel'

import {OwnershipPanel,type OwnershipActions} from './OwnershipPanel'

type Removal={kind:'channel'|'category'|'community';id:string;name:string;channels:string[]}
const ignoreRemoved=(_ids:string[])=>{}



export function CommunityPanel({session,url,onOpenChannel,onSecure,onInvite,activeChannel,onGovernance,onLoadGovernance,ownership,serverKey,pendingInvite,onInviteDone,onRemoved=ignoreRemoved}:{onRemoved?:(ids:string[])=>void;serverKey:string;pendingInvite?:HearthInvite|null;onInviteDone?:()=>void;ownership:OwnershipActions;onLoadGovernance:(id:string)=>Promise<GovernanceView>;onGovernance:(id:string,policy:Governance)=>Promise<Governance>;session:Session;url:string;activeChannel?:string;onOpenChannel:(id:string)=>Promise<void>;onSecure:(kind:'community'|'channel'|'join',id:string,code?:string)=>Promise<void>;onInvite:(id:string,expiry:number,uses:number)=>Promise<CommunityInvite>}) {

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

  const channels=(category:string|null)=>structure?.channels.filter(c=>c.category_id===category).map(c=><li key={c.id}><button data-channel-name={c.name} title={c.kind==='stage'?'Stage room':c.kind==='voice'?'Voice room':c.kind==='forum'?'Forum channel':c.kind==='announcement'?'Announcement channel':'Text channel'} disabled={busy} className={activeChannel===c.id?'selected':''} aria-current={activeChannel===c.id?'page':undefined} onClick={()=>void openChannel(c.id)}><span aria-hidden="true">{c.kind==='stage'?'◉':c.kind==='voice'?'◖':c.kind==='forum'?'▤':c.kind==='announcement'?'◈':'#'}</span> {c.name}</button><small>{c.kind==='stage'?'Stage':c.kind==='voice'?'Voice':c.kind==='forum'?'Forum':c.kind==='announcement'?'Announcements':''}</small></li>)

  function closePanel(){setPanel(null);setInvite('');setAccountInvite('')}

  return <section className="community-panel" aria-labelledby="communities-heading" aria-busy={loading || busy}>

    <header className="navigation-heading"><h2 id="communities-heading">Communities</h2><button className="icon-button" aria-label="Create or join a community" title="Create or join a community" onClick={()=>setPanel('join')}><Icon name="plus" /></button></header>
    {pendingInvite?.community && <div className="pending-invite"><strong>Community invite ready</strong><p>Join the community from your invite. An approved member’s device may need to be online before encrypted channels open.</p><button type="button" disabled={busy||loading} onClick={()=>void joinInvitedCommunity()}>Join invited community</button><button type="button" disabled={busy} onClick={()=>onInviteDone?.()}>Discard invite</button></div>}
    {joinedNotice && <p className="navigation-empty" role="status">Community joined. If channels are waiting for access, ask an approved member to open Hearth.</p>}
    {notice&&<p className="navigation-empty" role="status">{notice}</p>}

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

    {panel && <Modal title={removal?`Delete ${removal.kind}?`:panel==='create'?'Create a community':panel==='join'?'Join a community':`${structure?.community.name ?? 'Community'} settings`} onClose={()=>{if(removal){if(!busy)cancelDelete()}else closePanel()}}

      description={removal?undefined:panel==='manage'?'Organize this group’s channels and invite people who already have an account on this server.':'A community is your group’s space on this server. Channels are rooms inside it, such as #general or #announcements.'}>

      <div hidden={!!removal} style={removal?{display:'none'}:undefined}>

      {panel!=='manage' && <div className="panel-tabs" aria-label="Community setup"><button aria-pressed={panel==='join'} onClick={()=>{setPanel('join');setError('')}}>Join with an invite</button><button aria-pressed={panel==='create'} onClick={()=>{setPanel('create');setError('')}}>Create a community</button></div>}

      {panel==='create' && <form onSubmit={event=>void action(event,'create')}><label htmlFor="community-name">Community name</label><input id="community-name" name="name" maxLength={80} required disabled={busy} placeholder="Weekend friends" autoFocus/><small>You’ll manage this community. Add channels after creating it.</small><button className="primary-button" type="submit" disabled={busy || loading}>Create community</button></form>}

      {panel==='join' && <form onSubmit={event=>void action(event,'join')}><label htmlFor="community-code">Community invite code</label><input id="community-code" name="code" required maxLength={2048} type="text" spellCheck={false} autoComplete="off" disabled={busy} autoFocus/><small>Paste the pretty 32-character code for this server. To create an account, use Join a server first.</small><button className="primary-button" type="submit" disabled={busy || loading}>Join community</button></form>}

      {panel==='manage'&&structure&&<>{owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='channels'} onClick={()=>setTab('channels')}>Channels</button><button aria-pressed={tab==='categories'} onClick={()=>setTab('categories')}>Categories</button><button aria-pressed={tab==='invites'} onClick={()=>setTab('invites')}>Invites</button><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Roles & moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{!owner&&<div className="panel-tabs" aria-label="Community settings"><button aria-pressed={tab==='governance'} onClick={()=>setTab('governance')}>Moderation</button><button aria-pressed={tab==='ownership'} onClick={()=>setTab('ownership')}>Ownership</button></div>}{tab==='ownership'&&<OwnershipPanel id={structure.community.id} session={session} url={url} actions={ownership} onLoadGovernance={onLoadGovernance} onChanged={()=>{const client=new HearthClient(url);void Promise.all([client.communityStructure(session.token,selected),client.communities(session.token)]).then(([next,list])=>{setStructure(next);setCommunities(list)}).catch(e=>setError(e instanceof Error?e.message:'Refresh communities to see the new owner.'))}}/>}</>}

      {panel==='manage'&&!owner&&structure&&<>{tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}</>}

      {panel==='manage' && owner && <>



        {tab==='governance'&&<GovernancePanel structure={structure} session={session} url={url} onSave={onGovernance} onLoad={onLoadGovernance}/>}

        {tab==='categories' && <form onSubmit={event=>void action(event,'category')}><label htmlFor="category-name">Category name</label><input id="category-name" name="name" required maxLength={80} disabled={busy} placeholder="Hangouts"/><small>Categories group related channels in the sidebar.</small><button className="primary-button" type="submit" disabled={busy}>Add category</button></form>}
        {tab==='categories'&&structure&&<ul className="structure-management">{structure.categories.map(category=><li key={category.id}><span>{category.name}</span><button className="danger-button" disabled={busy} aria-label={`Delete category ${category.name}`} onClick={event=>askDelete('category',category.id,category.name,event.currentTarget)}>Delete</button></li>)}</ul>}

        {tab==='channels' && <form onSubmit={event=>void action(event,'channel')}><label htmlFor="channel-name">Channel name</label><input id="channel-name" name="name" required maxLength={80} disabled={busy} placeholder="general"/><label htmlFor="channel-category">Category</label><select id="channel-category" name="category" disabled={busy}><option value="">No category</option>{structure.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label htmlFor="channel-kind">Channel type</label><select id="channel-kind" name="kind" disabled={busy}><option value="text">Text — everyone can chat</option><option value="announcement">Announcement — only the owner can post</option><option value="forum">Forum — posts with dedicated replies</option><option value="voice">Voice — join and leave room audio</option><option value="stage">Stage — speakers and a listening audience</option></select><button className="primary-button" type="submit" disabled={busy}>Add channel</button></form>}
        {tab==='channels'&&structure&&<ul className="structure-management">{structure.channels.map(channel=><li key={channel.id}><span>{channel.name}</span><button className="danger-button" disabled={busy} aria-label={`Delete channel ${channel.name}`} onClick={event=>askDelete('channel',channel.id,channel.name,event.currentTarget)}>Delete</button></li>)}</ul>}

        {tab==='invites' && <><form onSubmit={event=>void action(event,'invite')}><label htmlFor="community-invite-expiry">Invite expires in</label><select id="community-invite-expiry" name="expiry" disabled={busy}><option value="86400">24 hours</option><option value="3600">1 hour</option><option value="604800">7 days</option></select><label htmlFor="community-invite-uses">Maximum new members</label><input id="community-invite-uses" name="uses" type="number" min={1} max={1000} defaultValue={1} required disabled={busy}/>{session.account.owner && <label><input name="include-account" type="checkbox" disabled={busy} /> Include a new server account (single use, 24 hours)</label>}<button className="primary-button" type="submit" disabled={busy}>Create community invite</button></form>

          {busy && <p role="status">Preparing invite…</p>}
          {invite && !busy && <div className="invite-result"><ShareInvite key={invite+accountInvite} token={session.token} invite={{server:url,serverKey,community:invite,...(accountInvite?{account:accountInvite}:{})}}/><button onClick={()=>{setInvite('');setAccountInvite('')}}>Hide code</button></div>}</>}

      </>}

      {panel==='manage'&&owner&&structure&&<section className="structure-delete-community"><h3>Delete community</h3><p>Remove this community and all its channels. Saved messages, files and backups are not erased.</p><button className="danger-button" disabled={busy} onClick={event=>askDelete('community',structure.community.id,structure.community.name,event.currentTarget)}>Delete community</button></section>}
      </div>
      {removal&&<form className="structure-delete-confirmation" onSubmit={event=>void remove(event)}><p>{removal.kind==='category'?<>Delete <strong>{removal.name}</strong>? Its channels will be kept and moved out of this category.</>:<>Delete <strong>{removal.name}</strong>{removal.kind==='community'?' and all its channels':''}? This removes access and stops new messages and calls. Saved messages, files and backups are not erased.</>}</p><label htmlFor="delete-structure-name">Type {removal.name} to confirm</label><input id="delete-structure-name" autoFocus autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy}/><div className="form-actions"><button type="button" disabled={busy} onClick={cancelDelete}>Cancel</button><button type="submit" className="danger-button" disabled={busy||!owner||confirmation!==removal.name}>{busy?'Deleting…':`Delete ${removal.kind}`}</button></div></form>}

      {error && <p className="input-error" role="alert">{error}</p>}

    </Modal>}

  </section>

}
