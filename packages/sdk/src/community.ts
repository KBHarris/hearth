// SPDX-License-Identifier: Apache-2.0 OR MIT
import type { Community, CommunityStructure, Category, Channel, CommunityInvite, ChannelRoster,CommunityAuthority,CommunityAdmission,ChannelPolicy,ChannelAuthorization } from './protocol.ts'
import {isPerson,isMember} from './index.ts'
import {isGovernance} from './governance.ts'
import type {CommunityInvitation,OwnershipHandoff,OwnershipState} from './protocol.ts'
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object' && v!==null && !Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v)
const name=(v:unknown):v is string=>typeof v==='string' && v.length>0 && new TextEncoder().encode(v).length<=80 && v.trim()===v && !/[\u0000-\u001f\u007f-\u009f]/u.test(v)
export function isCommunity(v:unknown):v is Community { return record(v) && id(v.id) && id(v.owner_id) && name(v.name) }
export function isCommunities(v:unknown):v is Community[] { return Array.isArray(v) && v.length<=100 && v.every(isCommunity) && new Set(v.map(c=>c.id)).size===v.length }
export function isCategory(v:unknown):v is Category { return record(v) && id(v.id) && id(v.community_id) && name(v.name) }
export function isChannel(v:unknown):v is Channel { return record(v) && id(v.id) && id(v.community_id) && name(v.name) && (v.category_id===null || id(v.category_id)) && ['text','announcement','forum'].includes(v.kind as string) }
export function isCommunityInvite(v:unknown):v is CommunityInvite { return record(v) && id(v.code) && Number.isInteger(v.expires_in_seconds) && (v.expires_in_seconds as number)>=60 && (v.expires_in_seconds as number)<=604800 && Number.isInteger(v.max_uses) && (v.max_uses as number)>=1 && (v.max_uses as number)<=1000 }
export function isCommunityStructure(v:unknown):v is CommunityStructure {
  if(!record(v) || !isCommunity(v.community) || !Array.isArray(v.categories) || v.categories.length>256 || !v.categories.every(isCategory) || !Array.isArray(v.channels) || v.channels.length>512 || !v.channels.every(isChannel))return false
  const categories=new Set(v.categories.map(c=>c.id))
  const community=v.community
  if(v.authority!==undefined && v.authority!==null && (!isAuthority(v.authority)||v.authority.community_id!==community.id||v.authority.owner.account_id!==community.owner_id))return false
  return categories.size===v.categories.length && new Set(v.channels.map(c=>c.id)).size===v.channels.length && v.categories.every(c=>c.community_id===community.id) && v.channels.every(c=>c.community_id===community.id && (c.category_id===null || categories.has(c.category_id)))
}
export function isChannelRoster(v:unknown):v is ChannelRoster {
  if(!record(v) || !isCommunity(v.community) || !isChannel(v.channel) || v.channel.community_id!==v.community.id || !Array.isArray(v.people) || v.people.length<1 || v.people.length>128 || !v.people.every(isPerson))return false
  const community=v.community,people=v.people
  if(v.rules_accepted!==undefined&&v.rules_accepted!==null&&typeof v.rules_accepted!=='boolean')return false
  if(!(v.authority===null||isAuthority(v.authority))||!(v.policy===null||isPolicy(v.policy))||!Array.isArray(v.admissions)||!v.admissions.every(isAdmission)||new Set(v.admissions.map(g=>g.account_id)).size!==v.admissions.length)return false
  if(v.governance!==undefined&&v.governance!==null&&(!isGovernance(v.governance)||v.governance.community_id!==community.id))return false
  if(v.authority && (v.authority.community_id!==community.id||v.authority.owner.account_id!==community.owner_id))return false
  if(v.policy && (v.policy.channel_id!==v.channel.id||v.policy.community_id!==community.id||v.policy.kind!==v.channel.kind))return false
  if(!Array.isArray(v.invitations)||v.invitations.length>128||!v.invitations.every(i=>record(i)&&id(i.account_id)&&isInvitation(i.invitation)&&i.invitation.community_id===community.id)||new Set(v.invitations.map(i=>i.account_id)).size!==v.invitations.length)return false
  return new Set(people.map(p=>p.account.id)).size===people.length && people.some(p=>p.account.id===community.owner_id) && new Set(people.flatMap(p=>p.devices.map(d=>d.device_key))).size===people.reduce((sum,p)=>sum+p.devices.length,0)
}
const signature=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{128}$/.test(v)
export function isAuthority(v:unknown,depth=0):v is CommunityAuthority {return depth<=8&&record(v)&&id(v.community_id)&&isMember(v.owner)&&signature(v.signature)&&(v.handoff===undefined||v.handoff===null||isOwnershipHandoff(v.handoff,depth+1))}
export function isOwnershipHandoff(v:unknown,depth=1):v is OwnershipHandoff{if(depth>8||!record(v)||!isAuthority(v.previous,depth)||!isMember(v.issuer)||!isMember(v.successor)||!Array.isArray(v.endorsed)||v.endorsed.length>2048||!v.endorsed.every(id)||!signature(v.signature))return false;const values=v.endorsed;return values.every((d,i)=>i===0||values[i-1]<d)}
export function isOwnershipState(v:unknown):v is OwnershipState{return record(v)&&isAuthority(v.authority)&&Array.isArray(v.endorsed)&&v.endorsed.length<=2048&&v.endorsed.every(id)&&(v.offer===null||isOwnershipHandoff(v.offer))}
export function isAdmission(v:unknown):v is CommunityAdmission {return record(v)&&(v.invitation===undefined||v.invitation===null||isInvitation(v.invitation))&&id(v.community_id)&&id(v.account_id)&&id(v.identity_key)&&isMember(v.owner)&&signature(v.signature)&&record(v.history_from)&&Object.keys(v.history_from).length<=512&&Object.entries(v.history_from).every(([key,epoch])=>id(key)&&typeof epoch==='number'&&Number.isSafeInteger(epoch)&&epoch>=0)}
export function isPolicy(v:unknown):v is ChannelPolicy {return record(v)&&id(v.channel_id)&&id(v.community_id)&&['text','announcement','forum'].includes(v.kind as string)&&['none','since_invite','full'].includes(v.history as string)&&typeof v.revision==='number'&&Number.isSafeInteger(v.revision)&&v.revision>0&&typeof v.created_at==='number'&&Number.isSafeInteger(v.created_at)&&v.created_at>=0&&Array.isArray(v.history_open_for)&&v.history_open_for.length<=128&&v.history_open_for.every(id)&&new Set(v.history_open_for).size===v.history_open_for.length&&isMember(v.owner)&&signature(v.signature)}
export function isChannelAuthorization(v:unknown):v is ChannelAuthorization {return record(v)&&(v.governance===undefined||v.governance===null||isGovernance(v.governance))&&isAuthority(v.authority)&&isPolicy(v.policy)&&Array.isArray(v.admissions)&&v.admissions.length<=1024&&v.admissions.every(isAdmission)}
export function isInvitation(v:unknown):v is CommunityInvitation{return record(v)&&id(v.community_id)&&id(v.invite_id)&&isMember(v.owner)&&signature(v.signature)&&typeof v.issued_at==='number'&&Number.isSafeInteger(v.issued_at)&&v.issued_at>=0&&record(v.history_from)&&Object.keys(v.history_from).length<=512&&Object.entries(v.history_from).every(([key,epoch])=>id(key)&&typeof epoch==='number'&&Number.isSafeInteger(epoch)&&epoch>=0)}
