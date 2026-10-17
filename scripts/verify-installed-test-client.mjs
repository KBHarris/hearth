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

async function devtools(url) {
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
    const second=spawn(join(install,executables[0]),[warmLink],{cwd:install,windowsHide:true,stdio:'ignore'})
    assert.equal(await new Promise((resolve,reject)=>{second.once('error',reject);second.once('exit',resolve)}),0)
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
      await cdp.evaluate('document.querySelector("[aria-label=\"Hosting and updates\"]").click()')
      await eventually(()=>cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Running")'),'native host status',30000)
      await cdp.evaluate('[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Stop server").click()')
      await cdp.evaluate('[...document.querySelectorAll(".hosting-panel button")].find(e=>e.textContent==="Stop hosting").click()')
      await eventually(()=>cdp.evaluate('document.querySelector(".hosting-panel")?.textContent.includes("Stopped")'),'native stop',90000)
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
