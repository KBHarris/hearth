// Validate the explicitly selected suite without claiming unselected tests passed.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const suites = JSON.parse(readFileSync(new URL('../.github/required-ci-jobs.json', import.meta.url), 'utf8'))

export function verifyResults(results, suite) {
  if (typeof suite !== 'string' || !Object.hasOwn(suites, suite)) throw new Error('Choose checks, core or full explicitly')
  if (!results || typeof results !== 'object' || Array.isArray(results)) throw new Error('CI job results must be an object')
  const required = new Set(suites[suite])
  const failed = suites.full.filter(job => results[job]?.result !== (required.has(job) ? 'success' : 'skipped'))
  if (failed.length) throw new Error(`CI results do not match ${suite}: ${failed.map(job => `${job}=${results[job]?.result ?? 'missing'}`).join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyResults(JSON.parse(process.env.HEARTH_CI_NEEDS ?? 'null'), process.env.HEARTH_CI_SUITE)
  console.log(`Selected suite passed: ${process.env.HEARTH_CI_SUITE}. Only full establishes cross-platform acceptance.`)
}
