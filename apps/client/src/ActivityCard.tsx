import {useEffect,useRef,useState} from 'react'
import type {Activity,LocalMessage,SharedPlayback} from '@hearth/sdk'
import {playbackEnabled,playbackTarget,providerName} from './activities'
import {isTauri} from '@tauri-apps/api/core'
import {getIdentifier} from '@tauri-apps/api/app'

export function ActivityCard({message,account,send,disabled,canRespond}:{message:LocalMessage;account:string;send:(activity:Activity)=>Promise<void>;disabled:boolean;canRespond:boolean}){
  const [error,setError]=useState('')
  async function action(activity:Activity){setError('');try{await send(activity)}catch(error){setError(error instanceof Error?error.message:'The activity could not be updated.')}}
  const event=message.event
  return <>{event&&<section className="activity-card" aria-label="Scheduled event"><p>{new Date(event.event.starts_at).toLocaleString()} – {new Date(event.event.ends_at).toLocaleString()}</p><p>{event.event.description}</p>{event.event.location&&<p>Meet: {event.event.location}</p>}{event.cancelled?<p role="status">This event was cancelled.</p>:<><div className="call-controls">{(['going','interested','declined'] as const).map(response=><button key={response} disabled={disabled||!canRespond} aria-pressed={event.rsvps[account]===response} onClick={()=>void action({type:'rsvp',id:message.id,response})}>{({going:'Going',interested:'Interested',declined:'Cannot attend'})[response]} · {Object.values(event.rsvps).filter(value=>value===response).length}</button>)}</div>{message.author_id===account&&<button disabled={disabled} onClick={()=>void action({type:'event_cancel',id:message.id})}>Cancel event</button>}</>}</section>}
    {message.playback&&<SharedPlayer key={message.id} playback={message.playback} host={message.author_id===account} disabled={disabled} update={position=>action({type:'playback_update',id:message.id,position})}/>}{error&&<p role="alert">{error}</p>}
  </>
}
function SharedPlayer({playback,host,disabled,update}:{playback:SharedPlayback;host:boolean;disabled:boolean;update:(position:SharedPlayback['position'])=>Promise<void>}){
  const [enabled,setEnabled]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(''),[seek,setSeek]=useState(0),[now,setNow]=useState(Date.now)
  const [clientOrigin,setClientOrigin]=useState(location.origin)
  const iframe=useRef<HTMLIFrameElement|null>(null),nonce=useRef(''),latest=useRef({playback,update,disabled}),pending=useRef(false)
  latest.current={playback,update,disabled}
  const provider=providerName(playback.provider)
  // A data document has an opaque origin even with allow-same-origin. Provider
  // scripts execute there, never in the application containing plaintext or IPC.
  const bridge=new URL('/playback-bridge.js',location.href).href
  const policy=`default-src 'none'; script-src ${location.origin} https://www.youtube.com https://s.ytimg.com https://w.soundcloud.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://w.soundcloud.com; connect-src https://www.youtube.com https://w.soundcloud.com; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'`
  const source='data:text/html;charset=utf-8,'+encodeURIComponent(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>External media player</title><div id="player"></div><script src="${bridge}"></script>`)
  function tell(position:ReturnType<typeof playbackTarget>){iframe.current?.contentWindow?.postMessage({type:'hearth-player-control',nonce:nonce.current,...position},'*')}
  async function start(){
    if(!playbackEnabled(playback.provider))return
    setError('')
    try{if(isTauri()){const id=await getIdentifier();if(!/^[a-zA-Z0-9.-]{1,253}$/.test(id))throw new Error('Player application identity is unavailable.');setClientOrigin('https://'+id)}
      nonce.current=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');setReady(false);setEnabled(true)
    }catch{setError('The player application identity could not be checked. Try connecting again.')}
  }
  useEffect(()=>{if(!enabled)return;const timer=setInterval(()=>setNow(Date.now()),1000);const message=(event:MessageEvent)=>{if(event.source!==iframe.current?.contentWindow||event.data?.type!=='hearth-player-status'||event.data.nonce!==nonce.current)return;if(event.data.ready===true)setReady(true);if(event.data.failed===true)setError('The provider player could not load. Its availability, sign-in rules or this runtime may prevent playback.')};window.addEventListener('message',message);return()=>{clearInterval(timer);window.removeEventListener('message',message)}},[enabled])
  useEffect(()=>{if(enabled&&ready)tell(playbackTarget(playback.position,now))},[enabled,ready,playback.position,now])
  useEffect(()=>{if(!enabled||ready)return;const timer=setTimeout(()=>setError('The provider did not finish loading. Stop playback and reconnect, or check its availability and sign-in requirements.'),20000);return()=>clearTimeout(timer)},[enabled,ready])
  async function publish(playing:boolean,positionMs=playbackTarget(latest.current.playback.position).positionMs){
    if(pending.current||latest.current.disabled)return
    pending.current=true
    try{const state=latest.current.playback.position;await latest.current.update({revision:state.revision+1,playing,position_ms:Math.round(positionMs),sent_at:Date.now()})}finally{pending.current=false}
  }
  useEffect(()=>{if(!enabled||!host)return;const timer=setInterval(()=>{if(latest.current.playback.position.playing)void publish(true).catch(()=>setError('Playback synchronization paused while messaging is unavailable.'))},10000);return()=>clearInterval(timer)},[enabled,host])
  return <section className="activity-card" aria-label="Synchronized playback"><p>{provider} · {playback.position.playing?'Playing':'Paused'} · {Math.floor(playbackTarget(playback.position,now).positionMs/1000)} seconds</p>
    {!playbackEnabled(playback.provider)?<p role="status">Spotify playback is disabled in this release.</p>:!enabled?<><p>Connecting loads {provider} in an isolated player. The provider sees your network address, the Hearth application or website identifier, and media choice and may use its own browser sign-in. Hearth sends it no messages, keys, account identity or RSVP data. Playback availability, ads and sign-in depend on the provider.</p><button disabled={disabled} onClick={()=>void start()}>Connect to {provider} and follow playback</button></>:<><iframe ref={iframe} title={`${provider} isolated player`} src={source} sandbox="allow-scripts allow-same-origin" allow="autoplay; encrypted-media; fullscreen" referrerPolicy="no-referrer" onLoad={()=>iframe.current?.contentWindow?.postMessage({type:'hearth-player-init',nonce:nonce.current,provider:playback.provider,url:playback.url,origin:clientOrigin},'*')}/><button onClick={()=>{tell({playing:false,positionMs:0});setEnabled(false);setReady(false)}}>Stop provider playback</button>{!ready&&!error&&<p role="status">Waiting for the provider player…</p>}<button disabled={!ready} onClick={()=>tell(playbackTarget(playback.position))}>Sync to host now</button></>}
    {host&&<div className="call-controls"><button disabled={disabled||!enabled||!ready} onClick={()=>void publish(!playback.position.playing)}>{playback.position.playing?'Pause everyone':'Play together'}</button><label>Position (seconds)<input type="number" min="0" max="86400" value={seek} onChange={event=>setSeek(Number(event.target.value))}/></label><button disabled={disabled||!enabled||!ready||!Number.isFinite(seek)||seek<0||seek>86400} onClick={()=>void publish(playback.position.playing,seek*1000)}>Seek everyone</button></div>}
    <p>Synchronization is best effort. Your device must be online with a reasonably accurate clock. A stale host pauses playback after 45 seconds. Nothing starts until you choose to connect.</p>{error&&<p role="alert">{error}</p>}
  </section>
}
