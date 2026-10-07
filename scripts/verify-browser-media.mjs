// Hosted browser acceptance test. Locally, use the visible harness through your browser.
import assert from 'node:assert/strict'
import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
import firefox from 'selenium-webdriver/firefox.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startMediaFixture } from './serve-media-spike.mjs'

const browser = process.env.HEARTH_TEST_BROWSER ?? 'chrome'
assert.ok(['chrome', 'firefox', 'safari'].includes(browser), 'Unknown test browser')
const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = await startMediaFixture({ nativeBinary: process.env.LIVEKIT_BINARY, hearthOrigin: process.env.HEARTH_SPIKE_ORIGIN })
let driver
try {
  driver = await new Builder().forBrowser(browser)
    .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--autoplay-policy=no-user-gesture-required'))
    .setFirefoxOptions(new firefox.Options().addArguments('-headless'))
    .build()
  await driver.get(fixture.url)
  await driver.findElement(By.id('run')).click()
  await driver.wait(async () => /^(PASS|FAIL) ·/.test(await driver.findElement(By.id('status')).getText()), 70000)
  const report = JSON.parse(await driver.findElement(By.id('report')).getText())
  const output = join(root, 'target', 'phase0-evidence')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, `browser-${browser}-${process.platform}.json`), JSON.stringify({ runtime: `${browser} (${process.platform})`, ...report }, null, 2) + '\n')
  writeFileSync(join(output, `browser-${browser}-${process.platform}.png`), Buffer.from(await driver.takeScreenshot(), 'base64'))
  assert.equal(report.outcome, 'pass', `${browser} failed during ${report.failedStage}`)
  if (process.env.HEARTH_SPIKE_ORIGIN) assert.equal(report.checks.hearth_health_and_discovery, true)
  console.log(JSON.stringify({ runtime: `${browser} (${process.platform})`, ...report }, null, 2))
} finally {
  try { await driver?.quit() }
  finally { await fixture.stop() }
}
