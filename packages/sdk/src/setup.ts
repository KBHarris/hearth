import { HearthError, normalizeServerUrl } from './index.ts'

/** Invite capabilities live only in the fragment and in client memory. */
export interface HearthInvite {
  server: string
  serverKey: string
  account?: string
  community?: string
}

const hex = /^[a-f0-9]{64}$/
const invalidInvite = () => new HearthError(0, 'This Hearth invite is incomplete or invalid. Ask your host for a new invite.', 'invalid_url')

export function createHearthInvite(invite: HearthInvite): string {
  const server = normalizeServerUrl(invite.server)
  if (!hex.test(invite.serverKey) || (!invite.account && !invite.community) ||
    (invite.account !== undefined && !hex.test(invite.account)) ||
    (invite.community !== undefined && !hex.test(invite.community))) throw invalidInvite()
  const fragment = new URLSearchParams({ v: '1', server, key: invite.serverKey })
  if (invite.account) fragment.set('account', invite.account)
  if (invite.community) fragment.set('community', invite.community)
  return `hearth://join/#${fragment}`
}

export function parseHearthInvite(input: string): HearthInvite {
  if (input.length > 2048) throw invalidInvite()
  let url: URL
  try { url = new URL(input.trim()) } catch { throw invalidInvite() }
  if (url.protocol !== 'hearth:' || url.hostname !== 'join' || url.pathname !== '/' ||
    url.username || url.password || url.port || url.search) throw invalidInvite()
  const values = new URLSearchParams(url.hash.slice(1))
  const allowed = ['v', 'server', 'key', 'account', 'community']
  if ([...values.keys()].some(key => !allowed.includes(key) || values.getAll(key).length !== 1) || values.get('v') !== '1') throw invalidInvite()
  const invite = {
    server: values.get('server') ?? '', serverKey: values.get('key') ?? '',
    ...(values.has('account') ? { account: values.get('account')! } : {}),
    ...(values.has('community') ? { community: values.get('community')! } : {}),
  }
  // Keep validation shared with the producer, including HTTPS and origin-only URLs.
  createHearthInvite(invite)
  return { ...invite, server: normalizeServerUrl(invite.server) }
}

export function setupTarget(input: string): { server: string; invite: HearthInvite | null } {
  const value = input.trim()
  if (/^hearth:/i.test(value)) {
    const invite = parseHearthInvite(value)
    return { server: invite.server, invite }
  }
  return { server: normalizeServerUrl(value), invite: null }
}

/** A successful check from this client never proves outside-network reachability. */
export function addressScope(server: string): 'loopback' | 'private' | 'shared' | 'public' {
  const host = new URL(normalizeServerUrl(server)).hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') return 'loopback'
  if (host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.') && !host.startsWith('[')) return 'private'
  if (host.startsWith('[fc') || host.startsWith('[fd') || /^\[fe[89ab]/.test(host)) return 'private'
  if (host === '[::]') return 'private'
  const mapped = host.match(/^\[::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})\]$/)
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16)
    return addressScope(`https://${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  const parts = host.split('.').map(Number)
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    const [a, b] = parts
    if (a === 127) return 'loopback'
    if (a === 100 && b >= 64 && b <= 127) return 'shared'
    if (a === 10 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168) return 'private'
  }
  return 'public'
}
