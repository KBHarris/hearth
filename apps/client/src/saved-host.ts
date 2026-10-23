export type SavedHost = { local_url: string | null; state: string }
export type SavedHostLookup = { kind: 'saved'; host: SavedHost } | { kind: 'missing' } | { kind: 'unavailable' }

// Native IPC can fail or stall while the app resumes. Keep the last known host
// in the UI, retry failures, and ignore results superseded by a settings change.
export function watchSavedHost(
  load: () => Promise<SavedHost | null>,
  changed: (result: SavedHostLookup) => void,
  retryMs = 2000,
  timeoutMs = 5000,
) {
  let stopped = false, busy = false, revision = 0, failures = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  function refresh() {
    if (stopped) return
    revision++
    clearTimeout(timer)
    if (busy) return
    run()
  }
  function run() {
    busy = true
    const request = revision
    let settled = false
    function finish(value: SavedHost | null, failed: boolean) {
      if (stopped || settled) return
      settled = true; clearTimeout(deadline); busy = false
      if (request !== revision) { run(); return }
      if (failed) {
        changed({ kind: 'unavailable' })
        timer = setTimeout(refresh, Math.min(retryMs * 2 ** Math.min(failures++, 4), 30_000))
      } else {
        failures = 0
        changed(value ? { kind: 'saved', host: value } : { kind: 'missing' })
        if (value && !value.local_url) timer = setTimeout(refresh, 30_000)
      }
    }
    deadline = setTimeout(() => finish(null, true), timeoutMs)
    void Promise.resolve().then(load).then(value => finish(value, false), () => finish(null, true))
  }
  refresh()
  return { refresh, stop() { stopped = true; clearTimeout(timer); clearTimeout(deadline) } }
}
