import assert from 'node:assert/strict'
import {test} from 'node:test'
import {spawnSync} from 'node:child_process'
import {suites, verifyResults} from '../verify-ci-results.mjs'

const resultsFor = suite => Object.fromEntries(suites.full.map(job => [job, {result: suites[suite].includes(job) ? 'success' : 'skipped'}]))

for (const suite of Object.keys(suites)) {
  test(`${suite} accepts exactly its selected coverage`, () => {
    assert.doesNotThrow(() => verifyResults(resultsFor(suite), suite))
  })
  test(`${suite} rejects failures, cancellations, skips and missing selected results`, () => {
    for (const job of suites[suite]) for (const status of ['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', undefined]) {
      const results = resultsFor(suite)
      if (status === undefined) delete results[job]
      else results[job].result = status
      assert.throws(() => verifyResults(results, suite), error => error.message.includes(job))
    }
  })
}

test('core permits only explicit skips for the unselected platform jobs', () => {
  for (const job of suites.full.filter(job => !suites.core.includes(job))) {
    for (const status of ['success', 'failure', 'cancelled', undefined]) {
      const results = resultsFor('core')
      if (status === undefined) delete results[job]
      else results[job].result = status
      assert.throws(() => verifyResults(results, 'core'))
    }
  }
})

test('a core run cannot be presented as full acceptance', () => {
  assert.throws(() => verifyResults(resultsFor('core'), 'full'), /desktop/)
})

test('missing or unknown suite names cannot enable expensive coverage implicitly', () => {
  for (const suite of [undefined, '', 'all', '__proto__', 'constructor']) assert.throws(() => verifyResults(resultsFor('full'), suite))
})

test('absent or malformed results fail', () => {
  for (const input of [null, undefined, [], '', {}, {rust: null}]) assert.throws(() => verifyResults(input, 'full'))
})

test('the CI entry point requires both a suite and complete results', () => {
  const env = {...process.env}
  delete env.HEARTH_CI_NEEDS
  delete env.HEARTH_CI_SUITE
  const run = extra => spawnSync(process.execPath, ['scripts/verify-ci-results.mjs'], {env: {...env, ...extra}, encoding: 'utf8', windowsHide: true})
  assert.notEqual(run({}).status, 0)
  assert.notEqual(run({HEARTH_CI_SUITE: 'core', HEARTH_CI_NEEDS: '{}'}).status, 0)
  const valid = run({HEARTH_CI_SUITE: 'core', HEARTH_CI_NEEDS: JSON.stringify(resultsFor('core'))})
  assert.equal(valid.status, 0, valid.stderr)
})
