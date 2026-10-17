// Real client controls against an isolated native PostgreSQL/server fixture.
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {Builder,By,Key} from 'selenium-webdriver'
import {Select} from 'selenium-webdriver/lib/select.js'
import chrome from 'selenium-webdriver/chrome.js'
import {verifyTextUI} from './phase2-text-ui.mjs'
import {createHearthInvite,resolveSetupTarget} from '../packages/sdk/src/index.ts'

const root=fileURLToPath(new URL('../',import.meta.url))
// Direct Vite does not execute the client's npm predev hook. Build the current
// crypto engine explicitly so changed file/protocol limits cannot use stale WASM.
assert.equal(spawnSync(process.execPath,[join(root,'scripts/build-auth-wasm.mjs')],{cwd:root,stdio:'inherit',windowsHide:true}).status,0,'Current auth WASM build failed')
const output=join(root,process.argv.includes('--setup-only')?'target/setup-join-evidence':process.argv.includes('--guided-setup')?'target/setup-evidence':process.argv.includes('--phase3')?'target/phase3-evidence':'target/phase2-evidence')
mkdirSync(output,{recursive:true})
mkdirSync(join(output,'downloads'),{recursive:true})
const checks=new Proxy({}, {set(target,key,value){target[key]=value;console.log('UI check passed: '+String(key));return true}})
let succeeded=false
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
let fixture,vite,driver,buddy
let fixtureOutput=''
let fixtureErrors=''
async function trackRequests(client){await client.executeScript("window.__apiTimes=[];const fixtureFetch=window.fetch.bind(window);window.fetch=(...args)=>{if(String(args[0]).includes('/api/v1/'))window.__apiTimes.push(Date.now());return fixtureFetch(...args)}")}
// The real server retains its Phase 1 abuse controls. Pace bursts of automated
// setup/actions rather than bypassing limits or accepting a queued message as delivered.
async function pace(client){await client.wait(()=>client.executeScript('return window.__apiTimes.filter(at=>Date.now()-at<65000).length<50'),90000,'Automated action burst must stay within the real request budget')}
async function exit(child) {
  if(!child || child.exitCode!==null || child.signalCode!==null)return
  const closed=new Promise(resolve=>child.once('close',resolve))
  child.kill();await closed
}
async function closePanel(client){await client.findElement(By.css('dialog[open] .panel-heading button')).click()}
async function verifyOwnershipUi(owner,buddy,checks){
  await pace(owner);await pace(buddy)
  await owner.findElement(By.css('[aria-label="Manage community"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Ownership"]')).click()
  await owner.wait(async()=>await owner.findElements(By.id('ownership-member')).then(e=>e.length>0),15000)
  await new Select(owner.findElement(By.id('ownership-member'))).selectByVisibleText('@uibuddy')
  await owner.wait(()=>owner.findElement(By.id('ownership-device')).getAttribute('value').then(value=>!!value),15000)
  await owner.findElement(By.xpath('//label[contains(.,"I want this member")]/input')).click()
  await owner.wait(()=>owner.findElement(By.xpath('//button[text()="Offer ownership transfer"]')).isEnabled(),15000)
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Offer ownership transfer"]')).click()
  await owner.wait(async()=>await owner.findElements(By.xpath('//button[text()="Cancel transfer"]')).then(e=>e.length>0),30000)
  await buddy.findElement(By.css('[aria-label="Community settings"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Accept community ownership"]')).then(e=>e.length>0),15000)
  assert.equal(await buddy.findElement(By.xpath('//button[text()="Accept community ownership"]')).isEnabled(),false)
  await buddy.findElement(By.xpath('//label[contains(.,"I accept responsibility")]/input')).click()
  await buddy.findElement(By.xpath('//button[text()="Accept community ownership"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.id('ownership-member')).then(e=>e.length>0),30000)
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Refresh ownership"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('dialog[open]')).getText().then(t=>t.includes('Current owner: @uibuddy')&&!t.includes('Cancel transfer')),15000)
  await closePanel(owner);await closePanel(buddy)
  assert.equal((await owner.findElements(By.css('[aria-label="Manage community"]'))).length,0)
  assert.equal((await buddy.findElements(By.css('[aria-label="Manage community"]'))).length,1)
  checks.ownership_offer_and_explicit_acceptance_update_both_clients_without_losing_session=true
  await pace(owner);await pace(buddy)
  await buddy.findElement(By.css('[aria-label="Manage community"]')).click()
  await buddy.findElement(By.xpath('//button[text()="Ownership"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.id('ownership-member')).then(e=>e.length>0),15000)
  await new Select(buddy.findElement(By.id('ownership-member'))).selectByVisibleText('@uiowner')
  await buddy.wait(()=>buddy.findElement(By.id('ownership-device')).getAttribute('value').then(value=>!!value),15000)
  await buddy.findElement(By.xpath('//label[contains(.,"I want this member")]/input')).click()
  await buddy.wait(()=>buddy.findElement(By.xpath('//button[text()="Offer ownership transfer"]')).isEnabled(),15000)
  await buddy.findElement(By.xpath('//button[text()="Offer ownership transfer"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Cancel transfer"]')).then(e=>e.length>0),30000)
  await owner.findElement(By.css('[aria-label="Community settings"]')).click()
  await owner.wait(async()=>await owner.findElements(By.xpath('//button[text()="Accept community ownership"]')).then(e=>e.length>0),15000)
  await owner.findElement(By.xpath('//label[contains(.,"I accept responsibility")]/input')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Accept community ownership"]')).click()
  await owner.wait(async()=>await owner.findElements(By.id('ownership-member')).then(e=>e.length>0),30000)
  await buddy.findElement(By.xpath('//button[text()="Refresh ownership"]')).click()
  await buddy.wait(async()=>await buddy.findElement(By.css('dialog[open]')).getText().then(t=>t.includes('Current owner: @uiowner')),15000)
  await closePanel(owner);await closePanel(buddy)
  checks.ownership_return_transfer_preserves_invited_member_history_and_signed_root=true
}
async function verifyGovernanceUi(owner,buddy,checks) {
  await pace(owner);await pace(buddy)
  await owner.findElement(By.css('[aria-label="Manage community"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Roles & moderation"]')).click()
  await owner.wait(async()=>await owner.findElements(By.id('role-name')).then(e=>e.length>0),15000)
  await owner.findElement(By.id('role-name')).sendKeys('Regulars')
  await owner.findElement(By.css('.governance-panel input[name="pin"]')).click()
  await owner.findElement(By.css('.governance-panel input[name="moderate"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Create role"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Members"]')).click()
  await new Select(owner.findElement(By.id('role-member'))).selectByVisibleText('@uibuddy')
  await owner.findElement(By.css('.governance-panel input[name="roles"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Save member roles"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//div[@class="message-reactions"]/button[text()="Pin"]')).then(e=>e.length>0),45000)
  await buddy.findElement(By.xpath('//div[@class="message-reactions"]/button[text()="Pin"]')).click()
  await owner.wait(async()=>await owner.findElements(By.xpath('//div[@class="message-reactions"]/button[text()="Unpin"]')).then(e=>e.length>0),15000)
  checks.role_creation_assignment_and_delegated_pin_work_in_real_client=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Channel access"]')).click()
  await new Select(owner.findElement(By.id('access-channel'))).selectByVisibleText('#news')
  await new Select(owner.findElement(By.id('access-target'))).selectByVisibleText('@uibuddy')
  await new Select(owner.findElement(By.css('.governance-panel select[name="react"]'))).selectByValue('deny')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Save channel override"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await buddy.wait(async()=>await buddy.findElement(By.css('[aria-label="React with thumbs up"]')).isEnabled().then(v=>!v),45000)
  assert.equal(await buddy.findElement(By.css('[aria-label="Account & devices"]')).isDisplayed(),true)
  assert.ok((await buddy.findElement(By.css('.message-log')).getText()).includes('UI encrypted owner announcement'))
  checks.channel_override_disables_reactions_without_losing_read_access_or_session=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Audit log"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Revision 3')),15000)
  assert.ok(!(await owner.findElement(By.css('.governance-panel')).getText()).includes('UI encrypted owner announcement'))
  checks.governance_audit_view_shows_revisions_without_message_plaintext=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Rules & onboarding"]')).click()
  await owner.findElement(By.id('community-rules')).sendKeys('Be kind. No spam.')
  await owner.findElement(By.css('.governance-panel input[name="screening"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Save rules"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Review community rules"]')).then(e=>e[0]??false),45000).then(b=>b.click())
  assert.equal(await buddy.findElement(By.css('.community-rules')).getText(),'Be kind. No spam.')
  await buddy.findElement(By.xpath('//button[text()="I agree to these rules"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.css('dialog[open]')).then(e=>e.length===0),30000)
  checks.signed_rules_screening_has_explicit_read_and_accept_flow=true
  await owner.findElement(By.id('community-rules')).sendKeys(' No harassment.')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Save rules"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Review community rules"]')).then(e=>e[0]??false),45000).then(b=>b.click())
  assert.equal(await buddy.findElement(By.css('.community-rules')).getText(),'Be kind. No spam. No harassment.')
  await buddy.findElement(By.xpath('//button[text()="I agree to these rules"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.css('dialog[open]')).then(e=>e.length===0),30000)
  checks.changed_rules_require_fresh_acceptance_in_real_client=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Retention"]')).click()
  await new Select(owner.findElement(By.id('retention-channel'))).selectByVisibleText('#news')
  await new Select(owner.findElement(By.id('retention-days'))).selectByValue('1')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Apply retention policy"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')&&t.includes('1 days')),30000)
  checks.retention_controls_explain_expiry_and_save_signed_channel_policy=true
  await owner.findElement(By.css('dialog[open] .panel-heading button')).click()
}

async function verifyModeratorUi(owner,buddy,checks){
  await pace(owner);await pace(buddy)
  await buddy.findElement(By.css('[aria-label="Community settings"]')).click()
  await buddy.findElement(By.xpath('//button[text()="Moderation"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.id('slowmode-channel')).then(e=>e.length>0),15000)
  assert.equal((await buddy.findElements(By.id('role-name'))).length,0)
  assert.equal((await buddy.findElements(By.xpath('//button[text()="Retention"]'))).length,0)
  await new Select(buddy.findElement(By.id('slowmode-channel'))).selectByVisibleText('#news')
  await buddy.findElement(By.id('slowmode-seconds')).clear();await buddy.findElement(By.id('slowmode-seconds')).sendKeys('2')
  await buddy.findElement(By.xpath('//button[text()="Save slow mode"]')).click()
  await buddy.wait(async()=>await buddy.findElement(By.css('.governance-panel')).getText().then(t=>t.includes('Changes saved.')),30000)
  await closePanel(buddy)
  checks.delegated_moderator_ui_saves_slowmode_and_keeps_roles_retention_owner_only=true
}
async function verifyForumUi(owner,buddy,checks){
  await pace(owner);await pace(buddy)
  await owner.findElement(By.css('[aria-label="Manage community"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Channels"]')).click()
  await owner.findElement(By.id('channel-name')).sendKeys('forum')
  await new Select(owner.findElement(By.id('channel-kind'))).selectByValue('forum')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Add channel"]')).click()
  await owner.wait(async()=>await owner.findElements(By.css('[data-channel-name="forum"]')).then(e=>e.length>0),30000)
  await closePanel(owner)
  for(const client of [owner,buddy]){await client.wait(async()=>await client.findElements(By.css('[data-channel-name="forum"]')).then(e=>e.length>0),30000);await client.findElement(By.css('[data-channel-name="forum"]')).click()}
  await owner.wait(async()=>await owner.findElement(By.xpath('//button[text()="New post"]')).isEnabled(),30000)
  assert.equal((await owner.findElements(By.id('message-text'))).length,0)
  await pace(owner);await owner.findElement(By.xpath('//button[text()="New post"]')).click()
  await owner.findElement(By.id('post-title')).sendKeys('Weekend plans')
  await owner.findElement(By.id('post-body')).sendKeys('Which game should we play?')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Publish post"]')).click()
  for(const client of [owner,buddy]){await client.wait(async()=>await client.findElements(By.xpath('//h3/button[text()="Weekend plans"]')).then(e=>e.length>0),30000);await client.findElement(By.xpath('//h3/button[text()="Weekend plans"]')).click()}
  await buddy.findElement(By.id('message-text')).sendKeys('A forum reply from buddy')
  await buddy.findElement(By.css('.send-message')).click()
  await owner.wait(async()=>await owner.findElement(By.css('.message-log')).getText().then(t=>t.includes('A forum reply from buddy')),30000)
  checks.forum_post_creation_dedicated_replies_and_explicit_back_navigation=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Create poll"]')).click()
  await owner.findElement(By.id('poll-question')).sendKeys('What should we play?')
  await owner.findElement(By.id('poll-options')).sendKeys('Co-op adventure',Key.ENTER,'Board game')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Publish poll"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.css('.message-poll')).then(e=>e.length>0),30000)
  const choice=By.xpath('//section[@class="message-poll"]/button[span[text()="Co-op adventure"]]')
  await buddy.findElement(choice).click()
  await owner.wait(async()=>await owner.findElement(choice).getText().then(t=>t.includes('1')),15000)
  assert.equal(await buddy.findElement(choice).getAttribute('aria-pressed'),'true')
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Close poll"]')).click()
  await buddy.wait(async()=>await buddy.findElement(choice).isEnabled().then(v=>!v),15000)
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Reports"]')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Enable inbox & refresh reports"]')).click()
  await owner.wait(async()=>await owner.findElement(By.xpath('//button[text()="Enable inbox & refresh reports"]')).isEnabled(),15000)
  await buddy.findElement(By.xpath('(//button[text()="Report"])[1]')).click()
  await buddy.wait(async()=>await buddy.findElement(By.id('report-recipient')).isEnabled(),15000)
  await buddy.findElement(By.id('report-reason')).sendKeys('Please review this selected forum post')
  await buddy.findElement(By.xpath('//button[text()="Review selected evidence"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.css('.report-evidence')).then(e=>e.length>0),15000)
  const shared=await buddy.findElement(By.css('.report-evidence')).getText();assert.ok(shared.includes('Which game should we play?'));assert.ok(!shared.includes('A forum reply from buddy'))
  await buddy.findElement(By.xpath('//button[text()="Send encrypted report"]')).click()
  await buddy.wait(async()=>await buddy.findElement(By.css('dialog[open]')).getText().then(t=>t.includes('Report sent to the selected moderator.')),15000)
  await buddy.findElement(By.xpath('//button[text()="Done"]')).click()
  checks.report_preview_explicitly_shares_selected_message_without_unselected_context=true
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Enable inbox & refresh reports"]')).click()
  await owner.wait(async()=>await owner.findElements(By.css('.report-evidence')).then(e=>e.length>0),15000)
  assert.ok((await owner.findElement(By.css('.report-evidence')).getText()).includes('Verified sender signature'))
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Mark resolved"]')).click()
  await owner.wait(async()=>await owner.findElement(By.css('dialog[open]')).getText().then(t=>t.includes('Resolved')),15000)
  await closePanel(owner)
  checks.moderator_inbox_decrypts_verifies_and_resolves_report_in_real_client=true
  for(const client of [owner,buddy]){await client.findElement(By.xpath('//button[text()="Back to forum"]')).click();assert.equal((await client.findElements(By.id('message-text'))).length,0)}
  writeFileSync(join(output,'forum-polls.png'),await owner.takeScreenshot(),'base64')
  checks.encrypted_poll_vote_sync_and_author_close_disable_voting_in_real_clients=true
}
async function verifyPrivacyUi(owner,buddy,checks){
  await pace(owner);await pace(buddy)
  await owner.findElement(By.xpath('//button[contains(.,"Privacy & blocked people")]')).click()
  const path=join(output,'downloads','hearth-uiowner-export.json');rmSync(path,{force:true})
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Download account data"]')).click()
  await owner.wait(()=>existsSync(path),30000)
  let data=JSON.parse(readFileSync(path,'utf8'));assert.equal(data.format,'hearth-account-export-v1');assert.equal(data.account_data.account.username,'uiowner');assert.equal(data.decrypted_messages,undefined)
  let raw=JSON.stringify(data);assert.ok(!raw.includes('UI encrypted owner announcement')&&!raw.includes('password_file')&&!raw.includes('token_hash'))
  rmSync(path,{force:true});await owner.findElement(By.xpath('//label[contains(.,"Include decrypted messages")]/input')).click()
  await pace(owner);await owner.findElement(By.xpath('//button[text()="Download account data"]')).click();await owner.wait(()=>existsSync(path),30000)
  data=JSON.parse(readFileSync(path,'utf8'));assert.ok(data.decrypted_messages.some(m=>m.text==='UI encrypted owner announcement'));assert.ok(!JSON.stringify(data).includes('HEARTH_UI_PASSWORD'))
  checks.account_export_download_has_explicit_plaintext_opt_in_and_excludes_credentials=true
  await closePanel(owner)
  await buddy.findElement(By.xpath('//button[contains(.,"Privacy & blocked people")]')).click()
  await buddy.findElement(By.id('block-username')).sendKeys('uiowner');await buddy.findElement(By.xpath('//button[text()="Block person"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Unblock"]')).then(e=>e.length>0),15000)
  await buddy.findElement(By.xpath('//button[text()="Unblock"]')).click();await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Unblock"]')).then(e=>e.length===0),15000)
  checks.private_block_settings_add_and_remove_people_in_real_client=true
  const deleting=buddy.findElement(By.xpath('//button[text()="Permanently delete account"]'))
  assert.equal(await deleting.isEnabled(),false)
  await buddy.findElement(By.id('delete-account-name')).sendKeys('wrong_username')
  await buddy.findElement(By.xpath('//label[contains(.,"I understand this cannot be undone")]/input')).click()
  assert.equal(await deleting.isEnabled(),false)
  await buddy.findElement(By.id('delete-account-name')).clear();await buddy.findElement(By.id('delete-account-name')).sendKeys('uibuddy')
  assert.equal(await deleting.isEnabled(),true)
  const boxes=await buddy.executeScript('return [...document.querySelectorAll("dialog[open] input[type=checkbox]")].map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,labelWidth:el.parentElement.getBoundingClientRect().width}))')
  assert.ok(boxes.length>0&&boxes.every(box=>box.width>=14&&box.width<=20&&box.height>=14&&box.height<=20&&box.labelWidth>box.width+20))
  // Use actual editing keys: WebDriver clear() can change the DOM value without
  // dispatching the input event React uses for a controlled confirmation field.
  await buddy.findElement(By.id('delete-account-name')).sendKeys(Key.chord(Key.CONTROL,'a'),Key.BACK_SPACE)
  await buddy.wait(async()=>!(await deleting.isEnabled()),5000,'Removing the confirmation must disable deletion')
  assert.equal(await buddy.findElement(By.id('delete-account-name')).getAttribute('value'),'')
  checks.account_deletion_requires_exact_username_and_acknowledgement_with_compact_checkboxes=true
  await closePanel(buddy)
}
async function verifyNavigation(client,checks,fixtureOrigin){
  const message=await client.findElement(By.id('message-text'))
  await message.sendKeys('UI draft survives management')
  await client.findElement(By.css('[aria-label="Add server"]')).click()
  assert.equal(await client.findElement(By.css('dialog[open] h2')).getText(),'Add a server')
  await client.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  await client.findElement(By.id('setup-address')).sendKeys('javascript:invalid')
  await client.findElement(By.css('dialog[open] form button[type="submit"]')).click()
  await client.wait(async()=>{const alerts=await client.findElements(By.css('dialog[open] [role="alert"]'));return alerts.length>0},5000)
  checks.add_server_opens_and_rejects_invalid_address_without_signing_out=true
  await client.switchTo().activeElement().sendKeys(Key.ESCAPE)
  assert.equal((await client.findElements(By.css('dialog[open]'))).length,0)
  assert.equal(await client.switchTo().activeElement().getAttribute('aria-label'),'Add server')
  checks.escape_closes_panel_and_restores_keyboard_focus=true
  await client.findElement(By.css('[aria-label="Channel settings"]')).click()
  assert.equal(await client.findElement(By.id('channel-history')).isDisplayed(),true)
  await closePanel(client)
  await client.findElement(By.css('[aria-label="Account & devices"]')).click()
  assert.equal(await client.findElement(By.css('.device-ready')).getText(),'This device is ready.')
  await closePanel(client)
  assert.equal(await message.getAttribute('value'),'UI draft survives management')
  checks.management_panels_preserve_chat_draft_and_device_session=true
  assert.equal((await client.findElements(By.id('community-name'))).length,0)
  assert.equal((await client.findElements(By.id('channel-name'))).length,0)
  assert.equal((await client.findElements(By.id('channel-history'))).length,0)
  assert.equal((await client.findElements(By.id('recovery-passphrase'))).length,0)
  assert.equal((await client.findElements(By.id('account-invite'))).length,0)
  checks.daily_chat_has_no_setup_recovery_or_owner_forms=true
  await client.findElement(By.css('[aria-label="Add server"]')).click()
  for(let i=0;i<8;i++){
    await client.switchTo().activeElement().sendKeys(Key.TAB)
    assert.equal(await client.executeScript('return !!document.activeElement.closest("dialog[open]")'),true)
  }
  await closePanel(client)
  checks.modal_keyboard_focus_stays_inside_management_panel=true
  await message.clear()
  await client.findElement(By.css('[aria-label="Add server"]')).click()
  await client.executeScript("window.__identityFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.__identityFetch(...args);if(String(args[0]).includes('/.well-known/hearth')){const info=await response.json();return new Response(JSON.stringify({...info,server_key:'0'.repeat(64)}),{status:200,headers:{'Content-Type':'application/json'}})}return response}")
  await client.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  await client.findElement(By.id('setup-address')).sendKeys('http://127.0.0.1:5174')
  await client.findElement(By.css('dialog[open] form button[type="submit"]')).click()
  await client.wait(async()=>{const alerts=await client.findElements(By.css('dialog[open] [role="alert"]'));return alerts.length>0 && (await alerts[0].getText()).includes('identity does not match')},15000)
  await client.executeScript('window.fetch=window.__identityFetch;delete window.__identityFetch')
  await closePanel(client)
  checks.reconnecting_changed_server_identity_preserves_current_session=true
  await client.findElement(By.css('[aria-label="Add server"]')).click()
  await client.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  await client.findElement(By.id('setup-address')).sendKeys(fixtureOrigin)
  await client.findElement(By.css('dialog[open] form button[type="submit"]')).click()
  await client.wait(async()=>{const buttons=await client.findElements(By.xpath('//button[text()="Continue to sign in"]'));return buttons[0]??false},15000).then(button=>button.click())
  await client.wait(async()=>{const fields=await client.findElements(By.id('username'));return fields[0]??false},15000)
  assert.equal(await client.executeScript('return localStorage.getItem("hearth.server-url")'),fixtureOrigin)
  assert.equal((await client.findElements(By.css('.server-tile:not(.add-server)'))).length,2)
  await client.findElement(By.id('username')).sendKeys('uiowner')
  await client.findElement(By.id('password')).sendKeys('HEARTH_UI_fixture_password_only')
  await client.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  await client.wait(async()=>{const buttons=await client.findElements(By.css('[data-channel-name="news"]'));return buttons[0]??false},30000).then(button=>button.click())
  await client.wait(async()=>{const logs=await client.findElements(By.css('.message-log'));return logs.length>0 && (await logs[0].getText()).includes('UI encrypted owner announcement')},30000)
  checks.add_server_connects_remembers_and_switches_without_losing_saved_messages=true
}
try {
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
  await driver.findElement(By.xpath('//button[text()="Categories"]')).click()
  await driver.findElement(By.id('category-name')).sendKeys('General')
  await driver.findElement(By.xpath('//button[text()="Add category"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.toLowerCase().includes('general')),15000)
  await driver.findElement(By.xpath('//button[text()="Channels"]')).click()
  await driver.findElement(By.id('channel-name')).sendKeys('chat')
  await driver.findElement(By.css('#channel-category option:nth-child(2)')).click()
  await driver.findElement(By.xpath('//button[text()="Add channel"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('chat')),15000)
  await driver.findElement(By.id('channel-name')).sendKeys('news')
  await driver.findElement(By.css('#channel-kind option[value="announcement"]')).click()
  await driver.findElement(By.xpath('//button[text()="Add channel"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('news')),15000)
  checks.create_category_text_and_announcement_channels=true
  await pace(driver)
  await driver.findElement(By.id('channel-name')).sendKeys('history')
  await driver.findElement(By.css('#channel-kind option[value="text"]')).click()
  await driver.findElement(By.xpath('//button[text()="Add channel"]')).click()
  await driver.wait(async()=>{const buttons=await driver.findElements(By.css('.channel-directory button[data-channel-name="history"]'));return buttons[0] ?? false},15000)
  await closePanel(driver)
  await driver.findElement(By.css('.channel-directory button[data-channel-name="history"]')).click()
  await driver.wait(()=>enabled(driver,'message-text'),30000)
  await driver.findElement(By.css('[aria-label="Channel settings"]')).click()
  await driver.findElement(By.css('#channel-history option[value="since_invite"]')).click()
  await driver.wait(async()=>await driver.findElement(By.id('channel-history')).getAttribute('value').then(value=>value==='since_invite') && await enabled(driver,'message-text'),15000)
  await closePanel(driver)
  await driver.findElement(By.id('message-text')).sendKeys('UI history before invitation')
  await driver.findElement(By.css('.send-message')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI history before invitation')),15000)
  await driver.findElement(By.css('.channel-directory button[data-channel-name="chat"]')).click()
  await driver.wait(()=>enabled(driver,'message-text'),30000)
  await driver.findElement(By.id('message-text')).sendKeys('UI private channel before join')
  await driver.findElement(By.css('.send-message')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI private channel before join')),15000)
  checks.open_channel_and_send_encrypted_solo_message=true
  await driver.findElement(By.css('[aria-label="Manage community"]')).click()
  await driver.findElement(By.xpath('//button[text()="Invites"]')).click()
  if(process.argv.includes('--guided-setup'))await driver.findElement(By.css('input[name="include-account"]')).click()
  if(process.argv.includes('--setup-only'))await driver.executeScript('window.__setupInviteFetch=window.fetch;window.fetch=(...args)=>String(args[0]).endsWith("/auth/admin/invite")?new Promise(resolve=>{window.__releaseSetupInvite=()=>resolve(window.__setupInviteFetch(...args))}):window.__setupInviteFetch(...args)')
  await driver.findElement(By.xpath('//button[text()="Create community invite"]')).click()
  if(process.argv.includes('--setup-only')){
    await driver.wait(()=>driver.executeScript('return !!window.__releaseSetupInvite'),15000)
    assert.equal((await driver.findElements(By.css('.share-invite'))).length,0)
    await driver.executeScript('window.__releaseSetupInvite();window.fetch=window.__setupInviteFetch;delete window.__releaseSetupInvite;delete window.__setupInviteFetch')
    checks.combined_invite_stays_hidden_until_account_capability_is_ready=true
  }
  const invite=await driver.wait(async()=>{const fields=await driver.findElements(By.css('.share-invite .invite-code'));return fields[0]??false},15000)
  assert.match(await invite.getAttribute('value'),/^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
  const communityCode=await invite.getAttribute('value')
  let combinedInvite=''
  if(process.argv.includes('--guided-setup')){
    combinedInvite=await driver.findElement(By.css('.share-invite input:not(.invite-code)')).getAttribute('value')
    assert.ok((await resolveSetupTarget(combinedInvite)).invite.account)
    checks.owner_creates_one_invite_for_account_and_signed_community_admission=true
  }
  await driver.findElement(By.xpath('//button[text()="Hide code"]')).click()
  assert.equal((await driver.findElements(By.css('.share-invite'))).length,0)
  checks.create_and_hide_invite_without_persisting_it=true
  await pace(driver)
  await closePanel(driver)
  await driver.findElement(By.css('.channel-directory button[data-channel-name="history"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'history') && await enabled(driver,'message-text'),30000)
  await driver.findElement(By.id('message-text')).sendKeys('UI history after invitation')
  await driver.findElement(By.css('.send-message')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI history after invitation')),15000)
  await driver.findElement(By.css('.channel-directory button[data-channel-name="chat"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'chat') && await enabled(driver,'message-text'),30000)
  await pace(driver)
  await driver.findElement(By.xpath('//button[normalize-space(.)="Server settings"]')).click()
  await driver.findElement(By.xpath('//button[text()="Create account invite"]')).click()
  await driver.wait(async()=>await driver.findElements(By.css('.share-invite input:not(.invite-code)')).then(fields=>fields[0]??false),15000)
  const accountLink=await driver.findElement(By.css('.share-invite input:not(.invite-code)')).getAttribute('value')
  const accountCode=(await resolveSetupTarget(accountLink)).invite.account
  await closePanel(driver)
  buddy=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--window-size=1440,1100').setUserPreferences({'download.default_directory':join(output,'downloads'),'download.prompt_for_download':false})).build()
  await buddy.get('http://127.0.0.1:5174')
  await trackRequests(buddy)
  await buddy.findElement(By.xpath('//button[contains(.,"Join a server")]')).click()
  const joinAddress=await buddy.findElement(By.id('setup-address'))
  if(process.argv.includes('--guided-setup')){
    const mismatched=createHearthInvite({...((await resolveSetupTarget(combinedInvite)).invite),serverKey:'0'.repeat(64)})
    await joinAddress.sendKeys(mismatched)
    await buddy.findElement(By.css('.guided-setup form button[type="submit"]')).click()
    await buddy.wait(async()=>await buddy.findElements(By.css('.setup-error')).then(items=>items.length===1),15000)
    assert.equal(await buddy.executeScript('return localStorage.getItem("hearth.server-url")'),null)
    assert.equal((await buddy.findElements(By.id('username'))).length,0)
    checks.mismatched_invite_identity_cannot_reach_account_creation_or_save_address=true
    await joinAddress.clear();await joinAddress.sendKeys(process.argv.includes('--account-code')?'http://127.0.0.1:5174':combinedInvite)
  } else await joinAddress.sendKeys('http://127.0.0.1:5174')
  await buddy.findElement(By.css('.guided-setup form button[type="submit"]')).click()
  await buddy.wait(async()=>await buddy.findElements(By.css('.setup-result .primary-button')).then(items=>items[0]??false),15000).then(button=>button.click())
  if(!process.argv.includes('--guided-setup')||process.argv.includes('--account-code')){
    await buddy.wait(async()=>{const buttons=await buddy.findElements(By.xpath('//button[text()="Create an account"]'));return buttons[0] ?? false},30000).then(button=>button.click())
    await buddy.findElement(By.id('invite-code')).sendKeys(process.argv.includes('--account-code')?communityCode:accountCode)
    if(process.argv.includes('--account-code'))checks.account_form_accepts_readable_combined_code_for_current_server=true
  } else {
    await buddy.wait(async()=>await buddy.findElement(By.id('auth-heading')).getText().then(text=>text==='Create your account'),15000)
    assert.equal((await buddy.findElements(By.id('invite-code'))).length,0)
  }
  await buddy.findElement(By.id('username')).sendKeys('uibuddy')
  await buddy.findElement(By.id('password')).sendKeys('HEARTH_UI_buddy_fixture_password_only')
  await buddy.findElement(By.id('confirm-password')).sendKeys('HEARTH_UI_buddy_fixture_password_only')
  await buddy.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  if(process.argv.includes('--guided-setup')){
    await buddy.wait(async()=>{const buttons=await buddy.findElements(By.xpath('//button[text()="Join invited community"]'));return buttons.length>0&&await buttons[0].isEnabled()?buttons[0]:false},30000)
    if(process.argv.includes('--setup-only')){
      await buddy.sendDevToolsCommand('Emulation.setDeviceMetricsOverride',{width:430,height:1000,deviceScaleFactor:1,mobile:false})
      assert.equal(await buddy.executeScript('return window.innerWidth'),430)
      await buddy.findElement(By.xpath('//button[text()="Close navigation"]')).click()
      assert.equal(await buddy.findElement(By.id('chat-navigation')).isDisplayed(),false)
      await buddy.findElement(By.xpath('//button[text()="View community invite"]')).click()
      assert.equal(await buddy.findElement(By.id('chat-navigation')).isDisplayed(),true)
      assert.equal(await buddy.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'),true)
      checks.pending_invite_can_reopen_navigation_at_430px_without_overflow=true
      await buddy.sendDevToolsCommand('Emulation.clearDeviceMetricsOverride')
    }
    await buddy.findElement(By.xpath('//button[text()="Join invited community"]')).click()
    await buddy.wait(async()=>await buddy.findElements(By.xpath('//button[text()="Join invited community"]')).then(items=>items.length===0),30000)
    const resolved=(await resolveSetupTarget(combinedInvite)).invite
    const secrets=[communityCode,resolved.account,resolved.community,new URLSearchParams(new URL(combinedInvite).hash.slice(1)).get('code')]
    const persisted=await buddy.executeScript('return JSON.stringify({...localStorage,...sessionStorage})')
    assert.ok(secrets.every(secret=>!persisted.includes(secret)))
    checks.combined_invite_creates_account_and_joins_community_without_persisting_capabilities=true
  }else{
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.css('[aria-label="Create or join a community"]'));return buttons[0]??false},30000).then(button=>button.click())
  await buddy.wait(async()=>{const fields=await buddy.findElements(By.id('community-code'));return fields[0] ?? false},30000).then(field=>field.sendKeys(communityCode))
  await buddy.wait(async()=>await buddy.findElement(By.xpath('//button[text()="Join community"]')).isEnabled(),15000)
  await buddy.findElement(By.xpath('//button[text()="Join community"]')).click()
  }
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.css('.channel-directory button[data-channel-name="chat"]'));return buttons[0] ?? false},15000).then(button=>button.click())
  await driver.wait(async()=>{const buttons=await driver.findElements(By.css('.access-action'));return buttons[0]??false},45000).then(button=>button.click())
  const approval=await driver.wait(async()=>{const buttons=await driver.findElements(By.xpath('//button[normalize-space(.)="Approve uibuddy"]'));return buttons[0] ?? false},45000,'Owner should see the pending member at the next directory refresh')
  assert.equal(await buddy.findElement(By.id('message-text')).isEnabled(),false)
  await pace(driver)
  await approval.click()
  await closePanel(driver)
  await buddy.wait(()=>enabled(buddy,'message-text'),45000)
  assert.ok(!(await buddy.findElement(By.css('.message-log')).getText()).includes('UI private channel before join'))
  await buddy.findElement(By.id('message-text')).sendKeys('UI private channel from buddy')
  await buddy.findElement(By.css('.send-message')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI private channel from buddy')),30000)
  checks.real_second_client_join_automatic_roster_rekey_and_no_old_history=true
  if(!process.argv.includes('--setup-only')){
  await pace(driver);await pace(buddy)
  await buddy.findElement(By.css('.chat-message:last-of-type button[aria-label="React with thumbs up"]')).click()
  await driver.wait(async()=>{const reactions=await driver.findElements(By.css('.chat-message:last-of-type .message-reactions button[aria-pressed]'));return reactions.length>0 && (await reactions[0].getText()).includes('1')},15000)
  await driver.findElement(By.xpath('//article[last()]//button[text()="Pin"]')).click()
  await buddy.wait(async()=>{const messages=await buddy.findElements(By.css('.chat-message'));return messages.length>0 && (await messages.at(-1).getText()).includes('Pinned')},15000)
  assert.equal((await buddy.findElements(By.xpath('//button[text()="Pin"]'))).length,0)
  checks.reactions_sync_and_only_owner_has_channel_pin_controls=true
  await buddy.wait(()=>enabled(buddy,'message-text'),15000)
  await buddy.findElement(By.id('message-text')).sendKeys('**UI bold** @uiowner [unsafe](javascript:alert(1)) ![tracker](https://example.invalid/pixel) <script>fixture</script>')
  await buddy.findElement(By.css('.send-message')).click()
  await driver.wait(async()=>{const strong=await driver.findElements(By.css('.message-body strong'));return strong.length>0 && (await strong.at(-1).getText())==='UI bold'},15000)
  assert.equal((await driver.findElements(By.css('.message-body img,.message-body script,.message-body a[href^="javascript:"]'))).length,0)
  assert.equal(await driver.findElement(By.css('.message-body mark')).getText(),'@uiowner')
  checks.markdown_and_mentions_render_without_raw_html_or_remote_images=true
  await pace(driver);await pace(buddy)
  await driver.findElement(By.xpath('//article[last()]//button[starts-with(normalize-space(.),"Open thread")]')).click()
  await driver.findElement(By.id('message-text')).sendKeys('UI isolated thread reply')
  await driver.findElement(By.css('.send-message')).click()
  await buddy.wait(async()=>await buddy.findElement(By.css('.message-log')).getText().then(text=>!text.includes('UI isolated thread reply')),10000)
  await buddy.findElement(By.xpath('//article[last()]//button[starts-with(normalize-space(.),"Open thread")]')).click()
  await buddy.wait(async()=>await buddy.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI isolated thread reply')),15000)
  await buddy.findElement(By.xpath('//button[text()="Mark viewed messages read"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('Read by uibuddy')),15000)
  checks.thread_filter_and_explicit_encrypted_read_receipt_sync=true
  await driver.findElement(By.xpath('//button[text()="Back to channel"]')).click()
  await buddy.findElement(By.xpath('//button[text()="Back to channel"]')).click()
  await driver.executeScript("window.__searchFetch=window.fetch;window.fetch=(url,...args)=>String(url).toLowerCase().includes('bold')?Promise.reject(new Error('Search must stay local')):window.__searchFetch(url,...args)")
  await driver.findElement(By.xpath('//button[normalize-space(.)="Search messages"]')).click()
  await driver.findElement(By.id('message-search')).sendKeys('BOLD')
  await driver.findElement(By.css('.local-search button[type="submit"],.local-search button:not([type])')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.local-search')).getText().then(text=>text.includes('1 local matches')),15000)
  await driver.findElement(By.xpath('//button[text()="Close results"]')).click()
  await closePanel(driver)
  await driver.executeScript('window.fetch=window.__searchFetch;delete window.__searchFetch')
  checks.local_search_finds_decrypted_text_without_server_query=true
  await pace(driver);await pace(buddy)
  await verifyTextUI({driver,buddy,By,enabled,output,checks,storage:process.argv.includes('--storage')})
  await pace(driver);await pace(buddy)
  await buddy.findElement(By.css('.channel-directory button[data-channel-name="history"]')).click()
  await buddy.wait(async()=>await activeChannel(buddy,'history') && await enabled(buddy,'message-text'),30000)
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.xpath('//button[text()="Request available history"]'));return buttons[0] ?? false},30000).then(button=>button.click())
  await buddy.wait(async()=>await buddy.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI history after invitation')),60000)
  assert.ok(!(await buddy.findElement(By.css('.message-log')).getText()).includes('UI history before invitation'))
  checks.signed_since_invite_history_backfills_after_owner_key_handoff=true
  await driver.findElement(By.css('.channel-directory button[data-channel-name="news"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'news') && await enabled(driver,'message-text'),30000)
  await buddy.findElement(By.css('.channel-directory button[data-channel-name="news"]')).click()
  await buddy.wait(async()=>{return await activeChannel(buddy,'news') && await buddy.findElement(By.css('[data-channel-name="news"]')).getAttribute('aria-current')==='page'},45000,'Buddy did not join announcement encryption: ')
  await driver.findElement(By.id('message-text')).sendKeys('UI encrypted owner announcement')
  await driver.findElement(By.css('.send-message')).click()
  await buddy.wait(async()=>{const logs=await buddy.findElements(By.css('.message-log'));return logs.length>0 && (await logs[0].getText()).includes('UI encrypted owner announcement')},30000,'Buddy did not receive the new announcement: ')
  assert.equal(await buddy.findElement(By.id('message-text')).isEnabled(),false)
  assert.equal(await buddy.findElement(By.css('.send-message')).isEnabled(),false)
  checks.announcement_member_reads_ciphertext_with_publish_controls_disabled=true
  if(!process.argv.includes('--phase3')){await buddy.quit();buddy=undefined}
  // Hide the account capability before capturing screenshots.
  // Management panels are already closed; no invite code is in the daily DOM.
  await driver.executeScript("window.__fixtureFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('/api/v1/communities')?Promise.reject(new Error('fixture outage')):window.__fixtureFetch(url,...args)")
  // Trigger the same refresh control shown on errors by first reselecting after reload.
  await driver.findElement(By.css('[aria-label="Account & devices"]')).click()
  await driver.findElement(By.xpath('//button[text()="Sign out"]')).click()
  await (await wait('username')).sendKeys('uiowner')
  await driver.findElement(By.id('password')).sendKeys('HEARTH_UI_fixture_password_only')
  await driver.findElement(By.css('.auth-panel form button[type="submit"]')).click()
  await wait('chat-navigation')
  await driver.wait(async()=>await driver.findElement(By.css('.community-panel')).getText().then(text=>text.includes('Communities could not be loaded.')),30000)
  const failureText=await driver.findElement(By.css('.community-panel')).getText()
  assert.ok(!failureText.includes('No communities yet.'))
  await driver.wait(async()=>await driver.findElements(By.xpath('//button[text()="Retry messaging"]')).then(e=>e.length>0),30000)
  await driver.executeScript('window.fetch=window.__fixtureFetch;delete window.__fixtureFetch')
  await driver.findElement(By.xpath('//button[text()="Refresh communities"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-panel nav')).getText().then(text=>text.includes('UI <Friends>')),15000)
  await driver.findElement(By.xpath('//nav[@aria-label="Your communities"]/button[text()="UI <Friends>"]')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.community-structure')).getText().then(text=>text.includes('news')),15000)
  checks.unavailable_directory_has_retry_and_restores_saved_structure=true
  await driver.findElement(By.xpath('//button[text()="Retry messaging"]')).click()
  await driver.findElement(By.css('.channel-directory button[data-channel-name="news"]')).click()
  await driver.wait(async()=>await activeChannel(driver,'news') && await enabled(driver,'message-text'),30000)
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI encrypted owner announcement')),15000)
  checks.messaging_startup_retry_preserves_encrypted_history_after_directory_outage=true
  await driver.findElement(By.css('.community-panel')).getRect().then(async rect=>{
    assert.ok(rect.width>=220 && rect.width<=300)
    await driver.executeScript('arguments[0].scrollIntoView({block:"start"})',await driver.findElement(By.css('.community-panel')))
  })
  writeFileSync(join(output,'community-ui-desktop.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  if(process.argv.includes('--phase3')){await verifyNavigation(driver,checks,match[1]);await verifyGovernanceUi(driver,buddy,checks);await verifyModeratorUi(driver,buddy,checks);await verifyOwnershipUi(driver,buddy,checks);await verifyForumUi(driver,buddy,checks);await verifyPrivacyUi(driver,buddy,checks)}
  await driver.manage().window().setRect({width:430,height:1000})
  await driver.findElement(By.xpath('//button[text()="Conversations"]')).click()
  await driver.findElement(By.xpath('//button[text()="Close navigation"]')).click()
  await driver.wait(async()=>await driver.findElements(By.id('server-members')).then(items=>items.length===0),5000)
  await driver.findElement(By.css('[aria-label="Server Members"]')).click()
  await driver.wait(async()=>await driver.findElement(By.id('server-members')).isDisplayed(),5000)
  assert.equal(await driver.executeScript('return document.activeElement.getAttribute("aria-label")'),'Close member list')
  await driver.findElement(By.css('#server-members [aria-label="Close member list"]')).sendKeys(Key.ESCAPE)
  await driver.wait(async()=>await driver.findElements(By.id('server-members')).then(items=>items.length===0),5000)
  assert.equal(await driver.executeScript('return document.activeElement.getAttribute("aria-label")'),'Server Members')
  checks.member_drawer_opens_and_closes_with_keyboard_on_narrow_windows=true
  await driver.findElement(By.xpath('//button[text()="Conversations"]')).click()
  assert.equal(await driver.findElement(By.id('chat-navigation')).isDisplayed(),true)
  await driver.findElement(By.xpath('//button[text()="Close navigation"]')).click()
  assert.equal(await driver.findElement(By.id('chat-navigation')).isDisplayed(),false)
  writeFileSync(join(output,'community-ui-narrow.png'),Buffer.from(await driver.takeScreenshot(),'base64'))
  assert.equal(await driver.executeScript('return document.documentElement.scrollWidth<=window.innerWidth'),true)
  checks.narrow_layout_has_no_horizontal_overflow=true
  }
  assert.equal(Object.keys(checks).length,(process.argv.includes('--setup-only')?12:(process.argv.includes('--storage')?21:16)+2+(process.argv.includes('--phase3')?23:0)+(process.argv.includes('--guided-setup')?5:0))+(process.argv.includes('--account-code')?1:0))
  succeeded=true
  console.log(JSON.stringify(checks))
}catch(error) {
  const diagnostics={checks,error:String(error),owner:[],buddy:[],cryptoFailures:{}}
  for(const [client,key] of [[driver,'owner'],[buddy,'buddy']]) {
    if(client)try {diagnostics[key]=await client.findElements(By.css('[role="alert"],[role="status"],.conversation-header,.admission-requests,.device-status,.people-panel')).then(elements=>Promise.all(elements.map(element=>element.getText())))}catch{/* Browser may already have closed. */}
  }
  for(const [client,key] of [[driver,'owner'],[buddy,'buddy']])if(client)try{diagnostics.cryptoFailures[key]=(await client.manage().logs().get('browser')).map(e=>e.message).filter(m=>m.includes('Encrypted operation failed:')||m.includes('Encrypted commit stage failed:'))}catch{}
  writeFileSync(join(output,'community-ui-failure.json'),JSON.stringify(diagnostics,null,2)+'\n')
  throw error
}finally {
  try {await buddy?.quit();await driver?.quit()}finally {
    await exit(vite)
    if(fixture && fixture.exitCode===null) {
      const closed=new Promise(resolve=>fixture.once('close',resolve))
      fixture.stdin.write('stop\n')
      await Promise.race([closed,pause(10000).then(()=>exit(fixture))])
    }
    writeFileSync(join(output,'community-ui.json'),JSON.stringify({runtime:`${process.platform} headless Chrome, two isolated profiles, real client controls`,outcome:succeeded?'pass':'fail',checks,measured_at:new Date().toISOString()},null,2)+'\n')
    const remaining=fixtureOutput.match(/setup code file: (.+?)\. Type stop/)
    if(remaining)assert.equal(existsSync(remaining[1]),false,'Disposable fixture was not cleaned')
  }
}
