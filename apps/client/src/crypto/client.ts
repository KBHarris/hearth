export class AuthCrypto {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  private sequence = 0
  private pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id)
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.result)
    }
    this.worker.onerror = () => this.close()
  }
  request(operation: 'registrationStart' | 'registrationFinish' | 'loginStart' | 'loginFinish' | 'prepareIdentity' | 'commitIdentity' | 'exportRecovery' | 'restoreIdentity' | 'linkOffer' | 'linkId' | 'openMessaging' | 'messaging', password: string, response?: string, username?: string, serverId?: string): Promise<string> {
    const id = ++this.sequence
    if(this.closed)return Promise.reject(new Error('This session is locked. Sign in again.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ id, operation, password, response, username, serverId })
    })
  }
  close() {
    this.closed = true
    this.worker.terminate()
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Authentication was interrupted. Please try again.')) }
    this.pending.clear()
  }
  private closed = false
  async openMessages(envelope:string|undefined,account:string,server:string) { await this.request('openMessaging','',envelope,account,server) }
  message(operation:string,input:unknown=''):Promise<string> { return this.request('messaging',operation,typeof input==='string'?input:JSON.stringify(input)) }
}
