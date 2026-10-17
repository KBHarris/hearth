import {useEffect,useRef,useState} from 'react'
import {Modal} from './Modal'
import {memberInitials,type MemberProfile} from './members'

export function MemberList({members,channel,onClose,onSelect}:{members:MemberProfile[];channel:boolean;onClose?:()=>void;onSelect:(id:string)=>void}){
  const list=useRef<HTMLElement>(null)
  useEffect(()=>{if(onClose&&window.matchMedia('(max-width: 1149px)').matches)list.current?.querySelector<HTMLButtonElement>('button')?.focus()},[onClose])
  return <aside ref={list} id="server-members" className="member-sidebar" aria-label={channel?'Server Members':'Conversation members'} onKeyDown={event=>{if(event.key==='Escape'&&onClose){event.preventDefault();onClose()}if(event.key==='Tab'&&window.matchMedia('(max-width: 1149px)').matches){const buttons=Array.from(event.currentTarget.querySelectorAll('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(index<0||(!event.shiftKey&&index===buttons.length-1)||(event.shiftKey&&index===0)){event.preventDefault();buttons[event.shiftKey?buttons.length-1:0]?.focus()}}}}>
    <header><h2>{channel?'Server Members':'Conversation members'} <span>{members.length}</span></h2>{onClose&&<button className="icon-button" aria-label="Close member list" onClick={onClose}>×</button>}</header>
    <ul>{members.map(member=><li key={member.id}><button className="member-row" onClick={()=>onSelect(member.id)} aria-label={`View profile for ${member.username}`}>
      <span className="member-avatar" aria-hidden="true">{memberInitials(member.displayName)}</span><span className="member-info"><strong>{member.displayName}</strong><small>{member.roles.join(' · ')}</small></span>
    </button></li>)}</ul>
    {channel&&<p className="member-list-help">Members of this community.</p>}
  </aside>
}

export function MemberModal({member,onClose}:{member:MemberProfile;onClose:()=>void}){
  const [copied,setCopied]=useState(false),[error,setError]=useState('')
  async function copy(){try{await navigator.clipboard.writeText(member.fingerprint!);setCopied(true);setError('')}catch{setError('Copy was unavailable. Select the fingerprint below to copy it.')}}
  return <Modal title="Member profile" onClose={onClose}>
    <div className="member-profile-heading"><span className="member-avatar large" aria-hidden="true">{memberInitials(member.displayName)}</span><div><h3>{member.displayName}</h3><p>@{member.username}</p></div></div>
    <section className="member-profile-section"><h3>Roles</h3><div className="member-role-list">{member.roles.map(role=><span key={role}>{role}</span>)}</div></section>
    <section className="member-profile-section"><h3>About</h3><p className="member-bio">{member.bio|| (member.sharedProfile?'No bio shared.':'No profile has been shared with your conversations yet.')}</p></section>
    <section className="member-profile-section"><h3>Identity fingerprint</h3>{member.fingerprint?<><code className="member-fingerprint">{member.fingerprint.match(/.{1,4}/g)?.join(' ')}</code><button onClick={()=>void copy()}>{copied?'Copied':'Copy fingerprint'}</button><p>{member.approved?'Compare this fingerprint with the person using a trusted channel.':'This identity is awaiting community approval. Compare the fingerprint before granting access.'}</p></>:<p>This member has not enrolled an identity yet.</p>}</section>
    {error&&<p role="alert">{error}</p>}
  </Modal>
}
