import { addressScope } from './setup.ts'
import { HearthClient, normalizeServerUrl } from './index.ts'

export type ReachabilityRequest = { schema: 1; kind: 'hearth-network-check'; server: string; serverKey: string; nonce: string; createdAt: number; expiresAt: number }
export type ReachabilityReceipt = { schema: 1; kind: 'hearth-network-result'; server: string; serverKey: string; nonce: string; checkedAt: number; outsideNetworkConfirmed: true }
const id = /^[a-f0-9]{64}$/
const ttl = 15 * 60_000
function object(input: string, keys: string[]): Record<string, unknown> {
  if (input.length > 4096) throw new Error('This network check is too large.')
  const value: unknown = JSON.parse(input)
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid network check. Ask the host for a new one.')
  return value as Record<string, unknown>
}
function publicOrigin(input: string): string {
  const origin = normalizeServerUrl(input)
  if (!origin.startsWith('https://') || addressScope(origin) !== 'public') throw new Error('An outside-network check needs a public HTTPS address.')
  return origin
}
export function createReachabilityRequest(server: string, serverKey: string, now = Date.now()): ReachabilityRequest {
  if (!id.test(serverKey)) throw new Error('Check the local server identity first.')
  const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('')
  return { schema: 1, kind: 'hearth-network-check', server: publicOrigin(server), serverKey, nonce, createdAt: now, expiresAt: now + ttl }
}
export function parseReachabilityRequest(input: string, now = Date.now()): ReachabilityRequest {
  const value = object(input, ['schema', 'kind', 'server', 'serverKey', 'nonce', 'createdAt', 'expiresAt'])
  if (value.schema !== 1 || value.kind !== 'hearth-network-check' || typeof value.server !== 'string' || publicOrigin(value.server) !== value.server || typeof value.serverKey !== 'string' || !id.test(value.serverKey) || typeof value.nonce !== 'string' || !id.test(value.nonce)
    || typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || typeof value.expiresAt !== 'number' || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt !== value.createdAt + ttl || value.createdAt > now + 60_000 || value.expiresAt <= now) throw new Error('This network check is invalid or expired. Ask the host for a new one.')
  return value as ReachabilityRequest
}
export async function checkReachabilityRequest(input: string, outsideNetworkConfirmed: boolean, signal?: AbortSignal): Promise<ReachabilityReceipt> {
  if (!outsideNetworkConfirmed) throw new Error('Use another household or disconnect Wi-Fi and use cellular, then confirm the network below.')
  const request = parseReachabilityRequest(input)
  // This client has no account/token; no invite, credential or third-party probe is sent.
  const info = await new HearthClient(request.server).inspect({ signal })
  if (info.wellKnown.server_key.toLowerCase() !== request.serverKey) throw new Error('This address points to a different Hearth server. Do not join or return a success result.')
  parseReachabilityRequest(input)
  return { schema: 1, kind: 'hearth-network-result', server: request.server, serverKey: request.serverKey, nonce: request.nonce, checkedAt: Date.now(), outsideNetworkConfirmed: true }
}
/** A tester-declared network result, not a signature or geolocation attestation. */
export function verifyReachabilityReceipt(input: string, request: ReachabilityRequest, now = Date.now()): ReachabilityReceipt {
  parseReachabilityRequest(JSON.stringify(request), now)
  const value = object(input, ['schema', 'kind', 'server', 'serverKey', 'nonce', 'checkedAt', 'outsideNetworkConfirmed'])
  if (value.schema !== 1 || value.kind !== 'hearth-network-result' || value.server !== request.server || value.serverKey !== request.serverKey || value.nonce !== request.nonce || value.outsideNetworkConfirmed !== true
    || typeof value.checkedAt !== 'number' || !Number.isSafeInteger(value.checkedAt) || value.checkedAt < request.createdAt || value.checkedAt > now + 60_000 || now - value.checkedAt > ttl) throw new Error('The result is stale or does not match this host and check. Run a new outside-network check.')
  return value as ReachabilityReceipt
}
