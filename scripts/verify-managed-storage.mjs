// Uses one disposable private S3 container; never an operator deployment or cloud account.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blobFixture } from './blob-fixture.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'target', 'storage-acceptance', randomUUID())
mkdirSync(directory, { recursive: true })
let storage
try {
  storage = await blobFixture(directory)
  const env = {
    ...process.env,
    ...storage.env,
    HEARTH_S3_BUCKET: `hearth-storage-test-${randomUUID()}`,
    HEARTH_S3_REGION: 'us-east-1',
    HEARTH_S3_URL_STYLE: 'path',
    HEARTH_S3_CREATE_BUCKET: 'false',
  }
  const child = spawn('cargo', ['test', '--locked', '-p', 'hearth-server', '--lib', 'storage::tests::private_s3_existing_bucket_round_trip_and_cleanup', '--', '--ignored', '--exact'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
  let timer
  const status = await new Promise((resolve, reject) => {
    timer = setTimeout(() => { child.kill(); reject(new Error('Storage acceptance timed out')) }, 300_000)
    child.once('error', reject)
    child.once('exit', resolve)
  }).finally(() => clearTimeout(timer))
  assert.equal(status, 0, 'Private S3 storage acceptance failed')
  const report = {
    measuredAt: new Date().toISOString(), outcome: 'pass',
    scope: 'Local private SeaweedFS; existing custom bucket with path-style URLs',
    checks: {
      configured_bucket_creation_and_existing_bucket_transfer: true,
      ciphertext_limit_bytes: 50_000_768,
      transfer_digest_matches: true,
      wrong_length_upload_rejected: true,
      anonymous_bucket_and_object_reads_rejected: true,
      tampered_and_expired_downloads_rejected: true,
      deleted_object_unavailable_through_prior_lease: true,
    },
    railwayValidated: false, virtualHostedNetworkValidated: false,
  }
  writeFileSync(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  storage?.close()
}
