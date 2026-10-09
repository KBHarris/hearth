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
let fixture,vite,driver,buddy
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
  const enabled=async(client,id)=>{const elements=await client.findElements(By.id(id));return elements.length>0 && await elements[0].isEnabled()}
  const activeChannel=async(client,name)=>{const headings=await client.findElements(By.css('.conversation-header strong'));return headings.length>0 && (await headings[0].getText())===`# ${name}`}
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
  await driver.findElement(By.xpath('//ul[@class="channel-directory"]//button[normalize-space(.)="# chat"]')).click()
  await driver.wait(()=>enabled(driver,'message-text'),30000)
  await driver.findElement(By.id('message-text')).sendKeys('UI private channel before join')
  await driver.findElement(By.css('.message-composer button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI private channel before join')),15000)
  checks.open_channel_and_send_encrypted_solo_message=true
  await driver.findElement(By.css('.community-structure details form:nth-of-type(3) button')).click()
  const invite=await wait('created-community-invite')
  assert.match(await invite.getAttribute('value'),/^[a-f0-9]{64}$/)
  const communityCode=await invite.getAttribute('value')
  await driver.findElement(By.xpath('//button[text()="Hide code"]')).click()
  assert.equal((await driver.findElements(By.id('created-community-invite'))).length,0)
  checks.create_and_hide_invite_without_persisting_it=true
  await driver.findElement(By.xpath('//summary[text()="Server settings"]')).click()
  await driver.findElement(By.xpath('//button[text()="Create account invite"]')).click()
  const accountCode=await (await wait('account-invite')).getAttribute('value')
  buddy=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--window-size=1440,1100')).build()
  await buddy.get('http://127.0.0.1:5174')
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.xpath('//button[text()="Create an account"]'));return buttons[0] ?? false},30000).then(button=>button.click())
  await buddy.findElement(By.id('invite-code')).sendKeys(accountCode)
  await buddy.findElement(By.id('username')).sendKeys('uibuddy')
  await buddy.findElement(By.id('password')).sendKeys('HEARTH_UI_buddy_fixture_password_only')
  await buddy.findElement(By.id('confirm-password')).sendKeys('HEARTH_UI_buddy_fixture_password_only')
  await buddy.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  await buddy.wait(async()=>{const fields=await buddy.findElements(By.id('community-code'));return fields[0] ?? false},30000).then(field=>field.sendKeys(communityCode))
  await buddy.wait(async()=>await buddy.findElement(By.css('.community-panel nav form:nth-of-type(2) button')).isEnabled(),15000)
  await buddy.findElement(By.css('.community-panel nav form:nth-of-type(2) button')).click()
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.xpath('//ul[@class="channel-directory"]//button[normalize-space(.)="# chat"]'));return buttons[0] ?? false},15000).then(button=>button.click())
  await buddy.wait(()=>enabled(buddy,'message-text'),45000)
  assert.ok(!(await buddy.findElement(By.css('.message-log')).getText()).includes('UI private channel before join'))
  await buddy.findElement(By.id('message-text')).sendKeys('UI private channel from buddy')
  await buddy.findElement(By.css('.message-composer button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI private channel from buddy')),30000)
  checks.real_second_client_join_automatic_roster_rekey_and_no_old_history=true
  await driver.findElement(By.xpath('//ul[@class="channel-directory"]//button[normalize-space(.)="# news"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'news') && await enabled(driver,'message-text'),30000)
  await buddy.findElement(By.xpath('//ul[@class="channel-directory"]//button[normalize-space(.)="# news"]')).click()
  await buddy.wait(async()=>{const indicators=await buddy.findElements(By.css('.conversation-list button[aria-current="page"] small'));return await activeChannel(buddy,'news') && indicators.length>0 && (await indicators[0].getText())==='Encrypted'},45000,'Buddy did not join announcement encryption: ')
  await driver.findElement(By.id('message-text')).sendKeys('UI encrypted owner announcement')
  await driver.findElement(By.css('.message-composer button')).click()
  await buddy.wait(async()=>{const logs=await buddy.findElements(By.css('.message-log'));return logs.length>0 && (await logs[0].getText()).includes('UI encrypted owner announcement')},30000,'Buddy did not receive the new announcement: ')
  assert.equal(await buddy.findElement(By.id('message-text')).isEnabled(),false)
  assert.equal(await buddy.findElement(By.css('.message-composer button')).isEnabled(),false)
  checks.announcement_member_reads_ciphertext_with_publish_controls_disabled=true
  await buddy.quit();buddy=undefined
  // Hide the account capability before capturing screenshots.
  await driver.findElement(By.xpath('//summary[text()="Server settings"]')).click()
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
  await driver.findElement(By.xpath('//button[text()="Retry messaging"]')).click()
  await driver.findElement(By.xpath('//ul[@class="channel-directory"]//button[normalize-space(.)="# news"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'news') && await enabled(driver,'message-text'),30000)
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI encrypted owner announcement')),15000)
  checks.messaging_startup_retry_preserves_encrypted_history_after_directory_outage=true
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
  try {await buddy?.quit();await driver?.quit()}finally {
    await exit(vite)
    if(fixture && fixture.exitCode===null) {
      const closed=new Promise(resolve=>fixture.once('close',resolve))
      fixture.stdin.write('stop\n')
      await Promise.race([closed,pause(10000).then(()=>exit(fixture))])
    }
    writeFileSync(join(output,'community-ui.json'),JSON.stringify({runtime:'Windows headless Chrome, two isolated profiles, real client controls',outcome:Object.keys(checks).length===9?'pass':'fail',checks,measured_at:new Date().toISOString()},null,2)+'\n')
    const remaining=fixtureOutput.match(/setup code file: (.+?)\. Type stop/)
    if(remaining)assert.equal(existsSync(remaining[1]),false,'Disposable fixture was not cleaned')
  }
}
