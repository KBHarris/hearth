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
  request(operation: 'registrationStart' | 'registrationFinish' | 'loginStart' | 'loginFinish' | 'prepareIdentity' | 'commitIdentity', password: string, response?: string, username?: string, serverId?: string): Promise<string> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 30000)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ id, operation, password, response, username, serverId })
    })
  }
  close() {
    this.worker.terminate()
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Authentication was interrupted. Please try again.')) }
    this.pending.clear()
  }
}
