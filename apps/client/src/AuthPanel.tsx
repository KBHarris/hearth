import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, type ServerInfo, type Session } from '@hearth/sdk'
import { AuthCrypto } from './crypto/client'

export function AuthPanel({ url, info, setupFinished }: { url: string; info: ServerInfo; setupFinished: () => void }) {
  const [session, setSession] = useState<Session | null>(null)
  const [created, setCreated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = useRef<{ crypto: AuthCrypto; controller: AbortController } | null>(null)
  const register = !info.setup.setup_complete && !created
  useEffect(() => () => { active.current?.controller.abort(); active.current?.crypto.close() }, [])
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => { setSession(null); setError('Your session expired. Please sign in again.') }, session.expires_in_seconds * 1000)
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
    if (register && (password.length < 12 || password !== confirmation)) { setError('Use at least 12 characters and enter the same password twice.'); return }
    if (password.length > 1024) { setError('Use a password of no more than 1024 characters.'); return }
    // Password fields are uncontrolled, cleared before asynchronous work, and never saved.
    for (const name of ['password', 'confirm-password', 'setup-code']) {
      const input = form.elements.namedItem(name)
      if (input instanceof HTMLInputElement) input.value = ''
    }
    const controller = new AbortController()
    let crypto: AuthCrypto | undefined
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
      if (!controller.signal.aborted) setSession(next)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not sign in. Please try again.')
    } finally {
      password = ''; code = ''; data.delete('password'); data.delete('confirm-password'); data.delete('setup-code')
      crypto?.close()
      if (!active.current || active.current.controller === controller) { active.current = null; setBusy(false) }
    }
  }
  async function signOut() {
    if (!session) return
    const token = session.token
    setSession(null)
    setError('')
    try { await new HearthClient(url).logout(token) }
    catch { setError('Signed out on this device. The server session could not be revoked; it expires within 24 hours.') }
  }
  return <section className="auth-panel" aria-labelledby="auth-heading">
    <h2 id="auth-heading">{session ? `Welcome, ${session.account.username}.` : register ? 'Set up your server' : 'Sign in'}</h2>
    {session ? <>
      <p>You’re signed in as the server owner. Messaging is coming in the next Phase 1 milestone.</p>
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
