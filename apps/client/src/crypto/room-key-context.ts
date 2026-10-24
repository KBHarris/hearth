import {Permission,permissions,mediaPermissions,type CallSignal,type Conversation,type ChannelRoster} from '@hearth/sdk'

/** A queued export can outlive the signed policy or MLS epoch that created it.
 * Reject that obsolete context before asking the authoritative Rust verifier.
 * No approval or key is produced here; Rust still verifies every allowed export. */
export function currentRoomKeyContext(signal:CallSignal,conversation:Conversation|undefined,roster:ChannelRoster|undefined,own:string,now=Date.now(),epochGovernance=0){
  if(!signal.voice_room)return
  const changed=()=>Object.assign(new Error('The encrypted room context changed.'),{status:409})
  if(!conversation||conversation.epoch!==signal.epoch||!roster)throw changed()
  const required=Permission.connect|Permission.listen
  const selected=signal.participants??[]
  // Own denial wins even when another restricted peer sorts before this device.
  for(const device of [...selected.filter(device=>device===own),...selected.filter(device=>device!==own)]){
    const member=conversation.members.find(peer=>peer.enrollment.device_key===device)
    if(!member)throw changed()
    const account=member.account_id,identity=member.enrollment.identity_key
    const grant=roster.admissions.find(grant=>grant.account_id===account&&grant.identity_key===identity)
    const owner=account===roster.authority?.owner.account_id&&identity===roster.authority.owner.enrollment.identity_key
    const approved=roster.people.some(person=>person.account.id===account&&person.devices.some(proof=>proof.device_key===device&&proof.identity_key===identity))
    const departed=roster.departures?.some(departure=>departure.member.account_id===account&&departure.member.enrollment.identity_key===identity)
    const access=mediaPermissions(roster.governance,permissions(roster.governance,roster.community.owner_id,account,roster.channel.id,now,grant?.invitation?.issued_at??null),roster.channel.kind==='stage',account===roster.community.owner_id)
    if(!approved||(!owner&&!grant)||departed||(access&required)!==required)throw device===own?Object.assign(new Error('Your room access was revoked.'),{status:403}):changed()
  }
  // Rust also requires sends to use the policy committed into this MLS epoch.
  // Fresh authorization can arrive first; pause obsolete work until the actual
  // commit is accepted instead of treating that expected transition as fatal.
  if((roster.governance?.revision??0)!==epochGovernance)throw changed()
}
