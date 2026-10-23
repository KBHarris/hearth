import type {IceConfiguration} from './protocol.ts'
function endpoint(input:unknown):input is string{
  if(typeof input!=='string'||input.length>512||/\s/.test(input))return false
  const match=input.match(/^(stun|stuns|turn|turns):(.+)$/);if(!match)return false
  try{
    const url=new URL(match[1]+'://'+match[2])
    return !!url.hostname&&!url.username&&!url.password&&!url.pathname&&!url.hash&&(!url.search||match[1].startsWith('turn')&&['?transport=udp','?transport=tcp'].includes(url.search))
  }catch{return false}
}
export function isIceConfiguration(input:unknown):input is IceConfiguration {
  if(!input||typeof input!=='object')return false
  const value=input as IceConfiguration
  return Number.isSafeInteger(value.expires_at)&&value.expires_at>Date.now()&&value.expires_at<=Date.now()+3_660_000&&Array.isArray(value.ice_servers)&&value.ice_servers.length<=2&&value.ice_servers.every(server=>{
    if(!server||!Array.isArray(server.urls)||!server.urls.length||server.urls.length>4||!server.urls.every(endpoint))return false
    const relay=server.urls.every(url=>/^turns?:/.test(url))
    return relay?typeof server.username==='string'&&server.username.length<=128&&typeof server.credential==='string'&&server.credential.length<=128:server.urls.every(url=>/^stuns?:/.test(url))&&server.username===null&&server.credential===null
  })
}
