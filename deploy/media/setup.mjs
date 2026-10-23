import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {isIP} from 'node:net'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export function mediaSettings(input={}){
  assert.ok(input&&typeof input==='object'&&!Array.isArray(input))
  for(const key of Object.keys(input))assert.ok(['url','advertiseIp','bind','signalPort','tcpPort','udpPort','turn','turnPort','relayMin','relayMax','profile','nodeIp','turnTls','turnTlsPort','turnHost'].includes(key),'Unknown media setting')
  const value={url:'ws://127.0.0.1:7880',advertiseIp:'127.0.0.1',bind:'127.0.0.1',signalPort:7880,tcpPort:7881,udpPort:7882,turn:false,turnPort:3478,relayMin:49160,relayMax:49259,profile:'standard',turnTls:false,turnTlsPort:5349,...input}
  assert.ok(['standard','sfu25'].includes(value.profile),'Use a bounded request profile')
  if(input.signalPort&&!input.url)value.url='ws://127.0.0.1:'+value.signalPort
  const url=new URL(value.url),local=['127.0.0.1','localhost','[::1]'].includes(url.hostname)
  assert.ok(!url.username&&!url.password&&!url.search&&!url.hash&&['/','/hearth-media','/hearth-media/'].includes(url.pathname)&&(url.protocol==='wss:'||local&&url.protocol==='ws:'),'Use WSS or loopback WS for the SFU URL')
  assert.equal(isIP(value.advertiseIp),4,'Specify an IPv4 media address')
  assert.ok(['127.0.0.1','0.0.0.0'].includes(value.bind),'Media bind must be explicit')
  if(!local)assert.ok(value.bind==='0.0.0.0'&&Number(value.advertiseIp.split('.')[0])<224&&!/^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(value.advertiseIp),'Public media requires an explicit public advertised address and bind')
  const nodeIp=value.nodeIp??value.advertiseIp;assert.equal(isIP(nodeIp),4,'Specify an IPv4 media node address');const loopback=nodeIp.startsWith('127.');assert.ok(!/^(0\.|169\.254\.)/.test(nodeIp)&&Number(nodeIp.split('.')[0])<224,'Use a unicast media node address');if(!local)assert.ok(!loopback,'Public media cannot enable loopback peers');if(local&&value.bind!=='127.0.0.1')assert.ok(value.bind==='0.0.0.0'&&!!value.nodeIp&&!loopback,'LAN media binding requires an explicit node address')
  if(local)assert.equal(Number(url.port||(url.protocol==='wss:'?443:80)),value.signalPort,'Local signal URL must match its published port')
  for(const name of ['signalPort','tcpPort','udpPort'])assert.ok(Number.isSafeInteger(value[name])&&value[name]>=1024&&value[name]<=65535,'Invalid media port')
  assert.equal(new Set([value.signalPort,value.tcpPort,value.udpPort]).size,3,'Use distinct media ports')
  assert.equal(typeof value.turn,'boolean')
  for(const name of ['turnPort','relayMin','relayMax'])assert.ok(Number.isSafeInteger(value[name])&&value[name]>=1024&&value[name]<=65535,'Invalid relay port')
  assert.ok(value.relayMax>=value.relayMin&&value.relayMax-value.relayMin>=99&&value.relayMax-value.relayMin<=511,'Use a bounded range of at least 100 relay ports')
  for(const port of [value.signalPort,value.tcpPort,value.udpPort,value.turnPort])assert.ok(port<value.relayMin||port>value.relayMax,'Media listeners must not overlap relay allocations')
  assert.ok(![value.signalPort,value.tcpPort,value.udpPort].includes(value.turnPort),'TURN needs a distinct listener')
  assert.equal(typeof value.turnTls,'boolean');if(value.turnTls){assert.ok(value.turn,'TLS needs the common TURN relay');assert.ok(!local,'TLS relay needs a public WSS media address');assert.ok(Number.isSafeInteger(value.turnTlsPort)&&value.turnTlsPort>=1024&&value.turnTlsPort<=65535&&!new Set([value.signalPort,value.tcpPort,value.udpPort,value.turnPort]).has(value.turnTlsPort)&&!(value.turnTlsPort>=value.relayMin&&value.turnTlsPort<=value.relayMax),'Use a distinct TLS relay port')}
  const turnHost=value.turnHost??url.hostname;assert.ok(/^[a-zA-Z0-9.-]{1,253}$/.test(turnHost)&&!turnHost.startsWith('.')&&!turnHost.includes('..'),'Use a plain relay DNS name or IPv4 address')
  return {...value,nodeIp,turnHost,loopback,local}
}
export function initializeMedia(directory,input={}){
  const target=resolve(directory),envPath=join(target,'.env'),configPath=join(target,'livekit.yaml'),preferences=join(target,'settings.json')
  const saved=existsSync(preferences)?JSON.parse(readFileSync(preferences,'utf8')):{}
  const merged={...saved,...input}
  if(input.signalPort&&!input.url&&saved.url&&new URL(saved.url).protocol==='ws:'&&['127.0.0.1','localhost','[::1]'].includes(new URL(saved.url).hostname))delete merged.url
  const settings=mediaSettings(merged)
  mkdirSync(target,{recursive:true})
  let apiKey,secret,previous={}
  if(existsSync(envPath)){
    const values=Object.fromEntries(readFileSync(envPath,'utf8').trim().split(/\r?\n/).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),line.slice(index+1)]}));previous=values
    apiKey=values.HEARTH_SFU_API_KEY;secret=values.HEARTH_SFU_API_SECRET
    assert.match(apiKey??'',/^[a-f0-9]{32}$/,'Preserve and inspect existing media credentials')
    assert.match(secret??'',/^[a-f0-9]{64}$/,'Preserve and inspect existing media credentials')
  }else{apiKey=randomBytes(16).toString('hex');secret=randomBytes(32).toString('hex')}
  const environment={HEARTH_SFU_URL:settings.url,HEARTH_SFU_LOCAL_URL:'ws://127.0.0.1:'+settings.signalPort,HEARTH_SFU_API_KEY:apiKey,HEARTH_SFU_API_SECRET:secret,HEARTH_MEDIA_BIND:settings.bind,HEARTH_SFU_SIGNAL_PORT:String(settings.signalPort),HEARTH_SFU_TCP_PORT:String(settings.tcpPort),HEARTH_SFU_UDP_PORT:String(settings.udpPort),HEARTH_SFU_CONFIG_PATH:configPath.replaceAll('\\','/')}
  environment.HEARTH_REQUEST_PROFILE=settings.profile
  if(settings.turn){
    const turnSecret=previous.HEARTH_TURN_SECRET??randomBytes(32).toString('hex'),turnPath=join(target,'turnserver.conf')
    assert.match(turnSecret,/^[a-f0-9]{64}$/,'Preserve and inspect existing relay credentials')
    const turnHost=settings.advertiseIp
    Object.assign(environment,{HEARTH_TURN_URLS:`turn:${turnHost}:${settings.turnPort}?transport=udp,turn:${turnHost}:${settings.turnPort}?transport=tcp`+(settings.turnTls?`,turns:${settings.turnHost}:${settings.turnTlsPort}?transport=tcp`:''),HEARTH_TURN_SECRET:turnSecret,HEARTH_TURN_PORT:String(settings.turnPort),HEARTH_TURN_RELAY_MIN:String(settings.relayMin),HEARTH_TURN_RELAY_MAX:String(settings.relayMax),HEARTH_TURN_CONFIG_PATH:turnPath.replaceAll('\\','/')})
    const turn=[`listening-port=${settings.turnPort}`,'listening-ip=0.0.0.0',`external-ip=${settings.advertiseIp}`,`min-port=${settings.relayMin}`,`max-port=${settings.relayMax}`,'realm=hearth-media','use-auth-secret',`static-auth-secret=${turnSecret}`,'fingerprint',...(settings.turnTls?[`tls-listening-port=${settings.turnTlsPort}`,`cert=/var/lib/hearth-certificates/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${settings.turnHost}/${settings.turnHost}.crt`,`pkey=/var/lib/hearth-certificates/caddy/certificates/acme-v02.api.letsencrypt.org-directory/${settings.turnHost}/${settings.turnHost}.key`,'no-tlsv1','no-tlsv1_1']:['no-tls']),'no-dtls','no-cli','no-multicast-peers','user-quota=8','total-quota=256','relay-threads=2','pidfile=/tmp/turn.pid','log-file=stdout','simple-log',...(settings.loopback?['allow-loopback-peers',`cli-password=${turnSecret}`]:[])]
    if(settings.turnTls)Object.assign(environment,{HEARTH_TURN_TLS_PORT:String(settings.turnTlsPort),HEARTH_TURN_CERT_HOST:settings.turnHost})
    writeFileSync(turnPath,turn.join('\n')+'\n',{mode:0o600})
  }else if(previous.HEARTH_TURN_SECRET){
    // Keep dormant relay settings so disabling/re-enabling never rotates a secret.
    assert.ok(previous.HEARTH_MEDIA_BIND===settings.bind&&previous.HEARTH_SFU_URL===settings.url,'Repeat --turn when changing an initialized relay host')
    for(const [name,value] of Object.entries(previous))if(name.startsWith('HEARTH_TURN_'))environment[name]=value
  }
  // LiveKit's node_ip is its advertised ICE address, rather than a socket bind.
  // A public profile must not replace that address with the host's private LAN IP.
  const yaml=`port: ${settings.signalPort}\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: ${settings.tcpPort}\n  udp_port: ${settings.udpPort}\n  node_ip: ${settings.local?settings.nodeIp:settings.advertiseIp}\n  use_external_ip: false\n  advertise_internal_ip: ${!settings.local}\n  enable_loopback_candidate: ${settings.loopback}\nkeys:\n  ${apiKey}: ${secret}\nroom:\n  empty_timeout: 60\n  departure_timeout: 10\n  max_participants: 25\nlogging:\n  level: error\n`
  writeFileSync(configPath,yaml,{mode:0o600})
  const stored={...settings};delete stored.local;delete stored.loopback
  writeFileSync(preferences,JSON.stringify(stored,null,2)+'\n',{mode:0o600})
  writeFileSync(envPath,Object.entries(environment).map(([name,value])=>name+'='+value).join('\n')+'\n',{mode:0o600})
  return {directory:target,envPath,configPath,settings}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  const settings={}
  for(const argument of process.argv.slice(2)){
    if(argument==='--turn'){settings.turn=true;continue}
    if(argument==='--turn-tls'){settings.turn=true;settings.turnTls=true;continue}
    if(argument==='--no-turn-tls'){settings.turnTls=false;continue}
    const match=/^--(url|advertise-ip|bind|signal-port|tcp-port|udp-port|turn-port|relay-min|relay-max|profile|node-ip|turn-tls-port|turn-host)=(.+)$/.exec(argument)
    assert.ok(match,'Use named media settings')
    const key={url:'url','advertise-ip':'advertiseIp',bind:'bind','signal-port':'signalPort','tcp-port':'tcpPort','udp-port':'udpPort','turn-port':'turnPort','relay-min':'relayMin','relay-max':'relayMax',profile:'profile','node-ip':'nodeIp','turn-tls-port':'turnTlsPort','turn-host':'turnHost'}[match[1]]
    settings[key]=key.endsWith('Port')||key.startsWith('relay')?Number(match[2]):match[2]
  }
  const result=initializeMedia(join(dirname(fileURLToPath(import.meta.url)),'data'),settings)
  console.log('Media configuration prepared. Credentials were preserved and are not printed.')
  console.log('Use deploy/compose.yaml with deploy/compose.media.yaml and deploy/media/data/.env.')
  console.log(result.settings.local?'Media ports are loopback only. Internet access has not been configured.':'Complete WSS termination, DNS and media port routing before testing outside access.')
}
