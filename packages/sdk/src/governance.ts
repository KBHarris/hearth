import {isAdmission} from './community.ts'
// SPDX-License-Identifier: Apache-2.0 OR MIT
import type {Governance, GovernanceView, AuditEntry} from './protocol.ts'
import {isMember} from './index.ts'
export const Permission={read:1,send:2,react:4,attach:8,pin:16,invite:32,channels:64,roles:128,moderate:256,audit:512,connect:1024,speak:2048,listen:4096,camera:8192,screen:16384} as const
export const MEDIA_PERMISSIONS=31744
export function mediaPermissions(policy:Governance|null|undefined,bits:number,stage=false,owner=false):number {
  const media=!(bits&Permission.read)?0:policy?.media_version===1?bits&MEDIA_PERMISSIONS:(bits&3)===3?MEDIA_PERMISSIONS:0
  return stage&&!owner&&policy?.media_version!==1?media&(Permission.connect|Permission.listen):media
}
/** Upgrade signed legacy grants explicitly when the owner saves media settings. */
export function withMediaPermissions(policy:Governance,stages:readonly string[]=[]):Governance {
  if(policy.media_version===1)return policy
  const expand=(bits:number)=>bits|(bits&Permission.send?MEDIA_PERMISSIONS:0)
  const publication=Permission.speak|Permission.camera|Permission.screen
  const overrides=policy.overrides.map(override=>({...override,allow:expand(override.allow)&(stages.includes(override.channel_id)?~publication:32767),deny:expand(override.deny)}))
  for(const channel_id of stages){const existing=overrides.find(item=>item.channel_id===channel_id&&item.kind==='everyone');if(existing)existing.deny|=publication;else overrides.push({channel_id,kind:'everyone',target_id:'',allow:0,deny:publication})}
  return {...policy,media_version:1,everyone:expand(policy.everyone),roles:policy.roles.map(role=>({...role,permissions:expand(role.permissions)})),overrides}
}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const bits=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=32767
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
const list=(v:unknown,max:number,check:(v:unknown)=>boolean)=>Array.isArray(v)&&v.length<=max&&v.every(check)
export function isGovernance(v:unknown,depth=0):v is Governance {
  return depth<=8&&record(v)&&(v.media_version===undefined||v.media_version===null||v.media_version===1)&&(v.media_version===1||bits(v.everyone)&&v.everyone<=1023&&Array.isArray(v.roles)&&v.roles.every(r=>record(r)&&bits(r.permissions)&&r.permissions<=1023)&&Array.isArray(v.overrides)&&v.overrides.every(o=>record(o)&&bits(o.allow)&&bits(o.deny)&&o.allow<=1023&&o.deny<=1023))&&(v.moderator_admission===undefined||v.moderator_admission===null||isAdmission(v.moderator_admission))&&(v.delegation===undefined||v.delegation===null||isGovernance(v.delegation,depth+1))&&id(v.community_id)&&integer(v.revision)&&v.revision>0&&bits(v.everyone)&&isMember(v.owner)&&typeof v.signature==='string'&&/^[a-f0-9]{128}$/.test(v.signature)&&typeof v.rules==='string'&&new TextEncoder().encode(v.rules).length<=4096&&typeof v.screening==='boolean'&&
    list(v.roles,64,r=>record(r)&&id(r.id)&&typeof r.name==='string'&&r.name.trim().length>0&&new TextEncoder().encode(r.name).length<=80&&bits(r.permissions))&&
    list(v.assignments,128,a=>record(a)&&id(a.account_id)&&list(a.role_ids,64,id))&&
    list(v.overrides,512,o=>record(o)&&id(o.channel_id)&&['everyone','role','member'].includes(o.kind as string)&&(o.kind==='everyone'?o.target_id==='':id(o.target_id))&&bits(o.allow)&&bits(o.deny)&&!(o.allow&o.deny))&&
    list(v.sanctions,128,s=>record(s)&&id(s.account_id)&&(s.channel_id===null||id(s.channel_id))&&(s.kick_after===undefined||integer(s.kick_after))&&['ban','kick','timeout'].includes(s.kind as string)&&(s.until===null||integer(s.until)))&&
    list(v.limits,512,l=>record(l)&&id(l.channel_id)&&integer(l.slowmode_seconds)&&l.slowmode_seconds<=21600&&(l.retention_days===null||(integer(l.retention_days)&&l.retention_days>=1&&l.retention_days<=3650)))
}
export function isGovernanceView(v:unknown):v is GovernanceView {return record(v)&&(v.admission===undefined||v.admission===null||isAdmission(v.admission))&&typeof v.rules_accepted==='boolean'&&(v.governance===null||isGovernance(v.governance))&&list(v.members,1024,a=>record(a)&&id(a.id)&&typeof a.username==='string'&&/^[a-z0-9_]{3,32}$/.test(a.username)&&typeof a.owner==='boolean')}
export function isAudit(v:unknown):v is AuditEntry[] {return list(v,100,a=>record(a)&&integer(a.revision)&&a.revision>0&&id(a.actor_id)&&typeof a.action==='string'&&['governance_update','ownership_transfer'].includes(a.action)&&id(a.digest))}
export function permissions(policy:Governance|null|undefined,owner:string,account:string,channel:string|null,now=Date.now(),inviteIssuedAt:number|null=null):number {
  if(account===owner)return 32767
  if(!policy)return 15
  const roles=policy.assignments.find(a=>a.account_id===account)?.role_ids??[]
  let result=policy.everyone
  for(const role of policy.roles)if(roles.includes(role.id))result|=role.permissions
  if(channel)for(const kind of ['everyone','role','member'] as const){let allow=0,deny=0;for(const o of policy.overrides)if(o.channel_id===channel&&o.kind===kind&&(kind==='everyone'||(kind==='role'?roles.includes(o.target_id):o.target_id===account))){allow|=o.allow;deny|=o.deny}result=(result&~deny)|allow}
  for(const sanction of policy.sanctions)if(sanction.account_id===account&&(sanction.until===null||now<sanction.until)&&(sanction.channel_id===null||sanction.channel_id===channel)){if(sanction.kind==='ban')return 0;if(sanction.kind==='kick'){if(!(sanction.kick_after!==undefined&&sanction.kick_after!==null&&inviteIssuedAt!==null&&inviteIssuedAt>sanction.kick_after))return 0}else result&=~(30|Permission.speak|Permission.camera|Permission.screen)}
  return result&32767
}
