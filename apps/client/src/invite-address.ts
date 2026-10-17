import { addressScope, normalizeServerUrl } from '@hearth/sdk'

export type InviteHost = { https: boolean; public_address: string | null; local_url: string | null }
/** Only the selected loopback host may supply an automatic public sharing address. */
export function inviteShareServer(server: string, host: InviteHost): string {
  try {
    if (!host.https || !host.public_address || !host.local_url || addressScope(server) !== 'loopback' || addressScope(host.local_url) !== 'loopback') return server
    const current = new URL(normalizeServerUrl(server)), local = new URL(normalizeServerUrl(host.local_url))
    if (current.protocol !== local.protocol || current.port !== local.port) return server
    const publicServer = normalizeServerUrl('https://' + host.public_address)
    return addressScope(publicServer) === 'public' ? publicServer : server
  } catch { return server }
}
