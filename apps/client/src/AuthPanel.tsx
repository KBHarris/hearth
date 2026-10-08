import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, type DeviceEnrollment, type ServerInfo, type Session } from '@hearth/sdk'
import { AuthCrypto } from './crypto/client'
import { createIdentity, readIdentity, identityScope, identityStorageLabel, storageDeadline } from './crypto/vault-store'

export function AuthPanel({ url, info, setupFinished }: { url: string; info: ServerInfo; setupFinished: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [created, setCreated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [device, setDevice] = useState<DeviceEnrollment | null>(null)
  const [unlinked, setUnlinked] = useState(false)
  const unlocked = useRef<AuthCrypto | null>(null)
  const active = useRef<{ crypto: AuthCrypto; controller: AbortController } | null>(null)
  const register = !info.setup.setup_complete && !created
  useEffect(() => () => { active.current?.controller.abort(); active.current?.crypto.close(); unlocked.current?.close() }, [])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { unlocked.current?.close(); unlocked.current = null; setDevice(null); setSession(null); setError('Your session expired. Please sign in again.') }, session.expires_in_seconds * 1000)
    return () => clearTimeout(timer)
  }, [session])

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const username = String(data.get('username')).trim()
    let password = String(data.get('password'))
    let code = String(data.get('setup-code') ?? '').trim()
    const confirmation = String(data.get('confirm-password') ?? '')
    setError('')
    setDevice(null); setUnlinked(false)
    if (register && (password.length < 12 || password !== confirmation)) { setError('Use at least 12 characters and enter the same password twice.'); return }
    if (password.length > 1024) { setError('Use a password of no more than 1024 characters.'); return }
    // Password fields are uncontrolled, cleared before asynchronous work, and never saved.
    for (const name of ['password', 'confirm-password', 'setup-code']) {
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
      let pinned: string | null
      try { pinned = localStorage.getItem(pinKey) }
      catch { throw new Error('Allow site storage to remember this server’s identity before signing in.') }
      if (pinned && pinned !== serverId) throw new Error('This server’s identity changed. Contact its operator before signing in.')
      try { localStorage.setItem(pinKey, serverId) }
      catch { throw new Error('Allow site storage to remember this server’s identity before signing in.') }
      if (register) {
        const message = await crypto.request('registrationStart', password)
        const response = await client.ownerStart({ username, message, setup_code: code }, options)
        const upload = await crypto.request('registrationFinish', password, response.message, username, serverId)
        await client.ownerFinish({ username, message: upload, setup_code: code }, options)
        setCreated(true)
        setupFinished()
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
      if (!controller.signal.aborted) setSession(next)
    } catch (error) {
      if (!controller.signal.aborted) {
        if (authenticated) setSession(authenticated)
        setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.')
      }
    } finally {
      password = ''; code = ''; data.delete('password'); data.delete('confirm-password'); data.delete('setup-code')
      if (!keepCrypto) crypto?.close()
      if (!active.current || active.current.controller === controller) { active.current = null; setBusy(false) }
    }
  }
  async function signOut() {
    if (!session) return
    const token = session.token
    unlocked.current?.close(); unlocked.current = null; setDevice(null); setUnlinked(false)
    setSession(null)
    setError('')
    try { await new HearthClient(url).logout(token) }
    catch { setError('Signed out on this device. The server session could not be revoked; it expires within 24 hours.') }
  }
  return <section className="auth-panel" aria-labelledby="auth-heading">
    <h2 id="auth-heading">{session ? `Welcome, ${session.account.username}.` : register ? 'Set up your server' : 'Sign in'}</h2>
    {session ? <>
      <p>You’re signed in as the server owner. Messaging is coming in the next Phase 1 milestone.</p>
      {device && <div className="device-status">
        <p className="device-ready">This device is ready.</p>
        <small>{identityStorageLabel()} protects your account and device keys. Signing out locks them.</small>
        <details><summary>Identity fingerprint</summary><code>{device.identity_key.match(/.{1,4}/g)?.join(' ')}</code><small>Keep this fingerprint when checking your account’s identity.</small></details>
      </div>}
      {unlinked && <p className="input-error">This install isn’t linked to your account. Device linking and recovery are coming in the next milestone; a password login does not replace your identity.</p>}
      {!device && !unlinked && <p className="input-error">Your account is signed in, but its keys could not be unlocked. Sign out and try again after resolving the storage or identity issue below.</p>}
      <button className="retry-button" onClick={() => void signOut()}>Sign out</button>
    </> : <>
      <p>{register ? 'Create the owner account using the setup code from your server’s installer.' : 'Use your existing account on this server. Public registration is closed.'}</p>
      <form onSubmit={(event) => void authenticate(event)} aria-busy={busy}>
        <fieldset disabled={busy}>
          {register && <><label htmlFor="setup-code">Setup code</label><input id="setup-code" name="setup-code" type="password" required minLength={64} maxLength={64} autoComplete="off" /><small>Run the installer with --show-setup-code on the server to retrieve it.</small></>}
          <label htmlFor="username">Username</label><input id="username" name="username" required pattern="[a-z0-9_]{3,32}" minLength={3} maxLength={32} autoComplete="username" spellCheck={false} /><small>3–32 lowercase letters, numbers, or underscores.</small>
          <label htmlFor="password">Password</label><input id="password" name="password" type="password" required maxLength={1024} minLength={register ? 12 : 1} autoComplete={register ? 'new-password' : 'current-password'} />
          {register && <><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" name="confirm-password" type="password" required autoComplete="new-password" /></>}
          <button className="primary-button" type="submit">{busy ? 'Verifying…' : register ? 'Create owner account' : 'Sign in'}</button>
        </fieldset>
        {busy && <button className="retry-button" type="button" onClick={() => { active.current?.controller.abort(); active.current?.crypto.close() }}>Cancel</button>}
      </form>
      <small>Your password stays on this device. Reloading or changing servers signs you out of this client.</small>
    </>}
    {error && <p className="input-error" role="alert">{error}</p>}
  </section>
}
