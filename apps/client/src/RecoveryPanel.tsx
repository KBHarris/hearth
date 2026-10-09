import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HearthClient, type DeviceEnrollment, type Session, type DeviceLinkOffer } from '@hearth/sdk'
import type { AuthCrypto } from './crypto/client'
import { createIdentity, identityScope, storageDeadline } from './crypto/vault-store'

export function RecoveryPanel({ crypto, session, serverKey, url, ready, restored }: { crypto: AuthCrypto; session: Session; serverKey: string; url: string; ready: boolean; restored: (device: DeviceEnrollment) => void }) {
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
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'This device operation could not complete.') }
    finally { if (active.current === controller) {active.current = null;setBusy(false)} }
  }
  async function exportKit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form)
    let passphrase = String(data.get('recovery-passphrase')); const confirmation = String(data.get('recovery-confirmation'))
    if (passphrase.length < 16 || passphrase !== confirmation) {setError('Use at least 16 characters and enter the same recovery passphrase twice.');return}
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
      if (remote.identity_key !== prepared.enrollment.identity_key) throw new Error('This kit belongs to a different identity. Existing keys were preserved.')
      const saved = await storageDeadline(createIdentity(identityScope(session.account.id,serverKey),prepared.envelope),signal)
      if (saved !== prepared.envelope) prepared = JSON.parse(await crypto.request('prepareIdentity','',saved,session.account.id,serverKey)) as typeof prepared
      if (signal.aborted) throw signal.reason
      const accepted = await client.restoreDevice(session.token,{enrollment:prepared.enrollment,link_id:linkId},{signal})
      if (!(Object.keys(prepared.enrollment) as Array<keyof DeviceEnrollment>).every(key => accepted[key] === prepared.enrollment[key])) throw new Error('The server returned a different identity; your saved keys were preserved.')
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
      <details><summary>Back up your identity</summary><p>Your kit restores your identity on a new install. Keep it and its passphrase safe, separately. It does not include message history.</p>
        <form onSubmit={event => void exportKit(event)}><fieldset disabled={busy}>
          <label htmlFor="recovery-passphrase">Recovery passphrase</label><input id="recovery-passphrase" name="recovery-passphrase" type="password" minLength={16} maxLength={1024} required autoComplete="off" />
          <label htmlFor="recovery-confirmation">Confirm recovery passphrase</label><input id="recovery-confirmation" name="recovery-confirmation" type="password" required autoComplete="off" /><button type="submit">Create recovery kit</button>
        </fieldset></form>
        {kit && <><label htmlFor="recovery-kit-output">Encrypted recovery kit</label><textarea id="recovery-kit-output" readOnly value={kit} rows={8}/><button type="button" onClick={download}>Download recovery kit</button></>}
      </details>
      <details><summary>Link another device</summary><p>Sign in to the same account on your new install, then enter this code there. It expires in three minutes and delivers your portable identity once.</p>
        <button type="button" disabled={busy} onClick={() => void offerLink()}>Create link code</button>
        {code && <p><code className="link-code">{code.match(/.{1,4}/g)?.join(' ')}</code><small>Share only with your new install. Old message history is not copied.</small></p>}
      </details>
    </> : <>
      <details open><summary>Link this install</summary><p>Create a link code on an approved device and enter it below.</p>
        <form onSubmit={event => void restore(event,true)}><fieldset disabled={busy}><label htmlFor="link-code">Device link code</label><input id="link-code" name="link-code" required autoComplete="off" spellCheck={false}/><button type="submit">Link this device</button></fieldset></form>
      </details>
      <details><summary>Restore a recovery kit</summary><p>Restoring keeps your identity and creates a new device. Your account password is still required to sign in.</p>
        <form onSubmit={event => void restore(event,false)}><fieldset disabled={busy}>
          <label htmlFor="restore-kit">Encrypted recovery kit</label><textarea id="restore-kit" name="restore-kit" required rows={8} maxLength={4096}/>
          <label htmlFor="restore-passphrase">Kit passphrase</label><input id="restore-passphrase" name="restore-passphrase" type="password" minLength={16} maxLength={1024} required autoComplete="off"/><button type="submit">Restore this identity</button>
        </fieldset></form>
      </details>
    </>}
    {busy && <p role="status">Securing this device… <button type="button" onClick={() => active.current?.abort()}>Cancel</button></p>}
    {error && <p className="input-error" role="alert">{error}</p>}
  </div>
}
