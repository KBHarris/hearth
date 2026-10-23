// Emitted only by the opt-in acceptance build, never normal release assets.
(()=>{
  let blocked=0
  try{parent.localStorage.getItem('hearth.fixture.playerCanary')}catch{blocked++}
  try{parent.document.body}catch{blocked++}
  try{localStorage.getItem('hearth.fixture.playerCanary')}catch{blocked++}
  const report=ipc=>parent.postMessage({type:'hearth-native-player-probe',blocked,ipc},'*')
  const ipc=window.__TAURI_INTERNALS__
  if(!ipc?.invoke){report('absent');return}
  let finished=false
  const done=value=>{if(!finished){finished=true;report(value)}}
  // Read-only disposable configuration. A successful result is never disclosed.
  void ipc.invoke('phase1_config').then(()=>done('allowed')).catch(()=>done('denied'))
  setTimeout(()=>done('timeout'),5000)
})()
