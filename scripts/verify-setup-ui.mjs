// Browser-only failure/cancellation checks. Real admission is covered by
// verify-community-ui.mjs --phase3 --storage --guided-setup.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target/setup-failure-evidence')
mkdirSync(output, { recursive: true })
let mode = 'ready', registrationFails = false, requests = 0, release
const gates = new Set()
const key = 'a'.repeat(64), account = 'b'.repeat(64)
let advertisedKey = key
const fixture = createServer(async (request, response) => {
  requests++
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Content-Type', 'application/json')
  if (mode === 'slow') await new Promise(resolve => { gates.add(resolve); release = resolve })
  if (response.destroyed) return
  if (request.url === '/health') response.end(JSON.stringify({ status: mode === 'degraded' ? 'degraded' : 'ok', version: '0.1.0', protocol: 1 }))
  else if (request.url === '/.well-known/hearth') response.end(JSON.stringify({ server_name: 'Setup test fixture', server_key: advertisedKey, protocols: mode === 'incompatible' ? [99] : [1], federation: false }))
  else if (request.url === '/api/v1/setup') response.end(JSON.stringify({ setup_complete: true }))
  else if (request.url === '/api/v1/auth/registration') {
    response.statusCode = registrationFails ? 503 : 200
    response.end(JSON.stringify({ registration_mode: 'invite' }))
  } else response.writeHead(404).end('{}')
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
const checks = {}
let driver, vite, outcome = 'fail'
try {
  vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], {
    cwd: join(root, 'apps/client'), env: { ...process.env, HEARTH_DEV_CLIENT_PORT: '5176', HEARTH_DEV_SERVER: origin }, windowsHide: true, stdio: 'ignore',
  })
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch('http://127.0.0.1:5176/', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break } } catch { /* Starting. */ }
    if (vite.exitCode !== null) throw new Error('Setup test Vite exited')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, 'Setup test Vite did not start')
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new', '--window-size=1000,1000')).build()
  await driver.get('http://127.0.0.1:5176')
  const button = text => driver.findElement(By.xpath(`//button[normalize-space(.)="${text}"]`))
  const wait = selector => driver.wait(async () => (await driver.findElements(By.css(selector)))[0] ?? false, 15000)
  const fill = async value => { const input = await wait('#setup-address'); await input.clear(); await input.sendKeys(value) }
  const check = async () => (await driver.findElement(By.css('.guided-setup form button[type="submit"]'))).click()
  const joinButton = await driver.wait(async () => (await driver.findElements(By.xpath('//button[contains(.,"Join a server")]')))[0] ?? false, 15000)
  await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', { width: 430, height: 1000, deviceScaleFactor: 1, mobile: false })
  assert.equal(await driver.executeScript('return window.innerWidth'), 430)
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'), true)
  const version = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/tauri.test.conf.json'), 'utf8')).version
  const versionLabel = await wait('[aria-label="Client version"]')
  assert.equal(await versionLabel.getText(), 'v' + version)
  assert.equal(await versionLabel.isDisplayed(), true)
  checks.current_client_version_is_visible_at_430px = true
  writeFileSync(join(output, 'setup-430px.png'), Buffer.from(await driver.takeScreenshot(), 'base64'))
  checks.host_join_choices_fit_an_actual_430px_viewport = true
  await driver.sendDevToolsCommand('Emulation.clearDeviceMetricsOverride')
  await joinButton.click()
  await driver.executeScript('window.__setupFetchCount=0;window.__setupFetch=window.fetch;window.fetch=(...args)=>{window.__setupFetchCount++;return window.__setupFetch(...args)}')
  await fill('hearth://join/#v=1&server=' + encodeURIComponent(origin) + '&key=' + key + '&account=' + account + '&setup=forbidden')
  await check(); await wait('.setup-error')
  assert.equal(requests, 0)
  await fill(account); await check(); await wait('.setup-error')
  assert.equal(requests, 0)
  assert.equal(await driver.executeScript('return window.__setupFetchCount'), 0)
  checks.malformed_invites_and_bare_codes_are_rejected_before_network_access = true

  mode = 'slow'
  await fill(origin); await check()
  await driver.wait(() => !!release, 5000)
  await (await button('← Host or join')).click()
  mode = 'ready'; for (const resolve of gates) resolve(); gates.clear()
  await driver.findElement(By.xpath('//button[contains(.,"Host a server")]')).click()
  assert.equal((await driver.findElements(By.css('.setup-result'))).length, 0)
  assert.equal(await driver.executeScript('return localStorage.getItem("hearth.server-url")'), null)
  checks.cancelled_check_cannot_connect_or_overwrite_the_next_route = true

  for (const failure of ['degraded', 'incompatible']) {
    mode = failure; await fill(origin); await check(); await wait('.setup-error')
    assert.equal((await driver.findElements(By.css('.setup-result .primary-button'))).length, 0)
    assert.equal(await driver.executeScript('return localStorage.getItem("hearth.server-url")'), null)
  }
  checks.degraded_and_incompatible_servers_cannot_continue_or_save_address = true

  mode = 'ready'; await fill(origin); await check(); await wait('.setup-result')
  await fill('invalid address')
  assert.equal((await driver.findElements(By.css('.setup-result'))).length, 0)
  checks.editing_a_checked_address_invalidates_the_previous_result = true

  await (await button('← Host or join')).click()
  await driver.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  await fill(`hearth://join/#v=1&server=${encodeURIComponent(origin)}&key=${key}&account=${account}`)
  await check(); await wait('.setup-result')
  registrationFails = true
  await (await button('Continue to account setup')).click()
  await wait('.auth-panel [role="alert"]')
  assert.equal(await driver.findElement(By.css('.auth-panel form button[type="submit"]')).isEnabled(), false)
  assert.equal((await driver.findElements(By.id('invite-code'))).length, 0)
  registrationFails = false
  await (await button('Check again')).click()
  await driver.wait(() => driver.findElement(By.css('.auth-panel form button[type="submit"]')).isEnabled(), 15000)
  assert.ok(!(await driver.executeScript('return JSON.stringify({...localStorage,...sessionStorage})')).includes(account))
  checks.registration_failure_has_working_retry_and_preserves_invite_only_in_memory = true

  advertisedKey = 'c'.repeat(64)
  await driver.executeScript('window.__setupGetItem=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key.startsWith("hearth.server-key:"))throw new Error("Test storage unavailable");return window.__setupGetItem.call(this,key)}')
  await driver.findElement(By.css('[aria-label="Add server"]')).click()
  await driver.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  await fill(origin); await check()
  assert.ok((await (await wait('.setup-error')).getText()).includes('identity does not match'))
  await driver.executeScript('Storage.prototype.getItem=window.__setupGetItem;delete window.__setupGetItem')
  checks.current_server_identity_is_preserved_even_when_saved_pins_cannot_be_read = true
  outcome = 'pass'
  console.log('Setup failure/cancellation checks passed: ' + Object.keys(checks).length)
} finally {
  for (const resolve of gates) resolve()
  try { await driver?.quit() } finally {
    if (vite && vite.exitCode === null) { const closed = new Promise(resolve => vite.once('close', resolve)); vite.kill(); await closed }
    fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve))
    writeFileSync(join(output, 'setup-ui.json'), JSON.stringify({ runtime: 'headless Chrome with mock discovery and registration responses', outcome, checks, measuredAt: new Date().toISOString() }, null, 2) + '\n')
  }
}
