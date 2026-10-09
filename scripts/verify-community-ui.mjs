// Real client controls against an isolated native PostgreSQL/server fixture.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {Builder,By} from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const root=fileURLToPath(new URL('../',import.meta.url))
const output=join(root,'target/phase2-evidence')
mkdirSync(output,{recursive:true})
const checks={}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let fixture,vite,driver
let fixtureOutput=''
async function exit(child) {
  if(!child || child.exitCode!==null || child.signalCode!==null)return
  const closed=new Promise(resolve=>child.once('close',resolve))
  child.kill();await closed
}
try {
  fixture=spawn(process.execPath,['scripts/verify-auth.mjs','--serve','--native-postgres'],{cwd:root,env:{...process.env,HEARTH_TEST_DATABASE_URL:'',HEARTH_CLIENT_ORIGINS:'http://127.0.0.1:5174'},windowsHide:true,stdio:['pipe','pipe','pipe']})
  fixture.stdout.on('data',chunk=>{fixtureOutput+=chunk})
  fixture.stderr.on('data',()=>{})
  let match
  for(let i=0;i<240;i++) {
    match=fixtureOutput.match(/Disposable owner-setup fixture: (http:\/\/127\.0\.0\.1:\d+); setup code file: (.+?)\. Type stop/)
    if(match)break
    if(fixture.exitCode!==null)throw new Error('Community UI fixture exited')
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
  driver=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--window-size=1440,1100')).build()
  await driver.get('http://127.0.0.1:5174')
  const wait=async id=>driver.wait(async()=>{const elements=await driver.findElements(By.id(id));return elements[0] ?? false},30000)
  await (await wait('setup-code')).sendKeys(code)
  await driver.findElement(By.id('username')).sendKeys('uiowner')
  await driver.findElement(By.id('password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.id('confirm-password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  const create=await wait('community-name')
  await driver.wait(async()=>await driver.findElement(By.css('.community-panel nav form:first-of-type button')).isEnabled(),30000)
  await create.sendKeys('UI <Friends>')
  await driver.findElement(By.css('.community-panel nav form:first-of-type button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('UI <Friends>')),15000)
  checks.create_and_select_community_with_literal_text=true
  await driver.findElement(By.css('.community-structure summary')).click()
  await driver.findElement(By.id('category-name')).sendKeys('General')
  await driver.findElement(By.css('.community-structure details form:first-of-type button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('General')),15000)
  await driver.findElement(By.id('channel-name')).sendKeys('chat')
  await driver.findElement(By.css('#channel-category option:nth-child(2)')).click()
  await driver.findElement(By.css('.community-structure details form:nth-of-type(2) button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('chat')),15000)
  await driver.findElement(By.id('channel-name')).sendKeys('news')
  await driver.findElement(By.css('#channel-kind option[value="announcement"]')).click()
  await driver.findElement(By.css('.community-structure details form:nth-of-type(2) button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('Announcements')),15000)
  checks.create_category_text_and_announcement_channels=true
  await driver.findElement(By.css('.community-structure details form:nth-of-type(3) button')).click()
  const invite=await wait('created-community-invite')
  assert.match(await invite.getAttribute('value'),/^[a-f0-9]{64}$/)
  await driver.findElement(By.xpath('//button[text()="Hide code"]')).click()
  assert.equal((await driver.findElements(By.id('created-community-invite'))).length,0)
  checks.create_and_hide_invite_without_persisting_it=true
  await driver.executeScript("window.__fixtureFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/v1/communities')?Promise.reject(new Error('fixture outage')):window.__fixtureFetch(url,...args)")
  // Trigger the same refresh control shown on errors by first reselecting after reload.
  await driver.findElement(By.xpath('//button[text()="Sign out"]')).click()
  await (await wait('username')).sendKeys('uiowner')
  await driver.findElement(By.id('password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  await wait('community-name')
  await driver.wait(async()=>await driver.findElement(By.css('.community-panel')).getText().then(text=>text.includes('Communities could not be loaded.')),30000)
  const failureText=await driver.findElement(By.css('.community-panel')).getText()
  assert.ok(!failureText.includes('No communities yet.'))
  await driver.executeScript('window.fetch=window.__fixtureFetch;delete window.__fixtureFetch')
  await driver.findElement(By.xpath('//button[text()="Refresh communities"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-panel nav')).getText().then(text=>text.includes('UI <Friends>')),15000)
  await driver.findElement(By.xpath('//nav[@aria-label="Your communities"]/button[text()="UI <Friends>"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('Announcements')),15000)
  checks.unavailable_directory_has_retry_and_restores_saved_structure=true
  await driver.findElement(By.css('.community-panel')).getRect().then(async rect=>{
    assert.ok(rect.width>400)
    await driver.executeScript('arguments[0].scrollIntoView({block:"start"})',await driver.findElement(By.css('.community-panel')))
  })
  writeFileSync(join(output,'community-ui-desktop.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  await driver.manage().window().setRect({width:430,height:1000})
  writeFileSync(join(output,'community-ui-narrow.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'),true)
  checks.narrow_layout_has_no_horizontal_overflow=true
  console.log(JSON.stringify(checks))
}finally {
  try {await driver?.quit()}finally {
    await exit(vite)
    if(fixture && fixture.exitCode===null) {
      const closed=new Promise(resolve=>fixture.once('close',resolve))
      fixture.stdin.write('stop\n')
      await Promise.race([closed,pause(10000).then(()=>exit(fixture))])
    }
    writeFileSync(join(output,'community-ui.json'),JSON.stringify({runtime:'Windows headless Chrome, real client controls',outcome:Object.keys(checks).length===5?'pass':'fail',checks,measured_at:new Date().toISOString()},null,2)+'\n')
    const remaining=fixtureOutput.match(/setup code file: (.+?)\. Type stop/)
    if(remaining)assert.equal(existsSync(remaining[1]),false,'Disposable fixture was not cleaned')
  }
}
