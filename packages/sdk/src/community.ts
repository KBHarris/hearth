// SPDX-License-Identifier: Apache-2.0 OR MIT
import type { Community, CommunityStructure, Category, Channel, CommunityInvite } from './protocol.ts'
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object' && v!==null && !Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v)
const name=(v:unknown):v is string=>typeof v==='string' && v.length>0 && new TextEncoder().encode(v).length<=80 && v.trim()===v && !/[\u0000-\u001f\u007f-\u009f]/u.test(v)
export function isCommunity(v:unknown):v is Community { return record(v) && id(v.id) && id(v.owner_id) && name(v.name) }
export function isCommunities(v:unknown):v is Community[] { return Array.isArray(v) && v.length<=100 && v.every(isCommunity) && new Set(v.map(c=>c.id)).size===v.length }
export function isCategory(v:unknown):v is Category { return record(v) && id(v.id) && id(v.community_id) && name(v.name) }
export function isChannel(v:unknown):v is Channel { return record(v) && id(v.id) && id(v.community_id) && name(v.name) && (v.category_id===null || id(v.category_id)) && ['text','announcement'].includes(v.kind as string) }
export function isCommunityInvite(v:unknown):v is CommunityInvite { return record(v) && id(v.code) && Number.isInteger(v.expires_in_seconds) && (v.expires_in_seconds as number)>=60 && (v.expires_in_seconds as number)<=604800 && Number.isInteger(v.max_uses) && (v.max_uses as number)>=1 && (v.max_uses as number)<=1000 }
export function isCommunityStructure(v:unknown):v is CommunityStructure {
  if(!record(v) || !isCommunity(v.community) || !Array.isArray(v.categories) || v.categories.length>256 || !v.categories.every(isCategory) || !Array.isArray(v.channels) || v.channels.length>512 || !v.channels.every(isChannel))return false
  const categories=new Set(v.categories.map(c=>c.id))
  const community=v.community
  return categories.size===v.categories.length && new Set(v.channels.map(c=>c.id)).size===v.channels.length && v.categories.every(c=>c.community_id===community.id) && v.channels.every(c=>c.community_id===community.id && (c.category_id===null || categories.has(c.category_id)))
}
