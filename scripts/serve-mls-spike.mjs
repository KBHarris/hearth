import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target', 'mls-spike-browser')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}
run('cargo', ['build', '--locked', '-p', 'hearth-wasm', '--target', 'wasm32-unknown-unknown', '--features', 'mls-spike'])
run('wasm-bindgen', [join(root, 'target', 'wasm32-unknown-unknown', 'debug', 'hearth_wasm.wasm'), '--target', 'web', '--out-dir', output])

const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Hearth MLS feasibility check</title>
<style>body{font:16px/1.6 system-ui;background:#181c19;color:#e5e4db;max-width:800px;margin:50px auto;padding:24px}pre{white-space:pre-wrap}h1{color:#e8b681}</style>
<h1>Hearth MLS feasibility check</h1><p>Test-only, in-memory groups. No account, server, or persistent keys.</p>
<pre id="result" role="status">Running browser WebAssembly check…</pre>
<script type="module">
import init, { mlsSpike } from '/hearth_wasm.js';
const result = document.querySelector('#result');
try {
  await init();
  const report = JSON.parse(mlsSpike());
  result.textContent = 'PASS: Browser WebAssembly\\n' + JSON.stringify(report, null, 2);
} catch (error) {
  result.textContent = 'FAIL: Browser WebAssembly\\n' + String(error);
}
</script></html>`
const files = {
  '/': { type: 'text/html; charset=utf-8', body: html },
  '/hearth_wasm.js': { type: 'text/javascript', body: readFileSync(join(output, 'hearth_wasm.js')) },
  '/hearth_wasm_bg.wasm': { type: 'application/wasm', body: readFileSync(join(output, 'hearth_wasm_bg.wasm')) },
}
const server = createServer((request, response) => {
  const file = files[request.url]
  if (!file) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' })
  response.end(file.body)
})
server.listen(0, '127.0.0.1', () => console.log(`MLS browser check: http://127.0.0.1:${server.address().port}/`))
