// Production React bundle with an injected native IPC fixture, in an isolated browser.
// No real host selection, runtime, account or desktop profile is modified.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve, extname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(process.argv[2] ?? join(root, 'apps/client/dist'))
const output = resolve(process.argv[3] ?? join(root, 'target/host-sidebar-diagnosis/ui'))
mkdirSync(output, { recursive: true })
const fixture = createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = resolve(dist, '.' + (name === '/' ? '/index.html' : name))
  const within = relative(dist, file)
  if (!within || within.startsWith('..') || isAbsolute(within)) { res.writeHead(404).end(); return }
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
    res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
    res.end(readFileSync(file))
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${fixture.address().port}`
const checks = {}
let driver, outcome = 'fail', injection
try {
  driver = await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new', '--window-size=1100,900')).build()
  const wait = selector => driver.wait(async () => (await driver.findElements(By.css(selector)))[0] ?? false, 15000)
  const hosted = '[aria-label="Open your hosted server"]'
  const recovery = '[aria-label="Your host needs attention"]'
  async function page(mode) {
    if (injection) await driver.sendDevToolsCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection })
    const result = await driver.sendAndGetDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.clear(); window.isTauri = true; window.__hostCalls = 0;
      window.__hostMode = ${JSON.stringify(mode)};
      window.__host = {folder:'C:/fixture/host',state:'selected',message:'Saved host',local_url:'http://localhost:8080',https:false,public_address:null};
      window.__TAURI_INTERNALS__ = {invoke: async (command) => {
        if(command==='plugin:app|version')return '0.3.5';
        if(command==='take_invite_link')return null;
        if(command==='host_startup')return {enabled:false,message:'Fixture startup disabled'};
        if(command==='host_select'){window.__hostMode='ready';window.__host={...window.__host,local_url:'http://localhost:8183'};return window.__host;}
        if(command==='host_saved'){
          window.__hostCalls++;
          if(window.__hostMode==='fail-once' && window.__hostCalls===1)throw Error('Temporary native storage failure');
          if(window.__hostMode==='failure')throw Error('Temporary native storage failure');
          if(window.__hostMode==='missing')return null;
          if(window.__hostMode==='repair')return {...window.__host,state:'error',local_url:null,message:'Saved package needs recovery'};
          return window.__host;
        }
        if(command==='host_control')return {...window.__host,state:'running',message:'Fixture running'};
        throw Error('Unexpected fixture command: '+command);
      }};
    ` })
    injection = result.identifier
    await driver.get(origin)
    await wait('[aria-label="Hosting and updates"]')
  }
  await page('fail-once')
  await wait(hosted)
  assert.ok(await driver.executeScript('return window.__hostCalls>=2'))
  checks.startup_ipc_failure_recovers_without_reopening = true

  await driver.executeScript("window.__hostMode='failure';window.dispatchEvent(new Event('focus'))")
  await driver.wait(() => driver.executeScript('return window.__hostCalls>=3'), 5000)
  assert.equal((await driver.findElements(By.css(hosted))).length, 1)
  checks.transient_failure_preserves_last_known_host_entry = true

  await driver.executeScript("window.__hostMode='ready';window.__host.local_url='http://localhost:8183';window.dispatchEvent(new Event('focus'))")
  await (await wait(hosted)).click()
  await driver.wait(async () => (await (await wait('#server-address')).getAttribute('value')) === 'http://localhost:8183', 5000)
  checks.focus_refresh_uses_new_saved_host_address = true

  await page('repair')
  await (await wait(recovery)).click()
  await wait('.hosting-panel .host-folder')
  assert.ok((await driver.findElement(By.css('.host-folder')).getText()).includes('fixture'))
  checks.saved_host_with_missing_package_address_opens_recovery = true

  await page('missing')
  await driver.findElement(By.css('[aria-label="Hosting and updates"]')).click()
  const choose = await driver.wait(async () => (await driver.findElements(By.xpath('//button[normalize-space(.)="Choose host package"]')))[0] ?? false, 5000)
  await choose.click()
  await wait(hosted)
  checks.host_selection_updates_sidebar_while_settings_are_open = true
  await driver.sendDevToolsCommand('Emulation.setDeviceMetricsOverride', { width: 430, height: 950, deviceScaleFactor: 1, mobile: false })
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'), true)
  checks.host_recovery_controls_fit_430px_viewport = true
  writeFileSync(join(output, 'host-settings.png'), Buffer.from(await driver.takeScreenshot(), 'base64'))
  outcome = 'pass'
} finally {
  await driver?.quit()
  fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve))
  writeFileSync(join(output, 'result.json'), JSON.stringify({ outcome, measuredAt: new Date().toISOString(), scope: 'Production browser UI with injected native IPC failures; no real desktop profile or host modified', checks }, null, 2) + '\n')
}
console.log(JSON.stringify({ outcome, checks }, null, 2))
