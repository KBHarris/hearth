// Exercise the actual installer and production executable. No account is created,
// so this smoke test never adds credentials to the user's system key store.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(test, label, ms = 20000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const value = await test(); if (value) return value } catch { /* Starting or navigating. */ }
    await sleep(150)
  }
  throw new Error('Installed client timeout: ' + label)
}

export async function devtools(url) {
  const socket = new WebSocket(url), pending = new Map()
  let next = 0
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), call = pending.get(message.id)
    if (!call) return
    pending.delete(message.id); clearTimeout(call.timer)
    if (message.error) call.reject(new Error('Installed client DevTools command failed'))
    else call.resolve(message.result)
  })
  function send(method, params = {}) {
    const id = ++next
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Installed client DevTools request timed out')) }, 10000)
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }))
    })
  }
  return { send, close: () => socket.close(), async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error('Installed client evaluation failed')
    return result.result.value
  } }
}

export async function verifyInstalledTestClient({ bundle, origin, output, hostProject }) {
  assert.equal(process.platform, 'win32', 'This installer smoke test requires Windows')
  const manifest = JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8'))
  const directory = resolve(output), allowed = resolve(root, 'target/bundle-acceptance')
  const within = relative(allowed, directory)
  assert.ok(within && !within.startsWith('..') && !isAbsolute(within))
  assert.ok(!lstatSync(directory).isSymbolicLink())
  const install = join(directory, 'installed-client')
  assert.ok(!existsSync(install), 'Never overwrite an existing installation directory')
  const beforeProfiles = [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean).map(base => {
    const path = resolve(base, manifest.client.identifier)
    assert.equal(dirname(path), resolve(base))
    return { path, existed: existsSync(path) }
  })
  assert.ok(beforeProfiles.every(profile => !profile.existed), 'Preserve an existing Hearth Test profile; do not run automatic installation over it')
  const productLiteral="'"+(manifest.client.productName??'Hearth Test').replaceAll("'","''")+"'"
  const existing = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -eq "+productLiteral+").Count"], { windowsHide: true, encoding: 'utf8' })
  assert.equal(existing.status, 0); assert.equal(existing.stdout.trim(), '0', 'Preserve the existing Hearth Test installation')
  const association=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if(Test-Path -LiteralPath 'HKCU:\\Software\\Classes\\hearth'){'registered'};exit 0"],{windowsHide:true,encoding:'utf8'})
  assert.equal(association.status,0);assert.equal(association.stdout.trim(),'','Preserve an existing Hearth protocol handler before running the disposable install test')
  // NSIS requires /D= and _?= last and unquoted, including paths with spaces:
  // https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.1
  const installerPath = join(bundle, 'client', manifest.client.installer)
  const installed = spawnSync(installerPath, ['/S', '/D=' + install], { argv0: `"${installerPath}"`, windowsVerbatimArguments: true, windowsHide: true, timeout: 180000, stdio: 'ignore' })
  assert.equal(installed.status, 0, 'Test installer failed')
  if(hostProject){
    assert.match(hostProject,/^hearth-host-[a-f0-9]{24}$/)
    const hostRoot=join(directory,'native-host');mkdirSync(join(hostRoot,'deploy'),{recursive:true})
    const hostManifest=structuredClone(manifest);hostManifest.server.composeProject=hostProject;hostManifest.server.backendPort=Number(new URL(origin).port)
    for(const file of ['compose.yaml','compose.https.yaml','setup.mjs','.env.example','Caddyfile','storage-entrypoint.sh']){
      copyFileSync(join(bundle,'deploy',file),join(hostRoot,'deploy',file))
      hostManifest.files['deploy/'+file]=createHash('sha256').update(readFileSync(join(hostRoot,'deploy',file))).digest('hex')
    }
    for(const file of ['.env','s3.json'])copyFileSync(join(directory,file),join(hostRoot,'deploy',file))
    writeFileSync(join(hostRoot,'manifest.json'),JSON.stringify(hostManifest))
    const signingKey=process.env.TAURI_SIGNING_PRIVATE_KEY_PATH??join(root,'.release-keys/updater.key')
    assert.equal(spawnSync(process.execPath,[join(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--private-key-path',signingKey,'--app-version',manifest.client.version,join(hostRoot,'manifest.json')],{cwd:root,stdio:'ignore',windowsHide:true}).status,0,'Sign the disposable native host manifest')
    const profile=join(process.env.APPDATA,manifest.client.identifier);mkdirSync(profile,{recursive:true})
    writeFileSync(join(profile,'host-selection.json'),JSON.stringify({root:hostRoot,https:false,project:hostProject,public_address:null}))
  }
  let child, cdp
  const checks = {}, screenshots = []
  try {
    const executables = readdirSync(install).filter(name => name.endsWith('.exe') && !/uninstall/i.test(name))
    assert.equal(executables.length, 1, 'Expected exactly one product executable')
    checks.actual_nsis_installer_installs_product = true
    const registered=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"(Get-Item -LiteralPath 'HKCU:\\Software\\Classes\\hearth\\shell\\open\\command' -ErrorAction Stop).GetValue('')"],{windowsHide:true,encoding:'utf8'})
    assert.equal(registered.status,0)
    assert.ok(registered.stdout.toLowerCase().includes(join(install,executables[0]).toLowerCase())&&registered.stdout.includes('"%1"'),'The installer must register its executable and a quoted URI argument')
    checks.installer_registers_hearth_invites_with_quoted_argument=true
    const lease = createServer()
    await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve))
    const port = lease.address().port
    await new Promise(resolve => lease.close(resolve))
    const coldLink='hearth://join/#v=2&server='+encodeURIComponent(origin)+'&code='+'0'.repeat(32)
    child = spawn(join(install, executables[0]), [coldLink], { cwd: install, windowsHide: true, stdio: 'ignore', env: {
      ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(directory, 'isolated-webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`,
    } })
    const target = await eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
      return (await response.json()).find(target => target.type === 'page' && target.webSocketDebuggerUrl && /tauri[.:]/.test(target.url))
    }, 'production WebView2 startup', 45000)
    cdp = await devtools(target.webSocketDebuggerUrl)
    await eventually(() => cdp.evaluate('document.querySelectorAll(".setup-choice").length===2'), 'Host/Join welcome')
    const metadata = await cdp.evaluate('Promise.all([window.__TAURI_INTERNALS__.invoke("plugin:app|version"),window.__TAURI_INTERNALS__.invoke("plugin:app|identifier"),window.__TAURI_INTERNALS__.invoke("protocol_version")])')
    assert.deepEqual(metadata, [manifest.client.version, manifest.client.identifier, 1])
    checks.installed_release_has_correct_version_profile_and_native_ipc = true
    assert.equal(await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("build_revision")'),manifest.sourceCommit)
    checks.installed_binary_embeds_matching_source_revision=true
    async function reviewLink(expected) {
      await eventually(()=>cdp.evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Review invite")'),'native invite handoff')
      assert.equal(await cdp.evaluate('document.querySelectorAll(".setup-screen .setup-choice").length'),2,'OS links must preserve the existing screen until reviewed')
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Review invite").click()')
      assert.equal(await cdp.evaluate('document.querySelector("dialog #setup-address")?.value'),expected)
      assert.equal(await cdp.evaluate('document.querySelectorAll("dialog .setup-result").length'),0,'Opening a link must not connect automatically')
      await cdp.evaluate('document.querySelector("dialog[open] .panel-heading button").click()')
    }
    await reviewLink(coldLink)
    checks.cold_start_invite_requires_review_and_check_before_connecting=true
    const warmLink=coldLink.replace('0'.repeat(32),'1'.repeat(32))
    const second=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process -FilePath '"+warmLink.replaceAll("'","''")+"' -WindowStyle Hidden"],{cwd:install,windowsHide:true,stdio:'ignore',timeout:20000})
    assert.equal(second.status,0,'Open the warm invite through the Windows URI association')
    assert.equal(child.exitCode,null,'Invite handoff keeps the original app alive')
    await reviewLink(warmLink)
    checks.running_instance_receives_invite_without_replacing_current_session=true
    const evidence = join(bundle, 'evidence'); mkdirSync(evidence, { recursive: true })
    async function screenshot(name) {
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(evidence, name), Buffer.from(capture.data, 'base64')); screenshots.push('evidence/' + name)
    }
    await screenshot('installed-welcome.png')
    if(hostProject){
      await cdp.evaluate("document.querySelector('[aria-label=\"Hosting and updates\"]').click()")
      await eventually(()=>cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Running")'),'native host status',30000)
      await cdp.evaluate('[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Stop server").click()')
      await cdp.evaluate('[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Stop hosting").click()')
      await eventually(()=>cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Stopped")'),'native stop',180000)
      await cdp.evaluate('[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Start server").click()')
      await eventually(()=>cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Running")'),'native start',180000)
      await cdp.evaluate('document.querySelector(".hosting-panel details").open=true;[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Get owner setup code").click()')
      assert.match(await eventually(()=>cdp.evaluate('document.querySelector("#local-owner-code")?.value'),'protected local setup code'),/^[a-f0-9]{64}$/)
      checks.installed_host_ui_starts_stops_and_retrieves_setup_code_without_terminal=true
      await screenshot('installed-hosting.png')
      await cdp.evaluate('document.querySelector("dialog[open] .panel-heading button").click()')
      assert.equal(await cdp.evaluate('document.querySelector("#local-owner-code")'),null)
      checks.local_setup_code_clears_when_host_panel_closes=true
    }
    await cdp.evaluate('[...document.querySelectorAll(".setup-choice")].find(e=>e.textContent.includes("Join a server")).click()')
    await cdp.evaluate('document.querySelector("#setup-address").focus()')
    await cdp.send('Input.insertText', { text: 'f'.repeat(64) })
    await cdp.evaluate('document.querySelector(".guided-setup form button[type=submit]").click()')
    await eventually(() => cdp.evaluate('document.querySelector(".setup-error")?.textContent.includes("invite code alone")'), 'bare-code rejection')
    checks.installed_client_contains_latest_invite_input_guard = true
    await cdp.evaluate('document.querySelector(".setup-back").click()')
    await cdp.evaluate('[...document.querySelectorAll(".setup-choice")].find(e=>e.textContent.includes("Host a server")).click()')
    await cdp.evaluate('document.querySelector("#setup-address").focus();document.querySelector("#setup-address").select()')
    await cdp.send('Input.insertText', { text: origin })
    await cdp.evaluate('document.querySelector(".guided-setup form button[type=submit]").click()')
    const readiness = await eventually(() => cdp.evaluate('document.querySelector(".setup-result")?.textContent'), 'bundled server discovery')
    assert.ok(readiness.includes('Passed') && readiness.includes('Not checked') && readiness.includes('only on this computer'))
    await screenshot('installed-host-check.png')
    await cdp.evaluate('document.querySelector(".setup-result .primary-button").click()')
    await eventually(() => cdp.evaluate('!!document.querySelector("#setup-code") && !!document.querySelector("#username")'), 'owner enrollment handoff')
    checks.installed_client_checks_bundled_server_and_reaches_owner_setup = true
    return { checks, runtime: 'installed production Windows x64 NSIS client / system WebView2', version: metadata[0], identifier: metadata[1], screenshots }
  } finally {
    cdp?.close()
    if (child && child.exitCode === null) { const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed }
    const uninstaller = readdirSync(install).find(name => /uninstall.*\.exe$/i.test(name))
    assert.ok(uninstaller, 'Installed test uninstaller missing')
    const uninstallPath = join(install, uninstaller)
    const removed = spawnSync(uninstallPath, ['/S', '_?=' + install], { argv0: `"${uninstallPath}"`, windowsVerbatimArguments: true, cwd: install, windowsHide: true, timeout: 120000, stdio: 'ignore' })
    assert.equal(removed.status, 0, 'Temporary test uninstall failed')
    for (const profile of beforeProfiles) if (!profile.existed && existsSync(profile.path)) {
      assert.equal(resolve(profile.path), profile.path); assert.ok(!lstatSync(profile.path).isSymbolicLink())
      rmSync(profile.path, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 })
    }
    checks.temporary_test_install_uninstalled_and_existing_profiles_preserved = true
  }
}

// Validate an in-place Preview upgrade without replacing the user's profile or host selection.
export async function verifyInstalledPreviewUpgrade({bundle,output,origin,hostProject,ownerEnrollment=false}) {
  assert.equal(process.platform,'win32')
  const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8'))
  assert.equal(manifest.client.productName,'Hearth Preview');assert.equal(manifest.client.identifier,'chat.hearth.preview')
  const install=resolve(process.env.LOCALAPPDATA,'Hearth Preview'),executable=join(install,'hearth-desktop.exe')
  assert.equal(dirname(install),resolve(process.env.LOCALAPPDATA));assert.ok(existsSync(executable));assert.ok(!lstatSync(install).isSymbolicLink())
  const quote=value=>"'"+value.replaceAll("'","''")+"'"
  const closed=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$target=${quote(executable)};Get-Process hearth-desktop -ErrorAction SilentlyContinue | Where-Object Path -eq $target | ForEach-Object {if(-not $_.CloseMainWindow() -or -not $_.WaitForExit(10000)){Stop-Process -Id $_.Id}};exit 0`],{windowsHide:true,stdio:'ignore',timeout:30000})
  assert.equal(closed.status,0);await sleep(1000)
  const backup=join(root,'target/manual-test/upgrade-backups',Date.now().toString());mkdirSync(backup,{recursive:true})
  const protectedBackup=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;icacls ${quote(backup)} /inheritance:r /grant:r "*$($sid):(OI)(CI)F" | Out-Null;exit $LASTEXITCODE`],{windowsHide:true,stdio:'ignore'})
  assert.equal(protectedBackup.status,0)
  const saved=[]
  function snapshot(path,target){
    if(!existsSync(path))return
    assert.ok(!lstatSync(path).isSymbolicLink());mkdirSync(target,{recursive:true})
    for(const entry of readdirSync(path,{withFileTypes:true})){
      // WebView cache is isolated during verification; leave the original tree in place.
      if(entry.name==='EBWebView')continue
      const source=join(path,entry.name),destination=join(target,entry.name)
      assert.ok(!lstatSync(source).isSymbolicLink())
      if(entry.isDirectory())snapshot(source,destination)
      else {copyFileSync(source,destination);saved.push({path:source,hash:createHash('sha256').update(readFileSync(source)).digest('hex')})}
    }
  }
  for(const [label,base] of [['local',process.env.LOCALAPPDATA],['roaming',process.env.APPDATA]])snapshot(join(base,manifest.client.identifier),join(backup,label))
  const checks={},installer=join(bundle,'client',manifest.client.installer)
  const hostSelection=join(process.env.APPDATA,manifest.client.identifier,'host-selection.json')
  const originalSelection=readFileSync(hostSelection)
  let child,cdp,changedSelection=false
  try {
    const result=spawnSync(installer,['/S','/D='+install],{argv0:`"${installer}"`,windowsVerbatimArguments:true,windowsHide:true,timeout:180000,stdio:'ignore'})
    assert.equal(result.status,0,'Preview upgrade installer failed');checks.actual_nsis_upgrade_installs_successfully=true
    const lease=createServer();await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));const port=lease.address().port;await new Promise(resolve=>lease.close(resolve))
    const coldLink='hearth://join/#v=2&server='+encodeURIComponent('http://localhost:8080')+'&code='+'0'.repeat(32)
    child=spawn(executable,[coldLink],{cwd:install,windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:join(output,'upgrade-webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`}})
    const target=await eventually(async()=>{const response=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(500)});return(await response.json()).find(page=>page.type==='page'&&page.webSocketDebuggerUrl&&/tauri[.:]/.test(page.url))},'upgraded WebView startup',45000)
    cdp=await devtools(target.webSocketDebuggerUrl)
    assert.deepEqual(await cdp.evaluate('Promise.all([window.__TAURI_INTERNALS__.invoke("plugin:app|version"),window.__TAURI_INTERNALS__.invoke("build_revision")])'),[manifest.client.version,manifest.sourceCommit])
    checks.upgraded_native_binary_matches_version_and_source=true
    await eventually(async()=>await cdp.evaluate(`document.querySelector('[aria-label="Client version"]')?.textContent===${JSON.stringify('v'+manifest.client.version)}`),'installed client version label')
    checks.visible_client_version_matches_installed_binary=true
    async function reviewCompatibleLink(expected){
      await eventually(()=>cdp.evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Review invite")'),'compatible OS invite handoff')
      await cdp.evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent==="Review invite").click()')
      assert.equal(await cdp.evaluate('document.querySelector("dialog #setup-address")?.value'),expected)
      assert.equal(await cdp.evaluate('document.querySelectorAll("dialog .setup-result").length'),0)
      await cdp.evaluate('document.querySelector("dialog[open] .panel-heading button").click()')
    }
    await reviewCompatibleLink(coldLink);checks.existing_os_invites_still_require_review_after_cold_start=true
    const warmLink=coldLink.replace('0'.repeat(32),'1'.repeat(32))
    assert.equal(spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath ${quote(warmLink)} -WindowStyle Hidden`],{windowsHide:true,stdio:'ignore',timeout:20000}).status,0)
    await reviewCompatibleLink(warmLink);assert.equal(child.exitCode,null)
    checks.existing_os_invites_still_reach_the_running_instance=true
    const status=await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_control",{action:"status"})')
    assert.equal(status.state,'running','The existing selected host must remain running')
    checks.existing_host_remains_running_without_restart_or_data_reset=true
    if(ownerEnrollment){
      assert.match(hostProject,/^hearth-host-[a-f0-9]{24}$/)
      const hostRoot=join(output,'native-owner-host');mkdirSync(join(hostRoot,'deploy'),{recursive:true})
      const hostManifest=structuredClone(manifest);hostManifest.server.composeProject=hostProject;hostManifest.server.backendPort=Number(new URL(origin).port)
      for(const file of ['compose.yaml','compose.https.yaml','setup.mjs','.env.example','Caddyfile','storage-entrypoint.sh']){
        copyFileSync(join(bundle,'deploy',file),join(hostRoot,'deploy',file))
        hostManifest.files['deploy/'+file]=createHash('sha256').update(readFileSync(join(hostRoot,'deploy',file))).digest('hex')
      }
      for(const file of ['.env','s3.json'])copyFileSync(join(output,file),join(hostRoot,'deploy',file))
      writeFileSync(join(hostRoot,'manifest.json'),JSON.stringify(hostManifest))
      const signingKey=process.env.TAURI_SIGNING_PRIVATE_KEY_PATH??join(root,'.release-keys/updater.key')
      assert.equal(spawnSync(process.execPath,[join(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--private-key-path',signingKey,'--app-version',manifest.client.version,join(hostRoot,'manifest.json')],{cwd:root,stdio:'ignore',windowsHide:true}).status,0)
      changedSelection=true;writeFileSync(hostSelection,JSON.stringify({root:hostRoot,https:false,project:hostProject,public_address:null}))
      await cdp.evaluate('[...document.querySelectorAll(".setup-choice")].find(e=>e.textContent.includes("Host a server")).click()')
      await cdp.evaluate('document.querySelector("#setup-address").focus();document.querySelector("#setup-address").select()')
      await cdp.send('Input.insertText',{text:origin})
      await cdp.evaluate('document.querySelector(".guided-setup form button[type=submit]").click()')
      await eventually(()=>cdp.evaluate('!!document.querySelector(".setup-result .primary-button")'),'owner host readiness')
      await cdp.evaluate('document.querySelector(".setup-result .primary-button").click()')
      await eventually(()=>cdp.evaluate('!!document.querySelector(".local-owner-setup")'),'native owner form')
      await cdp.evaluate('document.querySelector(".local-owner-setup").click()')
      await eventually(()=>cdp.evaluate('document.querySelector(".auth-panel form .notice")?.textContent.includes("Local owner setup is ready")'),'native owner authorization')
      assert.equal(await cdp.evaluate('document.querySelector("#setup-code")'),null)
      assert.equal(await cdp.evaluate(`(async()=>{const info=await(await fetch(${JSON.stringify(origin+'/.well-known/hearth')})).json();const code=await window.__TAURI_INTERNALS__.invoke('host_owner_code',{server:${JSON.stringify(origin)},serverKey:info.server_key});return !(document.documentElement.outerHTML+JSON.stringify({...localStorage,...sessionStorage})).includes(code)})()`),true)
      checks.installed_owner_form_authorizes_without_code_in_dom_or_storage=true
      assert.equal(await cdp.evaluate(`window.__TAURI_INTERNALS__.invoke('host_owner_code',{server:'https://example.org',serverKey:'a'.repeat(64)}).then(()=>false,error=>String(error).includes('selected local server'))`),true)
      checks.installed_owner_handoff_rejects_remote_destination=true
      await cdp.evaluate('window.__ownerNow=Date.now;Date.now=()=>window.__ownerNow()+300001')
      for(const [id,value] of [['username','test_owner'],['password','Owner-test-password'],['confirm-password','Owner-test-password']]){
        await cdp.evaluate(`document.querySelector(${JSON.stringify('#'+id)}).focus()`);await cdp.send('Input.insertText',{text:value})
      }
      await cdp.evaluate('document.querySelector(".auth-panel form button[type=submit]").click()')
      await eventually(()=>cdp.evaluate('!!document.querySelector("#setup-code") && document.querySelector(".auth-panel [role=alert]")?.textContent.includes("expired")'),'native authorization expiry')
      await cdp.evaluate('Date.now=window.__ownerNow')
      checks.installed_owner_authorization_expires_before_account_creation=true
      writeFileSync(hostSelection,originalSelection);changedSelection=false
      assert.equal((await cdp.evaluate('window.__TAURI_INTERNALS__.invoke("host_control",{action:"status"})')).state,'running')
    }
    for(const item of saved)assert.equal(createHash('sha256').update(readFileSync(item.path)).digest('hex'),item.hash)
    checks.native_profiles_and_host_configuration_are_preserved=true
    return {checks,runtime:'in-place Windows Preview NSIS upgrade / isolated system WebView2; existing native profiles preserved',version:manifest.client.version,identifier:manifest.client.identifier,screenshots:[]}
  } finally {
    if(changedSelection)writeFileSync(hostSelection,originalSelection)
    cdp?.close()
    if(child&&child.exitCode===null){const done=new Promise(resolve=>child.once('close',resolve));child.kill();await done}
    const reopened=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process -FilePath ${quote(executable)} -WorkingDirectory ${quote(install)}`],{windowsHide:true,stdio:'ignore'})
    assert.equal(reopened.status,0,'Reopen the upgraded app with its normal profile')
  }
}
