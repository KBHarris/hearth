import {CallDevices} from './CallDevices'
import {useEffect,useState} from 'react'
import {Permission,type ChannelRoster,type VoiceRoom} from '@hearth/sdk'
import type {MessagingSession} from './crypto/messaging-session'
import {Playback,VideoTrack,AudioTrack} from './CallPanel'
import {VoiceRoomCall,type VoiceState} from './media/voice-room'
import {Modal} from './Modal'

export function VoiceRoomPanel({call,state,service,channel,name,unavailable=false}:{call:VoiceRoomCall|null;state:VoiceState;service:MessagingSession|null;channel:ChannelRoster|undefined;name:(id:string)=>string;unavailable?:boolean}){
  const [room,setRoom]=useState<VoiceRoom|null>(null),[setup,setSetup]=useState(false),[relay,setRelay]=useState(false),[ice,setIce]=useState<RTCIceServer[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [shareAudio,setShareAudio]=useState(false)
  const active=!['idle','ended'].includes(state.phase),allowed=channel&&['voice','stage'].includes(channel.channel.kind)
  useEffect(()=>{setRoom(null);setSetup(false);setError('')},[channel?.channel.id])
  async function changeSpeaker(account:string,speaker:boolean){
    if(!service||!channel)return
    setBusy(true);setError('')
    try{await service.stageSpeaker(channel.channel.id,account,speaker)}catch(error){setError(error instanceof Error?error.message:'The stage role could not be updated.')}finally{setBusy(false)}
  }
  async function prepare(){
    if(!service||!channel)return
    setBusy(true);setError('')
    try{const {room}=await service.voiceRoom(channel.channel.id);setRoom(room);setRelay(room.participants.length?room.relay_only:false);setIce(await service.callConfiguration());setSetup(true)}catch(error){setError(error instanceof Error?error.message:'Room access could not be checked.')}finally{setBusy(false)}
  }
  async function join(){if(!call||!channel)return;setBusy(true);setError('');try{setSetup(false);await call.join(channel.channel.id,relay,ice)}catch(error){setError(error instanceof Error?error.message:'The room could not be joined.')}finally{setBusy(false)}}
  async function video(kind:'camera'|'screen'){setError('');try{await call?.video(kind,kind==='screen'&&shareAudio)}catch(error){setError(error instanceof Error?error.message:'Room video could not be started.')}}
  const canRelay=ice.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)))
  return <div className="call-region voice-room-region">
    {allowed&&!active&&<section className="call-panel" aria-label="Community voice room"><strong>{channel.channel.name} · Voice room</strong><p>Join whenever you like. The room stays available when everyone leaves.</p><button className="primary-button voice-room-join" disabled={!call||!service||busy||unavailable} onClick={()=>void prepare()}>Join voice room</button><p className="muted">Camera and screen sharing start only when you choose. The room limit is shown before joining.</p></section>}
    {active&&<section className="call-panel" aria-label="Joined voice room"><strong>Voice room · {state.participants.length}/{state.capacity} joined</strong><p role="status">{state.message}</p>{!call?.canSpeak&&<p>You are listening as an audience member. Your microphone is off.</p>}<ul className="group-call-people">{state.participants.map(person=><li key={person.device}><span>{name(person.account)}</span>{channel?.channel.kind==='stage'&&channel.community.owner_id===service?.callAccount&&person.account!==service.callAccount&&<button disabled={busy} onClick={()=>void changeSpeaker(person.account,!call?.speaker(person.device))}>{call?.speaker(person.device)?'Move to audience':'Allow to speak'}</button>}<small>{call?.speaker(person.device)?'Speaker':'Audience'} · {person.phase}</small>{person.remote&&<Playback stream={person.remote} kind="audio"/>}{person.device!==service?.callDevice&&person.systemAudio&&person.systemAudioTrack&&<AudioTrack key={person.systemAudioTrack.id} track={person.systemAudioTrack}/>}</li>)}</ul><div className="call-controls"><button aria-pressed={state.muted} disabled={!call?.speaking||!['connecting','connected'].includes(state.phase)} onClick={()=>call?.mute()}>{state.muted?'Unmute room microphone':'Mute room microphone'}</button><button aria-pressed={state.camera} disabled={!(call?.ownPermissions!&Permission.camera)||state.phase!=='connected'&&!state.camera&&!state.cameraPending} onClick={()=>void video('camera')}>{state.cameraPending?'Cancel room camera':state.camera?'Turn room camera off':'Turn room camera on'}</button><button aria-pressed={state.sharing} disabled={!(call?.ownPermissions!&Permission.screen)||state.phase!=='connected'&&!state.sharing&&!state.sharingPending||typeof navigator.mediaDevices?.getDisplayMedia!=='function'&&!state.sharing&&!state.sharingPending} onClick={()=>void video('screen')}>{state.sharingPending?'Cancel room screen selection':state.sharing?'Stop room sharing':'Share screen with room'}</button><button className="call-hangup" onClick={()=>call?.leave()}>Leave voice room</button></div>
      {call&&<CallDevices call={call} disabled={state.phase!=='connected'} microphoneDisabled={!call.speaking}/>}
      {call?.canSpeak&&!call.speaking&&<button disabled={state.phase!=='connected'||busy} onClick={()=>{setBusy(true);void call.startSpeaking().catch(error=>setError(error instanceof Error?error.message:'The microphone could not start.')).finally(()=>setBusy(false))}}>Start speaking</button>}
      <label className="call-privacy"><input type="checkbox" checked={shareAudio} disabled={state.sharing||state.sharingPending} onChange={event=>setShareAudio(event.target.checked)}/>Include computer or tab audio when sharing</label>
      <div className="call-videos">{state.participants.flatMap(person=>[person.camera&&person.cameraTrack?<figure className="room-video-tile" key={person.device+'camera'}><figcaption>{person.device===service?.callDevice?'You':name(person.account)} · Camera</figcaption><VideoTrack track={person.cameraTrack}/></figure>:null,person.sharing&&person.screenTrack?<figure className="room-video-tile" key={person.device+'screen'}><figcaption>{person.device===service?.callDevice?'You':name(person.account)} · Screen</figcaption><VideoTrack track={person.screenTrack}/></figure>:null])}</div>
      {(state.camera||state.sharing)&&<p className="call-sharing" role="status">{state.camera&&'Your camera is on. '}{state.sharing&&'Your screen is being shared. '}Video goes to everyone in this room. Sharing continues through verified room membership changes. {state.systemAudio?'Computer audio is included; microphone mute does not mute shared audio.':'Computer audio is not being shared.'}</p>}
      {state.mediaNotice&&<p role="status">{state.mediaNotice}</p>}
    </section>}
    {state.phase==='ended'&&<p className="call-ended" role="status">{state.message}</p>}
    {error&&<p role="alert" className="input-error">{error}</p>}
    {setup&&room&&<Modal title="Join voice room" onClose={()=>setSetup(false)} description="Your microphone starts only if your role permits speaking and someone else is in the room. Camera and screen sharing stay off until you choose. Joining does not ring anyone.">
      <p>{room.participants.length}/{room.capacity} people currently in this room. One device per person can join.</p>
      <label className="call-privacy"><input type="checkbox" checked={relay} disabled={room.participants.length>0||!canRelay} onChange={event=>setRelay(event.target.checked)}/>Use relay only</label>
      <p>{room.sfu?'Encrypted media goes through the room’s media server. ':''}{relay?'Everyone connects through the configured TURN relay.':room.sfu?'The media server can see your network address; other participants connect to that server.':'Direct connections can reveal your network address to other room participants.'} {room.participants.length>0?'The current room keeps this privacy setting until empty.':'The first person chooses the setting for this session.'}</p>
      <button className="primary-button" disabled={busy||unavailable||room.participants.length>=room.capacity||relay&&!canRelay} onClick={()=>void join()}>Join room audio</button>
    </Modal>}
  </div>
}
