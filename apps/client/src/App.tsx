import { useEffect, useState } from 'react'
import { HearthClient, PROTOCOL_VERSION, type Health } from '@hearth/sdk'
import './App.css'

// In dev, Vite proxies /health and /api to the local server (see vite.config.ts).
// The desktop build talks to the server URL directly.
const serverUrl = import.meta.env.VITE_HEARTH_SERVER_URL ?? window.location.origin
const client = new HearthClient(serverUrl)

type Status = { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string }

export default function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    client
      .health()
      .then((health) => setStatus({ kind: 'ok', health }))
      .catch((e: unknown) => setStatus({ kind: 'error', message: String(e) }))
  }, [])

  return (
    <div className="shell">
      <nav className="rail" aria-label="Communities">
        <div className="rail-item home" title="Direct messages">H</div>
        <div className="rail-divider" />
        <button className="rail-item add" title="Join or create a community" disabled>
          +
        </button>
      </nav>

      <aside className="sidebar">
        <header className="sidebar-header">Direct Messages</header>
        <p className="empty">No conversations yet.</p>
      </aside>

      <main className="main">
        <header className="main-header"># welcome</header>
        <section className="welcome">
          <h1>Welcome to Hearth</h1>
          <p>Private, self-hosted community chat. Everything you send is end-to-end encrypted.</p>
          <ServerStatus status={status} />
        </section>
      </main>
    </div>
  )
}

function ServerStatus({ status }: { status: Status }) {
  if (status.kind === 'loading') return <p className="status">Connecting to {serverUrl}…</p>
  if (status.kind === 'error') {
    return (
      <p className="status err">
        Server unreachable at {serverUrl} ({status.message})
      </p>
    )
  }
  const { health } = status
  const compatible = health.protocol === PROTOCOL_VERSION
  return (
    <p className={`status ${health.status === 'ok' && compatible ? 'ok' : 'warn'}`}>
      Server {health.version} · protocol v{health.protocol}
      {compatible ? '' : ` (client speaks v${PROTOCOL_VERSION})`} · {health.status}
    </p>
  )
}
