import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { HearthClient, HearthError, normalizeServerUrl } from '../src/index.ts'

const health = { status: 'ok', version: '0.1.0', protocol: 1 }
const discovery = { server_name: 'test.hearth', protocols: [1], server_key: 'a'.repeat(64), federation: false }

async function withServer(overrides, run) {
  const calls = []
  const sockets = new Set()
  let closing = false
  const server = createServer((request, response) => {
    calls.push(request.url)
    const defaults = { '/health': health, '/.well-known/hearth': discovery, '/api/v1/setup': { setup_complete: false } }
    const value = Object.hasOwn(overrides, request.url) ? overrides[request.url] : defaults[request.url]
    if (typeof value === 'function') return value(request, response)
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(value))
  })
  server.on('connection', (socket) => {
    // Include preconnected/raw sockets, not just sockets with an HTTP request.
    if (closing) { socket.destroy(); return }
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(new HearthClient(`http://127.0.0.1:${server.address().port}`), calls)
  } finally {
    await new Promise((resolve) => {
      // Stop accepting first so a pending discovery request cannot reconnect
      // between closing existing sockets and closing the listening server.
      closing = true
      server.close(resolve)
      for (const socket of sockets) socket.destroy()
    })
  }
}

function errorKind(kind) {
  return (error) => error instanceof HearthError && error.kind === kind
}

test('addresses default to HTTPS and support loopback development', () => {
  assert.equal(normalizeServerUrl(' chat.example.org/ '), 'https://chat.example.org')
  assert.equal(normalizeServerUrl('localhost:8080'), 'http://localhost:8080')
  assert.equal(normalizeServerUrl('http://[::1]:8080/'), 'http://[::1]:8080')
  for (const address of ['', 'http://chat.example.org', 'ftp://localhost', 'https://user:secret@chat.example.org',
    'https://chat.example.org/api', 'https://chat.example.org?token=secret', 'https://chat.example.org#invite']) {
    assert.throws(() => normalizeServerUrl(address), errorKind('invalid_url'))
  }
})

test('inspect discovers a compatible server and its incomplete owner setup', async () => {
  await withServer({}, async (client, calls) => {
    const info = await client.inspect()
    assert.equal(info.wellKnown.server_name, 'test.hearth')
    assert.equal(info.setup.setup_complete, false)
    assert.equal(info.health.status, 'ok')
    assert.deepEqual(calls.sort(), ['/.well-known/hearth', '/api/v1/setup', '/health'].sort())
  })
})

test('completed setup is returned independently of federation preference', async () => {
  await withServer({ '/api/v1/setup': { setup_complete: true }, '/.well-known/hearth': { ...discovery, federation: true } }, async (client) => {
    const info = await client.inspect()
    assert.equal(info.setup.setup_complete, true)
    assert.equal(info.wellKnown.federation, true)
  })
})

test('both health and discovery must agree on protocol support before querying setup', async () => {
  for (const overrides of [{ '/health': { ...health, protocol: 2 } }, { '/.well-known/hearth': { ...discovery, protocols: [2] } }]) {
    await withServer(overrides, async (client, calls) => {
      await assert.rejects(client.inspect(), errorKind('incompatible'))
      assert.ok(!calls.includes('/api/v1/setup'))
    })
  }
})

test('degraded database is never treated as a verified connection', async () => {
  await withServer({ '/health': { ...health, status: 'degraded' } }, async (client, calls) => {
    await assert.rejects(client.inspect(), errorKind('degraded'))
    assert.ok(!calls.includes('/api/v1/setup'))
  })
})

test('rejects malformed, HTML, and incorrectly typed responses', async () => {
  for (const overrides of [
    { '/health': { ...health, status: 'healthy' } },
    { '/health': { ...health, protocol: '1' } },
    { '/.well-known/hearth': { ...discovery, server_key: 'not-a-key' } },
    { '/.well-known/hearth': { ...discovery, federation: 'false' } },
    { '/api/v1/setup': { setup_complete: 'false' } },
    { '/health': (_request, response) => response.end('<html>wrong server</html>') },
  ]) {
    await withServer(overrides, async (client) => assert.rejects(client.inspect(), errorKind('invalid_response')))
  }
})

test('setup errors preserve HTTP status instead of masquerading as incomplete setup', async () => {
  await withServer({ '/api/v1/setup': (_request, response) => { response.statusCode = 503; response.end() } }, async (client) => {
    await assert.rejects(client.inspect(), (error) => errorKind('http')(error) && error.status === 503)
  })
})

test('timeouts bound both response headers and a stalled response body', async () => {
  for (const respond of [() => {}, (_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{') }]) {
    await withServer({ '/health': respond }, async (client) => {
      await assert.rejects(client.health({ timeoutMs: 40 }), errorKind('timeout'))
    })
  }
})

test('caller cancellation survives without being converted into a network error', async () => {
  await withServer({ '/health': () => {} }, async (client) => {
    const controller = new AbortController()
    const pending = client.health({ signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, (error) => error.name === 'AbortError')
    await assert.rejects(client.health({ signal: controller.signal }), (error) => error.name === 'AbortError')
  })
})

test('deadline settles a stalled response reader even when transport ignores abort', async () => {
  const originalFetch = globalThis.fetch
  let streamController
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { streamController = controller; controller.enqueue(new TextEncoder().encode('{')) },
  }))
  try {
    await assert.rejects(new HearthClient('http://127.0.0.1').health({ timeoutMs: 40 }), errorKind('timeout'))
  } finally {
    globalThis.fetch = originalFetch
    streamController?.error(new DOMException('Fixture closed', 'AbortError'))
  }
})

test('redirects are rejected instead of discovering a different origin', async () => {
  await withServer({ '/health': (_request, response) => { response.writeHead(302, { Location: '/api/v1/setup' }); response.end() } }, async (client, calls) => {
    await assert.rejects(client.health(), errorKind('network'))
    assert.ok(!calls.includes('/api/v1/setup'))
  })
})
