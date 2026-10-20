import { useEffect, useRef, useState } from 'react'
import { HearthClient, createReachabilityRequest, checkReachabilityRequest, verifyReachabilityReceipt, addressScope, type ReachabilityRequest } from '@hearth/sdk'

export function NetworkCheckPanel({ localUrl, publicAddress }: { localUrl?: string | null; publicAddress?: string | null }) {
  const [request, setRequest] = useState<ReachabilityRequest | null>(null)
  const [incoming, setIncoming] = useState('')
  const [receipt, setReceipt] = useState('')
  const [result, setResult] = useState('')
  const [outside, setOutside] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [wan, setWan] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { setRequest(null); setReceipt(''); setMessage(''); setError(''); controller.current?.abort() }, [localUrl, publicAddress])
  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort(); const current = new AbortController(); controller.current = current
    setBusy(true); setMessage(''); setError(''); setResult('')
    try { await action(current.signal) } catch (error) { if (!current.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (controller.current === current) setBusy(false) }
  }
  let wanScope: string | null = null
  try { if (wan.trim()) wanScope = addressScope('https://' + wan.trim()) } catch { /* User can finish typing. */ }
  return <section aria-labelledby="network-check-heading"><h2 id="network-check-heading">Check access from another network</h2>
    <p>A check on the host PC cannot prove that friends can reach it. Use another household’s Hearth app, or a supported browser client on cellular with Wi-Fi off. Checks contain only a public address, public identity and a temporary random identifier.</p>
    {localUrl && publicAddress && <>
      <button disabled={busy} onClick={() => void perform(async signal => {
        setRequest(null); setReceipt('')
        const info = await new HearthClient(localUrl).inspect({ signal })
        if (!signal.aborted) setRequest(createReachabilityRequest('https://' + publicAddress, info.wellKnown.server_key.toLowerCase()))
      })}>Create outside-network check</button>
      {request && <><label htmlFor="outside-request">Send this check to your tester (expires in 15 minutes)</label><textarea id="outside-request" readOnly value={JSON.stringify(request)} /><label htmlFor="outside-receipt">Paste the tester’s result</label><textarea id="outside-receipt" value={receipt} onChange={event => { setReceipt(event.target.value); setMessage('') }} /><button disabled={busy || !receipt} onClick={() => void perform(async signal => {
        verifyReachabilityReceipt(receipt, request)
        const info = await new HearthClient(localUrl).inspect({ signal })
        if (info.wellKnown.server_key.toLowerCase() !== request.serverKey) throw new Error('The local host identity changed. Create a new check.')
        if (!signal.aborted) setMessage('The tester reports successful HTTPS, compatible Hearth and the matching server identity from another network. Network location is confirmed by the tester; Hearth does not geolocate it.')
      })}>Review outside result</button></>}
    </>}
    <details><summary>Test someone else’s host</summary><label htmlFor="incoming-network-check">Paste the host’s check</label><textarea id="incoming-network-check" value={incoming} disabled={busy} onChange={event => { setIncoming(event.target.value); setResult(''); setError('') }} />
      <label className="checkbox-label"><input type="checkbox" checked={outside} disabled={busy} onChange={event => { setOutside(event.target.checked); setResult('') }} />I am on another household’s network or cellular with Wi-Fi off.</label>
      <button disabled={busy || !outside || !incoming} onClick={() => void perform(async signal => { const receipt = await checkReachabilityRequest(incoming, outside, signal); if (!signal.aborted) setResult(JSON.stringify(receipt)) })}>Run outside-network check</button>
      {result && <><label htmlFor="network-check-result">Send this result back to the host</label><textarea id="network-check-result" readOnly value={result} /></>}
    </details>
    {busy && <button onClick={() => { controller.current?.abort(); setBusy(false) }}>Cancel network check</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <details><summary>Firewall, router and relay help</summary>
      <p>For direct internet hosting, reserve this computer’s LAN address in your router. Forward TCP ports 80 and 443 to it, and allow those ports in the computer’s firewall. Keep database, storage and Docker management ports private. The router and firewall must each allow the connection; HTTPS also needs a trusted certificate for your public address.</p>
      <label htmlFor="router-wan">Router’s reported WAN IPv4 address (optional)</label><input id="router-wan" value={wan} onChange={event => setWan(event.target.value)} autoComplete="off" />
      {wanScope === 'shared' && <p>Your router reports an address in the shared CGNAT range. Ask your ISP for a public address, or configure a tunnel. Hearth did not independently query your ISP.</p>}
      {wanScope === 'private' && <p>Your router reports a private upstream address. Another router or your ISP may be performing NAT. Check upstream forwarding or ask your ISP about a public address.</p>}
      <p>If an outside check succeeds but this PC’s public HTTPS check fails, router loopback or local DNS/firewall settings may be responsible. A timeout alone cannot diagnose CGNAT or loopback.</p>
      <p>An optional tunnel can forward a public HTTPS address to this host. Configure it with your chosen provider, use that address in hosting settings, and repeat both identity checks. Hearth never enrolls a provider automatically. Providers can observe connection metadata. A provider that terminates TLS can also alter a hosted web client; a separately installed signed desktop client avoids relying on that web delivery path. Encrypted message and media content must remain end-to-end encrypted.</p>
    </details>
  </section>
}
