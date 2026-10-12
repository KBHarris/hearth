import assert from 'node:assert/strict'
import {join} from 'node:path'
import {writeFileSync,readFileSync,existsSync,rmSync,mkdirSync} from 'node:fs'
export async function verifyTextUI({driver,buddy,By,enabled,output,checks,storage}){
  await buddy.findElement(By.xpath('//button[normalize-space(.)="Profile & presence"]')).click()
  await buddy.findElement(By.id('profile-name')).sendKeys('UI Encrypted Buddy')
  await buddy.findElement(By.id('profile-bio')).sendKeys('UI private profile bio')
  await buddy.findElement(By.css('.local-profile form button')).click()
  await buddy.wait(()=>enabled(buddy,'message-text'),15000)
  await buddy.findElement(By.css('#presence-state option[value="idle"]')).click()
  await buddy.findElement(By.css('dialog[open] .panel-heading button')).click()
  await driver.wait(async()=>await driver.findElement(By.css('.message-log')).getText().then(text=>text.includes('UI Encrypted Buddy (@uibuddy)')&&text.includes('idle')),15000)
  await driver.findElement(By.css('[aria-label="Conversation members"]')).click()
  assert.ok((await driver.findElement(By.css('.people-panel')).getText()).includes('UI private profile bio'))
  checks.profiles_and_presence_share_over_encrypted_conversations=true
  await driver.findElement(By.css('dialog[open] .panel-heading button')).click()
  await driver.executeScript("window.__previewRequests=[];window.__previewFetch=window.fetch;window.fetch=(url,...args)=>{if(String(url).includes('example.invalid'))window.__previewRequests.push(String(url));return window.__previewFetch(url,...args)}")
  await buddy.wait(()=>enabled(buddy,'message-text'),15000)
  await buddy.findElement(By.css('.preview-composer summary')).click()
  await buddy.findElement(By.id('preview-url')).sendKeys('https://example.invalid/private-link')
  await buddy.findElement(By.id('preview-title')).clear();await buddy.findElement(By.id('preview-title')).sendKeys('UI chosen preview title')
  await buddy.findElement(By.id('preview-description')).sendKeys('UI private link summary')
  await buddy.findElement(By.id('message-text')).sendKeys('UI encrypted preview message')
  await buddy.findElement(By.css('.message-composer button')).click()
  await driver.wait(async()=>{const previews=await driver.findElements(By.css('.link-preview'));return previews.length&&await previews.at(-1).getText().then(text=>text.includes('UI chosen preview title')&&text.includes('UI private link summary'))},15000)
  assert.deepEqual(await driver.executeScript('return window.__previewRequests'),[])
  await driver.executeScript('window.fetch=window.__previewFetch;delete window.__previewFetch;delete window.__previewRequests')
  checks.sender_generated_link_preview_renders_without_metadata_fetch=true
  if(!storage)return
  const canary='HEARTH_UI_ATTACHMENT_CANARY_private_file',path=join(output,'attachment-ui.txt'),image=join(output,'emoji-ui.png')
  rmSync(join(output,'downloads','attachment-ui.txt'),{force:true});writeFileSync(path,canary);writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNwmPD/PwgzwBgAX7ILOaSjuloAAAAASUVORK5CYII=','base64'))
  await driver.wait(()=>enabled(driver,'message-text'),15000)
  await driver.findElement(By.css('.file-composer summary')).click()
  await driver.findElement(By.id('message-file')).sendKeys(path)
  await driver.findElement(By.css('.message-composer button')).click()
  await buddy.wait(async()=>{const buttons=await buddy.findElements(By.css('.encrypted-attachment button'));for(const button of buttons)if((await button.getText()).includes('attachment-ui.txt'))return true;return false},30000)
  await buddy.findElement(By.xpath('//button[contains(text(),"Download attachment-ui.txt")]')).click()
  const downloaded=join(output,'downloads','attachment-ui.txt')
  await buddy.wait(()=>existsSync(downloaded),15000);assert.equal(readFileSync(downloaded,'utf8'),canary)
  checks.real_file_picker_encrypted_upload_and_buddy_download_pass=true
  await driver.findElement(By.css('[aria-label="Channel settings"]')).click()
  await driver.findElement(By.id('emoji-alias')).sendKeys('party')
  await driver.findElement(By.id('emoji-file')).sendKeys(image)
  await driver.findElement(By.css('.emoji-settings button')).click()
  await buddy.wait(async()=>{const images=await buddy.findElements(By.css('.emoji-picker img.custom-emoji'));return images.length>0&&await images[0].getAttribute('src').then(src=>src.startsWith('blob:'))},30000)
  await driver.findElement(By.css('dialog[open] .panel-heading button')).click()
  await driver.wait(()=>enabled(driver,'message-text'),15000)
  await driver.findElement(By.id('message-text')).sendKeys('UI :party: custom emoji')
  await driver.findElement(By.css('.message-composer button')).click()
  await buddy.wait(async()=>{const images=await buddy.findElements(By.css('.message-body img.custom-emoji'));return images.length>0&&await images.at(-1).getAttribute('src').then(src=>src.startsWith('blob:'))},15000)
  checks.custom_emoji_local_thumbnail_encrypts_and_renders_in_markdown=true
  mkdirSync(join(output,'downloads'),{recursive:true})
}
