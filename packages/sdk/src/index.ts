import { PROTOCOL_VERSION, type Health, type SetupStatus, type WellKnown } from './protocol.ts'
import type { Account, AuthResponse, LoginResponse, Session, OwnerRegistrationStart, OwnerRegistrationFinish, LoginStart, LoginFinish } from './protocol.ts'
import type { AccountIdentity, DeviceEnrollment, DeviceRestore, DeviceLinkOffer, DeviceLinkEnvelope } from './protocol.ts'
import type { RegistrationStart,RegistrationFinish,RegistrationStatus,ServerSettings,AccountInvite } from './protocol.ts'
import type { Person,Conversation,KeyPackageRecord,CommitUpload,MessageUpload,DeliveryEvent,GroupMember } from './protocol.ts'
import type { Community, CommunityStructure, Category, Channel, CreateChannel, CreateCommunityInvite, CommunityInvite } from './protocol.ts'
import { isCommunity, isCommunities, isCommunityStructure, isCategory, isChannel, isCommunityInvite } from './community.ts'

export * from './protocol.ts'

export type ErrorKind = 'invalid_url' | 'http' | 'network' | 'timeout' | 'invalid_response' | 'incompatible' | 'degraded'

export class HearthError extends Error {
  readonly status: number
  readonly kind: ErrorKind

  constructor(status: number, message: string, kind: ErrorKind = 'http') {
    super(message)
    this.name = 'HearthError'
    this.status = status
    this.kind = kind
  }
}

/** A server is an origin, never a URL containing credentials or an API path. */
export function normalizeServerUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new HearthError(0, 'Enter a server address.', 'invalid_url')
  let url: URL
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`)
  } catch {
    throw new HearthError(0, 'Enter a valid server address, such as chat.example.org.', 'invalid_url')
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (!value.includes('://') && local) url.protocol = 'http:'
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new HearthError(0, 'Use just the server address, without a path, login, or query.', 'invalid_url')
  }
  if (url.protocol === 'http:' && !local) {
    throw new HearthError(0, 'Use HTTPS for your server. HTTP is available for localhost development.', 'invalid_url')
  }
  return url.origin
}

export interface RequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ServerInfo {
  health: Health
  wellKnown: WellKnown
  setup: SetupStatus
}

/** Public discovery and owner authentication. Gateway delivery is a later milestone. */
export class HearthClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = normalizeServerUrl(baseUrl)
  }
  private community<T>(path:string,token:string,validate:(value:unknown)=>value is T,body?:unknown,options?:RequestOptions):Promise<T> {
    return this.get('/api/v1/communities'+(path?'/'+path:''),validate,options,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  }
  communities(token:string,options?:RequestOptions):Promise<Community[]> { return this.community('',token,isCommunities,undefined,options) }
  createCommunity(token:string,name:string,options?:RequestOptions):Promise<Community> { return this.community('',token,isCommunity,{name},options) }
  communityStructure(token:string,id:string,options?:RequestOptions):Promise<CommunityStructure> { checkedId(id);return this.community(id,token,isCommunityStructure,undefined,options) }
  createCategory(token:string,id:string,name:string,options?:RequestOptions):Promise<Category> { checkedId(id);return this.community(`${id}/categories`,token,isCategory,{name},options) }
  createChannel(token:string,id:string,body:CreateChannel,options?:RequestOptions):Promise<Channel> { checkedId(id);return this.community(`${id}/channels`,token,isChannel,body,options) }
  createCommunityInvite(token:string,id:string,body:CreateCommunityInvite,options?:RequestOptions):Promise<CommunityInvite> { checkedId(id);return this.community(`${id}/invites`,token,isCommunityInvite,body,options) }
  joinCommunity(token:string,code:string,options?:RequestOptions):Promise<Community> { checkedId(code);return this.community('join',token,isCommunity,{code},options) }
  private chat<T>(path:string,token:string,validate:(value:unknown)=>value is T,body?:unknown,options?:RequestOptions):Promise<T> {
    return this.get('/api/v1/chat/'+path,validate,options,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
  }
  person(token:string,username:string,options?:RequestOptions):Promise<Person> { return this.chat(`people/${encodeURIComponent(username)}`,token,isPerson,undefined,options) }
  personById(token:string,id:string,options?:RequestOptions):Promise<Person> { checkedId(id);return this.chat(`accounts/${id}`,token,isPerson,undefined,options) }
  conversations(token:string,options?:RequestOptions):Promise<Conversation[]> { return this.chat('conversations',token,isConversations,undefined,options) }
  packageCount(token:string,device:string,options?:RequestOptions):Promise<{available:number}> { checkedId(device);return this.chat(`packages/${device}`,token,isPackageCount,undefined,options) }
  uploadPackage(token:string,body:KeyPackageRecord,options?:RequestOptions):Promise<null> { return this.chat('packages',token,isEmpty,body,options) }
  claimPackages(token:string,deviceKeys:string[],options?:RequestOptions):Promise<KeyPackageRecord[]> { deviceKeys.forEach(checkedId);return this.chat('packages/claim',token,isPackages,{device_keys:deviceKeys},options) }
  uploadCommit(token:string,id:string,body:CommitUpload,options?:RequestOptions):Promise<null> { checkedId(id);return this.chat(`conversations/${id}/commit`,token,isEmpty,body,options) }
  uploadMessage(token:string,id:string,body:MessageUpload,options?:RequestOptions):Promise<null> { checkedId(id);return this.chat(`conversations/${id}/message`,token,isEmpty,body,options) }
  events(token:string,device:string,after:number,options?:RequestOptions):Promise<DeliveryEvent[]> { checkedId(device);if(!isSequence(after))throw new HearthError(0,'Invalid delivery cursor.','invalid_response');return this.chat(`events/${device}?after=${after}`,token,isEvents,undefined,options) }
  identity(token: string, options?: RequestOptions): Promise<AccountIdentity> {
    return this.get('/api/v1/auth/identity', isAccountIdentity, options, { headers: { Authorization: `Bearer ${token}` } })
  }
  enrollFirstDevice(token: string, enrollment: DeviceEnrollment, options?: RequestOptions): Promise<DeviceEnrollment> {
    return this.get('/api/v1/auth/device/first', isDeviceEnrollment, options, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(enrollment) })
  }
  restoreDevice(token: string, body: DeviceRestore, options?: RequestOptions): Promise<DeviceEnrollment> {
    return this.get('/api/v1/auth/device/restore', isDeviceEnrollment, options, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body) })
  }
  offerDeviceLink(token: string, body: DeviceLinkOffer, options?: RequestOptions): Promise<DeviceLinkEnvelope> {
    return this.get('/api/v1/auth/device/link', isLinkEnvelope, options, { method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}, body:JSON.stringify(body) })
  }
  deviceLink(token: string, id: string, options?: RequestOptions): Promise<DeviceLinkEnvelope> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new HearthError(0,'Enter a valid device link code.','invalid_response')
    return this.get(`/api/v1/auth/device/link/${id}`, isLinkEnvelope, options, {headers:{Authorization:`Bearer ${token}`}})
  }
  registration(options?:RequestOptions):Promise<RegistrationStatus> { return this.get('/api/v1/auth/registration',isRegistration,options) }
  registerStart(body:RegistrationStart,options?:RequestOptions):Promise<AuthResponse> { return this.get('/api/v1/auth/register/start',isAuthResponse,options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) }
  registerFinish(body:RegistrationFinish,options?:RequestOptions):Promise<Account> { return this.get('/api/v1/auth/register/finish',isAccount,options,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}) }
  serverSettings(token:string,options?:RequestOptions):Promise<ServerSettings> { return this.get('/api/v1/auth/admin/settings',isServerSettings,options,{headers:{Authorization:`Bearer ${token}`}}) }
  configureServer(token:string,body:ServerSettings,options?:RequestOptions):Promise<ServerSettings> { return this.get('/api/v1/auth/admin/settings',isServerSettings,options,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}) }
  accountInvite(token:string,options?:RequestOptions):Promise<AccountInvite> { return this.get('/api/v1/auth/admin/invite',isAccountInvite,options,{method:'POST',headers:{Authorization:`Bearer ${token}`}}) }

  health(options?: RequestOptions): Promise<Health> {
    return this.get('/health', isHealth, options)
  }

  wellKnown(options?: RequestOptions): Promise<WellKnown> {
    return this.get('/.well-known/hearth', isWellKnown, options)
  }

  setupStatus(options?: RequestOptions): Promise<SetupStatus> {
    return this.get('/api/v1/setup', isSetupStatus, options)
  }

  ownerStart(body: OwnerRegistrationStart, options?: RequestOptions): Promise<AuthResponse> {
    return this.get('/api/v1/auth/owner/start', isAuthResponse, options, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  }
  ownerFinish(body: OwnerRegistrationFinish, options?: RequestOptions): Promise<Account> {
    return this.get('/api/v1/auth/owner/finish', isAccount, options, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  }
  loginStart(body: LoginStart, options?: RequestOptions): Promise<LoginResponse> {
    return this.get('/api/v1/auth/login/start', isLoginResponse, options, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  }
  loginFinish(body: LoginFinish, options?: RequestOptions): Promise<Session> {
    return this.get('/api/v1/auth/login/finish', isSession, options, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  }
  session(token: string, options?: RequestOptions): Promise<Account> {
    return this.get('/api/v1/auth/session', isAccount, options, { headers: { Authorization: `Bearer ${token}` } })
  }
  async logout(token: string, options?: RequestOptions): Promise<void> {
    await this.get('/api/v1/auth/logout', (value): value is null => value === null, options, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  }

  async inspect(options?: RequestOptions): Promise<ServerInfo> {
    const [health, wellKnown] = await Promise.all([this.health(options), this.wellKnown(options)])
    if (health.protocol !== PROTOCOL_VERSION || !wellKnown.protocols.includes(PROTOCOL_VERSION)) {
      throw new HearthError(0, `This server does not support Hearth protocol v${PROTOCOL_VERSION}. Update your client or choose another server.`, 'incompatible')
    }
    if (health.status !== 'ok') {
      throw new HearthError(0, 'This server is reachable, but its database is unavailable. Try again after the operator restores it.', 'degraded')
    }
    const setup = await this.setupStatus(options)
    return { health, wellKnown, setup }
  }

  private async get<T>(path: string, validate: (value: unknown) => value is T, options: RequestOptions = {}, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    let rejectAbort: (reason: unknown) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const abort = () => {
      controller.abort(options.signal?.reason)
      rejectAbort(controller.signal.reason)
    }
    if (options.signal?.aborted) abort()
    else options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      rejectAbort(controller.signal.reason)
    }, options.timeoutMs ?? 8_000)
    try {
      // Bound settlement as well as requesting transport cancellation: some fetch
      // implementations can stall a response reader after aborting its connection.
      const res = await Promise.race([fetch(this.baseUrl + path, {
        ...init,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      }), aborted])
      if (!res.ok) throw new HearthError(res.status, res.status === 401 ? 'The setup code or authentication exchange was rejected.' :
        res.status === 403 ? path.includes('/register/') ? 'Registration is closed, or this invite has expired or been used.' : 'This account is not allowed to perform that action.' :
        res.status === 409 && path.includes('/register/') ? 'This username is already taken.' :
        res.status === 409 && path.includes('/chat/') ? 'Encryption or delivery state changed. Refresh and retry.' :
        res.status === 409 && path.includes('/communities/') ? 'A community limit was reached. Refresh and try again.' :
        res.status === 409 ? path.includes('/device/') ? 'This account already has an identity. Link an approved device or restore your existing keys.' : 'Owner setup is already complete. Sign in with the owner account.' :
        res.status === 429 ? 'Too many attempts. Wait one minute and try again.' : res.status === 503 ?
        'This server is temporarily unavailable. Try again soon.' :
        'The server could not complete the connection check. Check the address or contact its operator.')
      let value: unknown
      try {
        value = res.status === 204 ? null : await Promise.race([res.json(), aborted])
      } catch (error) {
        if (controller.signal.aborted) throw error
        throw new HearthError(0, 'This address did not return a valid Hearth response.', 'invalid_response')
      }
      if (!validate(value)) throw new HearthError(0, 'This address did not return a valid Hearth response.', 'invalid_response')
      return value
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Cancelled', 'AbortError')
      if (timedOut) throw new HearthError(0, 'The server took too long to respond. Check the address and try again.', 'timeout')
      if (error instanceof HearthError) throw error
      throw new HearthError(0, 'Could not reach this server. Check the address, your connection, and whether the server allows this client.', 'network')
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
}

function isHealth(value: unknown): value is Health {
  return isRecord(value) && (value.status === 'ok' || value.status === 'degraded') &&
    typeof value.version === 'string' && value.version.length > 0 && isVersion(value.protocol)
}

function isWellKnown(value: unknown): value is WellKnown {
  return isRecord(value) && typeof value.server_name === 'string' && value.server_name.length > 0 &&
    Array.isArray(value.protocols) && value.protocols.length > 0 && value.protocols.every(isVersion) &&
    typeof value.server_key === 'string' && /^[a-fA-F0-9]{64}$/.test(value.server_key) &&
    typeof value.federation === 'boolean'
}

function isSetupStatus(value: unknown): value is SetupStatus {
  return isRecord(value) && typeof value.setup_complete === 'boolean'
}

export const AUTH_PROFILE = 'hearth-opaque-r255-sha512-argon2id-m19456-t2-p1-v1'
function isAuthResponse(value: unknown): value is AuthResponse {
  return isRecord(value) && typeof value.message === 'string' && /^[a-f0-9]{2,4096}$/.test(value.message) && value.message.length % 2 === 0 && value.profile === AUTH_PROFILE
}
function isLoginResponse(value: unknown): value is LoginResponse {
  if (!isRecord(value)) return false
  const id = value.exchange_id
  return isAuthResponse(value) && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)
}
function isAccount(value: unknown): value is Account {
  return isRecord(value) && typeof value.id === 'string' && /^[a-f0-9]{64}$/.test(value.id) && typeof value.username === 'string' && /^[a-z0-9_]{3,32}$/.test(value.username) && typeof value.owner === 'boolean'
}
function isSession(value: unknown): value is Session {
  return isRecord(value) && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token) && Number.isInteger(value.expires_in_seconds) && (value.expires_in_seconds as number) > 0 && (value.expires_in_seconds as number) <= 86400 && isAccount(value.account)
}
function isDeviceEnrollment(value: unknown): value is DeviceEnrollment {
  return isRecord(value) && ['identity_key', 'device_key'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key])) &&
    ['certificate', 'account_signature', 'device_signature'].every(key => typeof value[key] === 'string' && /^[a-f0-9]{128}$/.test(value[key]))
}
function isAccountIdentity(value: unknown): value is AccountIdentity {
  if (!isRecord(value) || !Array.isArray(value.devices) || !value.devices.every(isDeviceEnrollment)) return false
  return value.identity_key === null ? value.devices.length === 0 : typeof value.identity_key === 'string' && /^[a-f0-9]{64}$/.test(value.identity_key) && value.devices.length >= 1 && value.devices.length <= 16 && new Set(value.devices.map(device => device.device_key)).size === value.devices.length && value.devices.every(device => device.identity_key === value.identity_key)
}
function isLinkEnvelope(value: unknown): value is DeviceLinkEnvelope {
  return isRecord(value) && typeof value.envelope === 'string' && value.envelope.length <= 4096 && Number.isInteger(value.expires_in_seconds) && (value.expires_in_seconds as number) > 0 && (value.expires_in_seconds as number) <= 180
}
function isRegistration(value:unknown):value is RegistrationStatus { return isRecord(value) && ['closed','invite','open'].includes(value.registration_mode as string) }
function isServerSettings(value:unknown):value is ServerSettings { return isRegistration(value) && typeof (value as unknown as Record<string,unknown>).server_name === 'string' && ((value as unknown as Record<string,unknown>).server_name as string).length > 0 }
function isAccountInvite(value:unknown):value is AccountInvite { return isRecord(value) && typeof value.code === 'string' && /^[a-f0-9]{64}$/.test(value.code) && value.expires_in_seconds === 86400 }
function isId(value:unknown):value is string { return typeof value==='string' && /^[a-f0-9]{64}$/.test(value) }
function checkedId(value:string) { if(!isId(value))throw new HearthError(0,'Invalid encrypted delivery identifier.','invalid_response') }
function isEmpty(value:unknown):value is null { return value===null }
function isSequence(value:unknown):value is number { return typeof value==='number' && Number.isSafeInteger(value) && value>=0 }
function isWire(value:unknown):value is string { return typeof value==='string' && value.length>0 && value.length<=524288 && value.length%2===0 && /^[a-f0-9]+$/.test(value) }
function isMember(value:unknown):value is GroupMember { return isRecord(value) && isId(value.account_id) && isDeviceEnrollment(value.enrollment) }
function isMembers(value:unknown):value is GroupMember[] { return Array.isArray(value) && value.length>=1 && value.length<=32 && value.every(isMember) && new Set(value.map(peer=>peer.enrollment.device_key)).size===value.length }
function isPerson(value:unknown):value is Person { return isRecord(value) && isAccount(value.account) && Array.isArray(value.devices) && value.devices.length<=16 && value.devices.every(isDeviceEnrollment) }
function isConversation(value:unknown):value is Conversation { return isRecord(value) && isId(value.id) && isSequence(value.epoch) && isMembers(value.members) && Array.isArray(value.accounts) && value.accounts.length>=2 && value.accounts.length<=10 && value.accounts.every(isId) }
function isConversations(value:unknown):value is Conversation[] { return Array.isArray(value) && value.every(isConversation) }
function isPackages(value:unknown):value is KeyPackageRecord[] { return Array.isArray(value) && value.length<=32 && value.every(record=>isRecord(record) && isMember(record.member) && isWire(record.package) && isId(record.package_hash)) }
function isPackageCount(value:unknown):value is {available:number} { return isRecord(value) && isSequence(value.available) && value.available<=4 }
function isCommit(value:unknown):value is CommitUpload { return isRecord(value) && isId(value.operation_id) && isId(value.device_key) && isSequence(value.expected_epoch) && isMembers(value.members) && isWire(value.commit) && typeof value.signature==='string' && /^[a-f0-9]{128}$/.test(value.signature) && Array.isArray(value.welcomes) && value.welcomes.length<=32 && value.welcomes.every(w=>isRecord(w) && isId(w.device_key) && isId(w.package_hash) && isWire(w.ciphertext)) }
function isMessageUpload(value:unknown):value is MessageUpload { return isRecord(value) && isId(value.operation_id) && isId(value.device_key) && isSequence(value.epoch) && ['send','edit','delete','typing'].includes(value.action as string) && (value.target_id===null || isId(value.target_id)) && isWire(value.ciphertext) && typeof value.signature==='string' && /^[a-f0-9]{128}$/.test(value.signature) }
export function validateDeliveryEvent(value:unknown):value is DeliveryEvent {
  if(!isRecord(value) || !isSequence(value.seq) || value.seq===0 || !isId(value.conversation_id) || !isRecord(value.data))return false
  const data=value.data
  return data.kind==='redacted' || data.kind==='commit' && isCommit(data.upload) || data.kind==='welcome' && isCommit(data.upload) && isRecord(data.welcome) && isId(data.welcome.device_key) && isId(data.welcome.package_hash) && isWire(data.welcome.ciphertext) || data.kind==='message' && isMessageUpload(data.upload)
}
function isEvents(value:unknown):value is DeliveryEvent[] { return Array.isArray(value) && value.length<=128 && value.every(validateDeliveryEvent) }
