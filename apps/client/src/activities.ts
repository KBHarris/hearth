import type {PlaybackPosition,PlaybackProvider} from '@hearth/sdk'
export function playbackAddress(input:string):{provider:PlaybackProvider;url:string}{
  const url=new URL(input.trim())
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('Use a public HTTPS media link without credentials.')
  if(['www.youtube.com','youtube.com','youtu.be'].includes(url.hostname)){
    const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.startsWith('/shorts/')?url.pathname.slice(8):null
    if(id&&/^[a-zA-Z0-9_-]{11}$/.test(id))return {provider:'youtube',url:'https://www.youtube.com/watch?v='+id}
  }
  if(url.hostname==='open.spotify.com'&&/^\/(track|episode)\/[a-zA-Z0-9]{22}$/.test(url.pathname))return {provider:'spotify',url:'https://open.spotify.com'+url.pathname}
  if(url.hostname==='soundcloud.com'&&/^\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(url.pathname)&&url.pathname.length<=161)return {provider:'soundcloud',url:'https://soundcloud.com'+url.pathname}
  throw new Error('Use a YouTube video, Spotify track or episode, or SoundCloud track link.')
}
/** Bounded best-effort clock correction. Stale hosts stop playback locally. */
export function playbackTarget(state:PlaybackPosition,now=Date.now()){
  const age=now-state.sent_at,playing=state.playing&&age>=-5000&&age<45000
  return {playing,positionMs:Math.min(86_400_000,Math.max(0,state.position_ms+(playing?Math.max(0,Math.min(age,15000)):0)))}
}
export const providerName=(provider:PlaybackProvider)=>({youtube:'YouTube',spotify:'Spotify',soundcloud:'SoundCloud'})[provider]
// Spotify's additional SDK origin is deliberately not authorized in this release.
export const playbackEnabled=(provider:PlaybackProvider)=>provider!=='spotify'
