// Runs no provider or account sessions; proves the consent boundary in Chromium.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {Builder} from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
const root=resolve('.'),csp=JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json','utf8')).app.security.csp
const bridge=readFileSync('apps/client/public/playback-bridge.js','utf8'),canary='HEARTH_PLAYER_PRIVATE_STORAGE_CANARY'
const server=createServer((request,response)=>{
  response.setHeader('Content-Security-Policy',csp)
  if(request.url==='/escape.html'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><script src="/escape.js"></script>');return}
  if(request.url==='/escape.js'){response.setHeader('Content-Type','text/javascript');response.end('parent.__escaped=true;parent.__stolen=localStorage.getItem("private")');return}
  if(request.url==='/playback-bridge.js'){response.setHeader('Content-Type','text/javascript');response.end(bridge);return}
  if(request.url==='/probe.js'){response.setHeader('Content-Type','text/javascript');response.end(`let blocked=0;try{parent.localStorage.getItem('private')}catch{blocked++}try{parent.document.body}catch{blocked++}try{localStorage.getItem('private')}catch{blocked++}parent.postMessage({type:'isolation-probe',blocked,origin:location.origin},'*');addEventListener('message',event=>{if(event.source===parent&&event.data?.type==='escape-probe')location.href=event.data.url})`);return}
  if(request.url==='/test.js'){response.setHeader('Content-Type','text/javascript');response.end(`localStorage.setItem('private','${canary}');window.__probe=null;addEventListener('message',event=>{if(event.source===document.querySelector('iframe').contentWindow&&event.data?.type==='isolation-probe')window.__probe={...event.data,senderOrigin:event.origin}});const frame=document.createElement('iframe');frame.sandbox='allow-scripts allow-same-origin';frame.src='data:text/html,'+encodeURIComponent('<script src="'+location.origin+'/probe.js"><\/script><script src="'+location.origin+'/playback-bridge.js"><\/script>');document.body.append(frame)`);return}
  response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Isolated provider consent check</title><script src="/test.js" defer></script>')
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let driver
try{
  const origin='http://127.0.0.1:'+server.address().port
  driver=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new').setLoggingPrefs({performance:'ALL',browser:'ALL'})).build()
  await driver.get(origin)
  await driver.wait(async()=>await driver.executeScript(()=>!!window.__probe),10000)
  const result=await driver.executeScript(()=>({probe:window.__probe,canary:localStorage.getItem('private'),parentCannotRead:(()=>{try{return document.querySelector('iframe').contentDocument===null}catch{return true}})()}))
  assert.equal(result.probe.blocked,3);assert.equal(result.probe.senderOrigin,'null');assert.ok(result.parentCannotRead);assert.equal(result.canary,canary)
  const network=(await driver.manage().logs().get('performance')).map(entry=>JSON.parse(entry.message).message).filter(message=>message.method==='Network.requestWillBeSent').map(message=>message.params.request.url)
  assert.ok(network.some(url=>url===origin+'/playback-bridge.js'),'Production bridge must have actually loaded')
  assert.ok(network.every(url=>url.startsWith(origin+'/')||url.startsWith('data:')),'A provider was contacted before consent')
  await driver.executeScript(origin=>document.querySelector('iframe').contentWindow.postMessage({type:'escape-probe',url:origin+'/escape.html'},'*'),origin)
  await new Promise(resolve=>setTimeout(resolve,300))
  assert.equal(await driver.executeScript(()=>window.__escaped===true),false,'Isolated code must not navigate to Hearth and regain its origin')
  const escapeRequests=(await driver.manage().logs().get('performance')).map(entry=>JSON.parse(entry.message).message).filter(message=>message.method==='Network.responseReceived').map(message=>message.params.response.url)
  assert.ok(!escapeRequests.some(url=>url===origin+'/escape.html'||url===origin+'/escape.js'),'The protected application-origin escape page must never load')
  if(process.argv.includes('--probe-live')){
    const provider=process.argv.find(arg=>arg.startsWith('--provider='))?.slice(11)??'youtube',examples={youtube:'https://www.youtube.com/watch?v=M7lc1UVf-VE',soundcloud:'https://soundcloud.com/forss/flickermood'};assert.ok(Object.hasOwn(examples,provider),'Choose an enabled provider; Spotify is disabled this release')
    const live=await driver.executeAsyncScript((origin,provider,url,done)=>{
      const frame=document.querySelector('iframe'),nonce='ab'.repeat(32),results=[]
      const listener=event=>{if(event.source===frame.contentWindow&&event.data?.type==='hearth-player-status'&&event.data.nonce===nonce){results.push({ready:event.data.ready===true,failed:event.data.failed===true,code:event.data.code});if(event.data.ready||event.data.failed)finish()}}
      let timer;const finish=()=>{clearTimeout(timer);window.removeEventListener('message',listener);done(results)};window.addEventListener('message',listener);timer=setTimeout(finish,20000)
      frame.onload=()=>frame.contentWindow.postMessage({type:'hearth-player-init',nonce,provider,url,origin},'*')
      frame.src='data:text/html,'+encodeURIComponent('<div id="player"></div><script src="'+origin+'/playback-bridge.js"><\/script>')
    },origin,provider,examples[provider])
    const diagnostics=(await driver.manage().logs().get('browser')).map(entry=>entry.message.replace(/HEARTH_[A-Z_]+/g,'[fixture]').slice(0,1200)),requests=(await driver.manage().logs().get('performance')).map(entry=>JSON.parse(entry.message).message).filter(message=>['Network.loadingFailed','Network.responseReceived'].includes(message.method)).map(message=>message.method==='Network.loadingFailed'?{event:'failed',error:message.params.errorText}:{event:'response',status:message.params.response.status,url:message.params.response.url.slice(0,300)})
    mkdirSync('target/provider-isolation-evidence',{recursive:true});writeFileSync('target/provider-isolation-evidence/live-'+provider+'.json',JSON.stringify({measuredAt:new Date().toISOString(),scope:'Public official provider API example in an isolated disposable browser, after explicit fixture consent; no account',provider,results:live,diagnostics,requests},null,2)+'\n')
    console.log('Provider probe statuses: '+JSON.stringify(live))
    assert.ok(live.some(status=>status.ready)&&!live.some(status=>status.failed),'The official public provider example must initialize after fixture consent')
  }
  mkdirSync('target/provider-isolation-evidence',{recursive:true});writeFileSync('target/provider-isolation-evidence/result.json',JSON.stringify({outcome:'pass',measuredAt:new Date().toISOString(),checks:{opaque_origin:true,parent_storage_and_document_inaccessible:true,frame_storage_inaccessible:true,parent_cannot_read_frame:true,production_bridge_loaded:true,no_provider_requests_before_consent:true,application_origin_navigation_escape_blocked:true},liveProviderPlaybackValidated:false,nativeIpcValidated:false},null,2)+'\n')
  console.log('Provider isolation and no-contact-before-consent checks pass.')
}finally{await driver?.quit();await new Promise(resolve=>server.close(resolve))}
