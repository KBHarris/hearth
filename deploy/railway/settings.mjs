import assert from 'node:assert/strict'

/** @param {any} value @returns {{projectName: string, environment: string, web: boolean, region: string, bucketRegion: 'sjc'|'iad'|'ams'|'sin', volumeSizeMB: number, extraClientOrigins: string[]}} */
export function validateSettings(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Invalid cloud settings')
  const names = ['projectName', 'environment', 'web', 'region', 'bucketRegion', 'volumeSizeMB', 'extraClientOrigins']
  assert.ok(Object.keys(value).every(name => names.includes(name)), 'Unknown cloud setting; secrets do not belong in this file')
  for (const name of ['projectName', 'environment', 'region']) assert.match(value[name] ?? '', /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, `Invalid ${name}`)
  assert.equal(typeof value.web, 'boolean', 'web must be true or false')
  assert.ok(['sjc', 'iad', 'ams', 'sin'].includes(value.bucketRegion), 'Unsupported bucket region')
  assert.ok(Number.isInteger(value.volumeSizeMB) && value.volumeSizeMB >= 1024 && value.volumeSizeMB <= 1_048_576, 'Invalid volume size')
  assert.ok(Array.isArray(value.extraClientOrigins), 'extraClientOrigins must be an array')
  for (const origin of value.extraClientOrigins) {
    let url
    try { url = new URL(origin) } catch { throw new Error('Invalid extra client origin') }
    assert.ok(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password, 'Extra client origins must be exact HTTPS origins')
  }
  return value
}
