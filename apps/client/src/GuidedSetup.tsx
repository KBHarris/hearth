import { useEffect, useRef, useState, type FormEvent } from 'react'
import { addressScope, HearthClient, normalizeServerUrl, resolveInviteCode, resolveSetupTarget, type HearthInvite, type ServerInfo } from '@hearth/sdk'
import { Icon } from './Icons'
import { NetworkCheckPanel } from './NetworkCheckPanel'

export type CheckedServer = { server: string; info: ServerInfo; invite: HearthInvite | null }

export function GuidedSetup({ defaultServer, signedIn = false, currentServer, onConnect, onManageHost, initialInvite = '' }: {
  defaultServer: string; signedIn?: boolean; currentServer?: { url: string; key: string }; onConnect: (checked: CheckedServer) => void; onManageHost?: () => void; initialInvite?: string
}) {
  const [route, setRoute] = useState<'host' | 'join' | null>(initialInvite ? 'join' : null)
  const [helping, setHelping] = useState(false)
  const [address, setAddress] = useState(initialInvite)
  const [inviteCode, setInviteCode] = useState('')
  const [checked, setChecked] = useState<CheckedServer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => request.current?.abort(), [])
  function choose(next: 'host' | 'join' | null) {
    request.current?.abort(); setBusy(false); setError(''); setChecked(null); setRoute(next)
    setAddress(next === 'host' ? defaultServer : currentServer?.url ?? ''); setInviteCode('')
  }
  async function check(event: FormEvent) {
    event.preventDefault(); request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError(''); setChecked(null)
    try {
      const target = route === 'host' ? { server: normalizeServerUrl(address), invite: null } : inviteCode.trim() ?
        { server: normalizeServerUrl(address), invite: await resolveInviteCode(address, inviteCode, { signal: controller.signal }) } :
        await resolveSetupTarget(address, { signal: controller.signal })
      const info = await new HearthClient(target.server).inspect({ signal: controller.signal })
      if (controller.signal.aborted) return
      const key = info.wellKnown.server_key.toLowerCase()
      let pinned: string | null = null
      try { pinned = localStorage.getItem(`hearth.server-key:${target.server}`) } catch { /* Auth handles required identity storage. */ }
      if ((pinned && pinned !== key) || (target.invite && target.invite.serverKey !== key) ||
        (currentServer?.url === target.server && currentServer.key !== key)) throw new Error('This server’s safety code does not match the server you use now, the one saved on this device, or your invite, so it may not be the server you expect. Ask the host to check it before you continue.')
      if (target.invite && !info.setup.setup_complete) throw new Error('This server has not finished owner setup. Ask its host to finish setup and send a new invite.')
      setChecked({ ...target, info })
    } catch (error) {
      if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Could not check this server. Try again.'); input.current?.focus() }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const scope = checked ? addressScope(checked.server) : null
  return <section className="guided-setup" aria-labelledby="setup-heading">
    {helping ? <>
      <button type="button" className="setup-back" onClick={() => setHelping(false)}>← Host or join</button>
      <NetworkCheckPanel />
    </> : !route ? <>
      <p className="eyebrow">GET STARTED</p><h1 id="setup-heading">Your people, your space.</h1>
      <p>Join someone’s Hearth server, or set up a home for your own group.</p>
      <div className="setup-choices">
        <button className="setup-choice" onClick={() => choose('join')}><Icon name="users" /><span><strong>Join a server</strong><small>I have an invite or server address.</small></span><Icon name="arrow" /></button>
        <button className="setup-choice" onClick={() => choose('host')}><Icon name="server" /><span><strong>Host a server</strong><small>Check my server and set up its owner.</small></span><Icon name="arrow" /></button>
        <button className="setup-choice setup-choice-quiet" onClick={() => setHelping(true)}><Icon name="globe" /><span><strong>Help a friend test their server</strong><small>They sent me a test to run from my internet connection.</small></span><Icon name="arrow" /></button>
      </div>
      <p className="setup-footnote">Messages and files are end-to-end encrypted, so only the people in a conversation can read them.</p>
    </> : <>
      <button type="button" className="setup-back" onClick={() => choose(null)}>← Host or join</button>
      <p className="eyebrow">{route === 'host' ? 'HOST A SERVER' : 'JOIN A SERVER'}</p>
      <h1 id="setup-heading">{route === 'host' ? 'Connect to your server.' : 'Bring your invite.'}</h1>
      <p>{route === 'host' ? 'Enter the address of your running Hearth server. Then create its owner account, or sign in.' : 'Enter the server address and invite code you were sent. If you already have an account there, the address is enough.'}</p>
      {route === 'host' && <>{onManageHost && <button type="button" onClick={onManageHost}>Start or manage a server on this computer</button>}<p className="notice">{onManageHost?'Start a server on this computer, or enter the address of a server you already run.':'Start your server first, or use the hosting controls in the Hearth desktop app.'}</p></>}
      <form onSubmit={event => void check(event)} aria-busy={busy}>
        <label htmlFor="setup-address">Server address</label>
        <input id="setup-address" ref={input} type="text" value={address} required autoFocus autoComplete="off" spellCheck={false} disabled={busy}
          placeholder={route === 'host' ? 'http://localhost:8080' : 'https://chat.example.org'}
          aria-invalid={!!error} aria-describedby="setup-address-help" onChange={event => { setAddress(event.target.value); setChecked(null); setError('') }} />
        <small id="setup-address-help">{route === 'host' ? 'For a server on this computer, use a localhost address. For a server somewhere else, use its https:// address.' : 'Hearth does not save your invite. Once the server works, only its address is saved.'}</small>
        {route === 'join' && <><label htmlFor="setup-code">Invite code (if you have one)</label><input id="setup-code" value={inviteCode} disabled={busy} autoComplete="off" spellCheck={false} placeholder="ABCD-EFGH-JKMP-QRST-VWXY-2345-6789-ABCD" onChange={event => { setInviteCode(event.target.value); setChecked(null); setError('') }} /></>}
        {signedIn && <p className="notice">Switching to a different server signs you out of this one. Your messages and account keys stay on this device.</p>}
        <button type="submit" disabled={busy}>{busy ? 'Checking server…' : checked ? 'Check again' : 'Check server'}</button>
        {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false) }}>Cancel check</button>}
      </form>
      {error && <div className="setup-error" role="alert"><p>{error}</p><small>Check the address and make sure the server is running. For a server on the internet, its host may need to check the secure connection (HTTPS), firewall and router settings. This check alone cannot tell whether the router or the internet provider is the problem.</small></div>}
      {checked && <div className="setup-result" aria-live="polite">
        <h2>{checked.info.wellKnown.server_name}</h2><p className="setup-origin">{checked.server}</p>
        <ul className="setup-checks"><li><span>Server responds</span><strong>Passed</strong></li><li><span>Compatible Hearth version</span><strong>Passed</strong></li>
          <li><span>{checked.invite ? 'Matches your invite' : 'Server safety code found'}</span><strong>Passed</strong></li>
          <li><span>Owner account</span><span>{checked.info.setup.setup_complete ? 'Already set up' : 'You create it next'}</span></li>
          <li><span>Reachable from another home</span><span>Not checked</span></li></ul>
        {scope === 'loopback' && <p className="notice">This address works only on this computer. Friends need an internet address.</p>}
        {scope === 'private' && <p className="notice">This looks like a local network address. Friends outside your home will need an internet address.</p>}
        {scope === 'shared' && <p className="notice">This address is shared with other customers of your internet provider, so friends outside your home may not be able to reach it. Ask your provider about a public address, or use a supported relay when one is available.</p>}
        {scope === 'public' && <p className="notice">This worked from your device. Test it from another network before you share it with friends.</p>}
        {checked.invite?.community && <p>Your community invite is ready. After you sign in, confirm that you want to join. An approved member’s device may need to be online before you can open encrypted channels.</p>}
        <button type="button" className="primary-button" onClick={() => onConnect(checked)}>{!checked.info.setup.setup_complete ? 'Set up owner account' : checked.invite?.account ? 'Continue to account setup' : 'Continue to sign in'}</button>
      </div>}
    </>}
  </section>
}
