import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, HearthError, normalizeServerUrl, type ServerInfo } from '@hearth/sdk'
import './App.css'
import './Workspace.css'
import { AuthPanel } from './AuthPanel'
import { Modal } from './Modal'
import { Flame, Icon } from './Icons'

const defaultUrl = import.meta.env.VITE_HEARTH_SERVER_URL ??
  ('__TAURI_INTERNALS__' in window ? 'http://localhost:8080' : window.location.origin)
const storageKey = 'hearth.server-url'
const serversKey = 'hearth.saved-servers'
type SavedServer = { url: string; name: string }
type Status = { kind: 'loading' } | { kind: 'ok'; info: ServerInfo } | { kind: 'error'; message: string }
function savedServers(): SavedServer[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(serversKey) ?? '[]')
    if (!Array.isArray(entries)) return []
    return entries.filter((entry): entry is SavedServer => !!entry && typeof entry.url === 'string' && typeof entry.name === 'string')
      .flatMap(entry => { try { return [{ url: normalizeServerUrl(entry.url), name: entry.name }] } catch { return [] } })
      .filter((entry, index, all) => all.findIndex(item => item.url === entry.url) === index)
  } catch { return [] }
}
function initialUrl() {
  try { const saved = localStorage.getItem(storageKey); if (saved) return normalizeServerUrl(saved) } catch { /* Storage is optional for discovery. */ }
  return defaultUrl
}
function connectionError(error: unknown) {
  return error instanceof HearthError || error instanceof Error ? error.message : 'Could not connect. Check the address and try again.'
}

export default function App() {
  const [url, setUrl] = useState(initialUrl)
  const [servers, setServers] = useState(savedServers)
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [panel, setPanel] = useState<'add' | 'connection' | null>(null)
  const [address, setAddress] = useState(url)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const candidate = useRef<AbortController | null>(null)
  function remember(nextUrl: string, name: string) {
    setServers(previous => {
      const next = [...previous.filter(item => item.url !== nextUrl), { url: nextUrl, name }]
      try { localStorage.setItem(serversKey, JSON.stringify(next)); localStorage.setItem(storageKey, nextUrl) } catch { /* Connecting still works without address storage. */ }
      return next
    })
  }
  useEffect(() => {
    const controller = new AbortController()
    void new HearthClient(url).inspect({ signal: controller.signal }).then(info => {
      if (controller.signal.aborted) return
      setStatus({ kind: 'ok', info }); remember(url, info.wellKnown.server_name)
    }).catch(error => { if (!controller.signal.aborted) setStatus({ kind: 'error', message: connectionError(error) }) })
    return () => controller.abort()
  }, [url, attempt])
  useEffect(() => () => candidate.current?.abort(), [])
  function openConnection(kind: 'add' | 'connection', next = url) {
    candidate.current?.abort(); setChecking(false); setError(''); setAddress(kind === 'add' && next === url ? '' : next); setPanel(kind)
  }
  function closePanel() { candidate.current?.abort(); setChecking(false); setPanel(null) }
  async function connect(event: FormEvent) {
    event.preventDefault(); candidate.current?.abort()
    const controller = new AbortController(); candidate.current = controller
    setError(''); setChecking(true)
    try {
      const nextUrl = normalizeServerUrl(address)
      const info = await new HearthClient(nextUrl).inspect({ signal: controller.signal })
      if (controller.signal.aborted) return
      if (nextUrl === url && status.kind === 'ok' && info.wellKnown.server_key.toLowerCase() !== status.info.wellKnown.server_key.toLowerCase()) throw new Error('This server’s identity changed. Contact its host before reconnecting. Your current session and saved keys were preserved.')
      remember(nextUrl, info.wellKnown.server_name)
      if (nextUrl !== url) setSignedIn(false)
      setUrl(nextUrl); setStatus({ kind: 'ok', info }); setAddress(nextUrl); setPanel(null)
    } catch (error) { if (!controller.signal.aborted) setError(connectionError(error)) }
    finally { if (!controller.signal.aborted) setChecking(false) }
  }
  function forgetServer() {
    setServers(previous => {
      const next = previous.filter(item => item.url !== url)
      try { localStorage.setItem(serversKey, JSON.stringify(next)); localStorage.removeItem(storageKey) } catch { /* Storage may be disabled. */ }
      return next
    })
  }
  const name = status.kind === 'ok' ? status.info.wellKnown.server_name : 'Your server'
  return <div className="app-shell">
    <nav className="server-rail" aria-label="Servers">
      <div className="rail-brand" title="Hearth"><Flame /></div>
      <div className="rail-divider" />
      {servers.map(server => <button key={server.url} className={`server-tile ${url === server.url ? 'selected' : ''}`}
        aria-label={`Open server ${server.name}`} aria-current={url === server.url ? 'page' : undefined} title={server.name}
        onClick={() => openConnection('connection', server.url)}>{server.name.slice(0, 2).toUpperCase()}</button>)}
      <button className="server-tile add-server" aria-label="Add server" title="Add server" onClick={() => openConnection('add')}><Icon name="plus" /></button>
      <span className="rail-bottom" title="Messages are encrypted"><Icon name="shield" /></span>
    </nav>
    <main className="app-main">
      <header className="app-header"><div className="app-brand">hearth<span className="brand-dot">.</span><span className="preview-tag">PREVIEW</span></div>
        <button className="server-connection-button" onClick={() => openConnection('connection')}><span className={`dot ${status.kind}`} />{name}<Icon name="chevron" /></button>
      </header>
      {status.kind === 'ok' ? <AuthPanel key={url} url={url} info={status.info} onSessionChange={setSignedIn}
        setupFinished={() => setStatus({ kind: 'ok', info: { ...status.info, setup: { setup_complete: true } } })}
        configured={settings => { remember(url, settings.server_name); setStatus({ kind: 'ok', info: { ...status.info, wellKnown: { ...status.info.wellKnown, server_name: settings.server_name } } }) }} /> :
        <section className="connection-screen"><Icon name="server" /><h1>{status.kind === 'loading' ? 'Connecting to your server…' : 'Let’s get you connected.'}</h1>
          <p role={status.kind === 'error' ? 'alert' : 'status'}>{status.kind === 'error' ? status.message : 'Checking that this server is ready for Hearth.'}</p>
          <p className="muted">{url}</p><div className="button-row"><button className="primary-button" onClick={() => openConnection('connection')}>Choose server</button>
            {status.kind === 'error' && <button onClick={() => { setStatus({ kind: 'loading' }); setAttempt(value => value + 1) }}>Try again</button>}</div>
        </section>}
    </main>
    {panel && <Modal title={panel === 'add' ? 'Add a server' : 'Server connection'} onClose={closePanel}
      description="A server is the home for your account and communities. Enter the address shared by its host.">
      <form onSubmit={event => void connect(event)} className="connection-form" aria-busy={checking}>
        <label htmlFor="server-address">Server address</label><input id="server-address" type="text" inputMode="url" autoComplete="url" spellCheck={false}
          placeholder="https://chat.example.org" value={address} required autoFocus aria-invalid={!!error} aria-describedby="address-help"
          onChange={event => { setAddress(event.target.value); setError('') }} disabled={checking} />
        <small id="address-help">Use a domain or public IP address. Include the port if your host gave you one.</small>
        {signedIn && <p className="notice">Switching to a different server signs you out here. Your saved keys and messages stay on this device.</p>}
        {error && <p className="input-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={checking}>{checking ? 'Checking server…' : 'Connect'}</button>
      </form>
      {panel === 'connection' && status.kind === 'ok' && <details className="connection-details"><summary>About the current server</summary>
        <dl><div><dt>Name</dt><dd>{name}</dd></div><div><dt>Address</dt><dd>{url}</dd></div><div><dt>Version</dt><dd>{status.info.health.version}</dd></div></dl>
        <details><summary>Server identity</summary><p>Compare this public key with your host using a trusted channel.</p><code>{status.info.wellKnown.server_key}</code></details>
        {servers.some(item => item.url === url) && <button type="button" onClick={forgetServer}>Forget saved address</button>}
      </details>}
    </Modal>}
  </div>
}
