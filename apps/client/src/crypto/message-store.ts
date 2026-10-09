import {invoke,isTauri} from '@tauri-apps/api/core'
export type StoredState={revision:number;envelope:string}
const DATABASE='hearth-messages-v1'
const STORE='states'
const ERROR='Encrypted storage changed in another window or could not be saved. Existing data was preserved. Close other Hearth windows and sign in again.'
export function messageScope(account:string,server:string,device:string) {
  if(![account,server,device].every(id=>/^[a-f0-9]{64}$/.test(id)))throw new Error('Invalid message storage scope.')
  return `${server}:${account}:${device}`
}
function envelope(value:unknown):value is string { return typeof value==='string' && value.length>=82 && value.length<=(8*1024*1024+41)*2 && value.length%2===0 && /^01[a-f0-9]+$/.test(value) }
function validate(value:unknown):StoredState|null {
  if(value===null || value===undefined)return null
  if(typeof value!=='object' || !('revision' in value) || !('envelope' in value) || typeof value.revision!=='number' || !Number.isSafeInteger(value.revision) || value.revision<1 || !envelope(value.envelope))throw new Error(ERROR)
  return {revision:value.revision,envelope:value.envelope}
}
function open():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    let settled=false
    const request=indexedDB.open(DATABASE,1)
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE)
    request.onsuccess=()=>{if(settled)request.result.close();else {settled=true;resolve(request.result)}}
    request.onerror=request.onblocked=()=>{settled=true;reject(new Error(ERROR))}
  })
}
export async function readMessages(scope:string):Promise<StoredState|null> {
  if(isTauri())return validate(await invoke('message_store_read',{scope}))
  const db=await open()
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readonly');const request=tx.objectStore(STORE).get(scope)
    tx.oncomplete=()=>{try {resolve(validate(request.result))}catch(error){reject(error)}}
    tx.onabort=()=>reject(new Error(ERROR))
  })}finally {db.close()}
}
/** One CAS transaction saves keys, outbox, history and cursor together. Never reset on conflict. */
export async function writeMessages(scope:string,revision:number,sealed:string):Promise<StoredState> {
  if(!envelope(sealed) || !Number.isSafeInteger(revision) || revision<0 || revision>=Number.MAX_SAFE_INTEGER)throw new Error(ERROR)
  if(isTauri()) {
    const saved=validate(await invoke('message_store_write',{scope,revision,envelope:sealed}));if(!saved || saved.revision!==revision+1)throw new Error(ERROR);return saved
  }
  const db=await open()
  try {return await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,'readwrite',{durability:'strict'});const store=tx.objectStore(STORE)
    const saved={revision:revision+1,envelope:sealed};const request=store.get(scope)
    request.onsuccess=()=>{try {if((validate(request.result)?.revision ?? 0)!==revision)tx.abort();else store.put(saved,scope)}catch {tx.abort()}}
    tx.oncomplete=()=>resolve(saved)
    tx.onabort=()=>reject(new Error(ERROR))
  })}finally {db.close()}
}
