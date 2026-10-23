import assert from 'node:assert/strict'
import { test } from 'node:test'
import { watchSavedHost } from '../src/saved-host.ts'

const host = { local_url: 'http://localhost:8080', state: 'selected' }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('a failed startup lookup retries without reopening or depending on Docker', async () => {
  let calls = 0
  const events = []
  let ready
  const recovered = new Promise(resolve => { ready = resolve })
  const watch = watchSavedHost(async () => { if (++calls === 1) throw new Error('Native storage temporarily unavailable'); return host }, result => {
    events.push(result); if (result.kind === 'saved') ready()
  }, 5)
  try { await recovered; assert.deepEqual(events, [{ kind: 'unavailable' }, { kind: 'saved', host }]) }
  finally { watch.stop() }
})

test('settings refresh supersedes an old in-flight lookup', async () => {
  let release, calls = 0
  const old = new Promise(resolve => { release = resolve })
  const events = []
  const watch = watchSavedHost(() => ++calls === 1 ? old : Promise.resolve(host), result => events.push(result))
  try {
    await tick(); watch.refresh(); release(null); await tick()
    assert.deepEqual(events, [{ kind: 'saved', host }]); assert.equal(calls, 2)
  } finally { watch.stop() }
})

test('a stalled native lookup times out and late results cannot replace recovery', async () => {
  let release, calls = 0, ready
  const old = new Promise(resolve => { release = resolve })
  const recovered = new Promise(resolve => { ready = resolve })
  const events = []
  const watch = watchSavedHost(() => ++calls === 1 ? old : Promise.resolve(host), result => {
    events.push(result); if (result.kind === 'saved') ready()
  }, 5, 15)
  try {
    await recovered; release(null); await tick()
    assert.deepEqual(events, [{ kind: 'unavailable' }, { kind: 'saved', host }])
  } finally { watch.stop() }
})

test('stop prevents pending native results and scheduled retries from updating the UI', async () => {
  let release
  const events = []
  const watch = watchSavedHost(() => new Promise(resolve => { release = resolve }), result => events.push(result))
  await tick(); watch.stop(); release(host); watch.refresh(); await tick()
  assert.deepEqual(events, [])
})
