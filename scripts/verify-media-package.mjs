// Starts only disposable media/relay services, never the user's Hearth stack.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomBytes,randomInt,randomUUID,createHmac} from 'node:crypto'
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {createSocket} from 'node:dgram'
import {request} from 'node:https'
import {join,resolve,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initializeMedia} from '../deploy/media/setup.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),parent=resolve(root,'target/media-package-evidence'),directory=join(parent,randomUUID()),project='hearth-media-check-'+randomUUID().slice(0,8)
mkdirSync(directory,{recursive:true})
const base=join(directory,'base.env'),report=join(parent,'result.json')
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function freePort(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port}
async function availableRange(){for(let attempt=0;attempt<30;attempt++){const start=randomInt(30000,45000),sockets=[];try{for(let port=start;port<start+100;port++){const socket=createSocket('udp4');sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(port,'127.0.0.1',resolve)})}return start}catch{}finally{for(const socket of sockets)try{socket.close()}catch{}}}throw new Error('No available disposable UDP relay range')}
const ports=new Set();while(ports.size<5)ports.add(await freePort())
const [signalPort,tcpPort,udpPort,turnPort,httpsPort]=[...ports],relayMin=await availableRange()
const settings=initializeMedia(directory,{turn:true,signalPort,tcpPort,udpPort,turnPort,relayMin,relayMax:relayMin+99})
writeFileSync(base,['POSTGRES_PASSWORD','HEARTH_S3_ACCESS_KEY','HEARTH_S3_SECRET_KEY'].map(name=>name+'='+randomBytes(32).toString('hex')).join('\n')+'\n',{mode:0o600})
const certificate=join(directory,'fixture.crt'),privateKey=join(directory,'fixture.key'),tlsHost='media.fixture.example',openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'
assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+tlsHost,'-addext','subjectAltName=DNS:'+tlsHost,'-keyout',privateKey,'-out',certificate],{stdio:'ignore',windowsHide:true}).status,0)
const route=readFileSync(join(root,'deploy/Caddyfile'),'utf8').match(/handle_path \/hearth-media\/\* \{[^}]*\{\$HEARTH_SFU_SIGNAL_PORT:7880\}[^}]*\}/)?.[0];assert.ok(route,'Use the actual production WSS route')
const caddy=join(directory,'Caddyfile');writeFileSync(caddy,'{\n auto_https off\n persist_config off\n log default {\n exclude http.log.error\n }\n}\nhttps://'+tlsHost+':8443 {\n tls /certs/fixture.crt /certs/fixture.key\n '+route+'\n}\n')
const proxyImage=readFileSync(join(root,'deploy/compose.https.yaml'),'utf8').match(/image: (caddy:[^\s]+)/)[1];assert.match(proxyImage,/@sha256:[a-f0-9]{64}$/)
const overlay=join(directory,'proxy.json');writeFileSync(overlay,JSON.stringify({services:{'fixture-proxy':{image:proxyImage,cap_drop:['ALL'],cap_add:['NET_BIND_SERVICE'],security_opt:['no-new-privileges:true'],read_only:true,tmpfs:['/tmp','/data','/config'],environment:{HEARTH_SFU_SIGNAL_PORT:String(signalPort)},ports:[`127.0.0.1:${httpsPort}:8443`],volumes:[`${caddy}:/etc/caddy/Caddyfile:ro`,`${certificate}:/certs/fixture.crt:ro`,`${privateKey}:/certs/fixture.key:ro`]}}}))
const args=['compose','-p',project,'--env-file',base,'--env-file',settings.envPath,'-f',join(root,'deploy/compose.yaml'),'-f',join(root,'deploy/compose.media.yaml'),'-f',join(root,'deploy/compose.turn.yaml'),'-f',overlay]
const secrets=readFileSync(settings.envPath,'utf8').split('\n').filter(line=>/API_KEY=|SECRET=/.test(line)).map(line=>line.slice(line.indexOf('=')+1))
function safe(value){for(const secret of secrets)value=value.split(secret).join('[redacted]');return value.replace(/[a-f0-9]{64,}/g,'[redacted]').slice(-2000)}
function docker(extra){const result=spawnSync('docker',[...args,...extra],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(result.status,0,'Disposable media package '+extra[0]+' failed: '+safe(result.stderr??''));return result.stdout.trim()}
let completed=false
try{
  const config=JSON.parse(docker(['config','--format','json']))
  assert.ok(config.services.media.image.includes('@sha256:')&&config.services.relay.image.includes('@sha256:'))
  assert.ok(config.services.media.ports.every(port=>port.host_ip==='127.0.0.1'))
  assert.equal(Number(config.services.media.ports.find(port=>Number(port.published)===signalPort).target),signalPort)
  docker(['up','-d','--no-deps','media','relay','fixture-proxy'])
  let healthy=false
  for(let i=0;i<40;i++){try{healthy=(await fetch('http://127.0.0.1:'+signalPort,{signal:AbortSignal.timeout(1000)})).ok;if(healthy)break}catch{}await pause(250)}
  assert.ok(healthy,'Packaged SFU readiness failed: '+safe(docker(['logs','--tail','10','media'])))
  let services=[],stable=0
  // Container "started" is not readiness. Require a stable running interval;
  // preserve bounded redacted diagnostics if a relay restart never recovers.
  for(let attempt=0;attempt<40;attempt++){
    services=docker(['ps','--all','--format','json']).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))
    stable=services.length===3&&services.every(service=>service.State==='running')?stable+1:0
    if(stable>=4)break
    await pause(500)
  }
  assert.equal(services.length,3);assert.ok(services.every(service=>service.State==='running'),'Media services not running: '+JSON.stringify(services.map(service=>({service:service.Service,state:service.State})))+' '+safe(docker(['logs','--tail','20','relay','fixture-proxy'])))
  const values=Object.fromEntries(readFileSync(settings.envPath,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]})),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
  const claims=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:values.HEARTH_SFU_API_KEY,sub:'media-fixture',exp:Math.floor(Date.now()/1000)+60,video:{roomJoin:true,room:'media-fixture-'+randomUUID(),canPublish:false,canSubscribe:false}}),token=claims+'.'+createHmac('sha256',values.HEARTH_SFU_API_SECRET).update(claims).digest('base64url')
  await new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:httpsPort,servername:tlsHost,ca:readFileSync(certificate),rejectUnauthorized:true,path:'/hearth-media/rtc?access_token='+token+'&protocol=16&sdk=js&version=2.22.3',headers:{Host:tlsHost+':8443',Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}},response=>{response.resume();reject(new Error('Packaged WSS route returned HTTP '+response.statusCode))});req.on('upgrade',(response,socket)=>{assert.equal(response.statusCode,101);socket.destroy();resolve()});req.setTimeout(8000,()=>req.destroy(new Error('Packaged WSS route timed out')));req.on('error',reject);req.end()})
  writeFileSync(report,JSON.stringify({outcome:'pass',measuredAt:new Date().toISOString(),scope:'Disposable loopback media/relay Compose overlays and production WSS route with a trusted private fixture certificate; no user stack or public networking',checks:{pinned_images:true,loopback_ports:true,custom_ports_match_advertised_ports:true,sfu_http_ready:true,media_and_relay_running:true,authenticated_wss_upgrade_through_production_proxy_route:true,verified_fixture_tls_certificate:true,backend_database_storage_not_started:true},images:{sfu:config.services.media.image,relay:config.services.relay.image,proxy:proxyImage}},null,2)+'\n')
  completed=true
  console.log('Disposable SFU and TURN package checks pass.')
}finally{
  assert.ok(project.startsWith('hearth-media-check-'))
  docker(['down','--remove-orphans'])
  assert.ok(relative(parent,resolve(directory))&&!relative(parent,resolve(directory)).startsWith('..'))
  rmSync(directory,{recursive:true,force:true})
  if(completed){const result=JSON.parse(readFileSync(report,'utf8'));result.fixtureSecretsRemoved=true;writeFileSync(report,JSON.stringify(result,null,2)+'\n')}
}
