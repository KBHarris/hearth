// SPDX-License-Identifier: Apache-2.0 OR MIT
import type {VoiceRoom,VoicePresence,SfuAccess} from './protocol.ts'
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v)
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0
export function isVoicePresence(v:unknown):v is VoicePresence{
  return record(v)&&(v.sfu===undefined||v.sfu===true)&&[v.channel_id,v.room_id,v.device_key,v.incarnation].every(id)&&integer(v.epoch)&&integer(v.issued_at)&&integer(v.expires_at)&&v.expires_at>v.issued_at&&v.expires_at-v.issued_at<=30000&&typeof v.public_key==='string'&&/^04[a-f0-9]{128}$/.test(v.public_key)&&typeof v.relay_only==='boolean'&&typeof v.active==='boolean'&&typeof v.signature==='string'&&/^[a-f0-9]{128}$/.test(v.signature)
}
export function isVoiceRoom(v:unknown):v is VoiceRoom{
  if(!record(v)||(v.sfu!==undefined&&v.sfu!==true)||!id(v.channel_id)||!id(v.room_id)||!integer(v.epoch)||!integer(v.revision)||!v.revision||!integer(v.capacity)||v.capacity!==(v.sfu?25:4)||typeof v.relay_only!=='boolean'||!Array.isArray(v.participants)||v.participants.length>v.capacity||!v.participants.every(isVoicePresence))return false
  const peers=v.participants
  return peers.every((peer,index)=>peer.channel_id===v.channel_id&&peer.room_id===v.room_id&&peer.epoch===v.epoch&&peer.relay_only===v.relay_only&&peer.sfu===v.sfu&&peer.active&&(index===0||peers[index-1].device_key<peer.device_key))
}
export function isSfuAccess(v:unknown):v is SfuAccess {
  if(!record(v)||!id(v.channel_id)||!id(v.room_id)||!integer(v.revision)||!v.revision||v.room!==`hearth-${v.room_id}-${v.revision}`||typeof v.identity!=='string'||!/^[a-f0-9]{64}-[a-f0-9]{64}$/.test(v.identity)||typeof v.token!=='string'||v.token.length>4096||!/^ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.token)||!integer(v.expires_at)||v.expires_at<=Date.now()||v.expires_at>Date.now()+65_000||typeof v.url!=='string')return false
  if(v.url.length>512)return false
  if(v.local_url!==undefined&&v.local_url!==null){try{const local=new URL(String(v.local_url));if(typeof v.local_url!=='string'||v.local_url.length>512||local.protocol!=='ws:'||!['localhost','127.0.0.1','[::1]'].includes(local.hostname)||local.username||local.password||local.search||local.hash||local.pathname!=='/')return false}catch{return false}}
  try{const url=new URL(v.url);return !url.username&&!url.password&&!url.search&&!url.hash&&['/','/hearth-media','/hearth-media/'].includes(url.pathname)&&(url.protocol==='wss:'||url.protocol==='ws:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))}catch{return false}
}
