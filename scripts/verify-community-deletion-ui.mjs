// Focused real-UI deletion check, using disposable accounts/PostgreSQL only.
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {Builder,By,Key} from 'selenium-webdriver'
import {Select} from 'selenium-webdriver/lib/select.js'
import chrome from 'selenium-webdriver/chrome.js'
const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'target/community-deletion-evidence');mkdirSync(output,{recursive:true});mkdirSync(join(output,'downloads'),{recursive:true})
assert.equal(spawnSync(process.execPath,[join(root,'scripts/build-auth-wasm.mjs')],{cwd:root,stdio:'inherit',windowsHide:true}).status,0)
const checks={},pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let fixture,vite,driver,fixtureOutput='',fixtureErrors='',succeeded=false
async function exit(child){if(!child||child.exitCode!==null)return;const done=new Promise(resolve=>child.once('close',resolve));child.kill();await done}
async function trackRequests(client){await client.executeScript(()=>{window.__apiTimes=[];const fetch=window.fetch.bind(window);window.fetch=(...args)=>{if(String(args[0]).includes('/api/v1/'))window.__apiTimes.push(Date.now());return fetch(...args)}})}
async function pace(){await driver.wait(()=>driver.executeScript(()=>window.__apiTimes.filter(at=>Date.now()-at<65000).length<50),90000)}
const byText=text=>By.xpath('//button[normalize-space(.)="'+text+'"]')
async function click(text){await driver.findElement(byText(text)).click()}
async function confirm(name){const input=await driver.findElement(By.id('delete-structure-name'));await input.sendKeys(name);await pace();await driver.findElement(By.css('.structure-delete-confirmation button[type="submit"]')).click()}
try{
  fixture=spawn(process.execPath,['scripts/verify-auth.mjs','--serve','--native-postgres',...(process.argv.includes('--phase3')?['--phase3']:[]),...(process.argv.includes('--storage')?['--storage']:[])],{cwd:root,env:{...process.env,HEARTH_TEST_DATABASE_URL:'',HEARTH_CLIENT_ORIGINS:'http://127.0.0.1:5174'},windowsHide:true,stdio:['pipe','pipe','pipe']})
  fixture.stdout.on('data',chunk=>{fixtureOutput+=chunk})
  fixture.stderr.on('data',chunk=>{fixtureErrors=(fixtureErrors+chunk).slice(-6000)})
  let match
  for(let i=0;i<2400;i++) {
    match=fixtureOutput.match(/Disposable owner-setup fixture: (http:\/\/127\.0\.0\.1:\d+); setup code file: (.+?)\. Type stop/)
    if(match)break
    if(fixture.exitCode!==null)throw new Error('Community UI fixture exited before readiness: '+fixtureErrors.replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[database URL]').replace(/[a-f0-9]{64,}/gi,'[redacted ID]'))
    await pause(250)
  }
  assert.ok(match,'Fixture readiness timeout')
  const code=readFileSync(match[2],'utf8').trim()
  vite=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1'],{cwd:join(root,'apps/client'),env:{...process.env,HEARTH_DEV_SERVER:match[1],HEARTH_DEV_CLIENT_PORT:'5174'},windowsHide:true,stdio:'ignore'})
  let ready=false
  for(let i=0;i<80;i++) {
    try { if((await fetch('http://127.0.0.1:5174/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break} }catch{/* Starting. */}
    if(vite.exitCode!==null)throw new Error('Isolated Vite exited')
    await pause(250)
  }
  assert.ok(ready,'Isolated Vite health timeout')
  driver=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--window-size=1440,1100').setUserPreferences({'download.default_directory':join(output,'downloads'),'download.prompt_for_download':false})).build()
  await driver.get('http://127.0.0.1:5174')
  await trackRequests(driver)
  const wait=async id=>driver.wait(async()=>{const elements=await driver.findElements(By.id(id));return elements[0] ?? false},30000)
  const enabled=async(client,id)=>{const elements=await client.findElements(By.id(id));return elements.length>0 && await elements[0].isEnabled()}
  const activeChannel=async(client,name)=>{const headings=await client.findElements(By.css('.conversation-header strong'));return headings.length>0 && (await headings[0].getText())===`# ${name}`}
  await driver.wait(async()=>await driver.findElements(By.css('.setup-choice')).then(items=>items.length===2),15000)
  assert.equal(await driver.executeScript('return performance.getEntriesByType("resource").filter(e=>/\\/(health|\\.well-known|api)\\b/.test(new URL(e.name).pathname)).length'),0)
  writeFileSync(join(output,'setup-welcome.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  await driver.manage().window().setRect({width:430,height:1000})
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'),true)
  writeFileSync(join(output,'setup-welcome-narrow.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  await driver.manage().window().setRect({width:1440,height:1100})
  if(process.argv.includes('--guided-setup'))checks.fresh_install_offers_host_join_without_network_probe_and_fits_narrow_screen=true
  await driver.findElement(By.xpath('//button[contains(.,"Host a server")]')).click()
  await driver.findElement(By.css('.guided-setup form button[type="submit"]')).click()
  await driver.wait(async()=>await driver.findElements(By.css('.setup-result')).then(items=>items.length===1),15000)
  const readiness=await driver.findElement(By.css('.setup-result')).getText()
  assert.ok(readiness.includes('Not checked')&&readiness.includes('only on this computer'))
  assert.equal(await driver.executeScript('return localStorage.getItem("hearth.server-url")'),null)
  writeFileSync(join(output,'setup-host-check.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  if(process.argv.includes('--guided-setup'))checks.host_readiness_is_local_only_and_is_not_saved_until_confirmation=true
  await driver.findElement(By.xpath('//button[text()="Set up owner account"]')).click()
  await (await wait('setup-code')).sendKeys(code)
  await driver.findElement(By.id('username')).sendKeys('uiowner')
  await driver.findElement(By.id('password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.id('confirm-password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  await driver.wait(async()=>{const buttons=await driver.findElements(By.css('[aria-label="Create or join a community"]'));return buttons[0]??false},30000).then(button=>button.click())
  await driver.findElement(By.xpath('//button[text()="Create a community"]')).click()
  const create=await wait('community-name')
  await driver.wait(async()=>await driver.findElement(By.xpath('//button[text()="Create community"]')).isEnabled(),30000)
  await create.sendKeys('UI <Friends>')
  await driver.findElement(By.xpath('//button[text()="Create community"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('UI <Friends>')),15000)
  checks.create_and_select_community_with_literal_text=true

  await driver.findElement(By.css('[aria-label="Manage community"]')).click()
  await click('Categories');await driver.findElement(By.id('category-name')).sendKeys('Gaming');await click('Add category')
  await driver.wait(()=>driver.findElements(By.css('.structure-management li')).then(elements=>elements.length===1),15000)
  await click('Channels')
  for(const name of ['general','keep']){await pace();await driver.findElement(By.id('channel-name')).sendKeys(name);await new Select(driver.findElement(By.id('channel-category'))).selectByVisibleText('Gaming');await click('Add channel');await driver.wait(()=>driver.findElements(By.css('[data-channel-name="'+name+'"]')).then(elements=>elements.length===1),15000);await driver.wait(()=>driver.findElement(By.id('channel-name')).getAttribute('value').then(value=>value===''),15000)}
  await driver.findElement(By.id('channel-name')).sendKeys('Unsent channel draft')
  await driver.findElement(By.css('[aria-label="Delete channel general"]')).click()
  assert.equal(await driver.findElement(By.css('.structure-delete-confirmation button[type="submit"]')).isEnabled(),false)
  await driver.findElement(By.id('delete-structure-name')).sendKeys('wrong')
  assert.equal(await driver.findElement(By.css('.structure-delete-confirmation button[type="submit"]')).isEnabled(),false)
  await driver.actions().sendKeys(Key.ESCAPE).perform()
  await driver.wait(()=>driver.findElement(By.id('channel-name')).isDisplayed(),10000)
  assert.equal(await driver.findElement(By.id('channel-name')).getAttribute('value'),'Unsent channel draft')
  assert.equal(await driver.switchTo().activeElement().getAttribute('aria-label'),'Delete channel general')
  checks.name_confirmation_escape_focus_and_creation_draft_preservation=true
  writeFileSync(join(output,'management.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  await click('Categories');await driver.findElement(By.css('[aria-label="Delete category Gaming"]')).click();await confirm('Gaming')
  await driver.wait(()=>driver.findElements(By.css('.community-structure h4')).then(elements=>elements.length===0),15000)
  assert.equal((await driver.findElements(By.css('.channel-directory [data-channel-name]'))).length,2)
  checks.category_deletion_keeps_channels_and_ungroups_them=true
  await driver.findElement(By.css('dialog[open] .panel-heading button')).click()
  await driver.findElement(By.css('[data-channel-name="general"]')).click();await driver.wait(()=>enabled(driver,'message-text'),30000)
  await driver.findElement(By.id('message-text')).sendKeys('Private unsent draft')
  await driver.findElement(By.css('[aria-label="Manage community"]')).click();await click('Channels')
  await driver.findElement(By.css('[aria-label="Delete channel general"]')).click();await confirm('general')
  await driver.wait(()=>driver.findElements(By.css('[data-channel-name="general"]')).then(elements=>elements.length===0),15000)
  await driver.findElement(By.css('dialog[open] .panel-heading button')).click()
  assert.ok((await driver.findElement(By.css('[aria-labelledby="chat-heading"]')).getText()).includes('Your unsent draft has been kept'))
  await driver.findElement(By.css('[data-channel-name="keep"]')).click();await driver.wait(()=>enabled(driver,'message-text'),30000)
  assert.equal(await driver.findElement(By.id('message-text')).getAttribute('value'),'')
  checks.active_channel_deletion_removes_it_without_sending_its_draft_elsewhere=true
  await driver.findElement(By.css('[aria-label="Manage community"]')).click();await click('Channels')
  await driver.findElement(By.css('[aria-label="Delete channel keep"]')).click()
  await driver.executeScript(()=>{window.__beforeDeleteFetch=window.fetch;window.fetch=(url,...args)=>String(url).endsWith('/delete')?Promise.reject(new Error('Disposable fixture outage')):window.__beforeDeleteFetch(url,...args)})
  await confirm('keep');await driver.wait(()=>driver.findElements(By.css('[role="alert"]')).then(async elements=>(await Promise.all(elements.map(element=>element.getText()))).some(text=>text.includes('Could not reach'))),15000)
  assert.equal(await driver.findElement(By.id('delete-structure-name')).getAttribute('value'),'keep')
  await driver.executeScript(()=>{window.fetch=window.__beforeDeleteFetch;delete window.__beforeDeleteFetch})
  await driver.findElement(By.css('.structure-delete-confirmation button[type="button"]')).click()
  assert.equal((await driver.findElements(By.css('[data-channel-name="keep"]'))).length,1)
  checks.network_failure_preserves_confirmation_and_channel=true
  await driver.findElement(By.css('.structure-delete-community button')).click()
  await driver.manage().window().setRect({width:430,height:1000})
  assert.equal(await driver.findElement(By.id('delete-structure-name')).isDisplayed(),true)
  assert.equal(await driver.executeScript(()=>{const bounds=document.querySelector('dialog[open]').getBoundingClientRect();return bounds.width>0&&bounds.x>=0&&bounds.right<=innerWidth&&bounds.y>=0&&bounds.bottom<=innerHeight}),true)
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'),true)
  writeFileSync(join(output,'delete-community-narrow.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  await driver.manage().window().setRect({width:1440,height:1100});await confirm('UI <Friends>')
  await driver.wait(()=>driver.findElements(By.css('nav[aria-label="Your communities"] .community-link')).then(elements=>elements.length===0),15000)
  assert.equal((await driver.findElements(By.css('.channel-directory [data-channel-name]'))).length,0)
  checks.community_deletion_clears_directory_and_narrow_confirmation_fits=true

  succeeded=true;console.log(JSON.stringify({outcome:'pass',checks}))
}catch(error){if(driver){try{writeFileSync(join(output,'failure.png'),Buffer.from(await driver.takeScreenshot(),'base64'));const alerts=await driver.findElements(By.css('[role="alert"],[role="status"]'));writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(error),alerts:await Promise.all(alerts.map(element=>element.getText()))},null,2))}catch{}}throw error}
finally{await driver?.quit().catch(()=>{});await exit(vite);if(fixture&&fixture.exitCode===null){const done=new Promise(resolve=>fixture.once('close',resolve));fixture.stdin.write('stop\n');await Promise.race([done,pause(15000)]);if(fixture.exitCode===null)await exit(fixture)}writeFileSync(join(output,'result.json'),JSON.stringify({outcome:succeeded?'pass':'fail',measuredAt:new Date().toISOString(),checks,scope:'One isolated Chromium profile, real production controls/WASM/MLS, authenticated HTTP and disposable PostgreSQL. No installed user profile or data modified.'},null,2)+'\n')}
