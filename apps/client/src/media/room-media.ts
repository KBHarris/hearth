export type RoomMediaKind='camera'|'screen'
export type RoomMediaFlags={camera:boolean;sharing:boolean;systemAudio?:boolean}

/** Encrypted room-heartbeat payload. Its counter is scoped to a fresh mesh key
 * context, so delayed controls cannot restore an earlier camera/share state. */
export function roomMediaDescription(revision:number,flags:RoomMediaFlags){
  if(!Number.isSafeInteger(revision)||revision<1||revision>99_999_999)throw new Error('Room media revision expired')
  return String(revision).padStart(8,'0')+':'+(flags.camera?'1':'0')+(flags.sharing?'1':'0')+(flags.systemAudio?'1':'0')
}
export class RemoteRoomMedia {
  private values=new Map<string,{revision:number;description:string;flags:RoomMediaFlags}>()
  receive(device:string,description:string|null):RoomMediaFlags|null{
    // Audio-only format-3 clients sent null. It cannot supersede a newer state.
    if(description===null)return null
    if(!/^[0-9]{8}:[01]{2,3}$/.test(description))throw new Error('Invalid room media state')
    const revision=Number(description.slice(0,8)),previous=this.values.get(device)
    if(revision===0)throw new Error('Invalid room media revision')
    if(previous&&revision<previous.revision)return null
    if(previous&&revision===previous.revision){if(description!==previous.description)throw new Error('Conflicting room media state');return null}
    const flags={camera:description[9]==='1',sharing:description[10]==='1',...(description.length===12?{systemAudio:description[11]==='1'}:{})}
    this.values.set(device,{revision,description,flags});return flags
  }
  clear(){this.values.clear()}
}
