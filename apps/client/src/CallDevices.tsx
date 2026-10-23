import {useEffect,useState,useSyncExternalStore} from 'react'
import {outputSnapshot,setOutput,subscribeOutput} from './media/playback-output'
export function CallDevices({call,camera=true,disabled=false,microphoneDisabled=false}:{call:{changeDevice:(kind:'audio'|'video',device:string)=>Promise<void>};camera?:boolean;disabled?:boolean;microphoneDisabled?:boolean}){
  const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [microphone,setMicrophone]=useState(''),[video,setVideo]=useState('')
  const output=useSyncExternalStore(subscribeOutput,outputSnapshot)
  async function refresh(){try{setDevices(await navigator.mediaDevices.enumerateDevices());setError('')}catch{setError('Device names are available after you grant microphone or camera access.')}}
  useEffect(()=>{const devices=navigator.mediaDevices;const changed=()=>void refresh();devices?.addEventListener('devicechange',changed);return()=>devices?.removeEventListener('devicechange',changed)},[])
  async function change(kind:'audio'|'video',value:string){setBusy(true);setError('');try{await call.changeDevice(kind,value);if(kind==='audio')setMicrophone(value);else setVideo(value)}catch(error){setError(error instanceof Error?error.message:'The device could not be changed.')}finally{setBusy(false)}}
  async function speakers(next:ReturnType<typeof outputSnapshot>){setError('');try{await setOutput(next)}catch(error){setError(error instanceof Error?error.message:'The speaker output could not be changed.')}}
  return <details className="call-devices"><summary>Microphone, camera &amp; speakers</summary><button disabled={busy} onClick={()=>void refresh()}>Refresh devices</button>
    <label>Microphone<select value={microphone} disabled={disabled||microphoneDisabled||busy} onChange={event=>void change('audio',event.target.value)}><option value="">System default</option>{devices.filter(device=>device.kind==='audioinput'&&device.deviceId).map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label||`Microphone ${index+1}`}</option>)}</select></label>
    {camera&&<label>Camera<select value={video} disabled={disabled||busy} onChange={event=>void change('video',event.target.value)}><option value="">System default</option>{devices.filter(device=>device.kind==='videoinput'&&device.deviceId).map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label||`Camera ${index+1}`}</option>)}</select></label>}
    <label>Speakers<select value={output.device} disabled={typeof HTMLMediaElement.prototype.setSinkId!=='function'} onChange={event=>void speakers({...output,device:event.target.value})}><option value="">System default</option>{devices.filter(device=>device.kind==='audiooutput'&&device.deviceId).map((device,index)=><option key={device.deviceId} value={device.deviceId}>{device.label||`Speakers ${index+1}`}</option>)}</select></label>
    <label>Call volume<input aria-label="Call volume" type="range" min="0" max="1" step="0.05" value={output.volume} onChange={event=>void speakers({...output,volume:Number(event.target.value)})}/></label><button aria-pressed={output.deafened} onClick={()=>void speakers({...output,deafened:!output.deafened})}>{output.deafened?'Resume listening':'Deafen call audio'}</button>
    <p>Choices apply during this session. Device changes keep encryption and microphone mute in place. Your system may ask for permission.</p>{error&&<p role="alert">{error}</p>}
  </details>
}
