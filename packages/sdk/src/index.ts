import { PROTOCOL_VERSION, type Health, type SetupStatus, type WellKnown } from './protocol.ts'

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

/** Public discovery client. Authenticated calls and the gateway arrive in Phase 1. */
export class HearthClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = normalizeServerUrl(baseUrl)
  }

  health(options?: RequestOptions): Promise<Health> {
    return this.get('/health', isHealth, options)
  }

  wellKnown(options?: RequestOptions): Promise<WellKnown> {
    return this.get('/.well-known/hearth', isWellKnown, options)
  }

  setupStatus(options?: RequestOptions): Promise<SetupStatus> {
    return this.get('/api/v1/setup', isSetupStatus, options)
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

  private async get<T>(path: string, validate: (value: unknown) => value is T, options: RequestOptions = {}): Promise<T> {
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
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      }), aborted])
      if (!res.ok) throw new HearthError(res.status, res.status === 503 ?
        'This server is temporarily unavailable. Try again soon.' :
        'The server could not complete the connection check. Check the address or contact its operator.')
      let value: unknown
      try {
        value = await Promise.race([res.json(), aborted])
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
