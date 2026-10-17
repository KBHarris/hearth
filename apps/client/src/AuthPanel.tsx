import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, resolveInviteCode, resolveSetupTarget, type HearthInvite, type DeviceEnrollment, type ServerInfo, type Session, type RegistrationMode,type ServerSettings } from '@hearth/sdk'
import { AuthCrypto } from './crypto/client'
import { createIdentity, readIdentity, identityScope, identityStorageLabel, storageDeadline } from './crypto/vault-store'
import { RecoveryPanel } from './RecoveryPanel'
import { AdminPanel } from './AdminPanel'
import { ChatPanel } from './ChatPanel'
import { Modal } from './Modal'
import { Icon } from './Icons'
import { invoke, isTauri } from '@tauri-apps/api/core'

export function AuthPanel({ url, info, setupFinished,configured,onSessionChange,invite=null,onInviteChange }: { url: string; info: ServerInfo; setupFinished: () => void;configured:(settings:ServerSettings)=>void;onSessionChange:(signedIn:boolean)=>void;invite?:HearthInvite|null;onInviteChange?:(invite:HearthInvite|null)=>void }) {
  const [panel, setPanel] = useState<'account' | 'server' | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [created, setCreated] = useState(false)
  const [accountMode,setAccountMode] = useState<'auto'|'signup'|'signin'>('auto')
  const signup = accountMode === 'signup' || accountMode === 'auto' && !!invite?.account
  const [registrationMode,setRegistrationMode] = useState<RegistrationMode>('closed')
  const [registrationReady,setRegistrationReady] = useState(false)
  const [registrationError,setRegistrationError] = useState('')
  const [registrationAttempt,setRegistrationAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<DeviceEnrollment | null>(null)
  const [unlinked, setUnlinked] = useState(false)
  const [clientCrypto, setClientCrypto] = useState<AuthCrypto | null>(null)
  const unlocked = useRef<AuthCrypto | null>(null)
  const active = useRef<{ crypto: AuthCrypto; controller: AbortController } | null>(null)
  const localOwner = useRef<{ code: string; expires: number } | null>(null)
  const ownerRequest = useRef(0)
  const [ownerReady, setOwnerReady] = useState(false)
  function clearLocalOwner() { localOwner.current = null; setOwnerReady(false) }
  useEffect(() => () => { ownerRequest.current++; localOwner.current = null }, [])
  useEffect(() => {
    if (!ownerReady) return
    const timer = window.setTimeout(clearLocalOwner, Math.max(0, (localOwner.current?.expires ?? 0) - Date.now()))
    return () => window.clearTimeout(timer)
  }, [ownerReady])
  async function prepareLocalOwner() {
    const request = ++ownerRequest.current
    clearLocalOwner(); setError(''); setBusy(true)
    try {
      const code = await invoke<string>('host_owner_code', { server: url, serverKey: info.wellKnown.server_key })
      if (request !== ownerRequest.current) return
      if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Local owner setup is unavailable. Retry or use the manual setup code.')
      localOwner.current = { code, expires: Date.now() + 300_000 }; setOwnerReady(true)
    } catch (error) { if (request === ownerRequest.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (request === ownerRequest.current) setBusy(false) }
  }
  useEffect(() => { onSessionChange(!!session) }, [session,onSessionChange])
  const ownerSetup = !info.setup.setup_complete && !created
  const register = ownerSetup || signup
  useEffect(() => {
    if (ownerSetup) return
    const controller = new AbortController()
    void new HearthClient(url).registration({signal:controller.signal}).then(value => {
      if(!controller.signal.aborted){setRegistrationMode(value.registration_mode);setRegistrationReady(true);setRegistrationError('')}
    }).catch(() => {if(!controller.signal.aborted)setRegistrationError('Could not check whether this server accepts new accounts.')})
    return () => controller.abort()
  },[ownerSetup,url,registrationAttempt])
  useEffect(() => () => { active.current?.controller.abort(); active.current?.crypto.close(); unlocked.current?.close() }, [])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { unlocked.current?.close(); unlocked.current = null; setClientCrypto(null); setDevice(null); setSession(null); setError('Your session expired. Please sign in again.') }, session.expires_in_seconds * 1000)
    return () => clearTimeout(timer)
  }, [session])

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const username = String(data.get('username')).trim()
    let password = String(data.get('password'))
    let code = String(ownerSetup ? data.get('setup-code') ?? '' : signup && invite?.account ? invite.account : data.get('invite-code') ?? '').trim()
    let acceptedInvite=invite
    const confirmation = String(data.get('confirm-password') ?? '')
    setError('')
    if (signup && (!registrationReady || registrationMode === 'closed')) {setError('Ask the host to allow account creation, or sign in to an existing account.');return}
    setDevice(null); setUnlinked(false)
    if (register && (password.length < 12 || password !== confirmation)) { setError('Use at least 12 characters and enter the same password twice.'); return }
    if (password.length > 1024) { setError('Use a password of no more than 1024 characters.'); return }
    if (ownerSetup && ownerReady) {
      if (!localOwner.current || localOwner.current.expires <= Date.now()) { clearLocalOwner(); setError('Local owner setup expired. Choose Use this computer’s host again.'); return }
      code = localOwner.current.code
    }
    clearLocalOwner()
    // Password fields are uncontrolled, cleared before asynchronous work, and never saved.
    for (const name of ['password', 'confirm-password', 'setup-code','invite-code']) {
      const input = form.elements.namedItem(name)
      if (input instanceof HTMLInputElement) input.value = ''
    }
    const controller = new AbortController()
    let crypto: AuthCrypto | undefined
    let authenticated: Session | null = null
    let keepCrypto = false
    const client = new HearthClient(url)
    const options = { signal: controller.signal }
    setBusy(true)
    try {
      crypto = new AuthCrypto()
      active.current = { crypto, controller }
      const pinKey = `hearth.server-key:${client.baseUrl}`
      const serverId = info.wellKnown.server_key.toLowerCase()
      if(signup && code && !/^[a-f0-9]{64}$/.test(code)) {
        const resolved=/^hearth:/i.test(code)?(await resolveSetupTarget(code,options)).invite:await resolveInviteCode(url,code,options)
        if(!resolved?.account || resolved.server!==client.baseUrl || resolved.serverKey!==serverId)throw new Error('Use an account invite for this server. Ask the host for a new invite.')
        acceptedInvite=resolved;code=resolved.account
      }
      let pinned: string | null
      try { pinned = localStorage.getItem(pinKey) }
      catch { throw new Error('Allow site storage to remember this server’s identity before signing in.') }
      if (pinned && pinned !== serverId) throw new Error('This server’s identity changed. Contact its operator before signing in.')
      try { localStorage.setItem(pinKey, serverId) }
      catch { throw new Error('Allow site storage to remember this server’s identity before signing in.') }
      if (register) {
        const message = await crypto.request('registrationStart', password)
        const response = ownerSetup ? await client.ownerStart({ username, message, setup_code: code }, options) : await client.registerStart({username,message,invite_code:code || null},options)
        const upload = await crypto.request('registrationFinish', password, response.message, username, serverId)
        if (ownerSetup) {await client.ownerFinish({ username, message: upload, setup_code: code }, options);setCreated(true);setupFinished()}
        else {await client.registerFinish({username,message:upload,invite_code:code || null},options);setAccountMode('signin');if(acceptedInvite?.account)onInviteChange?.(acceptedInvite.community?{...acceptedInvite,account:undefined}:null)}
      }
      const message = await crypto.request('loginStart', password)
      const response = await client.loginStart({ username, message }, options)
      const proof = await crypto.request('loginFinish', password, response.message, username, serverId)
      const next = await client.loginFinish({ exchange_id: response.exchange_id, message: proof }, options)
      await client.session(next.token, options)
      authenticated = next
      const remote = await client.identity(next.token, options)
      const scope = identityScope(next.account.id, serverId)
      let saved = await storageDeadline(readIdentity(scope), controller.signal)
      if (!saved && remote.identity_key !== null) {
        // Authentication alone never grants another device the account's identity.
        setUnlinked(true)
        unlocked.current = crypto; keepCrypto = true
      } else {
        const prepare = async (envelope?: string) => JSON.parse(await crypto!.request('prepareIdentity', '', envelope, next.account.id, serverId)) as { envelope: string; enrollment: DeviceEnrollment }
        let prepared = await prepare(saved ?? undefined)
        if (!saved) {
          saved = await storageDeadline(createIdentity(scope, prepared.envelope), controller.signal)
          // Another tab/process may have won. Open its durable vault before enrollment.
          if (saved !== prepared.envelope) prepared = await prepare(saved)
        }
        if (controller.signal.aborted) throw controller.signal.reason
        const enrollment = prepared.enrollment
        if (remote.identity_key && remote.identity_key !== enrollment.identity_key) throw new Error('The server’s account identity changed. Your saved keys were preserved. Contact its operator before continuing.')
        const sameProof = (item: DeviceEnrollment) => (Object.keys(enrollment) as Array<keyof DeviceEnrollment>).every(key => item[key] === enrollment[key])
        if (remote.identity_key && !remote.devices.some(sameProof)) throw new Error('This device’s approval changed on the server. Your saved keys were preserved; use an approved device before continuing.')
        const accepted = await client.enrollFirstDevice(next.token, enrollment, options)
        if (!sameProof(accepted)) throw new Error('The server returned a different device identity. Your saved keys were preserved.')
        await crypto.request('commitIdentity', '')
        if (!controller.signal.aborted) {
          unlocked.current = crypto; keepCrypto = true; setDevice(enrollment)
        }
      }
      if (!controller.signal.aborted) {setSession(next);if (keepCrypto) setClientCrypto(crypto);if(invite?.account)onInviteChange?.(invite.community?{...invite,account:undefined}:null)}
    } catch (error) {
      if (!controller.signal.aborted) {
        if (authenticated) setSession(authenticated)
        setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.')
      }
    } finally {
      password = ''; code = ''; data.delete('password'); data.delete('confirm-password'); data.delete('setup-code');data.delete('invite-code')
      if (!keepCrypto) crypto?.close()
      if (!active.current || active.current.controller === controller) { active.current = null; setBusy(false) }
    }
  }
  async function signOut() {
    if (!session) return
    const token = session.token
    unlocked.current?.close(); unlocked.current = null; setDevice(null); setUnlinked(false)
    setClientCrypto(null)
    setSession(null)
    setError(''); setPanel(null)
    try { await new HearthClient(url).logout(token) }
    catch { setError('Signed out on this device. The server session could not be revoked; it expires within 24 hours.') }
  }
  const accountControls = <div className="account-controls">
    <div className="account-avatar">{session?.account.username.slice(0,2).toUpperCase()}</div>
    <div className="account-label"><strong>{session?.account.username}</strong><small>{session?.account.owner ? 'Server owner' : 'Signed in'}</small></div>
    <button className="icon-button" aria-label="Account & devices" title="Account & devices" onClick={() => setPanel('account')}><Icon name="settings" /></button>
  </div>
  if (session) return <div className="authenticated-shell">
    {clientCrypto && device ? <ChatPanel crypto={clientCrypto} session={session} device={device} server={info.wellKnown.server_key.toLowerCase()} url={url}
      invite={invite} onInviteDone={() => onInviteChange?.(null)}
      accountControls={accountControls} serverControls={session.account.owner ? <button className="sidebar-action" onClick={() => setPanel('server')}><Icon name="server" />Server settings</button> : null} /> :
      <section className="auth-screen"><h1>Finish linking this device</h1><p>{unlinked ? 'Sign-in worked. Link this install from an approved device or restore your recovery kit to open your messages.' : 'Your account is signed in, but its keys could not be unlocked. Resolve the storage or identity issue before continuing.'}</p>
        {clientCrypto && <RecoveryPanel crypto={clientCrypto} session={session} serverKey={info.wellKnown.server_key.toLowerCase()} url={url} ready={false} restored={enrollment => {setDevice(enrollment);setUnlinked(false)}} />}
        <button onClick={() => void signOut()}>Sign out</button></section>}
    {panel === 'account' && <Modal title="Account & devices" description="Keep your identity safe and connect your other devices." onClose={() => setPanel(null)}>
      <p>Signed in as <strong>{session.account.username}</strong>.</p>
      {device && <div className="device-status"><p className="device-ready">This device is ready.</p><small>{identityStorageLabel()} protects your account and device keys. Signing out locks them.</small>
        <details><summary>This device ID</summary><code>{device.device_key.match(/.{1,4}/g)?.join(' ')}</code><small>Use this ID when choosing which device will accept a community ownership transfer.</small></details><details><summary>Identity fingerprint</summary><code>{device.identity_key.match(/.{1,4}/g)?.join(' ')}</code><small>Compare this fingerprint with your friends using a trusted channel.</small></details></div>}
      {clientCrypto && <RecoveryPanel crypto={clientCrypto} session={session} serverKey={info.wellKnown.server_key.toLowerCase()} url={url} ready={!!device} restored={enrollment => {setDevice(enrollment);setUnlinked(false)}} />}
      <button className="danger-button" onClick={() => void signOut()}>Sign out</button>
    </Modal>}
    {panel === 'server' && session.account.owner && <Modal title="Server settings" description="Manage this server’s name and who can create an account. Community settings apply to each group separately." onClose={() => setPanel(null)}>
      <AdminPanel session={session} url={url} serverKey={info.wellKnown.server_key.toLowerCase()} configured={settings => {setRegistrationMode(settings.registration_mode);configured(settings)}} />
    </Modal>}
    {error && <p className="input-error workspace-error" role="alert">{error}</p>}
  </div>
  return <section className="auth-screen auth-panel" aria-labelledby="auth-heading">
    <div className="auth-intro"><p className="eyebrow">{info.wellKnown.server_name}</p><h1 id="auth-heading">{ownerSetup ? 'Set up your server' : signup ? 'Create your account' : 'Welcome back.'}</h1>
      <p>{ownerSetup ? isTauri() ? 'Create the first owner account. On the host computer, Hearth can authorize setup for you.' : 'Create the first owner account using the private setup code from your host.' : signup ? invite?.account ? 'Your invite includes what you need to create an account here.' : registrationMode === 'invite' ? 'Enter the account invite shared by this server’s owner. Community invites are used after signing in.' : 'Create an account on this server.' : 'Sign in to open your messages and communities.'}</p></div>
      {invite && <div className="pending-invite"><strong>Your invite is ready.</strong><p>{invite.community ? 'Sign in or create your account, then confirm joining the invited community. An approved member’s device may need to be online before encrypted channels open.' : 'Create your account with the included invite, or sign in to an existing account.'}</p><button type="button" disabled={busy} onClick={() => {onInviteChange?.(null);setAccountMode('signin')}}>Discard invite</button></div>}
      {!ownerSetup && registrationError && <p className="input-error" role="alert">{registrationError} <button type="button" onClick={()=>{setRegistrationError('');setRegistrationAttempt(value=>value+1)}}>Check again</button></p>}
      {signup && !registrationReady && !registrationError && <p role="status">Checking account registration…</p>}
      {signup && registrationReady && registrationMode === 'closed' && <p className="notice">This server is not accepting new accounts. Sign in below or ask its host to enable invitations.</p>}
      <form onSubmit={(event) => void authenticate(event)} aria-busy={busy}>
        <fieldset disabled={busy}>
          {ownerSetup && <>{isTauri() && <button type="button" className="local-owner-setup" onClick={() => void prepareLocalOwner()}>Use this computer’s host</button>}
            {ownerReady ? <><p className="notice" role="status">Local owner setup is ready. Create your account within five minutes. The private setup code stays in memory.</p><button type="button" onClick={clearLocalOwner}>Use a setup code instead</button></> : <><label htmlFor="setup-code">Setup code</label><input id="setup-code" name="setup-code" type="password" required minLength={64} maxLength={64} autoComplete="off" /><small>For a remote or manually managed host, use its private owner setup code. Keep it on the host computer.</small></>}</>}
          {signup && invite?.account ? <p className="notice">Account invite included.</p> : signup && registrationMode === 'invite' && <><label htmlFor="invite-code">Account invite or code</label><input id="invite-code" name="invite-code" type="password" required minLength={32} maxLength={2048} autoComplete="off"/><small>Paste the full Hearth invite or its 32-character code for this server.</small></>}
          <label htmlFor="username">Username</label><input id="username" name="username" required pattern="[a-z0-9_]{3,32}" minLength={3} maxLength={32} autoComplete="username" spellCheck={false} /><small>3–32 lowercase letters, numbers, or underscores.</small>
          <label htmlFor="password">Password</label><input id="password" name="password" type="password" required maxLength={1024} minLength={register ? 12 : 1} autoComplete={register ? 'new-password' : 'current-password'} />
          {register && <><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" name="confirm-password" type="password" required autoComplete="new-password" /></>}
          <button className="primary-button" type="submit" disabled={signup && (!registrationReady || registrationMode === 'closed')}>{busy ? 'Verifying…' : ownerSetup ? 'Create owner account' : signup ? 'Create account' : 'Sign in'}</button>
        </fieldset>
        {busy && <button className="retry-button" type="button" onClick={() => { ownerRequest.current++; clearLocalOwner(); active.current?.controller.abort(); active.current?.crypto.close(); if (!active.current) setBusy(false) }}>Cancel</button>}
      </form>
      {!ownerSetup && (registrationMode !== 'closed' || signup) && <button type="button" className="retry-button" disabled={busy} onClick={() => {setAccountMode(signup?'signin':'signup');setError('')}}>{signup ? 'Already have an account? Sign in' : 'Create an account'}</button>}
      <small>Your password stays on this device. Reloading or changing servers signs you out of this client.</small>

    {error && <p className="input-error" role="alert">{error}</p>}
  </section>
}
