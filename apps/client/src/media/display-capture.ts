/** Browser/OS picker remains the authority. Audio is explicit and the returned
 * tracks are verified again by the owning call before any publication. */
export function captureDisplay(audio=false){
  const audioConstraints:MediaTrackConstraints&{restrictOwnAudio:boolean}={echoCancellation:false,noiseSuppression:false,autoGainControl:false,restrictOwnAudio:true}
  const options:DisplayMediaStreamOptions&{systemAudio:'include'|'exclude';selfBrowserSurface:'exclude'}={video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:10,max:15}},audio:audio?audioConstraints:false,systemAudio:audio?'include':'exclude',selfBrowserSurface:'exclude'}
  return navigator.mediaDevices.getDisplayMedia(options)
}
