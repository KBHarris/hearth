// Disposable TURN over trusted fixture TLS: authenticated allocation and a real
// bidirectional UDP payload through the relay. No user host or certificate.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomBytes,randomInt,randomUUID,createHmac,createHash} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve,relative} from 'node:path'
import {createServer} from 'node:net'
import {connect} from 'node:tls'
import {createSocket} from 'node:dgram'
import {initializeMedia} from '../deploy/media/setup.mjs'

const root=resolve('.'),parent=join(root,'target/turn-tls-evidence'),dir=join(parent,randomUUID()),project='hearth-tls-check-'+randomUUID().slice(0,8)
mkdirSync(dir,{recursive:true})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),host='turn.fixture.example'
async function free(){const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));return port}
async function availableRange(){for(let attempt=0;attempt<30;attempt++){const start=randomInt(30000,45000),sockets=[];try{for(let port=start;port<start+100;port++){const socket=createSocket('udp4');sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(port,'127.0.0.1',resolve)})}return start}catch{}finally{for(const socket of sockets)try{socket.close()}catch{}}}throw new Error('No available disposable UDP relay range')}
const ports=new Set();while(ports.size<5)ports.add(await free());const [signalPort,tcpPort,udpPort,turnPort,turnTlsPort]=[...ports],relayMin=await availableRange()
const settings=initializeMedia(dir,{url:'wss://'+host+'/hearth-media',advertiseIp:'203.0.113.4',nodeIp:'192.168.1.2',bind:'0.0.0.0',turn:true,turnTls:true,turnHost:host,signalPort,tcpPort,udpPort,turnPort,turnTlsPort,relayMin,relayMax:relayMin+99})
const certRoot=join(dir,'certificates'),certDir=join(certRoot,'caddy/certificates/acme-v02.api.letsencrypt.org-directory',host);mkdirSync(certDir,{recursive:true})
const cert=join(certDir,host+'.crt'),key=join(certDir,host+'.key'),openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'
assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN='+host,'-addext','subjectAltName=DNS:'+host,'-keyout',key,'-out',cert],{stdio:'ignore',windowsHide:true}).status,0,'Fixture certificate generation failed')
const env=Object.fromEntries(readFileSync(settings.envPath,'utf8').trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)]}))
// This local fixture alone permits a loopback echo peer. Public setup forbids it.
writeFileSync(join(dir,'turnserver.conf'),readFileSync(join(dir,'turnserver.conf'),'utf8')+'allow-loopback-peers\ncli-password='+env.HEARTH_TURN_SECRET+'\n',{mode:0o600})
const base=join(dir,'base.env');writeFileSync(base,'POSTGRES_PASSWORD='+randomBytes(32).toString('hex')+'\nHEARTH_S3_ACCESS_KEY='+randomBytes(16).toString('hex')+'\nHEARTH_S3_SECRET_KEY='+randomBytes(32).toString('hex')+'\n')
const overlay=join(dir,'fixture.yaml');writeFileSync(overlay,'services:\n  relay:\n    volumes:\n      - type: bind\n        source: '+JSON.stringify(certRoot.replaceAll('\\','/'))+'\n        target: /var/lib/hearth-certificates\n        read_only: true\n    ports: !override\n      - "127.0.0.1:'+turnTlsPort+':'+turnTlsPort+'/tcp"\n')
const args=['compose','-p',project,'--env-file',base,'--env-file',settings.envPath,'-f',join(root,'deploy/compose.yaml'),'-f',join(root,'deploy/compose.media.yaml'),'-f',join(root,'deploy/compose.turn.yaml'),'-f',join(root,'deploy/compose.turn-tls.yaml'),'-f',overlay]
function docker(extra){const result=spawnSync('docker',[...args,...extra],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});const safe=(result.stderr??'').replace(/[a-f0-9]{32,}/g,'[redacted]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[address]');assert.equal(result.status,0,'Disposable TLS relay '+extra[0]+' failed: '+safe.slice(-1600));return result.stdout.trim()}
function attr(type,value){const h=Buffer.alloc(4);h.writeUInt16BE(type);h.writeUInt16BE(value.length,2);return Buffer.concat([h,value,Buffer.alloc((4-value.length%4)%4)])}
function packet(type,attributes,integrity){const body=Buffer.concat(attributes),header=Buffer.alloc(20);header.writeUInt16BE(type);header.writeUInt16BE(body.length+(integrity?24:0),2);header.writeUInt32BE(0x2112a442,4);randomBytes(12).copy(header,8);const unsigned=Buffer.concat([header,body]);return integrity?Buffer.concat([unsigned,attr(8,createHmac('sha1',integrity).update(unsigned).digest())]):unsigned}
function attributes(packet){const result=new Map();for(let i=20;i+4<=packet.length;){const size=packet.readUInt16BE(i+2);result.set(packet.readUInt16BE(i),packet.subarray(i+4,i+4+size));i+=4+Math.ceil(size/4)*4}return result}
let socket,success=false
try{
  const config=JSON.parse(docker(['config','--format','json']));assert.match(config.services.relay.image,/@sha256:[a-f0-9]{64}$/);assert.equal(config.services.relay.entrypoint[1],'/etc/hearth/turn-entrypoint.sh')
  docker(['up','-d','--no-deps','relay'])
  let tlsFailure=''
  for(let i=0;i<60;i++){
    try{socket=await new Promise((resolve,reject)=>{const s=connect({host:'127.0.0.1',port:turnTlsPort,servername:host,ca:readFileSync(cert),rejectUnauthorized:true,minVersion:'TLSv1.2'},()=>resolve(s));s.setTimeout(1500,()=>s.destroy(new Error('timeout')));s.once('error',reject)});break}catch(error){tlsFailure=String(error.code??error.name);await pause(500)}
  }
  assert.ok(socket?.authorized,'Fixture TLS certificate must be verified, without bypasses: '+tlsFailure);socket.setTimeout(0)
  let buffer=Buffer.alloc(0);const pending=new Map(),indications=[]
  socket.on('data',bytes=>{buffer=Buffer.concat([buffer,bytes]);while(buffer.length>=20&&buffer.length>=20+buffer.readUInt16BE(2)){const length=20+buffer.readUInt16BE(2),message=buffer.subarray(0,length);buffer=buffer.subarray(length);const id=message.subarray(8,20).toString('hex'),resolve=pending.get(id);if(resolve){pending.delete(id);resolve(message)}else indications.push(message)}})
  async function request(message){const id=message.subarray(8,20).toString('hex');let timer;try{return await Promise.race([new Promise(resolve=>{pending.set(id,resolve);socket.write(message)}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('TURN response timed out')),5000)})])}finally{clearTimeout(timer);pending.delete(id)}}
  const transport=attr(0x19,Buffer.from([17,0,0,0])),challenge=await request(packet(3,[transport]));assert.equal(challenge.readUInt16BE(0),0x113)
  const attrs=attributes(challenge),realm=attrs.get(0x14),nonce=attrs.get(0x15);assert.ok(realm&&nonce)
  const username=String(Math.floor(Date.now()/1000)+600)+':fixture',password=createHmac('sha1',env.HEARTH_TURN_SECRET).update(username).digest('base64'),integrity=createHash('md5').update(username+':'+realm.toString()+':'+password).digest(),credentials=[attr(6,Buffer.from(username)),attr(0x14,realm),attr(0x15,nonce)]
  const allocation=await request(packet(3,[transport,...credentials],integrity));assert.equal(allocation.readUInt16BE(0),0x103);assert.ok(attributes(allocation).has(0x16))
  const relay= docker(['ps','-q','relay']),echoPort=34567
  assert.equal(spawnSync('docker',['exec','-d',relay,'turnutils_peer','-L','127.0.0.1','-p',String(echoPort)],{stdio:'ignore',windowsHide:true}).status,0,'Disposable UDP echo helper must start inside the relay network')
  await pause(300)
  const address=Buffer.alloc(8);address[1]=1;address.writeUInt16BE(echoPort^0x2112,2);address.writeUInt32BE((0x7f000001^0x2112a442)>>>0,4);const peer=attr(0x12,address)
  assert.equal((await request(packet(8,[peer,...credentials],integrity))).readUInt16BE(0),0x108)
  const payload=randomBytes(64);socket.write(packet(0x16,[peer,attr(0x13,payload)]))
  for(let i=0;i<100&&!indications.some(message=>message.readUInt16BE(0)===0x17&&attributes(message).get(0x13)?.equals(payload));i++)await pause(50)
  assert.ok(indications.some(message=>message.readUInt16BE(0)===0x17&&attributes(message).get(0x13)?.equals(payload)),'Bidirectional payload must traverse the TLS allocation')
  writeFileSync(join(parent,'result.json'),JSON.stringify({outcome:'pass',measuredAt:new Date().toISOString(),scope:'Disposable pinned TURN service, package certificate-wait wrapper, trusted private fixture CA, authenticated TLS allocation and bidirectional UDP echo; not public certificates, WebRTC TLS route selection, NAT or physical media acceptance',checks:{pinned_relay:true,packaged_tls_entrypoint:true,verified_tls_certificate:true,authenticated_allocation:true,bidirectional_payload_through_tls_relay:true,no_certificate_validation_bypass:true},tlsProtocol:socket.getProtocol(),image:config.services.relay.image},null,2)+'\n');success=true
  console.log('Packaged TURN-TLS authenticated allocation and bidirectional relay pass.')
}catch(error){const logs=docker(['logs','--tail','20','relay']).replace(/[a-f0-9]{32,}/g,'[redacted]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[address]');console.error(logs);throw error}finally{socket?.destroy();docker(['down','--remove-orphans']);assert.ok(relative(parent,resolve(dir))&&!relative(parent,resolve(dir)).startsWith('..'));rmSync(dir,{recursive:true,force:true});if(success){const path=join(parent,'result.json'),result=JSON.parse(readFileSync(path,'utf8'));result.fixtureSecretsRemoved=true;writeFileSync(path,JSON.stringify(result,null,2)+'\n')}}
