import {useEffect,useRef,useState,type FormEvent} from 'react'
import {HearthClient,HearthError,type Community,type CommunityStructure,type Session} from '@hearth/sdk'

export function CommunityPanel({session,url,onOpenChannel}:{session:Session;url:string;onOpenChannel:(id:string)=>Promise<void>}) {
  const [communities,setCommunities]=useState<Community[]>([])
  const [selected,setSelected]=useState('')
  const [structure,setStructure]=useState<CommunityStructure|null>(null)
  const [error,setError]=useState('')
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
    void new HearthClient(url).communities(session.token,{signal:controller.signal}).then(next=>{if(!controller.signal.aborted)setCommunities(next)}).catch(error=>{if(!controller.signal.aborted){setListFailed(true);setError(error instanceof HearthError?error.message:'Could not load communities.')}}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>{controller.abort();selection.current?.abort()}
  },[url,session.token,retry])
  useEffect(()=>{
    setStructure(null);setInvite('');setStructureFailed(false)
    if(!selected)return
    const controller=new AbortController();selection.current=controller;setError('')
    void new HearthClient(url).communityStructure(session.token,selected,{signal:controller.signal}).then(next=>{if(!controller.signal.aborted)setStructure(next)}).catch(error=>{if(!controller.signal.aborted){setStructureFailed(true);setError(error instanceof HearthError?error.message:'Could not load this community.')}})
    return ()=>controller.abort()
  },[selected,url,session.token,retry])
  async function action(event:FormEvent<HTMLFormElement>,kind:'create'|'join'|'category'|'channel'|'invite') {
    event.preventDefault()
    const form=event.currentTarget, data=new FormData(form), controller=lifetime.current
    if(!controller || controller.signal.aborted)return
    const client=new HearthClient(url), options={signal:controller.signal}, current=selected
    setBusy(true);setError('')
    try {
      if(kind==='create' || kind==='join') {
        const result=kind==='create'?await client.createCommunity(session.token,String(data.get('name')).trim(),options):await client.joinCommunity(session.token,String(data.get('code')).trim(),options)
        const next=await client.communities(session.token,options)
        if(!controller.signal.aborted){setCommunities(next);setSelected(result.id);form.reset()}
      } else if(kind==='invite') {
        const result=await client.createCommunityInvite(session.token,current,{expires_in_seconds:Number(data.get('expiry')),max_uses:Number(data.get('uses'))},options)
        if(!controller.signal.aborted)setInvite(result.code)
      } else {
        const name=String(data.get('name')).trim()
        if(kind==='category')await client.createCategory(session.token,current,name,options)
        else await client.createChannel(session.token,current,{name,category_id:String(data.get('category'))||null,kind:data.get('kind')==='announcement'?'announcement':'text'},options)
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
  const channels=(category:string|null)=>structure?.channels.filter(c=>c.category_id===category).map(c=><li key={c.id}><button disabled={busy} onClick={()=>void openChannel(c.id)}># {c.name}</button><small>{c.kind==='announcement'?'Announcements':'Text'}</small></li>)
  return <section className="community-panel" aria-labelledby="communities-heading" aria-busy={loading || busy}>
    <header className="chat-header"><h2 id="communities-heading">Communities</h2><small>Community setup</small></header>
    {error && <p className="input-error" role="alert">{error} <button disabled={busy} onClick={()=>setRetry(value=>value+1)}>Refresh communities</button></p>}
    <div className="community-layout">
      <nav aria-label="Your communities">
        {loading?<p role="status">Loading communities…</p>:listFailed?<p>Communities could not be loaded.</p>:communities.length===0?<p>No communities yet.</p>:communities.map(c=><button key={c.id} disabled={busy} className={selected===c.id?'selected':''} aria-current={selected===c.id?'page':undefined} onClick={()=>setSelected(c.id)}>{c.name}</button>)}
        <form onSubmit={event=>void action(event,'create')}><label htmlFor="community-name">Create a community</label><input id="community-name" name="name" maxLength={80} required disabled={busy} placeholder="Community name"/><button type="submit" disabled={busy || loading}>Create</button></form>
        <form onSubmit={event=>void action(event,'join')}><label htmlFor="community-code">Join with an invite</label><input id="community-code" name="code" required pattern="[a-f0-9]{64}" type="password" autoComplete="off" disabled={busy}/><button type="submit" disabled={busy || loading}>Join</button></form>
      </nav>
      <div className="community-structure">
        {structure?<><h3>{structure.community.name}</h3><p className="storage-note">Open a channel to exchange encrypted messages. New members receive messages after their device joins encryption; old history stays on existing devices.</p>
          <ul className="channel-directory">{channels(null)}</ul>
          {structure.categories.map(category=><section key={category.id}><h4>{category.name}</h4><ul className="channel-directory">{channels(category.id)}</ul></section>)}
          {structure.channels.length===0 && <p>No channels yet.</p>}
          {owner && <details><summary>Manage community</summary>
            <form onSubmit={event=>void action(event,'category')}><label htmlFor="category-name">New category</label><input id="category-name" name="name" required maxLength={80} disabled={busy}/><button type="submit" disabled={busy}>Add category</button></form>
            <form onSubmit={event=>void action(event,'channel')}><label htmlFor="channel-name">New channel</label><input id="channel-name" name="name" required maxLength={80} disabled={busy}/><label htmlFor="channel-category">Category</label><select id="channel-category" name="category" disabled={busy}><option value="">No category</option>{structure.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><label htmlFor="channel-kind">Channel type</label><select id="channel-kind" name="kind" disabled={busy}><option value="text">Text</option><option value="announcement">Announcement</option></select><button type="submit" disabled={busy}>Add channel</button></form>
            <form onSubmit={event=>void action(event,'invite')}><label htmlFor="community-invite-expiry">Invite expires in</label><select id="community-invite-expiry" name="expiry" disabled={busy}><option value="86400">24 hours</option><option value="3600">1 hour</option><option value="604800">7 days</option></select><label htmlFor="community-invite-uses">Maximum new members</label><input id="community-invite-uses" name="uses" type="number" min={1} max={1000} defaultValue={1} required disabled={busy}/><button type="submit" disabled={busy}>Create community invite</button></form>
            {invite && <div><label htmlFor="created-community-invite">Invite code</label><input id="created-community-invite" readOnly value={invite} onFocus={event=>event.currentTarget.select()}/><small>Share with someone who already has an account on this server.</small><button onClick={()=>setInvite('')}>Hide code</button></div>}
          </details>}</>:<p role="status">{selected?structureFailed?'Community could not be loaded.':'Loading community…':'Select, create or join a community.'}</p>}
      </div>
    </div>
  </section>
}
