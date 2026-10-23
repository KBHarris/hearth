import {registerOutput} from './media/playback-output'
import {CallDevices} from './CallDevices'
import {useEffect,useRef,useState} from 'react'
import type {Conversation} from '@hearth/sdk'
import type {MessagingSession} from './crypto/messaging-session'
import {DirectCall,callCapability,type CallState} from './media/direct-call'
import {Modal} from './Modal'
import './CallPanel.css'

export function Playback({stream,kind}:{stream:MediaStream;kind:'audio'|'video'}){
  const element=useRef<HTMLMediaElement|null>(null)
  const [blocked,setBlocked]=useState(false)
  useEffect(()=>{
    const player=element.current;if(!player)return
    player.srcObject=stream
    const unregister=kind==='audio'?registerOutput(player):()=>{}
    const play=()=>{void player.play().then(()=>setBlocked(false)).catch(()=>setBlocked(true))}
    play();stream.addEventListener('addtrack',play)
    return()=>{unregister();stream.removeEventListener('addtrack',play);player.pause();player.srcObject=null}
  },[stream,kind])
  return <>{kind==='video'?<video ref={value=>{element.current=value}} autoPlay playsInline muted className="call-video"/>:<audio ref={value=>{element.current=value}} autoPlay/>}{blocked&&<button onClick={()=>void element.current?.play().then(()=>setBlocked(false))}>Play call {kind}</button>}</>
}
export function AudioTrack({track}:{track:MediaStreamTrack}){const [stream]=useState(()=>new MediaStream([track]));return <Playback stream={stream} kind="audio"/>}
export function CallPanel({call,state,service,conversation,account,name,unavailable=false}:{call:DirectCall|null;state:CallState;service:MessagingSession|null;conversation:Conversation|undefined;account:string;name:(id:string)=>string;unavailable?:boolean}){
  const [setup,setSetup]=useState(false),[target,setTarget]=useState(''),[relay,setRelay]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [configuration,setConfiguration]=useState<RTCIceServer[]>([])
  const [shareAudio,setShareAudio]=useState(false)
  const active=!['idle','ended'].includes(state.phase)
  const peers=conversation?.members.filter(m=>m.account_id!==account)??[]
  const chosen=peers.some(p=>p.enrollment.device_key===target)?target:peers[0]?.enrollment.device_key??''
  const allowed=!!conversation&&!conversation.channel_id&&conversation.accounts.length===2
  const canRelay=configuration.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)))
  async function attempt(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action()}catch(error){setError(error instanceof Error?error.message:'The call could not be updated.')}finally{setBusy(false)}}
  const [videoTracks,setVideoTracks]=useState<MediaStreamTrack[]>([])
  useEffect(()=>{
    const stream=state.remote
    const update=()=>setVideoTracks(stream?.getVideoTracks()??[])
    update();stream?.addEventListener('addtrack',update);stream?.addEventListener('removetrack',update)
    return()=>{stream?.removeEventListener('addtrack',update);stream?.removeEventListener('removetrack',update)}
  },[state.remote])
  return <div className="call-region">
    {!active&&allowed&&<button className="call-start" disabled={!call||!service||busy||unavailable} onClick={()=>void attempt(async()=>{setConfiguration(await service!.callConfiguration());setSetup(true)})}>Voice call</button>}
    {active&&<section className="call-panel" aria-label="Encrypted call"><div><strong>{name(state.peer)}</strong><p role="status">{state.message||'Preparing encrypted call…'}</p></div>
      {state.phase==='incoming'?<div className="call-controls"><button className="primary-button" disabled={busy} onClick={()=>void attempt(async()=>{const config=await service!.callConfiguration();await call!.answer(config)})}>Answer call</button><button onClick={()=>void call?.hangup('Call declined.')}>Decline call</button></div>:<div className="call-controls">
        <button aria-pressed={state.muted} disabled={!['connected','reconnecting','rekeying'].includes(state.phase)} onClick={()=>call?.mute()}>{state.muted?'Unmute microphone':'Mute microphone'}</button>
        <button aria-pressed={state.camera} disabled={busy||(state.phase!=='connected'&&!(['reconnecting','rekeying'].includes(state.phase)&&state.camera))} onClick={()=>void attempt(()=>call!.video('camera'))}>{state.camera?'Turn camera off':'Turn camera on'}</button>
        <button aria-pressed={state.sharing} disabled={busy||(state.phase!=='connected'&&!(['reconnecting','rekeying'].includes(state.phase)&&state.sharing))} onClick={()=>void attempt(()=>call!.video('screen',shareAudio))}>{state.sharing?'Stop sharing':'Share screen'}</button>
        <button className="call-hangup" onClick={()=>void call?.hangup()}>End call</button>
      </div>}
      {call&&state.phase!=='incoming'&&<CallDevices call={call} disabled={state.phase!=='connected'}/>}
      {state.remote&&<Playback stream={state.remote} kind="audio"/>}
      {state.remoteSystemAudio&&<AudioTrack key={state.remoteSystemAudio.id} track={state.remoteSystemAudio}/>}
      <label className="call-privacy"><input type="checkbox" checked={shareAudio} disabled={state.sharing||busy} onChange={event=>setShareAudio(event.target.checked)}/>Include computer or tab audio when sharing</label>
      <div className="call-videos">{videoTracks.map(track=><VideoTrack key={track.id} track={track}/>)}</div>
      {state.sharing&&<p className="call-sharing" role="status">Your screen is being shared. {state.systemAudio?'Computer audio is included. Microphone mute does not mute shared audio.':'The selected source is not sharing audio.'}</p>}
    </section>}
    {state.phase==='ended'&&<p className="call-ended" role="status">{state.message}</p>}
    {error&&<p role="alert" className="input-error">{error}</p>}
    {setup&&<Modal title="Start an encrypted call" onClose={()=>setSetup(false)} description="Your microphone starts when you call. Camera and screen sharing stay off until you enable them.">
      {!callCapability()?<p>This runtime cannot encrypt media frames. Open Hearth in a supported browser to call.</p>:<>
        <p>Direct calls can reveal your network address to the other participant. Relay-only uses your server’s TURN relay and never falls back to a direct connection.</p>
        <label htmlFor="call-device">Their device</label><select id="call-device" value={chosen} onChange={event=>setTarget(event.target.value)}>{peers.map((peer,index)=><option key={peer.enrollment.device_key} value={peer.enrollment.device_key}>{name(peer.account_id)} · device {index+1} ({peer.enrollment.device_key.slice(0,8)})</option>)}</select>
        <label className="call-privacy"><input type="checkbox" checked={relay} disabled={!canRelay} onChange={event=>setRelay(event.target.checked)}/>Use relay only</label>
        {!canRelay&&<p className="muted">This server has no TURN relay configured. Direct connectivity depends on both networks.</p>}
        <button className="primary-button" disabled={!chosen||busy||unavailable} onClick={()=>void attempt(async()=>{setSetup(false);await call!.start(conversation!.id,chosen,relay,configuration)})}>Start voice call</button>
      </>}
    </Modal>}
  </div>
}
export function VideoTrack({track}:{track:MediaStreamTrack}){
  const [stream]=useState(()=>new MediaStream([track]))
  const [visible,setVisible]=useState(!track.muted)
  useEffect(()=>{const update=()=>setVisible(!track.muted&&track.readyState==='live');track.addEventListener('mute',update);track.addEventListener('unmute',update);track.addEventListener('ended',update);update();return()=>{track.removeEventListener('mute',update);track.removeEventListener('unmute',update);track.removeEventListener('ended',update)}},[track])
  return visible?<Playback stream={stream} kind="video"/>:null
}
