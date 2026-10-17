import { HearthClient, HearthError, normalizeServerUrl, type RequestOptions } from './index.ts'
import { createHearthInvite, parseHearthInvite, setupTarget, type HearthInvite } from './setup.ts'
import type { InviteEnvelope, StoreInviteEnvelope } from './protocol.ts'

// Crockford Base32: 160 random bits; ambiguous letters I/L/O/U are excluded.
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const encoder = new TextEncoder()
const invalid = () => new HearthError(0, 'This Hearth invite is incomplete or invalid. Ask your host for a new invite.', 'invalid_url')
const toHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16))
}
export function normalizeInviteCode(value: string): string {
  const code = value.trim().toUpperCase()
  if (!/^[0-9A-HJKMNP-TV-Z]{32}$/.test(code) && !/^(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/.test(code)) throw invalid()
  return code.replaceAll('-', '')
}
export function formatInviteCode(value: string): string {
  return normalizeInviteCode(value).match(/.{4}/g)!.join('-')
}
async function digest(domain: string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(domain + '\0' + value)))
}
async function material(server: string, code: string) {
  const id = toHex(await digest('hearth-invite-id-v2', code))
  const key = await crypto.subtle.importKey('raw', await digest('hearth-invite-key-v2', server + '\0' + code), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { id, key, additionalData: encoder.encode('hearth-invite-envelope-v2\0' + server) }
}
export function isInviteEnvelope(value: unknown): value is InviteEnvelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.nonce === 'string' && /^[a-f0-9]{24}$/.test(v.nonce) &&
    typeof v.ciphertext === 'string' && /^[a-f0-9]{64,8192}$/.test(v.ciphertext) && v.ciphertext.length % 2 === 0
}
/** Pure client operation: the code and plaintext capabilities never leave the client. */
export async function sealInvite(invite: HearthInvite): Promise<{ code: string; link: string; request: StoreInviteEnvelope }> {
  const payload = createHearthInvite(invite)
  const server = normalizeServerUrl(invite.server)
  const code = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => alphabet[byte & 31]).join('')
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const { id, key, additionalData } = await material(server, code)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData }, key, encoder.encode(payload))
  return { code: formatInviteCode(code), link: `hearth://join/#${new URLSearchParams({ v: '2', server, code: formatInviteCode(code) })}`,
    request: { id, envelope: { nonce: toHex(nonce), ciphertext: toHex(new Uint8Array(ciphertext)) } } }
}
function shortTarget(input: string): { server: string; code: string } | null {
  if (input.length > 2048) throw invalid()
  let url: URL
  try { url = new URL(input.trim()) } catch { return null }
  if (url.protocol !== 'hearth:') return null
  const values = new URLSearchParams(url.hash.slice(1))
  if (values.get('v') !== '2') return null
  if (url.hostname !== 'join' || url.pathname !== '/' || url.username || url.password || url.port || url.search ||
    [...values.keys()].some(key => !['v', 'server', 'code'].includes(key) || values.getAll(key).length !== 1)) throw invalid()
  return { server: normalizeServerUrl(values.get('server') ?? ''), code: normalizeInviteCode(values.get('code') ?? '') }
}
export async function openInvite(serverInput: string, codeInput: string, envelope: InviteEnvelope): Promise<HearthInvite> {
  const server = normalizeServerUrl(serverInput), code = normalizeInviteCode(codeInput)
  if (!isInviteEnvelope(envelope)) throw invalid()
  try {
    const { key, additionalData } = await material(server, code)
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(envelope.nonce), additionalData }, key, fromHex(envelope.ciphertext))
    const invite = parseHearthInvite(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
    if (invite.server !== server) throw invalid()
    return invite
  } catch { throw invalid() }
}
export async function createShortInvite(invite: HearthInvite, token: string, options?: RequestOptions): Promise<{ link: string; code: string }> {
  const sealed = await sealInvite(invite)
  options?.signal?.throwIfAborted()
  await new HearthClient(invite.server).storeInviteEnvelope(token, sealed.request, options)
  return { link: sealed.link, code: sealed.code }
}
export async function resolveSetupTarget(input: string, options?: RequestOptions): Promise<{ server: string; invite: HearthInvite | null }> {
  const target = shortTarget(input)
  if (!target) return setupTarget(input)
  return { server: target.server, invite: await resolveInviteCode(target.server, target.code, options) }
}
export async function resolveInviteCode(serverInput: string, codeInput: string, options?: RequestOptions): Promise<HearthInvite> {
  const server = normalizeServerUrl(serverInput), code = normalizeInviteCode(codeInput)
  const { id } = await material(server, code)
  options?.signal?.throwIfAborted()
  const envelope = await new HearthClient(server).inviteEnvelope(id, options)
  const invite = await openInvite(server, code, envelope)
  options?.signal?.throwIfAborted()
  return invite
}
