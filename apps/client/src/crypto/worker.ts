import init, { OpaqueAuthClient } from './generated/hearth_wasm.js'
import wasmUrl from './generated/hearth_wasm_bg.wasm?url'
import type {CryptoFailure} from './client'

const ready = init({ module_or_path: wasmUrl })
let client: OpaqueAuthClient
type Request = { id: number; operation: 'registrationStart' | 'registrationFinish' | 'loginStart' | 'loginFinish' | 'prepareIdentity' | 'commitIdentity' | 'exportRecovery' | 'restoreIdentity' | 'linkOffer' | 'linkId' | 'openMessaging' | 'messaging'; password: string; response?: string; username?: string; serverId?: string }
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    await ready
    client ??= new OpaqueAuthClient()
    const { operation, password } = data
    if (password.length > 1024) throw new Error('Password too long')
    const result = operation === 'messaging' ? client.messagingOperation(password,data.response ?? '') :
      operation === 'openMessaging' ? (client.openMessaging(data.response,data.username!,data.serverId!), '') :
      operation === 'exportRecovery' ? client.exportRecovery(password,data.username!,data.serverId!) :
      operation === 'restoreIdentity' ? client.restoreIdentity(data.response!,password,data.username!,data.serverId!) :
      operation === 'linkOffer' ? client.linkOffer(data.username!,data.serverId!) :
      operation === 'linkId' ? client.linkId(password) :
      operation === 'prepareIdentity' ? client.prepareIdentity(data.response, data.username!, data.serverId!) :
      operation === 'commitIdentity' ? (client.commitIdentity(), '') :
        operation === 'registrationStart' || operation === 'loginStart' ? client[operation](password) :
          client[operation](password, data.response!, data.username!, data.serverId!)
    self.postMessage({ id: data.id, result })
  } catch (error) {
    // Only fixed classes cross the worker boundary; exception text can contain secrets.
    const message=error instanceof Error?error.message:''
    let failure:CryptoFailure=error==='Authentication exchange rejected'?'auth_protocol':'crypto_unknown'
    if(error instanceof WebAssembly.RuntimeError || error instanceof RangeError){
      failure=/stack/i.test(message)?'wasm_stack':/memory|bounds/i.test(message)?'wasm_memory':error instanceof RangeError?'wasm_range':'wasm_runtime'
    }
    if (['messaging','openMessaging'].includes(data.operation)) { self.postMessage({id:data.id,failure,error:'Encrypted message or device verification failed. Existing data was preserved; sign in again to retry.'});return }
    self.postMessage({ id: data.id, failure, error: ['prepareIdentity','restoreIdentity','exportRecovery','linkOffer','linkId'].includes(data.operation) ? 'The identity operation could not be verified. Check your kit, passphrase, account and server; existing keys were preserved.' : 'The password or authentication exchange could not be verified.' })
  } finally { data.password = '' }
}
