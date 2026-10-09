// Hosted browser acceptance test. Locally, use the visible harness through your browser.
import assert from 'node:assert/strict'
import { Builder, By } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'
import firefox from 'selenium-webdriver/firefox.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startMediaFixture } from './serve-media-spike.mjs'

const browser = process.env.HEARTH_TEST_BROWSER ?? 'chrome'
assert.ok(['chrome', 'firefox', 'safari'].includes(browser), 'Unknown test browser')
const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'target', 'phase0-evidence')
const reportPath = join(output, `browser-${browser}-${process.platform}.json`)
const screenshotPath = join(output, `browser-${browser}-${process.platform}.png`)
rmSync(reportPath, { force: true })
rmSync(screenshotPath, { force: true })
const fixture = await startMediaFixture({ nativeBinary: process.env.LIVEKIT_BINARY, hearthOrigin: process.env.HEARTH_SPIKE_ORIGIN })
let driver
try {
  driver = await new Builder().forBrowser(browser)
    .setChromeOptions(new chrome.Options().addArguments('--headless=new', '--autoplay-policy=no-user-gesture-required'))
    // Firefox excludes loopback ICE candidates by default. This preference is
    // confined to the disposable local test profile; encryption remains required.
    .setFirefoxOptions(new firefox.Options().addArguments('-headless')
      .setPreference('media.peerconnection.ice.loopback', true)
      .setPreference('media.peerconnection.ice.default_address_only', false)
      .setPreference('media.peerconnection.ice.obfuscate_host_addresses', false)
      // Synthetic silent audio has no real device interaction in headless CI.
      .setPreference('media.autoplay.default', 0)
      .setPreference('media.autoplay.block-webaudio', false))
    .build()
  await driver.get(fixture.url)
  try {
    // A dev module can finish loading after WebDriver considers the DOM ready.
    // Preserve a real user-activation click, but wait for its handler first.
    await driver.wait(async () => await driver.findElement(By.id('run')).isEnabled(), 20000)
    await driver.findElement(By.id('run')).click()
    await driver.wait(async () => /^(PASS|FAIL) ·/.test(await driver.findElement(By.id('status')).getText()), 70000)
  } catch (error) {
    // Only the harness's stage/check fields; never browser logs, SDP or tokens.
    mkdirSync(output, { recursive: true })
    const status=await driver.findElement(By.id('status')).getText()
    const report=await driver.findElement(By.id('report')).getText()
    writeFileSync(reportPath, JSON.stringify({runtime:`${browser} (${process.platform})`,outcome:'fail',failedStage:status,errorClass:error.name,report},null,2)+'\n')
    writeFileSync(screenshotPath, Buffer.from(await driver.takeScreenshot(), 'base64'))
    throw error
  }
  const report = JSON.parse(await driver.findElement(By.id('report')).getText())
  mkdirSync(output, { recursive: true })
  writeFileSync(reportPath, JSON.stringify({ runtime: `${browser} (${process.platform})`, ...report }, null, 2) + '\n')
  writeFileSync(screenshotPath, Buffer.from(await driver.takeScreenshot(), 'base64'))
  assert.equal(report.outcome, 'pass', `${browser} failed during ${report.failedStage}`)
  if (process.env.HEARTH_SPIKE_ORIGIN) assert.equal(report.checks.hearth_health_and_discovery, true)
  console.log(JSON.stringify({ runtime: `${browser} (${process.platform})`, ...report }, null, 2))
} finally {
  try { await driver?.quit() }
  finally { await fixture.stop() }
}
