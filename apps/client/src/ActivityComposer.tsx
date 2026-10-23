import {useState,type FormEvent} from 'react'
import type {Activity} from '@hearth/sdk'
import {playbackAddress,playbackEnabled} from './activities'
export function ActivityComposer({kind,send,disabled}:{kind:'event'|'playback';send:(activity:Activity)=>Promise<void>;disabled:boolean}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function publish(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError('')
    try{const title=String(data.get('title')).trim()
      if(kind==='event'){
        const starts_at=new Date(String(data.get('start'))).getTime(),ends_at=new Date(String(data.get('end'))).getTime()
        if(!Number.isSafeInteger(starts_at)||!Number.isSafeInteger(ends_at)||starts_at<=Date.now()||ends_at<=starts_at||ends_at-starts_at>7*86400000)throw new Error('Choose a future start and an end within seven days of the start.')
        await send({type:'event',event:{title,description:String(data.get('description')).trim(),location:String(data.get('location')).trim(),starts_at,ends_at}})
      }else{
        const address=playbackAddress(String(data.get('url')))
        if(!playbackEnabled(address.provider))throw new Error('Spotify playback is disabled in this release. Use a YouTube video or SoundCloud track.')
        await send({type:'playback',playback:{title,...address,position:{revision:1,playing:false,position_ms:0,sent_at:Date.now()}}})
      }
    }catch(error){setError(error instanceof Error?error.message:'The activity could not be shared.')}finally{setBusy(false)}
  }
  return <form onSubmit={event=>void publish(event)}><label>Title<input name="title" maxLength={160} required disabled={disabled||busy}/></label>
    {kind==='event'?<><label>Description<textarea name="description" maxLength={4000} rows={4}/></label><label>Starts (your local time)<input name="start" type="datetime-local" required/></label><label>Ends (your local time)<input name="end" type="datetime-local" required/></label><label>Where to meet<input name="location" maxLength={200} placeholder="A room name or meeting place"/></label><p>Event details and responses stay encrypted. Everyone in this conversation can see RSVPs. Times use your local clock.</p></>:<><label>Media link<input name="url" type="url" required placeholder="https://…"/></label><p>YouTube videos and SoundCloud tracks are supported. Spotify playback is disabled in this release. Every person chooses whether to connect to the provider. Posting the link does not load a player or link your identity.</p></>}
    <button className="primary-button" disabled={disabled||busy}>{kind==='event'?'Schedule event':'Share synchronized playback'}</button>{error&&<p role="alert">{error}</p>}
  </form>
}
