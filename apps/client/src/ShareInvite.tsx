import { useEffect, useId, useState } from 'react'
import { addressScope, createShortInvite, type HearthInvite } from '@hearth/sdk'

export function ShareInvite({ invite, token }: { invite: HearthInvite; token: string }) {
  const id = useId()
  const [message, setMessage] = useState('')
  const [shared, setShared] = useState<{ link: string; code: string } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const { server, serverKey, account, community } = invite
  useEffect(() => {
    const controller = new AbortController()
    setShared(null); setError(''); setMessage('')
    void createShortInvite({ server, serverKey, account, community }, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setShared(value) })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not prepare this invite.') })
    return () => controller.abort()
  }, [server, serverKey, account, community, token, retry])
  async function copy() {
    if (!shared) return
    try { await navigator.clipboard.writeText(shared.link); setMessage('Invite copied.') }
    catch { setMessage('Select the invite above and copy it to share.') }
  }
  return <div className="share-invite">
    {shared ? <><label htmlFor={id + '-code'}>Invite code</label>
      <input id={id + '-code'} className="invite-code" readOnly value={shared.code} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} />
      <label htmlFor={id}>Hearth invite</label>
      <input id={id} readOnly value={shared.link} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} /></> : !error && <p role="status">Preparing invite…</p>}
    <small>Share privately. Copy the full invite so your friend has the server address. This link lasts up to 24 hours; the original invite’s expiry and use limits still apply. {invite.account ? 'Account setup is single use.' : 'Your friend needs an account on this server.'}</small>
    {addressScope(invite.server) !== 'public' && <p className="notice">This invite uses {addressScope(invite.server) === 'loopback' ? 'an address that only works on this computer' : 'an address that may not work outside your network'}. Use an internet address before inviting someone in another household.</p>}
    <button type="button" disabled={!shared} onClick={() => void copy()}>Copy invite</button>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry invite</button></>}
    {message && <p role="status">{message}</p>}
  </div>
}
