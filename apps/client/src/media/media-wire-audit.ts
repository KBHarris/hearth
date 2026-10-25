// Acceptance-only audit. Traffic volume is not evidence of key disclosure:
// inspect every captured frame, including keys captured after earlier traffic.
export function mediaWirePrivate(frames:readonly string[],keys:Iterable<string>){
  const secrets=[...keys]
  return frames.length>0&&secrets.every(key=>key.length>0&&frames.every(frame=>!frame.includes(key)))
}
