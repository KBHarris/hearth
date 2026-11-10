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
  const [chosen, setChosen] = useState<'mine' | 'friend' | 'help' | null>(null)
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
  const mine = !!(localUrl && publicAddress)
  const view = chosen === 'mine' && !mine ? 'friend' : chosen ?? (mine ? 'mine' : 'friend')
  return <section className="network-check" aria-labelledby="network-check-heading"><h2 id="network-check-heading">{mine ? 'Test if friends can reach your server' : 'Help test a server'}</h2>
    <div className="panel-tabs" aria-label="Server tests">{mine && <button type="button" aria-pressed={view === 'mine'} onClick={() => setChosen('mine')}>Test my server</button>}<button type="button" aria-pressed={view === 'friend'} onClick={() => setChosen('friend')}>Test a friend’s server</button><button type="button" aria-pressed={view === 'help'} onClick={() => setChosen('help')}>Router help</button></div>
    {localUrl && publicAddress && <div hidden={view !== 'mine'}>
    <p>A test from the server’s own computer cannot prove that friends can reach it. Ask someone in another home to run the test in their Hearth app, or use a supported browser on mobile data with Wi-Fi off. A test contains only the server’s internet address, its safety code and a temporary random code.</p>
      <button disabled={busy} onClick={() => void perform(async signal => {
        setRequest(null); setReceipt('')
        const info = await new HearthClient(localUrl).inspect({ signal })
        if (!signal.aborted) setRequest(createReachabilityRequest('https://' + publicAddress, info.wellKnown.server_key.toLowerCase()))
      })}>Create a test for a friend</button>
      {request && <><label htmlFor="outside-request">Send this test to your friend (it expires in 15 minutes)</label><textarea id="outside-request" readOnly value={JSON.stringify(request)} /><label htmlFor="outside-receipt">Paste your friend’s result</label><textarea id="outside-receipt" value={receipt} onChange={event => { setReceipt(event.target.value); setMessage('') }} /><button disabled={busy || !receipt} onClick={() => void perform(async signal => {
        verifyReachabilityReceipt(receipt, request)
        const info = await new HearthClient(localUrl).inspect({ signal })
        if (info.wellKnown.server_key.toLowerCase() !== request.serverKey) throw new Error('Your server’s safety code changed since you made this test. Create a new test.')
        if (!signal.aborted) setMessage('Your friend reached your server from another network: the secure connection (HTTPS) worked, the Hearth version is compatible and it is the right server. Hearth takes your friend’s word that they were on another network; it does not check their location.')
      })}>Check your friend’s result</button></>}
    </div>}
    <div hidden={view !== 'friend'}><p>A friend who runs a Hearth server can send you a test. Running it here tells them whether people outside their home can reach it.</p><label htmlFor="incoming-network-check">Paste the test your friend sent you</label><textarea id="incoming-network-check" value={incoming} disabled={busy} onChange={event => { setIncoming(event.target.value); setResult(''); setError('') }} />
      <label className="checkbox-label"><input type="checkbox" checked={outside} disabled={busy} onChange={event => { setOutside(event.target.checked); setResult('') }} />I am on a different home’s internet, or on mobile data with Wi-Fi off.</label>
      <button disabled={busy || !outside || !incoming} onClick={() => void perform(async signal => { const receipt = await checkReachabilityRequest(incoming, outside, signal); if (!signal.aborted) setResult(JSON.stringify(receipt)) })}>Run the test</button>
      {result && <><label htmlFor="network-check-result">Send this result back to your friend</label><textarea id="network-check-result" readOnly value={result} /></>}
    </div>
    {busy && <button onClick={() => { controller.current?.abort(); setBusy(false) }}>Cancel test</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <div hidden={view !== 'help'}>
      <p>To host from home, give this computer a fixed home-network address (its LAN address) in your router settings. Forward TCP ports 80 and 443 to it, and allow those ports in this computer’s firewall. Do not open database, storage or Docker management ports. The router and the firewall must both allow the connection. The secure connection (HTTPS) also needs a trusted certificate for your internet address.</p>
      <label htmlFor="router-wan">Internet address shown in your router’s settings (WAN IPv4, optional)</label><input id="router-wan" value={wan} onChange={event => setWan(event.target.value)} autoComplete="off" />
      {wanScope === 'shared' && <p>This address is shared with other customers of your internet provider (CGNAT), so friends usually cannot reach you directly. Ask your provider for a public address, or set up a tunnel. Hearth did not contact your provider to check this.</p>}
      {wanScope === 'private' && <p>Your router reports a private address, so another router or your internet provider may sit between you and the internet (NAT). Set up port forwarding on that device too, or ask your provider about a public address.</p>}
      <p>If a friend’s test works but the test on this computer fails, your router may not let home devices reach your own internet address (loopback), or local DNS or firewall settings may be the cause. A test that only times out cannot tell which problem you have.</p>
      <p>A tunnel service can give this server a public HTTPS address. Set it up with the provider you choose, enter that address in the hosting settings, and run both tests again. Hearth never signs you up with a provider. The provider can see who connects and when. If the provider handles the secure connection itself (TLS), it could also change the web version of Hearth it passes along; the separately installed, signed desktop app avoids that risk. Messages, voice and video must still be end-to-end encrypted.</p>
    </div>
  </section>
}
