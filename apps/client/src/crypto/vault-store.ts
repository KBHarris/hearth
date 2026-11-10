import { invoke, isTauri } from '@tauri-apps/api/core'

const DATABASE = 'hearth-identity-v1'
const STORE = 'vaults'
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result) } }
    request.onerror = () => { settled = true; reject(new Error('Allow site storage for Hearth, then try again. Hearth could not open the storage that keeps your account keys.')) }
    request.onblocked = () => { settled = true; reject(new Error('Close other Hearth tabs so Hearth can finish opening your account keys.')) }
  })
}
function validateEnvelope(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^01[a-f0-9]{272}$/.test(value)) throw new Error('Your saved account keys look damaged. Don’t clear Hearth’s data; you may need it to recover your account.')
  return value
}
export function identityScope(account: string, server: string): string {
  if (!/^[a-f0-9]{64}$/.test(account) || !/^[a-f0-9]{64}$/.test(server)) throw new Error('Something went wrong opening your account keys. Sign in again, and update Hearth if it keeps happening.')
  return `${server}:${account}`
}
export const identityStorageLabel = () => isTauri() ? 'Your computer’s secure key storage' : 'Encrypted browser storage'
/** Bound UI settlement even if an OS key-store prompt remains pending. */
export function storageDeadline<T>(operation: Promise<T>, signal: AbortSignal, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error) }
    const abort = () => fail(signal.reason ?? new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => fail(new Error('Unlock your computer’s secure key storage or allow browser storage, then try again. Opening your account keys took too long.')), timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    operation.then(value => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value) }, fail)
  })
}
export async function readIdentity(scope: string): Promise<string | null> {
  if (isTauri()) return validateEnvelope(await invoke('identity_vault_read', { scope }))
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(scope)
      tx.oncomplete = () => { try { resolve(validateEnvelope(request.result)) } catch (error) { reject(error) } }
      tx.onabort = () => reject(new Error('Hearth could not read your saved account keys. Try again. Nothing was lost.'))
    })
  } finally { db.close() }
}
/** Atomic create-or-read: never replace a vault created by another tab/process. */
export async function createIdentity(scope: string, envelope: string): Promise<string> {
  validateEnvelope(envelope)
  if (isTauri()) {
    const saved = validateEnvelope(await invoke('identity_vault_create', { scope, envelope }))
    if (!saved) throw new Error('Your computer’s secure key storage did not save your account keys. Try again.')
    return saved
  }
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      let saved = envelope
      const request = store.get(scope)
      request.onsuccess = () => {
        try {
          const current = validateEnvelope(request.result)
          if (current) saved = current
          else store.add(envelope, scope)
        } catch { tx.abort() }
      }
      // Resolve only after durable transaction completion, before server enrollment.
      tx.oncomplete = () => resolve(saved)
      tx.onabort = () => reject(new Error('Allow storage for Hearth and try again. Your account keys could not be saved. Nothing already saved was changed.'))
    })
  } finally { db.close() }
}
