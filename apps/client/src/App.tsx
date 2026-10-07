import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, HearthError, normalizeServerUrl, type ServerInfo } from '@hearth/sdk'
import './App.css'
import { AuthPanel } from './AuthPanel'

// Vite proxies the web origin to the development server. Packaged desktop builds
// need an actual server origin rather than the Tauri asset origin.
const defaultUrl = import.meta.env.VITE_HEARTH_SERVER_URL ??
  ('__TAURI_INTERNALS__' in window ? 'http://localhost:8080' : window.location.origin)
const storageKey = 'hearth.server-url'
type Status =
  | { kind: 'loading' }
  | { kind: 'ok'; info: ServerInfo }
  | { kind: 'error'; message: string; title: string }

function initialConnection() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return { url: normalizeServerUrl(saved), remembered: true, attempt: 0 }
  } catch {
    // Browsers can disable storage; connecting still works.
  }
  return { url: defaultUrl, remembered: false, attempt: 0 }
}

export default function App() {
  const [connection, setConnection] = useState(initialConnection)
  const [address, setAddress] = useState(connection.url)
  const [inputError, setInputError] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [remembered, setRemembered] = useState(connection.remembered)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    async function inspect() {
      try {
        const client = new HearthClient(connection.url)
        const info = await client.inspect({ signal: controller.signal })
        if (controller.signal.aborted) return
        setStatus({ kind: 'ok', info })
        try {
          localStorage.setItem(storageKey, client.baseUrl)
          setRemembered(true)
        } catch {
          setRemembered(false)
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const title = error instanceof HearthError && error.kind === 'incompatible' ? 'Update needed' :
          error instanceof HearthError && error.kind === 'degraded' ? 'Server needs attention' : 'Connection unsuccessful'
        setStatus({
          kind: 'error',
          title,
          message: error instanceof HearthError ? error.message : 'Could not connect. Please try again.',
        })
      }
    }
    void inspect()
    return () => controller.abort()
  }, [connection.url, connection.attempt])

  function connect(event: FormEvent) {
    event.preventDefault()
    try {
      const url = normalizeServerUrl(address)
      request.current?.abort()
      setInputError('')
      setAddress(url)
      setStatus({ kind: 'loading' })
      setConnection((previous) => ({ ...previous, url, attempt: previous.attempt + 1 }))
    } catch (error) {
      setInputError(error instanceof Error ? error.message : 'Enter a valid server address.')
      input.current?.focus()
    }
  }

  function forgetServer() {
    try {
      localStorage.removeItem(storageKey)
    } catch {
      // Storage may be disabled.
    }
    setRemembered(false)
    input.current?.focus()
  }

  function retry() {
    request.current?.abort()
    setStatus({ kind: 'loading' })
    setConnection((previous) => ({ ...previous, attempt: previous.attempt + 1 }))
  }

  function chooseServer() {
    input.current?.focus()
    input.current?.select()
  }

  const serverName = status.kind === 'ok' ? status.info.wellKnown.server_name : 'Your home server'

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main navigation">
        <button className="rail-item home" aria-label="Hearth home" aria-current="page" onClick={() => input.current?.focus()}>
          <Flame />
        </button>
        <div className="rail-divider" />
        <button className="rail-item add" aria-label="Choose a server" title="Choose a server" onClick={chooseServer}>
          <Icon name="plus" />
        </button>
        <span className="rail-bottom"><Icon name="shield" /></span>
      </nav>

      <aside className="sidebar">
        <header className="sidebar-header">
          <span>hearth<span className="brand-dot">.</span></span>
          <span className="preview-tag">PREVIEW</span>
        </header>
        <div className="sidebar-content">
          <p className="sidebar-label">GET STARTED</p>
          <button className="sidebar-link active" aria-current="page" onClick={() => input.current?.focus()}>
            <Icon name="server" /> Server connection <Icon name="chevron" />
          </button>
          <div className="sidebar-note"><span className={`dot ${status.kind}`} /><span>{serverName}</span></div>
        </div>
        <div className="sidebar-footer">
          <Icon name="shield" />
          <div>Your space. Your people.<small>Built for privacy and independence.</small></div>
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          <span><Icon name="home" /> Welcome home</span>
          <span className="phase-label">EARLY DEVELOPMENT</span>
        </header>
        <section className="welcome">
          <div className="welcome-mark"><Flame /></div>
          <p className="eyebrow">A PLACE TO BELONG</p>
          <h1>Make yourself at home.</h1>
          <p className="intro">
            A quieter corner of the internet, on a server you choose.<br className="desktop-break" />
            {' '}Start by connecting to your community’s Hearth server.
          </p>
          <div className="connection-card">
            <div className="card-heading">
              <span className="icon-box"><Icon name="server" /></span>
              <div><h2>Connect to a server</h2><p>Have an address? You’re in the right place.</p></div>
            </div>
            <form onSubmit={connect}>
              <label htmlFor="server-address">Server address</label>
              <div className="address-row">
                <input
                  ref={input}
                  id="server-address"
                  type="text"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  placeholder="chat.example.org"
                  value={address}
                  aria-invalid={Boolean(inputError)}
                  aria-describedby={inputError ? 'address-error' : 'address-help'}
                  onChange={(event) => { setAddress(event.target.value); setInputError('') }}
                />
                <button className="primary-button" type="submit">
                  {status.kind === 'loading' ? 'Check server' : 'Connect'}<Icon name="arrow" />
                </button>
              </div>
              {inputError ? (
                <p className="input-error" id="address-error" role="alert">{inputError}</p>
              ) : (
                <p className="input-help" id="address-help">Use your server’s web address. Local development supports HTTP.</p>
              )}
            </form>
            <div className="connection-status" aria-live="polite" aria-atomic="true" aria-busy={status.kind === 'loading'}>
              <ServerStatus status={status} url={connection.url} retry={retry} />
            </div>
            {status.kind === 'ok' && <ServerDetails info={status.info} />}
            {status.kind === 'ok' && <AuthPanel key={connection.url + connection.attempt} url={connection.url} info={status.info} setupFinished={() => setStatus({ kind: 'ok', info: { ...status.info, setup: { setup_complete: true } } })} />}
            <div className="storage-note">
              <span><Icon name="device" />{remembered ? 'Last working address saved on this device.' : 'A working address will be remembered on this device.'}</span>
              {remembered && <button type="button" onClick={forgetServer}>Forget address</button>}
            </div>
          </div>
          <div className="principles">
            <div><Icon name="shield" /><span>Privacy comes first</span></div>
            <div><Icon name="globe" /><span>Community owned</span></div>
            <div><Icon name="code" /><span>Open by design</span></div>
          </div>
          <p className="development-note">You’re trying an early build. Messaging, device linking, and recovery are still in development.</p>
        </section>
      </main>
    </div>
  )
}

function ServerStatus({ status, url, retry }: { status: Status; url: string; retry: () => void }) {
  if (status.kind === 'loading') {
    return <div className="status loading"><span className="spinner" /><div><strong>Checking your server…</strong><p>{url}</p></div></div>
  }
  if (status.kind === 'error') {
    return (
      <div className="status error">
        <Icon name="alert" />
        <div>
          <strong>{status.title}</strong>
          <p>{status.message}</p>
          <small className="checked-address">Checked {url}</small>
          <button className="retry-button" type="button" onClick={retry}>Try again <Icon name="refresh" /></button>
        </div>
      </div>
    )
  }
  return (
    <div className="status ok">
      <Icon name="check" />
      <div>
        <strong>Server connection verified</strong>
        <p>{status.info.wellKnown.server_name} is reachable and compatible with this client.</p>
        <small className="checked-address">Checked {url}</small>
      </div>
    </div>
  )
}

function ServerDetails({ info }: { info: ServerInfo }) {
  return (
    <div className="server-details">
      <dl>
        <div><dt>Server version</dt><dd>{info.health.version}</dd></div>
        <div><dt>Protocol</dt><dd>v{info.health.protocol}</dd></div>
        <div><dt>Federation setting</dt><dd>{info.wellKnown.federation ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Owner setup</dt><dd>{info.setup.setup_complete ? 'Complete' : 'Not complete'}</dd></div>
      </dl>
      {!info.setup.setup_complete && <p className="setup-note">Create the owner account below to complete this server’s setup.</p>}
      <details>
        <summary>Server signing key</summary>
        <p>This is the public key advertised by the server. It has not been independently verified.</p>
        <code>{info.wellKnown.server_key}</code>
      </details>
    </div>
  )
}

function Flame() {
  return (
    <svg viewBox="0 0 32 40" fill="none" aria-hidden="true">
      <path d="M18 2C19 13 30 15 29 25C28 33 23 38 15 38C7 38 2 32 3 24C4 17 10 14 11 8C15 11 15 16 15 16C19 12 18 2 18 2Z" fill="currentColor" />
      <path d="M17 21C18 26 22 27 21 31C20 35 16 36 13 34C9 32 11 28 13 26C13 30 17 29 17 21Z" fill="var(--flame-core)" />
    </svg>
  )
}

const paths = {
  server: 'M4 4h16v6H4z M4 14h16v6H4z M7 7h.01 M7 17h.01 M11 7h6 M11 17h6',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6',
  arrow: 'M4 12h16 M14 6l6 6-6 6',
  chevron: 'm9 6 6 6-6 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18',
  code: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  home: 'm3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9',
  device: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  plus: 'M12 5v14 M5 12h14',
  check: 'm5 12 4 4L19 6',
  alert: 'M12 3 2 21h20z M12 9v5 M12 17h.01',
  refresh: 'M20 8a8 8 0 1 0 1 7 M20 3v5h-5',
}

function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}
