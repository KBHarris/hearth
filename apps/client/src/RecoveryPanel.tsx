import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, type DeviceEnrollment, type Session, type DeviceLinkOffer } from '@hearth/sdk'
import type { AuthCrypto } from './crypto/client'
import { createIdentity, identityScope, storageDeadline } from './crypto/vault-store'

export function RecoveryPanel({ crypto, session, serverKey, url, ready, restored, section }: { crypto: AuthCrypto; session: Session; serverKey: string; url: string; ready: boolean; restored: (device: DeviceEnrollment) => void; section?: 'backup' | 'link' }) {
  const [way,setWay] = useState<'code' | 'kit'>('code')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [kit,setKit] = useState('')
  const [code,setCode] = useState('')
  const [expires,setExpires] = useState(0)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => { if (!expires) return; const timer = setTimeout(() => {setCode('');setExpires(0)},Math.max(0,expires-Date.now())); return () => clearTimeout(timer) },[expires])
  async function run(action: (client: HearthClient, signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController(); active.current = controller; setBusy(true);setError('')
    try { await action(new HearthClient(url),controller.signal) }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'That did not work. Please try again.') }
    finally { if (active.current === controller) {active.current = null;setBusy(false)} }
  }
  async function exportKit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    let passphrase = String(data.get('recovery-passphrase')); const confirmation = String(data.get('recovery-confirmation'))
    if (passphrase.length < 16 || passphrase !== confirmation) {setError('Use at least 16 characters, and type the same backup password both times.');return}
    form.reset()
    await run(async () => {setKit(await crypto.request('exportRecovery',passphrase,undefined,session.account.id,serverKey))})
    passphrase = '';data.delete('recovery-passphrase');data.delete('recovery-confirmation')
  }
  async function offerLink() {
    await run(async (client,signal) => {
      const offer = JSON.parse(await crypto.request('linkOffer','',undefined,session.account.id,serverKey)) as DeviceLinkOffer & {code:string}
      const response = await client.offerDeviceLink(session.token,{id:offer.id,device_key:offer.device_key,envelope:offer.envelope,signature:offer.signature},{signal})
      if (!signal.aborted) {setCode(offer.code);setExpires(Date.now()+response.expires_in_seconds*1000)}
    })
  }
  async function restore(event: FormEvent<HTMLFormElement>, fromLink: boolean) {
    event.preventDefault();const form = event.currentTarget;const data = new FormData(form)
    let passphrase = String(data.get(fromLink ? 'link-code' : 'restore-passphrase'))
    let envelope = String(data.get('restore-kit') ?? '')
    if (fromLink) passphrase = passphrase.replace(/[\s-]/g,'').toLowerCase()
    form.reset()
    await run(async (client,signal) => {
      const linkId = fromLink ? await crypto.request('linkId',passphrase) : null
      if (linkId) envelope = (await client.deviceLink(session.token,linkId,{signal})).envelope
      let prepared = JSON.parse(await crypto.request('restoreIdentity',passphrase,envelope,session.account.id,serverKey)) as {envelope:string;enrollment:DeviceEnrollment}
      const remote = await client.identity(session.token,{signal})
      if (remote.identity_key !== prepared.enrollment.identity_key) throw new Error('This recovery kit is for a different account. Your existing keys were kept.')
      const saved = await storageDeadline(createIdentity(identityScope(session.account.id,serverKey),prepared.envelope),signal)
      if (saved !== prepared.envelope) prepared = JSON.parse(await crypto.request('prepareIdentity','',saved,session.account.id,serverKey)) as typeof prepared
      if (signal.aborted) throw signal.reason
      const accepted = await client.restoreDevice(session.token,{enrollment:prepared.enrollment,link_id:linkId},{signal})
      if (!(Object.keys(prepared.enrollment) as Array<keyof DeviceEnrollment>).every(key => accepted[key] === prepared.enrollment[key])) throw new Error('The server answered with a different safety code for your account than expected, so nothing was changed. Your saved account keys were kept.')
      await crypto.request('commitIdentity','')
      if (!signal.aborted) restored(accepted)
    })
    passphrase = '';envelope = '';data.delete('restore-passphrase');data.delete('link-code');data.delete('restore-kit')
  }
  function download() {
    const objectUrl = URL.createObjectURL(new Blob([kit],{type:'application/json'}))
    const anchor = document.createElement('a');anchor.href = objectUrl;anchor.download = 'hearth-recovery.json';anchor.click()
    setTimeout(() => URL.revokeObjectURL(objectUrl),1000)
  }
  return <div className="recovery-panel">
    {ready ? <>
      <section hidden={section === 'link'}><h3>Make a recovery kit</h3><p>A recovery kit is a backup file that gets you back into your account on a new device or a fresh install. Keep the file and its backup password safe, and store them apart. It does not include your message history.</p>
        <form onSubmit={event => void exportKit(event)}><fieldset disabled={busy}>
          <label htmlFor="recovery-passphrase">Backup password (at least 16 characters)</label><input id="recovery-passphrase" name="recovery-passphrase" type="password" minLength={16} maxLength={1024} required autoComplete="off" />
          <label htmlFor="recovery-confirmation">Type the backup password again</label><input id="recovery-confirmation" name="recovery-confirmation" type="password" required autoComplete="off" /><button type="submit" className="primary-button">Create recovery kit</button>
        </fieldset></form>
        {kit && <><label htmlFor="recovery-kit-output">Your recovery kit (locked with your backup password)</label><textarea id="recovery-kit-output" readOnly value={kit} rows={8}/><button type="button" onClick={download}>Download recovery kit</button></>}
      </section>
      <section hidden={section === 'backup'}><h3>Add another device</h3><p>On the new device, sign in to this same account. It will ask for a link code. Create one here and type it there. The code works once, lasts three minutes, and gives that device full access to your account.</p>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void offerLink()}>Create link code</button>
        {code && <p><code className="link-code">{code.match(/.{1,4}/g)?.join(' ')}</code><small>Enter it only on your own new device. Old messages are not copied.</small></p>}
      </section>
    </> : <>
      <div className="panel-tabs" aria-label="Ways to add this device"><button type="button" aria-pressed={way === 'code'} onClick={() => setWay('code')}>Use a code from another device</button><button type="button" aria-pressed={way === 'kit'} onClick={() => setWay('kit')}>Use a recovery kit</button></div>
      <section hidden={way !== 'code'}><p>On a device where you already use this account, open Account & devices, choose Add a device and create a link code. Then type it here.</p>
        <form onSubmit={event => void restore(event,true)}><fieldset disabled={busy}><label htmlFor="link-code">Link code</label><input id="link-code" name="link-code" required autoComplete="off" spellCheck={false}/><button type="submit" className="primary-button">Link this device</button></fieldset></form>
      </section>
      <section hidden={way !== 'kit'}><p>This brings back your account keys and adds this as a new device. You still need your account password to sign in.</p>
        <form onSubmit={event => void restore(event,false)}><fieldset disabled={busy}>
          <label htmlFor="restore-kit">Recovery kit (paste the file’s contents)</label><textarea id="restore-kit" name="restore-kit" required rows={8} maxLength={4096}/>
          <label htmlFor="restore-passphrase">Backup password</label><input id="restore-passphrase" name="restore-passphrase" type="password" minLength={16} maxLength={1024} required autoComplete="off"/><button type="submit" className="primary-button">Restore from recovery kit</button>
        </fieldset></form>
      </section>
    </>}
    {busy && <p role="status">Securing this device… <button type="button" onClick={() => active.current?.abort()}>Cancel</button></p>}
    {error && <p className="input-error" role="alert">{error}</p>}
  </div>
}
