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
  const [busy, setBusy] = useState('Looking for your saved server…')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [appUpdate, setAppUpdate] = useState<UpdateStatus | null>(null)
  const [serverUpdate, setServerUpdate] = useState<UpdateStatus | null>(null)
  const [media,setMedia]=useState<{enabled:boolean;message:string}|null>(null)
  const [tab, setTab] = useState<'server' | 'media' | 'network' | 'updates' | 'backups'>('server')
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
    await perform('Checking for updates…', async () => {
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
    await perform('Testing your internet address…', async () => {
      const [remote, local] = await Promise.all([new HearthClient('https://' + host.public_address).inspect(), new HearthClient(host.local_url!).wellKnown()])
      if (remote.wellKnown.server_key.toLowerCase() !== local.server_key.toLowerCase()) throw new Error('Your internet address leads to a different Hearth server, not this one. Check the address and your router settings before you share it.')
      setMessage('From this computer, your internet address has a trusted secure connection and leads to this server. It has not been tested from another network, so friends may still be unable to reach it.')
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
    <div className="panel-tabs" aria-label="Hosting sections"><button type="button" aria-pressed={tab === 'server'} onClick={() => setTab('server')}>Your server</button><button type="button" aria-pressed={tab === 'media'} onClick={() => setTab('media')}>Voice & video</button><button type="button" aria-pressed={tab === 'network'} onClick={() => setTab('network')}>Test access</button><button type="button" aria-pressed={tab === 'updates'} onClick={() => setTab('updates')}>Updates</button><button type="button" aria-pressed={tab === 'backups'} onClick={() => setTab('backups')}>Backups</button></div>
    <section hidden={tab !== 'server'} aria-labelledby="local-host-heading"><h2 id="local-host-heading">Host on this computer</h2>
      <p>Run a Hearth server for your friends on this computer. Work through the steps in order. If something fails you can try again: your choices and server data are kept.</p>
      <h3>Step 1: Get the server files</h3>
      {!host?.folder && <button className="primary-button" disabled={!!busy} onClick={() => void perform('Getting verified server files…', async () => { const next = await invoke<HostStatus>('host_prepare'); setHost(next); setHttps(next.https); setPublicAddress(next.public_address ?? ''); setSettingsDirty(false); setMessage(next.message) })}>Prepare this computer to host</button>}
      <button disabled={!!busy} onClick={() => void perform('Choosing server files…', async () => {
        const next = await invoke<HostStatus | null>('host_select', { https, publicAddressInput: publicAddress || null }); if (next) { setHost(next); setSettingsDirty(false); setServerUpdate(null) }
      })}>{host?.folder ? 'Change server files' : 'Choose server files'}</button>
      {!host?.folder && <button disabled={!!busy} onClick={() => void control('status')}>Look for saved server again</button>}
      {host?.folder && <p className="host-folder">{host.folder}</p>}
      <h3>Step 2: Get the hosting tools</h3>
      <p>Your server runs inside a free program called Docker Desktop. Hearth can check for it, install it, or open it for you.</p>
      <div className="button-row"><button disabled={!!busy} onClick={() => void perform('Checking hosting tools…', async () => { setRuntime(await invoke('host_runtime', { action: 'status' })) })}>Check hosting tools</button><button disabled={!!busy || runtime?.ready} onClick={() => setConfirm('runtime')}>Install hosting tools</button><button disabled={!!busy} onClick={() => void perform('Opening hosting tools…', async () => { setRuntime(await invoke('host_runtime', { action: 'start' })) })}>Open hosting tools</button></div>
      {runtime && <p role="status">{runtime.message}</p>}
      <h3>Step 3: Choose who can reach it</h3>
      <label className="checkbox-label"><input type="checkbox" checked={https} disabled={!!busy} onChange={event => { setHttps(event.target.checked); setSettingsDirty(true) }} />Let people connect over the internet with a secure connection (HTTPS)</label>
      {https && <><label htmlFor="host-public-address">Your internet address (public IPv4 address or domain name)</label><input id="host-public-address" value={publicAddress} onChange={event => { setPublicAddress(event.target.value); setSettingsDirty(true) }} placeholder="chat.example.org" autoComplete="off" disabled={!!busy} /><small>Use the internet address your router shows. Your router must forward ports 80 and 443 to this computer. Test it from another network before you share it.</small></>}
      {host?.folder && <><h3>Step 4: Run your server</h3><p className="host-state"><span className={`dot ${host.state === 'running' ? 'ok' : host.state === 'error' ? 'error' : host.state === 'partial' ? 'loading' : ''}`} /><strong>{host.state === 'running' ? 'Running' : host.state === 'stopped' ? 'Stopped' : host.state === 'partial' ? 'Partly running' : host.state === 'error' ? 'Needs attention' : 'Ready to start'}</strong></p>
        {settingsDirty && <p className="notice">You changed the settings in step 3. Save them before starting. <button disabled={!!busy} onClick={() => void perform('Saving settings…', async () => { setHost(await invoke<HostStatus>('host_configure', { https, publicAddressInput: publicAddress || null })); setSettingsDirty(false) })}>Save settings</button></p>}
        <div className="button-row"><button className={host.state === 'running' ? undefined : 'primary-button'} disabled={!!busy || settingsDirty} onClick={() => void control('start')}>Start server</button><button disabled={!!busy} onClick={() => setConfirm('stop')}>Stop server</button><button disabled={!!busy} onClick={() => void control('status')}>Refresh status</button></div>
        {host.local_url && <button className={host.state === 'running' ? 'primary-button' : undefined} disabled={!!busy} onClick={() => onConnect(host.local_url!)}>Connect to local server</button>}
        {host.https && host.public_address && <><div className="button-row"><button disabled={!!busy || settingsDirty} onClick={() => void checkPublicHttps()}>Test internet address</button><button disabled={!!busy || settingsDirty} onClick={() => onConnect('https://' + host.public_address)}>Connect using internet address</button></div><small>You can stay connected on this computer and still make invite codes for your internet address. If the test fails only from home, try from another network: some routers cannot reach their own internet address from inside the home.</small></>}
        <small>Your server keeps running when you close Hearth. Stop server turns it off for everyone. Your data stays on this computer.</small>
        <label className="checkbox-label"><input type="checkbox" checked={startup?.enabled ?? false} disabled={!!busy || !startup} onChange={event => { const enabled = event.target.checked; void perform('Saving startup preference…', async () => { setStartup(await invoke('host_startup', { enabled })) }) }} />Start this server when I sign in to this computer</label>
        {startup && <small>{startup.message}</small>}
        <h3>Step 5: Create the owner account</h3><p>A brand-new server has no accounts yet. Connect to it above, then use this one-time code to create the first account, which becomes the owner. You can skip this if the owner account already exists.</p>
          <button disabled={!!busy} onClick={() => void perform('Getting setup code…', async () => { setSetupCode(await invoke<string>('host_setup_code')) })}>Get owner setup code</button>
          {setupCode && <><label htmlFor="local-owner-code">Owner setup code</label><input id="local-owner-code" type={showCode ? 'text' : 'password'} readOnly value={setupCode} onFocus={event => event.currentTarget.select()} autoComplete="off" /><button onClick={() => setShowCode(value => !value)}>{showCode ? 'Hide code' : 'Show code'}</button><small>Keep this code private. It disappears when you close this panel.</small></>}
        </>}
    </section>
    {!host?.folder&&<section hidden={tab !== 'media'}><h2>Voice and video</h2><p>Set up your server on the Your server tab first. Then you can turn on voice and video rooms here.</p></section>}
    {host?.folder&&<section hidden={tab !== 'media'} aria-labelledby="media-host-heading"><h2 id="media-host-heading">Voice and video</h2><p>Host voice and video rooms for your communities on this computer, plus a relay that can hide callers’ IP addresses from each other. Calls stay encrypted: only the people in them hold the keys. Turning this on starts two more Docker services.</p>
      <div className="button-row"><button disabled={!!busy||settingsDirty} onClick={()=>void perform('Checking voice and video…',async()=>setMedia(await invoke('host_media',{action:'status'})))}>Check voice and video</button><button disabled={!!busy||settingsDirty||media?.enabled} onClick={()=>void perform('Preparing voice and video hosting…',async()=>setMedia(await invoke('host_media',{action:'enable'})))}>Turn on voice and video</button>{media?.enabled&&<button disabled={!!busy} onClick={()=>void perform('Turning off voice and video…',async()=>setMedia(await invoke('host_media',{action:'disable'})))}>Turn off voice and video</button>}</div>
      {media&&<p role="status">{media.message}</p>}
    </section>}
    <div hidden={tab !== 'network'}><NetworkCheckPanel localUrl={host?.local_url} publicAddress={host?.public_address} /></div>
    <section hidden={tab !== 'updates'} aria-labelledby="update-heading"><h2 id="update-heading">Updates</h2><p>Hearth downloads updates from its public GitHub page and checks that they are genuine before installing anything.</p>
      <button className="primary-button" disabled={!!busy} onClick={() => void checkUpdates()}>Check for updates</button>
      {appUpdate && <div><p>{appUpdate.message}</p>{appUpdate.available && appUpdate.version && <button disabled={!!busy} onClick={() => void update('desktop', appUpdate.version!)}>Update app</button>}</div>}
      {serverUpdate && <div><p>{serverUpdate.message}</p>{serverUpdate.available && serverUpdate.version && <><p>Your server pauses while Hearth makes and checks a backup, then starts again after the update. If it does not start, Hearth puts the previous version back.</p><button disabled={!!busy} onClick={() => void update('server', serverUpdate.version!)}>Update hosted server</button></>}</div>}
    </section>
    <section hidden={tab !== 'backups'} aria-labelledby="backup-heading"><h2 id="backup-heading">Backups</h2><p>A backup holds everything your server needs to come back: accounts, communities, saved messages and files (still encrypted), and the server’s secret keys.</p>
      <ul className="settings-list">
        {host?.folder && <li><strong>Make a backup</strong><span>Saves a copy you can keep somewhere safe or move to another computer.</span><button disabled={!!busy} onClick={() => setConfirm('backup-export')}>Export server backup</button></li>}
        {host?.folder && <li><strong>Undo the last update</strong><span>Puts the server back to the backup Hearth made before its last update. Everything since then is lost.</span><button disabled={!!busy} onClick={() => setConfirm('restore')}>Restore last backup</button></li>}
        <li><strong>Move a server here</strong><span>Brings a server over from a backup that was made on another computer.</span><button disabled={!!busy} onClick={() => setConfirm('backup-import')}>Restore server onto this computer</button></li>
      </ul>
    </section>
    {confirm && <div className="notice"><p>{confirm === 'stop' ? 'Turn off this server for everyone?' : confirm === 'runtime' ? 'Install Docker Desktop, the hosting tools? This downloads Docker’s installer. Your computer must support virtualization, and you must agree to Docker’s terms yourself. Your computer may ask for administrator permission or a restart. Hearth does not accept licenses or change your firewall for you.' : confirm === 'backup-export' ? 'Your server pauses briefly while Hearth makes and checks a backup you can move to another computer, then starts again. The backup folder contains your server’s secret keys and login details. Keep it somewhere safe and never share it.' : confirm === 'backup-import' ? 'Restore a server backup onto this computer? Only use a backup you trust: it contains server programs that will run here, and secret keys. Keep the old server turned off so two copies of the same server are never running at once. If this computer already has data for that server, the restore will not go ahead.' : 'Go back to the last server backup? This undoes everything since that backup, including new messages and files.'}</p>
      <button disabled={!!busy} onClick={() => {
        if (confirm === 'stop') { void control('stop'); return }
        if (confirm === 'runtime') { void perform('Installing hosting tools…', async () => { setRuntime(await invoke('host_runtime', { action: 'install' })) }); return }
        if (confirm === 'backup-export' || confirm === 'backup-import') {
          const importing = confirm === 'backup-import'
          void perform(importing ? 'Checking and restoring server…' : 'Backing up server…', async () => {
            const result = await invoke<string | null>(importing ? 'host_backup_import' : 'host_backup_export')
            if (result) { setMessage(result); const status = await invoke<HostStatus>('host_control', { action: 'status' }); setHost(status); setHttps(status.https); setPublicAddress(status.public_address ?? ''); setSettingsDirty(false) }
          }); return
        }
        void perform('Restoring previous server…', async () => { setMessage(await invoke<string>('host_rollback')); setHost(await invoke<HostStatus>('host_control', { action: 'status' })) })
      }}>{confirm === 'stop' ? 'Stop hosting' : confirm === 'runtime' ? 'Install Docker Desktop' : confirm === 'backup-export' ? 'Create private backup' : 'Restore backup'}</button><button onClick={() => setConfirm(null)}>Cancel</button></div>}
    {busy && <p role="status">{busy}</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className="input-error">{error}</p>}
  </div>
}
