import { useEffect, useRef, useState, type FormEvent } from 'react'
import { addressScope, HearthClient, normalizeServerUrl, setupTarget, type HearthInvite, type ServerInfo } from '@hearth/sdk'
import { Icon } from './Icons'

export type CheckedServer = { server: string; info: ServerInfo; invite: HearthInvite | null }

export function GuidedSetup({ defaultServer, signedIn = false, currentServer, onConnect }: {
  defaultServer: string; signedIn?: boolean; currentServer?: { url: string; key: string }; onConnect: (checked: CheckedServer) => void
}) {
  const [route, setRoute] = useState<'host' | 'join' | null>(null)
  const [address, setAddress] = useState('')
  const [checked, setChecked] = useState<CheckedServer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => request.current?.abort(), [])
  function choose(next: 'host' | 'join' | null) {
    request.current?.abort(); setBusy(false); setError(''); setChecked(null); setRoute(next)
    setAddress(next === 'host' ? defaultServer : '')
  }
  async function check(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setChecked(null)
    try {
      const target = route === 'host' ? { server: normalizeServerUrl(address), invite: null } : setupTarget(address)
      const info = await new HearthClient(target.server).inspect({ signal: controller.signal })
      if (controller.signal.aborted) return
      const key = info.wellKnown.server_key.toLowerCase()
      let pinned: string | null = null
      try { pinned = localStorage.getItem(`hearth.server-key:${target.server}`) } catch { /* Auth handles required identity storage. */ }
      if ((pinned && pinned !== key) || (target.invite && target.invite.serverKey !== key) ||
        (currentServer?.url === target.server && currentServer.key !== key)) throw new Error('This server’s identity does not match your current server, saved identity or invite. Ask the host to check it before continuing.')
      if (target.invite && !info.setup.setup_complete) throw new Error('This server has not finished owner setup. Ask its host to finish setup and send a new invite.')
      setChecked({ ...target, info })
    } catch (error) {
      if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Could not check this server. Try again.'); input.current?.focus() }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const scope = checked ? addressScope(checked.server) : null
  return <section className="guided-setup" aria-labelledby="setup-heading">
    {!route ? <>
      <p className="eyebrow">GET STARTED</p><h1 id="setup-heading">Your people, your space.</h1>
      <p>Join someone’s Hearth server, or set up a home for your own group.</p>
      <div className="setup-choices">
        <button className="setup-choice" onClick={() => choose('join')}><Icon name="users" /><span><strong>Join a server</strong><small>I have an invite or server address.</small></span><Icon name="arrow" /></button>
        <button className="setup-choice" onClick={() => choose('host')}><Icon name="server" /><span><strong>Host a server</strong><small>Check my server and set up its owner.</small></span><Icon name="arrow" /></button>
      </div>
      <p className="setup-footnote">Messages and files stay end-to-end encrypted.</p>
    </> : <>
      <button type="button" className="setup-back" onClick={() => choose(null)}>← Host or join</button>
      <p className="eyebrow">{route === 'host' ? 'HOST A SERVER' : 'JOIN A SERVER'}</p>
      <h1 id="setup-heading">{route === 'host' ? 'Connect your host.' : 'Bring your invite.'}</h1>
      <p>{route === 'host' ? 'Check a running Hearth server, then create its owner account or sign in.' : 'Paste the invite your host shared. A server address works too.'}</p>
      {route === 'host' && <p className="notice">This build needs an existing Hearth server. Installing and managing hosting services from this app is still being built.</p>}
      <form onSubmit={event => void check(event)} aria-busy={busy}>
        <label htmlFor="setup-address">{route === 'host' ? 'Server address' : 'Invite or server address'}</label>
        <input id="setup-address" ref={input} type="text" value={address} required autoFocus autoComplete="off" spellCheck={false} disabled={busy}
          placeholder={route === 'host' ? 'http://localhost:8080' : 'hearth://join/… or https://chat.example.org'}
          aria-invalid={!!error} aria-describedby="setup-address-help" onChange={event => { setAddress(event.target.value); setChecked(null); setError('') }} />
        <small id="setup-address-help">{route === 'host' ? 'Use localhost for this computer or an HTTPS address for a remote host.' : 'Invites stay in memory while you join. Only the working server address is saved.'}</small>
        {signedIn && <p className="notice">Continuing to a different server signs you out here. Your keys and messages stay on this device.</p>}
        <button type="submit" disabled={busy}>{busy ? 'Checking server…' : checked ? 'Check again' : 'Check server'}</button>
        {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false) }}>Cancel check</button>}
      </form>
      {error && <div className="setup-error" role="alert"><p>{error}</p><small>Check the address and that the host is running. For internet access, the host may need to check HTTPS, firewall and router settings. A failed check alone cannot identify a router or CGNAT problem.</small></div>}
      {checked && <div className="setup-result" aria-live="polite">
        <h2>{checked.info.wellKnown.server_name}</h2><p className="setup-origin">{checked.server}</p>
        <ul className="setup-checks"><li><span>Server responds</span><strong>Passed</strong></li><li><span>Compatible Hearth version</span><strong>Passed</strong></li>
          <li><span>{checked.invite ? 'Identity matches invite' : 'Server identity available'}</span><strong>Passed</strong></li>
          <li><span>Owner account</span><span>{checked.info.setup.setup_complete ? 'Already set up' : 'Create next'}</span></li>
          <li><span>Access from another household</span><span>Not checked</span></li></ul>
        {scope === 'loopback' && <p className="notice">This address works only on this computer. Friends need an internet address.</p>}
        {scope === 'private' && <p className="notice">This looks like a local network address. Friends in another household will need an internet address.</p>}
        {scope === 'shared' && <p className="notice">This address is in the shared range used for CGNAT. Ask your internet provider about a public address, or use a supported relay when available.</p>}
        {scope === 'public' && <p className="notice">This check passed from your device. Confirm access from another network before sharing it as an internet host.</p>}
        {checked.invite?.community && <p>Your community invite is ready. After signing in, confirm joining the community. An approved member’s device may need to be online to open encrypted channels.</p>}
        <button type="button" className="primary-button" onClick={() => onConnect(checked)}>{!checked.info.setup.setup_complete ? 'Set up owner account' : checked.invite?.account ? 'Continue to account setup' : 'Continue to sign in'}</button>
      </div>}
    </>}
  </section>
}
