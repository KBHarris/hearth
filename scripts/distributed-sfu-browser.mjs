// Second disposable browser for the capacity fixture. Keeps shared hardware
// output limits from coupling all simulated clients to one browser process.
import {Builder} from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
export async function distributedSfuBrowser(origin){
  const browser=await new Builder().forBrowser('chrome').setChromeOptions(new chrome.Options().addArguments('--headless=new','--mute-audio','--autoplay-policy=no-user-gesture-required','--window-size=900,700','--allow-loopback-in-peer-connection','--ignore-certificate-errors','--site-per-process','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows')).build()
  try{
    await browser.get(origin+'/media-test.html')
    await browser.executeScript(()=>{
      const frames=new Map(),replies=[]
      window.__hearthSfuRemote={frames,replies}
      addEventListener('message',event=>{
        const entry=[...frames.values()].find(entry=>entry.frame.contentWindow===event.source&&entry.origin===event.origin)
        if(!entry||event.data?.type!=='hearth-sfu-fixture-reply'||event.data.nonce!==entry.nonce)return
        replies.push({...event.data,index:entry.index})
      })
    })
    return {pid:(await browser.getCapabilities()).get('goog:processID'),quit:()=>browser.quit(),async pump(primary){
      const jobs=await primary.executeScript(()=>window.__hearthSfuBrowserBridge?.jobs.splice(0)??[])
      const replies=await browser.executeScript(jobs=>{
        const {frames,replies}=window.__hearthSfuRemote
        for(const job of jobs){
          if(!Number.isInteger(job.index)||job.index<13||job.index>25||!/^[a-f0-9]{64}$/.test(job.nonce)||!Number.isInteger(job.request))throw new Error('Invalid disposable fixture job')
          const origin='https://media'+job.index+'.localhost:5177'
          if(job.name==='__open'){
            if(frames.has(job.index))throw new Error('Duplicate fixture frame')
            const frame=document.createElement('iframe'),entry={frame,index:job.index,nonce:job.nonce,origin};frames.set(job.index,entry)
            frame.src=origin+'/sfu-endpoint.html';frame.allow='autoplay';frame.style.cssText='width:190px;height:140px'
            frame.onload=()=>replies.push({index:job.index,nonce:job.nonce,request:job.request,value:true})
            document.body.append(frame)
          }else{
            const entry=frames.get(job.index)
            if(!entry||entry.nonce!==job.nonce)throw new Error('Unknown fixture endpoint')
            entry.frame.contentWindow.postMessage({type:'hearth-sfu-fixture',nonce:job.nonce,request:job.request,name:job.name,data:job.data},origin)
          }
        }
        return replies.splice(0)
      },jobs)
      if(replies.length)await primary.executeScript(replies=>window.__hearthSfuBrowserBridge.receive(replies),replies)
    }}
  }catch(error){await browser.quit().catch(()=>{});throw error}
}
