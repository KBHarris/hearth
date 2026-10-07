import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { initializeConfig } from '../setup.mjs'

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hearth-setup-test-'))
  t.after(() => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('hearth-setup-test-'))
    rmSync(directory, { recursive: true, force: true })
  })
  writeFileSync(join(directory, '.env.example'), 'HEARTH_PORT=8080\nPOSTGRES_PASSWORD=change-me\n')
  return directory
}

test('first run creates unique URL-safe secrets and subsequent runs preserve exact configuration', (t) => {
  const first = fixture(t)
  const second = fixture(t)
  assert.equal(initializeConfig(first).created, true)
  initializeConfig(second)
  const before = readFileSync(join(first, '.env'), 'utf8')
  assert.match(before, /POSTGRES_PASSWORD=[a-f0-9]{64}\n/)
  assert.notEqual(before, readFileSync(join(second, '.env'), 'utf8'))
  assert.equal(initializeConfig(first).created, false)
  assert.equal(readFileSync(join(first, '.env'), 'utf8'), before)
})

test('unsafe existing secrets fail without overwriting configuration', (t) => {
  for (const password of ['change-me', '', 'short', 'a'.repeat(32) + '/']) {
    const directory = fixture(t)
    const text = `HEARTH_PORT=8080\nPOSTGRES_PASSWORD=${password}\n`
    writeFileSync(join(directory, '.env'), text)
    assert.throws(() => initializeConfig(directory), /preserved/)
    assert.equal(readFileSync(join(directory, '.env'), 'utf8'), text)
  }
})

test('invalid ports fail before Compose starts and preserve secrets', (t) => {
  const directory = fixture(t)
  const text = `HEARTH_PORT=70000\nPOSTGRES_PASSWORD=${'a'.repeat(64)}\n`
  writeFileSync(join(directory, '.env'), text)
  assert.throws(() => initializeConfig(directory), /TCP port/)
  assert.equal(readFileSync(join(directory, '.env'), 'utf8'), text)
})
