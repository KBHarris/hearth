import type {ChannelRoster,Conversation,LocalProfile,Person} from '@hearth/sdk'

export type MemberProfile={id:string;username:string;displayName:string;bio:string;roles:string[];fingerprint:string|null;approved:boolean;sharedProfile:boolean}

/** Use only the current authorized roster; never turn cached people into a directory. */
export function conversationMembers(conversation:Conversation|undefined,channel:ChannelRoster|undefined,people:Record<string,Person>,profiles:Record<string,LocalProfile>):MemberProfile[]{
  if(!conversation)return []
  const ids=channel?channel.people.map(person=>person.account.id):conversation.accounts
  return [...new Set(ids)].map(id=>{
    const person=channel?.people.find(person=>person.account.id===id)??people[id]
    const memberIdentity=conversation.members.find(member=>member.account_id===id)?.enrollment.identity_key
    const admittedIdentity=channel?.authority?.owner.account_id===id?channel.authority.owner.enrollment.identity_key:channel?.admissions.find(admission=>admission.account_id===id)?.identity_key
    const identity=admittedIdentity??memberIdentity??person?.devices[0]?.identity_key??null
    const assigned=new Set(channel?.governance?.assignments.find(assignment=>assignment.account_id===id)?.role_ids??[])
    const roles=channel?.governance?.roles.filter(role=>assigned.has(role.id)).map(role=>role.name)??[]
    if(channel?.community.owner_id===id)roles.unshift('Community owner')
    if(person?.account.owner)roles.unshift('Server owner')
    const approved=!!identity&&(channel?admittedIdentity===identity:memberIdentity===identity)
    return {id,username:person?.account.username??id.slice(0,8),displayName:profiles[id]?.display_name||person?.account.username||id.slice(0,8),bio:profiles[id]?.bio??'',roles:[...new Set(roles.length?roles:['Member'])],fingerprint:identity,approved,sharedProfile:!!profiles[id]}
  }).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.id.localeCompare(b.id))
}

export function memberInitials(name:string){return Array.from(name.trim()).slice(0,2).join('').toUpperCase()||'?'}
