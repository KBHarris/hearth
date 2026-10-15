import { useId, useState } from 'react'
import { addressScope, createHearthInvite, type HearthInvite } from '@hearth/sdk'

export function ShareInvite({ invite }: { invite: HearthInvite }) {
  const id = useId()
  const [message, setMessage] = useState('')
  const link = createHearthInvite(invite)
  async function copy() {
    try { await navigator.clipboard.writeText(link); setMessage('Invite copied.') }
    catch { setMessage('Select the invite above and copy it to share.') }
  }
  return <div className="share-invite">
    <label htmlFor={id}>Hearth invite</label>
    <input id={id} readOnly value={link} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
    <small>Share privately. Your friend can paste this into Join a server in Hearth. {invite.account ? 'The account invite is single use and expires after 24 hours.' : 'Your friend needs an account on this server.'}</small>
    {addressScope(invite.server) !== 'public' && <p className="notice">This invite uses {addressScope(invite.server) === 'loopback' ? 'an address that only works on this computer' : 'an address that may not work outside your network'}. Use an internet address before inviting someone in another household.</p>}
    <button type="button" onClick={() => void copy()}>Copy invite</button>
    {message && <p role="status">{message}</p>}
  </div>
}
