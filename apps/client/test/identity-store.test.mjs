import { test } from 'node:test'
import assert from 'node:assert/strict'
import { storageDeadline } from '../src/crypto/vault-store.ts'

test('a pending system storage prompt cannot leave the client busy after cancellation', async () => {
  const controller = new AbortController()
  const pending = storageDeadline(new Promise(() => {}),controller.signal)
  const reason = new DOMException('Cancelled','AbortError')
  controller.abort(reason)
  await assert.rejects(pending,error => error === reason)
})
test('storage deadlines settle even if the platform operation never completes', async () => {
  await assert.rejects(storageDeadline(new Promise(() => {}),new AbortController().signal,20),/Identity storage took too long/)
})
