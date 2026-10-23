// Disposable native server/database + actual product MLS and media in Chromium.
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {readFileSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {randomBytes,randomUUID,randomInt} from 'node:crypto'
import {Builder} from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
import {createServer} from 'node:net'
import {devtools} from './verify-installed-test-client.mjs'
import {sfuObserverFixture} from './sfu-observer-fixture.mjs'
import {cpuSnapshot,cpuDelta} from './media-cpu-fixture.mjs'
import {mediaEndpointProxy} from './media-endpoint-proxy.mjs'
const desktop=process.argv.includes('--desktop')
const immutable=process.argv.includes('--immutable')
const stage=process.argv.includes('--stage')
const sfu=process.argv.includes('--sfu')||process.argv.includes('--sfu-25')||stage
const sfuCount=stage?3:process.argv.includes('--sfu-25')?25:6
const sfuCapacityProfile=process.argv.includes('--sfu-capacity-profile')
const distributedSfu=process.argv.includes('--sfu-distributed')
const frontendPort=Number(process.argv.find(arg=>arg.startsWith('--frontend-port='))?.slice(16)??5176)
assert.ok(Number.isSafeInteger(frontendPort)&&frontendPort>=1024&&frontendPort<=65535&&(!distributedSfu||frontendPort===5176),'Use a valid fixture port; distributed endpoints require 5176')
const frontendOrigin='http://127.0.0.1:'+frontendPort
assert.ok(!distributedSfu||sfu&&sfuCount===25&&!desktop,'Distributed fixture requires the explicit Chromium 25-person milestone')
assert.ok(!sfuCapacityProfile||sfu&&sfuCount===25,'Capacity profile is only for the explicit 25-person milestone')
const roomVideo=process.argv.includes('--room-video')
const rooms=process.argv.includes('--rooms')||process.argv.includes('--room-revoke')||roomVideo||sfu
const roomRevoke=process.argv.includes('--room-revoke')
const rekey=process.argv.includes('--rekey')
const groupVideo=process.argv.includes('--group-video')
const group=process.argv.includes('--group')||process.argv.includes('--group-revoke')||process.argv.includes('--group-rejoin')||groupVideo
const groupRejoin=process.argv.includes('--group-rejoin')
const groupRevoke=process.argv.includes('--group-revoke')
const turnTls=process.argv.includes('--turn-tls')
const turnMode=process.argv.includes('--turn')||process.argv.includes('--turn-tcp')||turnTls
assert.ok(!turnTls||!desktop,'The self-signed TLS fixture is Chromium-only; it never changes native certificate trust')
const transport=turnTls?'tls':process.argv.includes('--turn-tcp')?'tcp':'udp'
const turnImage='coturn/coturn:4.18.0-r0@sha256:bbefd3e1fdfdc0d58770fe01b581fd8b00d9f3a5580d00acb77cf719a6bc78e3'
const sfuImage='livekit/livekit-server:v1.13.8@sha256:ad961c9b4b064298cc08d618d772671f7c783e036001388079fa813929cc357e'
const checkpoint=process.argv.find(arg=>arg.startsWith('--checkpoint='))?.slice('--checkpoint='.length)
assert.ok(checkpoint===undefined||/^[a-z][a-z0-9-]{0,47}$/.test(checkpoint),'Use a short lowercase checkpoint name')
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'target/direct-calls-evidence',checkpoint??'',(sfu?'sfu-room-':rooms?(roomVideo?'room-video-'+(roomRevoke?'revoke-':''):roomRevoke?'voice-revoke-':'voice-room-'):group?(groupRevoke?'group-revoke-':groupRejoin?'group-rejoin-':'group-'):'')+(rekey?'rekey-':'')+(desktop?'native-':'')+(turnMode?'turn-'+transport:'direct'))
mkdirSync(output,{recursive:true});rmSync(join(output,'result.json'),{force:true})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let sfuProcess,sfuConfiguration,sfuObserver,sfuContainer,sfuPorts
let fixture,vite,driver,native,cdp,nativeConfiguration,nativeOutput='',nativeFinished=false,turnContainer,turnConfiguration,stdout='',stderr=''
let browserPid,cpuBefore,cpuMeasurement
let endpointProxy
const turnCertificateFiles=[]
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
async function finishNative(result){
  if(!native)return
  assert.equal(native.exitCode,null,'Native fixture exited before verified storage cleanup')
  const closed=new Promise(resolve=>native.once('close',resolve))
  await driver.executeScript(report=>window.__TAURI_INTERNALS__.invoke('phase1_finish',{report}),{outcome:result.outcome,checks:Object.keys(result.checks??{}).length?result.checks:{native_call_fixture_completed:false}}).catch(()=>{})
  let timeout
  try{await Promise.race([closed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Native fixture cleanup timed out')),25000)})])}finally{clearTimeout(timeout)}
  const report=nativeOutput.match(/HEARTH_PHASE1_REPORT=(.+)/)?.[1]
  assert.ok(report,'Native fixture did not report storage cleanup')
  const parsed=JSON.parse(report)
  assert.equal(parsed.fixture_storage_cleaned,true,'Native fixture storage was not fully drained/removed')
  if(result.outcome==='pass')assert.equal(parsed.outcome,'pass')
  result.nativeCleanup=parsed.fixture_cleanup
  result.checks.native_fixture_storage_drained_and_removed=true
  nativeFinished=true
}
function docker(args){const result=spawnSync('docker',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});assert.equal(result.status,0,'Disposable TURN fixture failed: '+args[0]);return result.stdout.trim()}
try{
  const env={...process.env,HEARTH_TEST_DATABASE_URL:'',HEARTH_CLIENT_ORIGINS:desktop?'http://tauri.localhost,https://tauri.localhost,tauri://localhost':frontendOrigin}
  if(distributedSfu)env.HEARTH_CLIENT_ORIGINS+=','+Array.from({length:sfuCount+1},(_,index)=>`https://media${index}.localhost:5177`).join(',')
  for(const key of ['HEARTH_STUN_URLS','HEARTH_TURN_URLS','HEARTH_TURN_SECRET','HEARTH_SFU_URL','HEARTH_SFU_LOCAL_URL','HEARTH_SFU_API_KEY','HEARTH_SFU_API_SECRET','HEARTH_REQUEST_PROFILE'])delete env[key]
  if(sfuCapacityProfile)env.HEARTH_REQUEST_PROFILE='sfu25'
  if(sfu){
    const signalPort=await freePort(),tcpPort=await freePort(),udpPort=randomInt(20000,30000),apiKey='hearth-sfu-fixture',secret=randomBytes(32).toString('hex')
    sfuPorts={signalPort,tcpPort,udpPort}
    sfuConfiguration=join(output,'livekit.yaml')
    writeFileSync(sfuConfiguration,`port: ${signalPort}\nbind_addresses: ["${turnMode?'0.0.0.0':'127.0.0.1'}"]\nrtc:\n  tcp_port: ${tcpPort}\n  udp_port: ${udpPort}\n  node_ip: 127.0.0.1\n  use_external_ip: false\n  enable_loopback_candidate: true\nkeys:\n  ${apiKey}: ${secret}\nlogging:\n  level: info\n`,{mode:0o600})
    if(!turnMode){
    sfuProcess=spawn(join(root,'target/livekit-spike',process.platform==='win32'?'livekit-server.exe':'livekit-server'),['--config',sfuConfiguration],{cwd:root,windowsHide:true,stdio:'ignore'})
    let error;sfuProcess.on('error',value=>{error=value})
    let ready=false;for(let i=0;i<60;i++){if(error)throw new Error('Local SFU binary unavailable');if(sfuProcess.exitCode!==null)throw new Error('Local SFU exited');try{if((await fetch(`http://127.0.0.1:${signalPort}`)).ok){ready=true;break}}catch{}await pause(100)}
    assert.ok(ready,'Disposable SFU readiness timed out')
    }
    env.HEARTH_SFU_URL=`ws://127.0.0.1:${signalPort}`;env.HEARTH_SFU_API_KEY=apiKey;env.HEARTH_SFU_API_SECRET=secret
    sfuObserver=await sfuObserverFixture(env.HEARTH_SFU_URL,apiKey,secret,frontendOrigin)
    if(!turnMode)console.log('Disposable loopback SFU started')
  }
  if(turnMode){
    const port=randomInt(35000,45000),relayMin=port+1,relayMax=port+(sfu?Math.max(32,sfuCount*4):24),secret=randomBytes(32).toString('hex')
    turnConfiguration=join(output,'turnserver.conf')
    // coturn requires a nonempty CLI password to honor its development-only
    // loopback-peer exception, even with the CLI disabled. Never deploy this profile.
    const tlsMounts=[]
    if(turnTls){
      const certificate=join(output,'turn-fixture.crt'),key=join(output,'turn-fixture.key');turnCertificateFiles.push(certificate,key)
      const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'
      assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-keyout',key,'-out',certificate],{stdio:'ignore',windowsHide:true}).status,0)
      tlsMounts.push('-v',`${certificate}:/etc/coturn/fixture.crt:ro`,'-v',`${key}:/etc/coturn/fixture.key:ro`)
    }
    const relaySettings=[
      'listening-port=3478','listening-ip=0.0.0.0','relay-ip=127.0.0.1','external-ip=127.0.0.1',
      `min-port=${relayMin}`,`max-port=${relayMax}`,'realm=hearth-call-fixture','use-auth-secret',
      `static-auth-secret=${secret}`,'fingerprint',...(turnTls?['tls-listening-port=5349','cert=/etc/coturn/fixture.crt','pkey=/etc/coturn/fixture.key','no-tlsv1','no-tlsv1_1']:['no-tls']),'no-dtls','no-cli',`cli-password=${secret}`,
      // Restart generations can overlap until coturn processes old allocation
      // deletion. Keep this disposable fixture bounded while allowing that overlap.
      'allow-loopback-peers','no-multicast-peers','relay-threads=1','user-quota=16','total-quota='+Math.max(32,sfu?sfuCount*5:32),
      'pidfile=/tmp/turn.pid','log-file=stdout','verbose',...(turnTls?['no-udp','no-tcp']:[transport==='tcp'?'no-udp':'no-tcp']),
    ]
    writeFileSync(turnConfiguration,relaySettings.join('\n')+'\n',{mode:0o600})
    turnContainer='hearth-call-turn-'+randomUUID().slice(0,12)
    const sfuBindings=sfuPorts?['-p',`127.0.0.1:${sfuPorts.signalPort}:${sfuPorts.signalPort}/tcp`]:[]
    docker(['run','-d','--name',turnContainer,'--user','0:0','--cap-drop=ALL','--cap-add=NET_BIND_SERVICE','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp',...(turnTls?['-p',`127.0.0.1:${port}:5349/tcp`]:['-p',`127.0.0.1:${port}:3478/udp`,'-p',`127.0.0.1:${port}:3478/tcp`]),'-p',`127.0.0.1:${relayMin}-${relayMax}:${relayMin}-${relayMax}/udp`,...sfuBindings,...tlsMounts,'-v',`${turnConfiguration}:/etc/coturn/turnserver.conf:ro`,turnImage,'-c','/etc/coturn/turnserver.conf'])
    if(docker(['inspect',turnContainer,'--format','{{.State.Running}}'])!=='true'){
      const logs=spawnSync('docker',['logs','--tail','18',turnContainer],{encoding:'utf8',windowsHide:true,timeout:10000})
      console.error((logs.stdout+logs.stderr).split(secret).join('[redacted]').replace(/[a-f0-9]{48,}/g,'[redacted]'))
      throw new Error('Disposable TURN fixture exited before readiness')
    }
    env.HEARTH_TURN_URLS=turnTls?`turns:127.0.0.1:${port}?transport=tcp`:`turn:127.0.0.1:${port}?transport=${transport}`;env.HEARTH_TURN_SECRET=secret
    console.log('Disposable loopback-only TURN fixture started ('+transport+')')
  }
  if(sfu&&turnMode){
    // Docker's loopback is separate from Windows loopback. Share the disposable
    // relay namespace so its loopback peer exception reaches the local SFU.
    sfuContainer='hearth-call-sfu-'+randomUUID().slice(0,12)
    docker(['run','-d','--name',sfuContainer,'--network','container:'+turnContainer,'--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--tmpfs','/tmp','-v',`${sfuConfiguration}:/etc/hearth/livekit.yaml:ro`,sfuImage,'--config','/etc/hearth/livekit.yaml'])
    let ready=false;for(let i=0;i<60;i++){try{if((await fetch(env.HEARTH_SFU_URL.replace('ws:','http:'))).ok){ready=true;break}}catch{}await pause(100)}
    assert.ok(ready,'Disposable container SFU readiness timed out');console.log('Disposable loopback SFU started in relay fixture namespace')
  }
  if(distributedSfu){
    const certificate=join(output,'endpoint-fixture.crt'),key=join(output,'endpoint-fixture.key');turnCertificateFiles.push(certificate,key)
    const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl'
    assert.equal(spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,DNS:*.localhost','-keyout',key,'-out',certificate],{stdio:'ignore',windowsHide:true}).status,0)
    endpointProxy=await mediaEndpointProxy({certificate,key,port:5177,frontend:'http://127.0.0.1:5176',sfu:env.HEARTH_SFU_URL})
    env.HEARTH_SFU_URL='wss://localhost:5177/hearth-media'
  }
  assert.equal(spawnSync(process.execPath,['scripts/build-auth-wasm.mjs'],{cwd:root,stdio:'inherit',windowsHide:true}).status,0)
  let executable
  if(desktop){
    assert.equal(process.platform,'win32','This native runner currently targets Windows WebView2 only')
    const buildEnv={...process.env,HEARTH_PREBUILT_WASM:'1',HEARTH_PHASE1_HARNESS:'1',HEARTH_DIRECT_CALL_HARNESS:'1'}
    const npm=spawnSync('cmd.exe',['/d','/s','/c','npm run build -w @hearth/client'],{cwd:root,env:buildEnv,stdio:'inherit',windowsHide:true})
    assert.equal(npm.status,0,'Native call acceptance frontend failed to build')
    assert.equal(spawnSync('cargo',['build','--locked','-p','hearth-desktop','--features','phase1-acceptance'],{cwd:root,env:buildEnv,stdio:'inherit',windowsHide:true}).status,0,'Native call acceptance failed to compile')
    executable=join(output,'hearth-call-acceptance.exe');copyFileSync(join(root,'target/debug/hearth-desktop.exe'),executable)
  }
  fixture=spawn(process.execPath,['scripts/verify-auth.mjs','--serve','--native-postgres',...(sfuCount===25?['--release-server']:[])],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
  fixture.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-12000)});fixture.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3000)})
  let match
  for(let attempt=0;attempt<1200;attempt++){
    match=stdout.match(/Disposable owner-setup fixture: (http:\/\/127\.0\.0\.1:\d+); setup code file: (.+?)\. Type stop/)
    if(match)break
    if(fixture.exitCode!==null)throw new Error('Disposable server failed: '+stderr.replace(/postgres(?:ql)?:\/\/\S+/g,'[database]').replace(/[a-f0-9]{48,}/g,'[redacted]'))
    await pause(250)
  }
  assert.ok(match,'Disposable server readiness timed out')
  console.log('Disposable call server ready')
  if(desktop){
    const origin=match[1],serverKey=(await(await fetch(origin+'/.well-known/hearth')).json()).server_key,port=await freePort()
    nativeConfiguration=join(output,'native-fixture.json')
    writeFileSync(nativeConfiguration,JSON.stringify({origin,serverKey,directCalls:true,voiceRooms:rooms}),{mode:0o600})
    native=spawn(executable,['--phase1-acceptance'],{cwd:root,env:{...process.env,HEARTH_PHASE1_FIXTURE_PATH:nativeConfiguration,WEBVIEW2_USER_DATA_FOLDER:join(output,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port} --autoplay-policy=no-user-gesture-required --mute-audio --disable-background-timer-throttling --disable-renderer-backgrounding ${sfu?'--allow-loopback-in-peer-connection':''}`},windowsHide:true,stdio:['ignore','pipe','pipe']})
    native.stdout.on('data',chunk=>{nativeOutput=(nativeOutput+chunk).slice(-12000)});native.stderr.on('data',()=>{})
    let target
    for(let i=0;i<180;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(page=>page.type==='page'&&page.webSocketDebuggerUrl&&/tauri[.:]/.test(page.url));if(target)break}catch{}if(native.exitCode!==null)throw new Error('Native call fixture exited before readiness');await pause(250)}
    assert.ok(target,'Native call WebView2 readiness timed out');cdp=await devtools(target.webSocketDebuggerUrl)
    driver={executeScript:(fn,...args)=>cdp.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`),takeScreenshot:async()=> (await cdp.send('Page.captureScreenshot',{format:'png'})).data,quit:async()=>cdp.close()}
  }else{
    const browserEnv={...env,HEARTH_DIRECT_CALL_HARNESS:'1',HEARTH_DEV_SERVER:match[1],HEARTH_DEV_CLIENT_PORT:String(frontendPort)}
    const site=join(output,'site')
    if(immutable)assert.equal(spawnSync(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'build','--outDir',site],{cwd:join(root,'apps/client'),env:browserEnv,stdio:'inherit',windowsHide:true}).status,0,'Immutable acceptance assets failed to build')
    vite=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),...(immutable?['preview','--outDir',site,'--port',String(frontendPort)]:[]),'--host','127.0.0.1'],{cwd:join(root,'apps/client'),env:browserEnv,windowsHide:true,stdio:'ignore'})
    for(let i=0;i<120;i++){try{if((await fetch(frontendOrigin+'/health')).ok)break}catch{}await pause(250)}
    driver=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--mute-audio','--autoplay-policy=no-user-gesture-required','--window-size=1100,850',...(sfu?['--allow-loopback-in-peer-connection']:[]),...(turnTls||distributedSfu?['--ignore-certificate-errors']:[]),...(distributedSfu?['--site-per-process','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']:[]))).build()
    browserPid=(await driver.getCapabilities()).get('goog:processID')
    await driver.manage().setTimeouts({script:180000});await driver.get(frontendOrigin+'/media-test.html')
  }
  for(let i=0;i<120;i++){if(await driver.executeScript(()=>typeof window.runCallAcceptance==='function'))break;await pause(250)}
  await driver.executeScript(config=>{window.runCallAcceptance(config).then(result=>{window.__callResult=result}).catch(error=>{window.__callResult={outcome:'fail',stage:'harness',failureClass:error instanceof Error?error.name:'untyped',locations:typeof error?.stack==='string'?error.stack.split('\n').slice(1).map(line=>line.match(/(?:acceptance|group-call|direct-call|frame-keys|messaging-session)\.tsx?:\d+:\d+/)?.[0]).filter(Boolean):[]}})},{origin:desktop?match[1]:frontendOrigin,setupCode:readFileSync(match[2],'utf8').trim(),turn:turnMode,rekey,group,groupRevoke,groupRejoin,groupVideo,rooms,roomRevoke,roomVideo,sfu,sfuCount,stage,sfuObserver:sfuObserver?.config,sfuCapacityProfile,distributedSfu})
  let result,lastStage='';const clicked=new Set()
  for(let attempt=0;attempt<(sfuCount===25&&sfu?4800:rooms?720:420);attempt++){
    const progress=await driver.executeScript(()=>({stage:document.getElementById('status').textContent,result:window.__callResult}))
    if(progress.result){result=progress.result;break}
    if(progress.stage==='Ready'&&lastStage&&lastStage!=='Ready')throw new Error('Call fixture source changed during acceptance; restart from a fresh fixture')
    if(progress.stage!==lastStage){lastStage=progress.stage;console.log('Call acceptance: '+lastStage)}
    if(progress.stage==='SFU video ready'&&!cpuBefore)cpuBefore=cpuSnapshot([browserPid,native?.pid,sfuProcess?.pid,fixture?.pid],[sfuContainer,turnContainer])
    if(progress.stage==='SFU wrong-key subscriber'&&cpuBefore&&!cpuMeasurement)cpuMeasurement=cpuDelta(cpuBefore,cpuSnapshot([browserPid,native?.pid,sfuProcess?.pid,fixture?.pid],[sfuContainer,turnContainer]))
    const roomAction=/^voice (join|rejoin|leave) (\d+)$/.exec(progress.stage)
    if(roomAction&&!clicked.has(progress.stage)){
      const [,action,index]=roomAction,selector='#voice-fixture-'+index
      if(action==='leave'){
        if(await driver.executeScript(selector=>{const button=[...document.querySelectorAll(selector+' button')].find(button=>button.textContent.trim()==='Leave voice room');if(!button||button.disabled)return false;button.click();return true},selector))clicked.add(progress.stage)
      }else{
        const joined=await driver.executeScript(turn=>{const start=[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()==='Join room audio');if(!start||start.disabled)return false;const privacy=document.querySelector('dialog .call-privacy input');if(turn&&!privacy.checked){if(privacy.disabled)throw new Error('Room relay control unavailable');privacy.click()}start.click();return true},turnMode)
        if(joined)clicked.add(progress.stage)
        else if(!clicked.has(progress.stage+' setup')&&await driver.executeScript(selector=>{const button=document.querySelector(selector+' .voice-room-join');if(!button||button.disabled)return false;button.click();return true},selector))clicked.add(progress.stage+' setup')
      }
    }
    if(progress.stage==='voice twelve audio paths'&&!clicked.has('voice screenshot')){writeFileSync(join(output,'connected-room.png'),Buffer.from(await driver.takeScreenshot(),'base64'));clicked.add('voice screenshot')}
    const speakerAction=/^stage start speaking (\d+)$/.exec(progress.stage)
    if(speakerAction&&!clicked.has(progress.stage)&&await driver.executeScript(selector=>{const button=[...document.querySelectorAll(selector+' button')].find(button=>button.textContent.trim()==='Start speaking');if(!button||button.disabled)return false;button.click();return true},'#voice-fixture-'+speakerAction[1]))clicked.add(progress.stage)
    if(progress.stage==='SFU include audio'&&!clicked.has(progress.stage)){
      if(await driver.executeScript(()=>{const input=document.querySelector('#voice-fixture-0 section .call-privacy input');if(!input||input.disabled)return false;if(!input.checked)input.click();return true}))clicked.add(progress.stage)
    }
    if(progress.stage==='include computer audio'&&!clicked.has(progress.stage)){
      if(await driver.executeScript(()=>{const input=document.querySelector('#call-fixture-0 section .call-privacy input');if(!input||input.disabled)return false;if(!input.checked)input.click();return true}))clicked.add(progress.stage)
    }
    if(progress.stage==='group include audio'&&!clicked.has(progress.stage)&&await driver.executeScript(()=>{const input=document.querySelector('#group-fixture-0 .call-privacy input');if(!input||input.disabled)return false;if(!input.checked)input.click();return true}))clicked.add(progress.stage)
    const groupMedia={'group camera':'Turn group camera on','group screen':'Share screen with group','group screen off':'Stop group sharing'}[progress.stage]
    if(groupMedia&&!clicked.has(progress.stage)&&await driver.executeScript(text=>{const button=[...document.querySelectorAll('#group-fixture-0 button')].find(button=>button.textContent.trim()===text);if(!button||button.disabled)return false;button.click();return true},groupMedia))clicked.add(progress.stage)
    const roomAudio=/^voice include audio (\d+)$/.exec(progress.stage)
    if(roomAudio&&!clicked.has(progress.stage)){
      if(await driver.executeScript(selector=>{const input=document.querySelector(selector+' section .call-privacy input');if(!input||input.disabled)return false;if(!input.checked)input.click();return true},'#voice-fixture-'+roomAudio[1]))clicked.add(progress.stage)
    }
    if(progress.stage==='SFU video ready'&&!clicked.has(progress.stage)){writeFileSync(join(output,'connected-sfu.png'),Buffer.from(await driver.takeScreenshot(),'base64'));clicked.add(progress.stage)}
    const roomVideoAction=/^voice (camera|screen) (on|off) (\d+)$/.exec(progress.stage)
    if(roomVideoAction&&!clicked.has(progress.stage)){
      const [,kind,direction,index]=roomVideoAction,text=kind==='camera'?(direction==='on'?'Turn room camera on':'Turn room camera off'):(direction==='on'?'Share screen with room':'Stop room sharing')
      if(await driver.executeScript((selector,text)=>{const button=[...document.querySelectorAll(selector+' button')].find(button=>button.textContent.trim()===text);if(!button||button.disabled)return false;button.click();return true},'#voice-fixture-'+index,text))clicked.add(progress.stage)
    }
    if(progress.stage==='voice twelve video paths'&&!clicked.has('room video screenshot')){writeFileSync(join(output,'connected-room-video.png'),Buffer.from(await driver.takeScreenshot(),'base64'));clicked.add('room video screenshot')}
    if(progress.stage==='group start invitation'&&!clicked.has(progress.stage)){
      const started=await driver.executeScript(turn=>{const start=[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()==='Start group voice call');if(!start||start.disabled)return false;if(turn){const privacy=document.querySelector('dialog .call-privacy input');if(!privacy||privacy.disabled)throw new Error('Group relay control unavailable');if(!privacy.checked)privacy.click()}start.click();return true},turnMode)
      if(started)clicked.add(progress.stage)
      else if(!clicked.has('group setup')){const opened=await driver.executeScript(()=>{const button=document.querySelector('#group-fixture-0 .group-call-start');if(!button||button.disabled)return false;button.click();return true});if(opened)clicked.add('group setup')}
    }
    if(progress.stage==='start invitation'&&!clicked.has(progress.stage)){
      const started=await driver.executeScript(turn=>{const start=[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()==='Start voice call');if(!start||start.disabled)return false;if(turn){const privacy=document.querySelector('dialog .call-privacy input');if(!privacy||privacy.disabled)throw new Error('TURN privacy control unavailable');if(!privacy.checked)privacy.click()}start.click();return true},turnMode)
      if(started)clicked.add(progress.stage)
      else if(!clicked.has('setup')){const opened=await driver.executeScript(()=>{const button=document.querySelector('#call-fixture-0 .call-start');if(!button||button.disabled)return false;button.click();return true});if(opened)clicked.add('setup')}
    }
    const action={'answer invitation':['#call-fixture-1','Answer call'],'camera':['#call-fixture-0','Turn camera on'],'camera off':['#call-fixture-0','Turn camera off'],'screen share':['#call-fixture-0','Share screen'],'stop screen share':['#call-fixture-0','Stop sharing'],'hangup':['#call-fixture-0','End call'],'group first answer':['#group-fixture-1','Answer group call'],'group second answer':['#group-fixture-2','Answer group call'],'group mute':['#group-fixture-0','Mute microphone'],'group unmute':['#group-fixture-0','Unmute microphone'],'group leave':['#group-fixture-0','End group call'],'group rejoin':['#group-fixture-0','Rejoin group call']}[progress.stage]
    if(action&&!clicked.has(progress.stage)){
      if(await driver.executeScript((selector,text)=>{const button=[...document.querySelectorAll(selector+' button')].find(button=>button.textContent.trim()===text);if(!button||button.disabled)return false;button.click();return true},...action))clicked.add(progress.stage)
    }
    if(progress.stage==='screen share'&&clicked.has('screen share'))writeFileSync(join(output,'connected-call.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
    if(progress.stage==='group mute'&&!clicked.has('group screenshot')){writeFileSync(join(output,'connected-group.png'),Buffer.from(await driver.takeScreenshot(),'base64'));clicked.add('group screenshot')}
    await pause(500)
  }
  assert.ok(result,'Call acceptance timed out')
  if(cpuMeasurement)result.cpuMeasurement=cpuMeasurement
  if(turnTls&&result.outcome==='pass'){
    result.checks.every_selected_relay_transport_is_tls=result.metrics?.flat().every(metric=>metric.connectivity?.selectedRelay&&metric.connectivity.relayProtocol==='tls')===true
    if(!result.checks.every_selected_relay_transport_is_tls)result.outcome='fail'
    result.fixtureCertificateValidationBypass=true
    result.certificateScope='Isolated Chromium accepts this disposable self-signed certificate only. Product certificate trust is unchanged; verify-turn-tls.mjs separately requires trusted TLS certificate validation.'
  }
  writeFileSync(join(output,'result.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  if(desktop){
    const isolation=await driver.executeScript(async()=>{
      localStorage.setItem('hearth.fixture.playerCanary','private-fixture-canary')
      const frame=document.createElement('iframe');frame.sandbox='allow-scripts allow-same-origin'
      const answer=new Promise(resolve=>{const timer=setTimeout(()=>done(null),12000);const listener=event=>{if(event.source===frame.contentWindow&&event.origin==='null'&&event.data?.type==='hearth-native-player-probe')done(event.data)};const done=value=>{clearTimeout(timer);window.removeEventListener('message',listener);resolve(value)};window.addEventListener('message',listener)})
      frame.src='data:text/html,'+encodeURIComponent('<!doctype html><script src="'+location.origin+'/provider-probe.js"></script>');document.body.append(frame)
      try{return await answer}finally{frame.remove();localStorage.removeItem('hearth.fixture.playerCanary')}
    })
    result.checks.isolated_provider_frame_cannot_read_storage_or_invoke_native_commands=!!isolation&&isolation.blocked===3&&['absent','denied'].includes(isolation.ipc)
    if(!result.checks.isolated_provider_frame_cannot_read_storage_or_invoke_native_commands)result.outcome='fail'
    writeFileSync(join(output,'renderer-result.json'),JSON.stringify(result,null,2)+'\n')
    await finishNative(result);result.scope=rooms?'Isolated Windows WebView2 community voice room interface, real approved accounts/MLS, synthetic media and native fixture storage':group?'Tauri Windows WebView2 group UI/WASM/three real accounts/MLS with native SQLCipher fixture storage; synthetic audio only':'Tauri Windows WebView2 product UI/WASM/accounts/MLS with native SQLCipher fixture storage; synthetic audio/video/screen only'
  }
  writeFileSync(join(output,'result.json'),JSON.stringify({measuredAt:new Date().toISOString(),runtime:desktop?'Windows WebView2 native fixture':'headless Chrome',serverBuildProfile:sfuCount===25?'release':'debug',...result,...(turnMode?{turnImage,turnTransport:transport,turnScope:turnTls?'Loopback Docker TURN-TLS with a disposable browser certificate exception; not public-certificate or NAT/firewall acceptance':'Loopback Docker relay; not internet, TURN-TLS or NAT/firewall acceptance'}:{}),...(distributedSfu?{certificateScope:'Disposable Chromium test profile accepts the private endpoint fixture certificate; production certificate validation and system trust are unchanged'}:{})},null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
  if(result.outcome!=='pass'&&turnContainer){
    const logs=spawnSync('docker',['logs','--tail','32',turnContainer],{encoding:'utf8',windowsHide:true,timeout:10000})
    const safe=(logs.stdout+logs.stderr).replace(/[a-f0-9]{48,}/g,'[redacted]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[address]')
    writeFileSync(join(output,'turn-diagnostics.log'),safe);console.error(safe)
  }
  if(result.outcome!=='pass'&&sfuContainer){
    const logs=spawnSync('docker',['logs','--tail','80',sfuContainer],{encoding:'utf8',windowsHide:true,timeout:10000})
    const events=(logs.stdout+logs.stderr).split('\n').filter(Boolean).map(line=>{const parts=line.split('\t');let data={};try{data=JSON.parse(parts.slice(5).join('\t'))}catch{}return {time:parts[0],level:parts[1],event:parts[4],reason:data.reason,connectionType:data.connectionType,numParticipants:data.numParticipants}})
    writeFileSync(join(output,'sfu-diagnostics.log'),JSON.stringify(events,null,2)+'\n')
  }
  assert.equal(result.outcome,'pass')
}finally{
  if(native&&!nativeFinished&&native.exitCode===null&&driver)await finishNative({outcome:'fail',checks:{native_call_fixture_completed:false}}).catch(()=>{})
  await driver?.quit().catch(()=>{})
  await endpointProxy?.close()
  if(native&&native.exitCode===null)native.kill()
  if(nativeConfiguration)rmSync(nativeConfiguration,{force:true})
  if(vite&&vite.exitCode===null){const closed=new Promise(resolve=>vite.once('close',resolve));vite.kill();await closed}
  if(fixture&&fixture.exitCode===null){const closed=new Promise(resolve=>fixture.once('close',resolve));fixture.stdin.write('stop\n');await Promise.race([closed,pause(30000)]);if(fixture.exitCode===null)fixture.kill()}
  if(sfuContainer){assert.ok(sfuContainer.startsWith('hearth-call-sfu-'));spawnSync('docker',['rm','-f','-v',sfuContainer],{stdio:'ignore',windowsHide:true,timeout:30000})}
  if(turnContainer){assert.ok(turnContainer.startsWith('hearth-call-turn-'));spawnSync('docker',['rm','-f','-v',turnContainer],{stdio:'ignore',windowsHide:true,timeout:30000})}
  if(turnConfiguration)rmSync(turnConfiguration,{force:true})
  for(const file of turnCertificateFiles)rmSync(file,{force:true})
  if(sfuProcess&&sfuProcess.exitCode===null){const stopped=new Promise(resolve=>sfuProcess.once('close',resolve));sfuProcess.kill();await Promise.race([stopped,pause(5000)])}
  if(sfuConfiguration)rmSync(sfuConfiguration,{force:true})
  await sfuObserver?.close()
}
