// Explicit acceptance only: a routing-authorized subscriber without Hearth keys.
import {BaseKeyProvider,Room,RoomEvent,type RemoteTrack} from 'livekit-client'
import EncryptionWorker from 'livekit-client/e2ee-worker?worker'
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
class WrongKeys extends BaseKeyProvider {
  constructor(){super({sharedKey:false,ratchetWindowSize:0,failureTolerance:-1})}
  async install(identity:string){const bytes=crypto.getRandomValues(new Uint8Array(32));try{this.onSetEncryptionKey(await crypto.subtle.importKey('raw',bytes,'HKDF',false,['deriveBits','deriveKey']),identity,0)}finally{bytes.fill(0)}}
}
export async function verifySfuObserver(config:{origin:string;token:string},name:string,audio:AudioContext,expected:number,ice:RTCIceServer[],relayOnly:boolean){
  const response=await fetch(config.origin,{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({room:name})})
  if(!response.ok)throw new Error('SFU observer fixture unavailable')
  const access=await response.json() as {url:string;token:string},provider=new WrongKeys(),worker=new EncryptionWorker()
  const room=new Room({encryption:{keyProvider:provider,worker},adaptiveStream:false,dynacast:false}),tracks:RemoteTrack[]=[],peaks:(()=>number)[]=[],nodes:AudioNode[]=[]
  let errors=0,phase='connect',packets=0,frames=0,peak=0
  room.on(RoomEvent.EncryptionError,()=>errors++)
  room.on(RoomEvent.ParticipantConnected,participant=>{void provider.install(participant.identity)})
  room.on(RoomEvent.TrackSubscribed,track=>{
    tracks.push(track)
    if(track.kind==='audio'){
      const source=audio.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])),analyser=audio.createAnalyser(),silent=audio.createGain();silent.gain.value=0;source.connect(analyser);analyser.connect(silent).connect(audio.destination);nodes.push(source,analyser,silent)
      const samples=new Float32Array(analyser.fftSize);peaks.push(()=>{analyser.getFloatTimeDomainData(samples);return Math.max(...samples.map(Math.abs))})
    }
  })
  try{
    await room.setE2EEEnabled(true);await room.connect(access.url,access.token,{autoSubscribe:true,rtcConfig:{...(ice.length?{iceServers:ice}:{}),iceTransportPolicy:relayOnly?'relay':'all'}})
    phase='subscriptions'
    for(const participant of room.remoteParticipants.values())await provider.install(participant.identity)
    for(let i=0;i<100&&tracks.length<expected;i++)await pause(100)
    if(tracks.length<expected)throw new Error('SFU observer missing ciphertext subscriptions')
    await pause(5000)
    phase='isolation'
    for(const track of tracks){const stats=await track.getRTCStatsReport();stats?.forEach(report=>{if(report.type==='inbound-rtp'){packets+=report.packetsReceived??0;frames+=report.framesDecoded??0}})}
    peak=Math.max(0,...peaks.map(read=>read()))
    if(packets<100||frames!==0||peak>=.005||errors===0)throw new Error('SFU wrong-key isolation failed')
    return {ciphertextTracks:tracks.length,packets,decodedVideoFrames:frames,decodedAudioPeak:peak,keyErrors:errors}
  }catch{throw Object.assign(new Error('SFU observer failed'),{observerDiagnostics:{phase,tracks:tracks.length,packets,frames,peak,errors}})}
  finally{nodes.forEach(node=>node.disconnect());room.removeAllListeners();await room.disconnect(true).catch(()=>{});worker.terminate();provider.removeAllListeners()}
}
