import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { initializeConfig, initializeStorage, publicAddress } from '../setup.mjs'

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

test('storage bootstrap preserves credentials and rejects conflicting private S3 configuration',t=>{
  const directory=fixture(t);initializeConfig(directory);initializeStorage(directory)
  const env=readFileSync(join(directory,'.env'),'utf8'),config=readFileSync(join(directory,'s3.json'),'utf8')
  initializeStorage(directory);assert.equal(readFileSync(join(directory,'.env'),'utf8'),env);assert.equal(readFileSync(join(directory,'s3.json'),'utf8'),config)
  const identity=JSON.parse(config).identities[0];assert.match(identity.credentials[0].accessKey,/^[a-f0-9]{32}$/);assert.match(identity.credentials[0].secretKey,/^[a-f0-9]{64}$/)
  writeFileSync(join(directory,'s3.json'),'different');assert.throws(()=>initializeStorage(directory),/preserved/);assert.equal(readFileSync(join(directory,'.env'),'utf8'),env)
})

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

test('duplicate password entries cannot hide an unsafe effective Compose value', (t) => {
  const directory = fixture(t)
  const text = `HEARTH_PORT=8080\nPOSTGRES_PASSWORD=${'a'.repeat(64)}\nPOSTGRES_PASSWORD=change-me\n`
  writeFileSync(join(directory, '.env'), text)
  assert.throws(() => initializeConfig(directory), /exactly one/)
  assert.equal(readFileSync(join(directory, '.env'), 'utf8'), text)
})

test('public HTTPS rejects unsafe addresses before starting Compose and preserves configuration', (t) => {
  const directory=fixture(t)
  for(const address of ['', 'https://8.8.8.8', '8.8.8.8:443', '8.8.8.8/path', 'host.example.com {', '127.0.0.1', '192.168.1.10', '10.1.2.3', '172.31.1.2', '100.64.0.1', '239.1.1.1', 'chat.localhost']){
    const text=`POSTGRES_PASSWORD=${'a'.repeat(64)}\nHEARTH_PUBLIC_ADDRESS=${address}\n`
    writeFileSync(join(directory,'.env'),text)
    assert.throws(()=>publicAddress(directory))
    assert.equal(readFileSync(join(directory,'.env'),'utf8'),text)
  }
  writeFileSync(join(directory,'.env'),'HEARTH_PUBLIC_ADDRESS=8.8.8.8\nHEARTH_PUBLIC_ADDRESS=1.1.1.1\n')
  assert.throws(()=>publicAddress(directory),/exactly one/)
  for(const address of ['8.8.8.8','chat.example.com']){
    writeFileSync(join(directory,'.env'),`HEARTH_PUBLIC_ADDRESS=${address}\n`)
    assert.equal(publicAddress(directory),address)
  }
})
