import assert from 'node:assert/strict'
import {test} from 'node:test'
import {spawnSync} from 'node:child_process'
import {requiredJobs, verifyResults} from '../verify-ci-results.mjs'

const success = () => Object.fromEntries(requiredJobs.map(job => [job, {result: 'success'}]))

test('the aggregate gate accepts a complete successful run', () => {
  assert.doesNotThrow(() => verifyResults(success()))
})

for (const status of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', undefined]) {
  test(`the aggregate gate rejects ${status ?? 'missing'} results for every required job`, () => {
    for (const job of requiredJobs) {
      const results = success()
      if (status === undefined) delete results[job]
      else results[job].result = status
      assert.throws(() => verifyResults(results), error => error.message.includes(job))
    }
  })
}

test('the aggregate gate rejects absent and malformed input', () => {
  for (const input of [null, undefined, [], '', {}, {rust: null}]) assert.throws(() => verifyResults(input))
})

test('the CI entry point exits nonzero when results are missing', () => {
  const result = spawnSync(process.execPath, ['scripts/verify-ci-results.mjs'], {
    env: {...process.env, HEARTH_CI_NEEDS: '{}'}, encoding: 'utf8', windowsHide: true,
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Required CI jobs did not succeed/)
})

test('the CI entry point validates without an opt-in flag', () => {
  const env = {...process.env}
  delete env.HEARTH_CI_NEEDS
  const missing = spawnSync(process.execPath, ['scripts/verify-ci-results.mjs'], {env, encoding: 'utf8', windowsHide: true})
  assert.notEqual(missing.status, 0)
  const valid = spawnSync(process.execPath, ['scripts/verify-ci-results.mjs'], {
    env: {...env, HEARTH_CI_NEEDS: JSON.stringify(success())}, encoding: 'utf8', windowsHide: true,
  })
  assert.equal(valid.status, 0, valid.stderr)
})
