import {BlockedPeople} from './BlockedPeople'
import { useEffect, useState, type FormEvent } from 'react'
import { HearthClient,type Session,type ServerSettings,type RegistrationMode } from '@hearth/sdk'
import { ShareInvite } from './ShareInvite'

export function AdminPanel({session,url,serverKey,configured}:{session:Session;url:string;serverKey:string;configured:(settings:ServerSettings)=>void}) {
  const [settings,setSettings] = useState<ServerSettings | null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [invite,setInvite] = useState('')
  const [saved,setSaved] = useState(false)
  useEffect(() => {const controller = new AbortController();void new HearthClient(url).serverSettings(session.token,{signal:controller.signal}).then(setSettings).catch(error => {if (!controller.signal.aborted) setError(error.message)});return () => controller.abort()},[url,session.token])
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');setSaved(false)
    const data = new FormData(event.currentTarget)
    try {const next = await new HearthClient(url).configureServer(session.token,{server_name:String(data.get('server-name')),registration_mode:String(data.get('registration-mode')) as RegistrationMode});setSettings(next);configured(next);setSaved(true)}
    catch(error) {setError(error instanceof Error ? error.message : 'Could not update this server.')}
    finally {setBusy(false)}
  }
  async function createInvite() {
    setBusy(true);setError('')
    try {setInvite((await new HearthClient(url).accountInvite(session.token)).code)}
    catch(error) {setError(error instanceof Error ? error.message : 'Could not create an invite.')}
    finally {setBusy(false)}
  }
  return <section className="recovery-panel">
    {settings && <form onSubmit={event => void save(event)}><fieldset disabled={busy}>
      <label htmlFor="server-name">Server name</label><input id="server-name" name="server-name" defaultValue={settings.server_name} required maxLength={80}/>
      <label htmlFor="registration-mode">Registration</label><select id="registration-mode" name="registration-mode" defaultValue={settings.registration_mode}>
        <option value="invite">Invite only</option><option value="closed">Closed</option><option value="open">Open to everyone</option>
      </select><button type="submit">Save server settings</button>
    </fieldset></form>}
    {saved && <p role="status">Server settings saved.</p>}
    <p>Invite someone to create an account. The invite includes this server’s address and identity, works once and expires after 24 hours.</p>
    <button type="button" disabled={busy} onClick={() => void createInvite()}>Create account invite</button>
    {invite && <><ShareInvite key={invite} token={session.token} invite={{server:url,serverKey,account:invite}}/><button type="button" onClick={() => setInvite('')}>Hide invite</button></>}
    <BlockedPeople url={url} session={session} operator/>
    {error && <p className="input-error" role="alert">{error}</p>}
  </section>
}
