// Isolated production WebView2 smoke: no user profile, server or URI association is modified.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createServer } from 'node:net'
import { devtools } from './verify-installed-test-client.mjs'
const executable = resolve(process.argv[2] ?? 'target/debug/hearth-desktop.exe')
const packageRoot = resolve(process.argv[3] ?? 'target/manual-test/guided-11cd35e')
const identifier = 'chat.hearth.hostjoinqa'
const profile = join(process.env.APPDATA, identifier), webProfile = join(process.env.LOCALAPPDATA, identifier)
const output = resolve('target/host-join-native-evidence')
assert.ok(!existsSync(profile) && !existsSync(webProfile), 'Preserve an existing QA profile; inspect it before rerunning')
const startup = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup', identifier.replaceAll('.', '-') + '-host.lnk')
assert.ok(!existsSync(startup), 'Preserve existing QA startup enrollment')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'manifest.json'), 'utf8'))
mkdirSync(profile, {recursive:true}); mkdirSync(output, {recursive:true})
const selection = JSON.stringify({root:packageRoot, https:false, project:manifest.server.composeProject, public_address:null})
writeFileSync(join(profile,'host-selection.json'),selection)
async function port() { const server = createServer(); await new Promise(r => server.listen(0,'127.0.0.1',r)); const value=server.address().port; await new Promise(r => server.close(r)); return value }
async function wait(test, label) { const end=Date.now()+45000; while(Date.now()<end) { try { const value=await test(); if(value)return value }catch{} await new Promise(r=>setTimeout(r,150)) } throw new Error('Host/Join native timeout: '+label) }
let child, cdp, outcome='fail'
const checks={}
async function launch() {
  const debugPort=await port()
  child=spawn(executable,[],{windowsHide:true,stdio:'ignore',env:{...process.env,DOCKER_HOST:'tcp://example.invalid:2375',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${debugPort}`}})
  console.log('QA launch',child.pid)
  const target=await wait(async()=>{const response=await fetch(`http://127.0.0.1:${debugPort}/json/list`);return(await response.json()).find(v=>v.type==='page'&&v.webSocketDebuggerUrl&&/tauri[.:]/.test(v.url))},'WebView2')
  cdp=await devtools(target.webSocketDebuggerUrl)
  await wait(()=>cdp.evaluate('!!window.__TAURI_INTERNALS__ && document.querySelectorAll(".setup-choice").length===2'),'application render')
  assert.equal(await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("plugin:app|identifier")'),identifier)
  console.log('QA native IPC ready')
}
async function stop() { cdp?.close();cdp=null;if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:10000});await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA process cleanup timeout')),10000))])}child=null }
try {
  await launch()
  const saved = await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_saved").catch(error=>({error:String(error)}))')
  console.log('QA saved host',saved ? {state:saved.state,error:saved.error,local_url:!!saved.local_url}:null)
  console.log('QA page',await cdp.evaluate('({native:window.isTauri,rail:[...document.querySelectorAll(".server-rail button")].map(e=>e.getAttribute("aria-label")),network:document.body.textContent.includes("Help someone check their internet host"),saved:localStorage.getItem("hearth.saved-servers")})'))
  assert.ok(saved?.local_url, JSON.stringify(saved))
  await wait(()=>cdp.evaluate(`!!document.querySelector('[aria-label="Open your hosted server"]')`),'saved host rail entry')
  checks.saved_host_is_visible_without_browser_saved_servers_or_docker_access=true
  await cdp.evaluate(`document.querySelector('[aria-label="Hosting and updates"]').click()`)
  await wait(()=>cdp.evaluate(`!!document.querySelector('.hosting-panel [role="alert"]')||document.querySelector('.hosting-panel')?.textContent.includes('remote Docker')`),'runtime error shown')
  const displayed = await cdp.evaluate('document.querySelector(".host-folder")?.textContent')
  assert.ok(displayed===packageRoot || displayed===String.fromCharCode(92,92,63,92)+packageRoot)
  checks.runtime_failure_preserves_host_and_shows_recovery_status=true
  assert.equal(readFileSync(join(profile,'host-selection.json'),'utf8'),selection)
  await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_startup",{enabled:true})')
  assert.ok(existsSync(startup))
  assert.equal((await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_startup",{enabled:null})')).enabled,true)
  await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_startup",{enabled:false})')
  assert.equal(existsSync(startup),false)
  checks.user_level_startup_enrollment_can_be_enabled_read_and_disabled=true
  assert.equal(await cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Restore server onto this computer")'),true)
  assert.equal(await cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Export server backup")'),true)
  checks.backup_and_network_controls_are_present=true
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:430,height:1000,deviceScaleFactor:1,mobile:false})
  assert.equal(await cdp.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true)
  const shot=await cdp.send('Page.captureScreenshot',{format:'png'})
  writeFileSync(join(output,'host-recovery-430px.png'),Buffer.from(shot.data,'base64'))
  checks.host_recovery_fits_430px_viewport=true
  await stop();await launch()
  await wait(()=>cdp.evaluate(`!!document.querySelector('[aria-label="Open your hosted server"]')`),'host retained after reopening')
  assert.equal(readFileSync(join(profile,'host-selection.json'),'utf8'),selection)
  checks.reopening_retains_native_host_when_browser_server_list_is_empty=true
  outcome='pass'
} finally {
  await stop()
  writeFileSync(join(output,'report.json'),JSON.stringify({outcome,measuredAt:new Date().toISOString(),scope:'Windows isolated native WebView2; not a clean-machine installer or internet test',checks},null,2)+'\n')
  // Only the named QA paths created above may be removed; never touch a Preview profile.
  for(const path of [profile,webProfile]) { assert.equal(dirname(path),path===profile?process.env.APPDATA:process.env.LOCALAPPDATA); assert.equal(path.split(/[\\/]/).at(-1),identifier); if(existsSync(path))rmSync(path,{recursive:true,maxRetries:10,retryDelay:500}) }
  if(existsSync(startup))rmSync(startup)
}
console.log(JSON.stringify({outcome,checks}))
