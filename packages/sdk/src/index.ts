import type { Health, WellKnown } from './protocol.ts'

export * from './protocol.ts'

export class HearthError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Minimal REST client. Authenticated calls and the gateway arrive in Phase 1. */
export class HearthClient {
  readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  health(): Promise<Health> {
    return this.get('/health')
  }

  wellKnown(): Promise<WellKnown> {
    return this.get('/.well-known/hearth')
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.baseUrl + path)
    if (!res.ok) throw new HearthError(res.status, `${path} returned ${res.status}`)
    return (await res.json()) as T
  }
}
