import init, { OpaqueAuthClient } from './generated/hearth_wasm.js'
import wasmUrl from './generated/hearth_wasm_bg.wasm?url'

const ready = init({ module_or_path: wasmUrl })
let client: OpaqueAuthClient
type Request = { id: number; operation: 'registrationStart' | 'registrationFinish' | 'loginStart' | 'loginFinish' | 'prepareIdentity' | 'commitIdentity'; password: string; response?: string; username?: string; serverId?: string }
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    await ready
    client ??= new OpaqueAuthClient()
    const { operation, password } = data
    if (password.length > 1024) throw new Error('Password too long')
    const result = operation === 'prepareIdentity' ? client.prepareIdentity(data.response, data.username!, data.serverId!) :
      operation === 'commitIdentity' ? (client.commitIdentity(), '') :
        operation === 'registrationStart' || operation === 'loginStart' ? client[operation](password) :
          client[operation](password, data.response!, data.username!, data.serverId!)
    self.postMessage({ id: data.id, result })
  } catch {
    self.postMessage({ id: data.id, error: data.operation === 'prepareIdentity' ? 'The saved identity could not be unlocked. Preserve it and use the original account and server.' : 'The password or authentication exchange could not be verified.' })
  } finally { data.password = '' }
}
