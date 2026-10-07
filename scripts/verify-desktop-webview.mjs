import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startMediaFixture } from './serve-media-spike.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target', 'phase0-evidence')
const reportPath = join(output, `webview-${process.platform}.json`)
// A failed startup must never upload a previous cached report as current evidence.
rmSync(reportPath, { force: true })
const fixture = await startMediaFixture({ nativeBinary: process.env.LIVEKIT_BINARY, hearthOrigin: process.env.HEARTH_SPIKE_ORIGIN })
const binary = join(root, 'target', 'debug', process.platform === 'win32' ? 'hearth-desktop.exe' : 'hearth-desktop')
let child
try {
  child = spawn(binary, ['--phase0-spike'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    for (const line of chunk.toString().split(/\r?\n/)) if (line.startsWith('Phase 0:')) console.log(line)
    if (stdout.length > 100000) child.kill()
  })
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Webview acceptance timed out')) }, 100000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); resolve(code) })
  })
  const line = stdout.split(/\r?\n/).find((line) => line.startsWith('HEARTH_PHASE0_REPORT='))
  assert.ok(line, 'Native webview did not return a report')
  const report = JSON.parse(line.slice('HEARTH_PHASE0_REPORT='.length))
  mkdirSync(output, { recursive: true })
  writeFileSync(reportPath, JSON.stringify({ runtime: `Tauri system webview (${process.platform})`, ...report }, null, 2) + '\n')
  const blockedMedia = report.outcome === 'fail' && report.failedStage === 'runtime capabilities' &&
    report.checks.native_mls_over_webview_ipc === true && report.capabilities.sdkE2eeSupported === false
  if (process.argv.includes('--allow-unsupported-media') && blockedMedia) {
    if (process.env.HEARTH_SPIKE_ORIGIN) assert.equal(report.checks.hearth_health_and_discovery, true)
    console.log(JSON.stringify({ runtime: `Tauri system webview (${process.platform})`, decision: 'Encrypted media blocked; supported browser required', ...report }, null, 2))
  } else {
    assert.equal(code, 0, `Webview failed during ${report.failedStage ?? 'acceptance'}`)
    assert.equal(report.outcome, 'pass')
    assert.equal(report.checks.native_mls_over_webview_ipc, true)
    if (process.env.HEARTH_SPIKE_ORIGIN) assert.equal(report.checks.hearth_health_and_discovery, true)
    console.log(JSON.stringify({ runtime: `Tauri system webview (${process.platform})`, ...report }, null, 2))
  }
} finally {
  child?.kill()
  await fixture.stop()
}
