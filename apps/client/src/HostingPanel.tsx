import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { HearthClient } from '@hearth/sdk'
import { NetworkCheckPanel } from './NetworkCheckPanel'

type HostStatus = { folder: string | null; https: boolean; state: string; message: string; local_url: string | null; public_address: string | null }
type UpdateStatus = { available: boolean; version: string | null; message: string }
export function HostingPanel({ onConnect }: { onConnect: (address: string) => void }) {
  const [host, setHost] = useState<HostStatus | null>(null)
  const [https, setHttps] = useState(true)
  const [publicAddress, setPublicAddress] = useState('')
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [busy, setBusy] = useState('Checking saved host…')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appUpdate, setAppUpdate] = useState<UpdateStatus | null>(null)
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null)
  const [media,setMedia]=useState<{enabled:boolean;message:string}|null>(null)
  const [confirm, setConfirm] = useState<'stop' | 'restore' | 'backup-export' | 'backup-import' | 'runtime' | null>(null)
  const [runtime, setRuntime] = useState<{ ready: boolean; message: string } | null>(null)
  const [startup, setStartup] = useState<{ enabled: boolean; message: string } | null>(null)
  const [setupCode, setSetupCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  useEffect(() => {
    if (host) window.dispatchEvent(new Event('hearth:host-changed'))
  }, [host])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const saved = await invoke<HostStatus | null>('host_saved')
        if (!active) return
        if (saved) {
          setHost(saved); setHttps(saved.https); setPublicAddress(saved.public_address ?? ''); setMessage(saved.message)
          const status = await invoke<HostStatus>('host_control', { action: 'status' })
          if (active) { setHost(status); setMessage(status.message) }
        }
      } catch (error) { if (active) setError(String(error)) }
      finally { if (active) setBusy('') }
    })()
    void invoke<typeof startup>('host_startup', { enabled: null }).then(value => { if (active) setStartup(value) }).catch(error => { if (active) setError(String(error)) })
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
      <p>Prepare a signed host package and its runtime, then start your server. Existing selections and server data are kept when you retry.</p>
      {!host?.folder && <button disabled={!!busy} onClick={() => void perform('Preparing signed host package…', async () => { const next = await invoke<HostStatus>('host_prepare'); setHost(next); setHttps(next.https); setPublicAddress(next.public_address ?? ''); setSettingsDirty(false); setMessage(next.message) })}>Prepare this computer to host</button>}
      <div className="button-row"><button disabled={!!busy} onClick={() => void perform('Checking hosting runtime…', async () => { setRuntime(await invoke('host_runtime', { action: 'status' })) })}>Check runtime</button><button disabled={!!busy || runtime?.ready} onClick={() => setConfirm('runtime')}>Install hosting runtime</button><button disabled={!!busy} onClick={() => void perform('Opening hosting runtime…', async () => { setRuntime(await invoke('host_runtime', { action: 'start' })) })}>Open hosting runtime</button></div>
      {runtime && <p role="status">{runtime.message}</p>}
      <label className="checkbox-label"><input type="checkbox" checked={https} disabled={!!busy} onChange={event => { setHttps(event.target.checked); setSettingsDirty(true) }} />Use the package’s public HTTPS configuration</label>
      {https && <><label htmlFor="host-public-address">Public IPv4 address or DNS name</label><input id="host-public-address" value={publicAddress} onChange={event => { setPublicAddress(event.target.value); setSettingsDirty(true) }} placeholder="chat.example.org" autoComplete="off" disabled={!!busy} /><small>Use your router’s public address. HTTPS needs ports 80 and 443 forwarded to this computer. Access from another network still needs to be tested.</small></>}
      <button disabled={!!busy} onClick={() => void perform('Choosing host package…', async () => {
        const next = await invoke<HostStatus | null>('host_select', { https, publicAddressInput: publicAddress || null }); if (next) { setHost(next); setSettingsDirty(false); setServerUpdate(null) }
      })}>{host?.folder ? 'Change host package' : 'Choose host package'}</button>
      {!host?.folder && <button disabled={!!busy} onClick={() => void control('status')}>Retry saved host lookup</button>}
      {host?.folder && <><p className="host-folder">{host.folder}</p><p><strong>{host.state === 'running' ? 'Running' : host.state === 'stopped' ? 'Stopped' : host.state === 'partial' ? 'Partly running' : host.state === 'error' ? 'Needs attention' : 'Ready to start'}</strong></p>
        {settingsDirty && <button disabled={!!busy} onClick={() => void perform('Saving host settings…', async () => { setHost(await invoke<HostStatus>('host_configure', { https, publicAddressInput: publicAddress || null })); setSettingsDirty(false) })}>Save host settings</button>}
        <div className="button-row"><button disabled={!!busy || settingsDirty} onClick={() => void control('start')}>Start server</button><button disabled={!!busy} onClick={() => setConfirm('stop')}>Stop server</button><button disabled={!!busy} onClick={() => void control('status')}>Refresh status</button></div>
        {host.local_url && <button disabled={!!busy} onClick={() => onConnect(host.local_url!)}>Connect to local server</button>}
        {host.https && host.public_address && <><div className="button-row"><button disabled={!!busy || settingsDirty} onClick={() => void checkPublicHttps()}>Check public HTTPS</button><button disabled={!!busy || settingsDirty} onClick={() => onConnect('https://' + host.public_address)}>Connect to public server</button></div><small>You can stay connected locally and create pretty codes for your public address. If public HTTPS fails only from home, check from another network; some routers do not support loopback.</small></>}
        <small>Hosting continues when you close Hearth. Stop server stops hosting for everyone; your data stays on this computer.</small>
        <label className="checkbox-label"><input type="checkbox" checked={startup?.enabled ?? false} disabled={!!busy || !startup} onChange={event => { const enabled = event.target.checked; void perform('Saving startup preference…', async () => { setStartup(await invoke('host_startup', { enabled })) }) }} />Start this host when I sign in</label>
        {startup && <small>{startup.message}</small>}
        <details><summary>Owner setup</summary><p>Retrieve the protected setup code for this local host when creating its first owner account.</p>
          <button disabled={!!busy} onClick={() => void perform('Retrieving setup code…', async () => { setSetupCode(await invoke<string>('host_setup_code')) })}>Get owner setup code</button>
          {setupCode && <><label htmlFor="local-owner-code">Owner setup code</label><input id="local-owner-code" type={showCode ? 'text' : 'password'} readOnly value={setupCode} onFocus={event => event.currentTarget.select()} autoComplete="off" /><button onClick={() => setShowCode(value => !value)}>{showCode ? 'Hide code' : 'Show code'}</button><small>Keep this code private. It is cleared when this panel closes.</small></>}
        </details></>}
    </section>
    {host?.folder&&<section aria-labelledby="media-host-heading"><h2 id="media-host-heading">Voice and video hosting</h2><p>Run encrypted community rooms and a call relay on this computer. Media keys stay with participants. Enabling this starts two additional Docker services.</p>
      <div className="button-row"><button disabled={!!busy||settingsDirty} onClick={()=>void perform('Checking media hosting…',async()=>setMedia(await invoke('host_media',{action:'status'})))}>Check media hosting</button><button disabled={!!busy||settingsDirty||media?.enabled} onClick={()=>void perform('Preparing voice and video hosting…',async()=>setMedia(await invoke('host_media',{action:'enable'})))}>Enable voice and video</button>{media?.enabled&&<button disabled={!!busy} onClick={()=>void perform('Stopping media hosting…',async()=>setMedia(await invoke('host_media',{action:'disable'})))}>Disable media hosting</button>}</div>
      {media&&<p role="status">{media.message}</p>}
    </section>}
    <NetworkCheckPanel localUrl={host?.local_url} publicAddress={host?.public_address} />
    <section aria-labelledby="update-heading"><h2 id="update-heading">Updates</h2><p>Install verified releases from Hearth’s public GitHub repository.</p>
      <button disabled={!!busy} onClick={() => void checkUpdates()}>Check for updates</button>
      {appUpdate && <div><p>{appUpdate.message}</p>{appUpdate.available && appUpdate.version && <button disabled={!!busy} onClick={() => void update('desktop', appUpdate.version!)}>Update app</button>}</div>}
      {serverUpdate && <div><p>{serverUpdate.message}</p>{serverUpdate.available && serverUpdate.version && <><p>Hosting will pause while a verified backup is made. It restarts after the update; a failed start restores the previous server.</p><button disabled={!!busy} onClick={() => void update('server', serverUpdate.version!)}>Update hosted server</button></>}</div>}
      {host?.folder && <button disabled={!!busy} onClick={() => setConfirm('restore')}>Restore last backup</button>}
      {host?.folder && <button disabled={!!busy} onClick={() => setConfirm('backup-export')}>Export server backup</button>}
      <button disabled={!!busy} onClick={() => setConfirm('backup-import')}>Restore server onto this computer</button>
    </section>
    {confirm && <div className="notice"><p>{confirm === 'stop' ? 'Stop hosting for everyone on this server?' : confirm === 'runtime' ? 'Install Docker Desktop using the operating system’s installer? This requires downloads, available virtualization and your consent to Docker’s terms. Your OS may request administrator access or a restart. Hearth does not accept licenses or change your firewall for you.' : confirm === 'backup-export' ? 'Pause hosting briefly to create and verify a portable backup, then restart it. The exported folder contains private server keys and credentials. Keep it on protected storage and share it with nobody.' : confirm === 'backup-import' ? 'Restore a trusted server backup onto this computer? Keep the old host stopped to avoid two servers using the same identity. Backups include executable server images and private keys. Existing data for that host on this computer will block import.' : 'Restore the last server backup? This replaces changes made since that backup, including new messages and files.'}</p>
      <button disabled={!!busy} onClick={() => {
        if (confirm === 'stop') { void control('stop'); return }
        if (confirm === 'runtime') { void perform('Installing hosting runtime…', async () => { setRuntime(await invoke('host_runtime', { action: 'install' })) }); return }
        if (confirm === 'backup-export' || confirm === 'backup-import') {
          const importing = confirm === 'backup-import'
          void perform(importing ? 'Validating and restoring server…' : 'Backing up server…', async () => {
            const result = await invoke<string | null>(importing ? 'host_backup_import' : 'host_backup_export')
            if (result) { setMessage(result); const status = await invoke<HostStatus>('host_control', { action: 'status' }); setHost(status); setHttps(status.https); setPublicAddress(status.public_address ?? ''); setSettingsDirty(false) }
          }); return
        }
        void perform('Restoring previous server…', async () => { setMessage(await invoke<string>('host_rollback')); setHost(await invoke<HostStatus>('host_control', { action: 'status' })) })
      }}>{confirm === 'stop' ? 'Stop hosting' : confirm === 'runtime' ? 'Install runtime' : confirm === 'backup-export' ? 'Create private backup' : 'Restore backup'}</button><button onClick={() => setConfirm(null)}>Cancel</button></div>}
    {busy && <p role="status">{busy}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="input-error">{error}</p>}
  </div>
}
