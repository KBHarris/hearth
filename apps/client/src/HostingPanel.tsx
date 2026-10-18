import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { HearthClient } from '@hearth/sdk'

type HostStatus = { folder: string | null; https: boolean; state: string; message: string; local_url: string | null; public_address: string | null }
type UpdateStatus = { available: boolean; version: string | null; message: string }
export function HostingPanel({ onConnect }: { onConnect: (address: string) => void }) {
  const [host, setHost] = useState<HostStatus | null>(null)
  const [https, setHttps] = useState(true)
  const [publicAddress, setPublicAddress] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appUpdate, setAppUpdate] = useState<UpdateStatus | null>(null)
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null)
  const [confirm, setConfirm] = useState<'stop' | 'restore' | null>(null)
  const [setupCode, setSetupCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  useEffect(() => {
    let active = true
    void invoke<HostStatus>('host_control', { action: 'status' }).then(status => { if (active) { setHost(status); setHttps(status.https); setPublicAddress(status.public_address ?? ''); setMessage(status.message) } })
      .catch(() => { /* Choose a package before its first start. Explicit refresh reports errors. */ })
    return () => { active = false }
  }, [])
  async function perform(label: string, action: () => Promise<void>) {
    setBusy(label); setError(''); setMessage(''); setConfirm(null); setSetupCode(''); setShowCode(false)
    try { await action() }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy('') }
  }
  async function control(action: 'start' | 'stop' | 'status') {
    await perform(action === 'start' ? 'Starting server…' : action === 'stop' ? 'Stopping server…' : 'Checking status…', async () => {
      const next = await invoke<HostStatus>('host_control', { action }); setHost(next); setMessage(next.message)
    })
  }
  async function checkUpdates() {
    await perform('Checking updates…', async () => {
      const [app, server] = await Promise.allSettled([
        invoke<UpdateStatus>('desktop_update', { install: false, expectedVersion: null }),
        host?.folder ? invoke<UpdateStatus>('server_update', { install: false, expectedVersion: null }) : Promise.resolve(null),
      ])
      setAppUpdate(app.status === 'fulfilled' ? app.value : null)
      setServerUpdate(server.status === 'fulfilled' ? server.value : null)
      const errors = [app, server].filter((value): value is PromiseRejectedResult => value.status === 'rejected').map(value => String(value.reason))
      if (errors.length) setError(errors.join(' '))
    })
  }
  async function checkPublicHttps() {
    if (!host?.public_address || !host.local_url) return
    await perform('Checking public HTTPS…', async () => {
      const [remote, local] = await Promise.all([new HearthClient('https://' + host.public_address).inspect(), new HearthClient(host.local_url!).wellKnown()])
      if (remote.wellKnown.server_key.toLowerCase() !== local.server_key.toLowerCase()) throw new Error('The public address points to a different Hearth server. Check your address and router settings before sharing it.')
      setMessage('Trusted HTTPS and the matching server identity were verified from this PC. Access from another network is still unverified.')
    })
  }
  async function update(kind: 'desktop' | 'server', version: string) {
    await perform(kind === 'server' ? 'Backing up and updating server…' : 'Downloading and installing app update…', async () => {
      const result = await invoke<UpdateStatus>(`${kind}_update`, { install: true, expectedVersion: version })
      setMessage(result.message)
      if (kind === 'desktop') setAppUpdate(null)
      else { setServerUpdate(null); setHost(await invoke<HostStatus>('host_control', { action: 'status' })) }
    })
  }
  return <div className="hosting-panel" aria-busy={!!busy}>
    <section aria-labelledby="local-host-heading"><h2 id="local-host-heading">Local hosting</h2>
      <p>Choose the extracted Hearth host package on this computer. Docker Desktop must be installed and running.</p>
      <label className="checkbox-label"><input type="checkbox" checked={https} disabled={!!busy} onChange={event => { setHttps(event.target.checked); setSettingsDirty(true) }} />Use the package’s public HTTPS configuration</label>
      {https && <><label htmlFor="host-public-address">Public IPv4 address or DNS name</label><input id="host-public-address" value={publicAddress} onChange={event => { setPublicAddress(event.target.value); setSettingsDirty(true) }} placeholder="chat.example.org" autoComplete="off" disabled={!!busy} /><small>Use your router’s public address. HTTPS needs ports 80 and 443 forwarded to this computer. Access from another network still needs to be tested.</small></>}
      <button disabled={!!busy} onClick={() => void perform('Choosing host package…', async () => {
        const next = await invoke<HostStatus | null>('host_select', { https, publicAddressInput: publicAddress || null }); if (next) { setHost(next); setSettingsDirty(false); setServerUpdate(null) }
      })}>{host?.folder ? 'Change host package' : 'Choose host package'}</button>
      {host?.folder && <><p className="host-folder">{host.folder}</p><p><strong>{host.state === 'running' ? 'Running' : host.state === 'stopped' ? 'Stopped' : host.state === 'partial' ? 'Partly running' : host.state === 'error' ? 'Needs attention' : 'Ready to start'}</strong></p>
        {settingsDirty && <button disabled={!!busy} onClick={() => void perform('Saving host settings…', async () => { setHost(await invoke<HostStatus>('host_configure', { https, publicAddressInput: publicAddress || null })); setSettingsDirty(false) })}>Save host settings</button>}
        <div className="button-row"><button disabled={!!busy || settingsDirty} onClick={() => void control('start')}>Start server</button><button disabled={!!busy} onClick={() => setConfirm('stop')}>Stop server</button><button disabled={!!busy} onClick={() => void control('status')}>Refresh status</button></div>
        {host.local_url && <button disabled={!!busy} onClick={() => onConnect(host.local_url!)}>Connect to local server</button>}
        {host.https && host.public_address && <><div className="button-row"><button disabled={!!busy || settingsDirty} onClick={() => void checkPublicHttps()}>Check public HTTPS</button><button disabled={!!busy || settingsDirty} onClick={() => onConnect('https://' + host.public_address)}>Connect to public server</button></div><small>You can stay connected locally and create pretty codes for your public address. If public HTTPS fails only from home, check from another network; some routers do not support loopback.</small></>}
        <small>Hosting continues when you close Hearth. Stop server stops hosting for everyone; your data stays on this computer.</small>
        <details><summary>Owner setup</summary><p>Retrieve the protected setup code for this local host when creating its first owner account.</p>
          <button disabled={!!busy} onClick={() => void perform('Retrieving setup code…', async () => { setSetupCode(await invoke<string>('host_setup_code')) })}>Get owner setup code</button>
          {setupCode && <><label htmlFor="local-owner-code">Owner setup code</label><input id="local-owner-code" type={showCode ? 'text' : 'password'} readOnly value={setupCode} onFocus={event => event.currentTarget.select()} autoComplete="off" /><button onClick={() => setShowCode(value => !value)}>{showCode ? 'Hide code' : 'Show code'}</button><small>Keep this code private. It is cleared when this panel closes.</small></>}
        </details></>}
    </section>
    <section aria-labelledby="update-heading"><h2 id="update-heading">Updates</h2><p>Install verified releases from Hearth’s public GitHub repository.</p>
      <button disabled={!!busy} onClick={() => void checkUpdates()}>Check for updates</button>
      {appUpdate && <div><p>{appUpdate.message}</p>{appUpdate.available && appUpdate.version && <button disabled={!!busy} onClick={() => void update('desktop', appUpdate.version!)}>Update app</button>}</div>}
      {serverUpdate && <div><p>{serverUpdate.message}</p>{serverUpdate.available && serverUpdate.version && <><p>Hosting will pause while a verified backup is made. It restarts after the update; a failed start restores the previous server.</p><button disabled={!!busy} onClick={() => void update('server', serverUpdate.version!)}>Update hosted server</button></>}</div>}
      {host?.folder && <button disabled={!!busy} onClick={() => setConfirm('restore')}>Restore last backup</button>}
    </section>
    {confirm && <div className="notice"><p>{confirm === 'stop' ? 'Stop hosting for everyone on this server?' : 'Restore the last server backup? This replaces changes made since that backup, including new messages and files.'}</p>
      <button onClick={() => confirm === 'stop' ? void control('stop') : void perform('Restoring previous server…', async () => { setMessage(await invoke<string>('host_rollback')); setHost(await invoke<HostStatus>('host_control', { action: 'status' })) })}>{confirm === 'stop' ? 'Stop hosting' : 'Restore backup'}</button><button onClick={() => setConfirm(null)}>Cancel</button></div>}
    {busy && <p role="status">{busy}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="input-error">{error}</p>}
  </div>
}
