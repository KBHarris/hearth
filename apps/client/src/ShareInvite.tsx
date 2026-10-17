import { useEffect, useId, useState } from 'react'
import { addressScope, createShortInvite, HearthClient, normalizeServerUrl, type HearthInvite } from '@hearth/sdk'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { inviteShareServer, type InviteHost } from './invite-address'

export function ShareInvite({ invite, token }: { invite: HearthInvite; token: string }) {
  const id = useId()
  const [message, setMessage] = useState('')
  const [shared, setShared] = useState<{ code: string } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const { server, serverKey, account, community } = invite
  const [shareServer, setShareServer] = useState(server)
  const [address, setAddress] = useState(server)
  const [checkingHost, setCheckingHost] = useState(isTauri() && addressScope(server) === 'loopback')
  useEffect(() => {
    if (!isTauri() || addressScope(server) !== 'loopback') return
    const controller = new AbortController()
    void invoke<InviteHost>('host_control', { action: 'status' }).then(async host => {
      const candidate = inviteShareServer(server, host)
      if (candidate === server || !host.local_url) return
      const identity = await new HearthClient(host.local_url).wellKnown({ signal: controller.signal })
      if (!controller.signal.aborted && identity.server_key.toLowerCase() === serverKey.toLowerCase()) { setShareServer(candidate); setAddress(candidate) }
    }).catch(() => { /* The address can also be entered explicitly. */ })
      .finally(() => { if (!controller.signal.aborted) setCheckingHost(false) })
    return () => controller.abort()
  }, [server, serverKey])
  useEffect(() => {
    if (checkingHost) return
    const controller = new AbortController()
    setShared(null); setError(''); setMessage('')
    void createShortInvite({ server: shareServer, serverKey, account, community }, token, { signal: controller.signal, relayServer: server })
      .then(value => { if (!controller.signal.aborted) setShared({ code: value.code }) })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not prepare this invite.') })
    return () => controller.abort()
  }, [server, shareServer, serverKey, account, community, token, retry, checkingHost])
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setMessage(label + ' copied.') }
    catch { setMessage('Select the ' + label.toLowerCase() + ' above and copy it to share.') }
  }
  function applyAddress() {
    try { const next = normalizeServerUrl(address); setAddress(next); setShareServer(next); setError(''); setShared(null); setRetry(value => value + 1) }
    catch { setError('Enter a valid server address, using HTTPS for internet access.') }
  }
  const addressChanged = address !== shareServer
  return <div className="share-invite">
    <label htmlFor={id + '-server'}>Server address for your friend</label>
    <input id={id + '-server'} className="invite-server-address" value={address} autoComplete="off" spellCheck={false} disabled={checkingHost} onChange={event => setAddress(event.target.value)} />
    {addressChanged && <button type="button" onClick={applyAddress}>Use server address</button>}
    {shared && !addressChanged ? <><label htmlFor={id + '-code'}>Invite code</label>
      <input id={id + '-code'} className="invite-code" readOnly value={shared.code} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} /></> : !error && <p role="status">{addressChanged ? 'Apply the server address to prepare its code.' : 'Preparing invite…'}</p>}
    <small>Share the server address and this code privately. Your friend enters both in Join a server. The code lasts up to 24 hours; the original invite’s expiry and use limits still apply. {invite.account ? 'Account setup is single use.' : 'Your friend needs an account on this server.'}</small>
    {addressScope(shareServer) !== 'public' && <p className="notice">This address {addressScope(shareServer) === 'loopback' ? 'only works on this computer' : 'may not work outside your network'}. Enter your public HTTPS address before inviting someone in another household.</p>}
    {server !== shareServer && <small>You can stay connected locally. This code is prepared for your friend’s address above; check that it works from another network.</small>}
    <div className="button-row"><button type="button" disabled={!shared || addressChanged} onClick={() => shared && void copy(shared.code, 'Invite code')}>Copy code</button>
      <button type="button" disabled={!shared || addressChanged} onClick={() => void copy(shareServer, 'Server address')}>Copy server address</button></div>
    {error && <><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Retry invite</button></>}
    {message && <p role="status">{message}</p>}
  </div>
}
