// One required check must reject failed, cancelled, skipped or missing test jobs.
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const requiredJobs = JSON.parse(readFileSync(new URL('../.github/required-ci-jobs.json', import.meta.url), 'utf8'))

export function verifyResults(results) {
  if (!results || typeof results !== 'object' || Array.isArray(results)) throw new Error('CI job results must be an object')
  const failed = requiredJobs.filter(job => results[job]?.result !== 'success')
  if (failed.length) throw new Error(`Required CI jobs did not succeed: ${failed.map(job => `${job}=${results[job]?.result ?? 'missing'}`).join(', ')}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyResults(JSON.parse(process.env.HEARTH_CI_NEEDS ?? 'null'))
  console.log('Every required CI job succeeded for this workflow run.')
}
