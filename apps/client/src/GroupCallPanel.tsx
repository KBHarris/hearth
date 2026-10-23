import {CallDevices} from './CallDevices'
import {useState} from 'react'
import type {Conversation} from '@hearth/sdk'
import type {MessagingSession} from './crypto/messaging-session'
import {GroupCall,type GroupCallState} from './media/group-call'
import {callCapability} from './media/direct-call'
import {Playback,VideoTrack,AudioTrack} from './CallPanel'
import {Modal} from './Modal'
import './CallPanel.css'

export function GroupCallPanel({call,state,service,conversation,account,name,unavailable=false}:{call:GroupCall|null;state:GroupCallState;service:MessagingSession|null;conversation:Conversation|undefined;account:string;name:(id:string)=>string;unavailable?:boolean}){
  const [setup,setSetup]=useState(false),[selected,setSelected]=useState<Record<string,string>>({}),[relay,setRelay]=useState(false),[ice,setIce]=useState<RTCIceServer[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [shareAudio,setShareAudio]=useState(false)
  const active=!['idle','ended'].includes(state.phase),allowed=!!conversation&&!conversation.channel_id&&conversation.accounts.length===3
  const peers=conversation?.accounts.filter(id=>id!==account)??[]
  const chosen=(id:string)=>{const devices=conversation?.members.filter(member=>member.account_id===id)??[];return devices.find(member=>member.enrollment.device_key===selected[id])?.enrollment.device_key??devices[0]?.enrollment.device_key??''}
  const canRelay=ice.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)))
  async function attempt(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action()}catch(error){setError(error instanceof Error?error.message:'The group call could not be updated.')}finally{setBusy(false)}}
  async function media(kind:'camera'|'screen'){setError('');try{await call?.video(kind,kind==='screen'&&shareAudio)}catch(error){setError(error instanceof Error?error.message:'Group video could not be updated.')}}
  return <div className="call-region group-call-region">
    {!active&&allowed&&<button className="group-call-start" disabled={!call||!service||busy||unavailable} onClick={()=>void attempt(async()=>{setIce(await service!.callConfiguration());setSetup(true)})}>Group voice call</button>}
    {active&&<section className="call-panel" aria-label="Encrypted group call">
      <strong>Group voice · {state.participants.filter(person=>!['Invited','Left','ended'].includes(person.phase)).length} joined</strong><p role="status">{state.message}</p>
      <ul className="group-call-people">{state.participants.map(person=><li key={person.device}><span>{name(person.account)}{person.account===account?' (you)':''}</span><small>{person.device.slice(0,8)} · {person.phase}</small>{person.remote&&<Playback stream={person.remote} kind="audio"/>}</li>)}</ul>
      <div className="call-controls">{state.phase==='incoming'?<>
        <button className="primary-button" disabled={busy||unavailable} onClick={()=>void attempt(async()=>{await call!.answer(await service!.callConfiguration())})}>Answer group call</button>
        <button onClick={()=>call?.hangup('Group call declined.')}>Decline group call</button>
      </>:<>
        <button aria-pressed={state.muted} disabled={!['connecting','connected','reconnecting'].includes(state.phase)} onClick={()=>call?.mute()}>{state.muted?'Unmute microphone':'Mute microphone'}</button>
        <button className="call-hangup" onClick={()=>call?.hangup()}>End group call</button>
      </>}</div>
      <>{call&&<CallDevices call={call} camera disabled={state.phase!=='connected'}/>}</><div className="call-controls"><button aria-pressed={state.camera} disabled={busy||state.phase!=='connected'&&!state.camera&&!state.cameraPending} onClick={()=>void media('camera')}>{state.cameraPending?'Cancel group camera':state.camera?'Turn group camera off':'Turn group camera on'}</button><button aria-pressed={state.sharing} disabled={busy||state.phase!=='connected'&&!state.sharing&&!state.sharingPending} onClick={()=>void media('screen')}>{state.sharingPending?'Cancel group screen selection':state.sharing?'Stop group sharing':'Share screen with group'}</button></div>
      <label className="call-privacy"><input type="checkbox" checked={shareAudio} disabled={state.sharing||state.sharingPending} onChange={event=>setShareAudio(event.target.checked)}/>Include computer or tab audio when sharing</label>
      <div className="call-videos">{state.participants.flatMap(person=>[person.camera&&person.cameraTrack?<figure key={person.device+'camera'}><figcaption>{name(person.account)} · Camera</figcaption><VideoTrack track={person.cameraTrack}/></figure>:null,person.sharing&&person.screenTrack?<figure key={person.device+'screen'}><figcaption>{name(person.account)} · Screen</figcaption><VideoTrack track={person.screenTrack}/></figure>:null])}</div>
      {state.participants.filter(person=>person.device!==service?.callDevice&&person.systemAudio&&person.systemAudioTrack).map(person=><AudioTrack key={person.systemAudioTrack!.id} track={person.systemAudioTrack!}/>)}
      {state.sharing&&<p role="status">Your screen is shared with this group. {state.systemAudio?'Computer audio is included; microphone mute leaves it playing.':'Computer audio is off.'}</p>}{state.mediaNotice&&<p role="status">{state.mediaNotice}</p>}
      <p className="muted">People can join independently, and the call stays open when someone leaves.</p>
    </section>}
    {state.phase==='ended'&&<p role="status" className="call-ended">{state.message}</p>}
    {state.phase==='ended'&&state.canRejoin&&state.conversation===conversation?.id&&<button className="primary-button" disabled={busy||unavailable||!call||!service} onClick={()=>void attempt(async()=>{await call!.rejoin(await service!.callConfiguration())})}>Rejoin group call</button>}
    {error&&<p role="alert" className="input-error">{error}</p>}
    {setup&&<Modal title="Start an encrypted group call" onClose={()=>setSetup(false)} description="Your microphone starts when another person joins. The third person can join later. Camera and screen sharing stay off until you choose.">
      {!callCapability()?<p>This runtime cannot encrypt media frames. Open Hearth in a supported browser to call.</p>:<>
        <p>Choose one device for each person. Direct calls can reveal your network address to the other participants. Relay-only uses your server’s TURN relay for every connection.</p>
        {peers.map(id=><div key={id}><label htmlFor={'group-device-'+id}>{name(id)} · device</label><select id={'group-device-'+id} value={chosen(id)} onChange={event=>setSelected({...selected,[id]:event.target.value})}>{conversation!.members.filter(member=>member.account_id===id).map((member,index)=><option key={member.enrollment.device_key} value={member.enrollment.device_key}>Device {index+1} ({member.enrollment.device_key.slice(0,8)})</option>)}</select></div>)}
        <label className="call-privacy"><input type="checkbox" checked={relay} disabled={!canRelay} onChange={event=>setRelay(event.target.checked)}/>Use relay only</label>
        {!canRelay&&<p className="muted">This server has no TURN relay configured. Direct connectivity depends on all three networks.</p>}
        <button className="primary-button" disabled={busy||unavailable||peers.some(id=>!chosen(id))} onClick={()=>void attempt(async()=>{setSetup(false);await call!.start(conversation!.id,[service!.callDevice,...peers.map(chosen)],relay,ice)})}>Start group voice call</button>
      </>}
    </Modal>}
  </div>
}
