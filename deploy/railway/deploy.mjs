import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cliBinary, root, runCli, version } from './cli.mjs'
import { prepareContext } from './context.mjs'
import { checkPublicReadiness, deploymentState, selectDomain } from './readiness.mjs'
import { validateSettings } from './settings.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const json = async args => {
  const text = await runCli(args, { capture: true, timeout: 60_000 })
  try { return JSON.parse(text) } catch { throw new Error('Unexpected Railway JSON response; no provider output was retained') }
}

export function deploymentId(output) {
  // `up --detach --json` emits JSON Lines. Never accept a prior successful build.
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (typeof event.deploymentId === 'string' && /^[a-zA-Z0-9-]+$/.test(event.deploymentId)) return event.deploymentId
  }
  throw new Error('Upload returned no deployment ID; inspect provider status before retrying')
}

async function domains(services, environment) {
  const result = {}
  for (const service of services) {
    let origin = selectDomain(await json(['domain', 'list', '--service', service, '--environment', environment, '--json']))
    if (!origin) {
      await runCli(['domain', '--service', service, '--environment', environment, '--port', '8080', '--json'], { capture: true })
      origin = selectDomain(await json(['domain', 'list', '--service', service, '--environment', environment, '--json']))
    }
    assert.ok(origin, 'Provider has not assigned a public domain')
    result[service] = origin
  }
  return result
}

export async function main(args = process.argv.slice(2)) {
  const settings = validateSettings(JSON.parse(readFileSync(join(root, '.railway/hearth.json'), 'utf8')))
  const [command = 'inspect', ...flags] = args
  if (command === 'inspect') {
    assert.equal(flags.length, 0, 'inspect does not accept flags')
    const program = (await import(pathToFileURL(join(root, '.railway/railway.ts')))).default
    const graph = await program({})
    console.log(JSON.stringify({ cli: version, sdk: '3.16.0', publicSettings: settings, resources: graph.resources.map(item => ({ address: item.address, kind: item.kind ?? item.type })), offlineOnly: true, deploymentReady: false }, null, 2))
    return
  }
  if (command === 'tools') { console.log(await runCli(['--version'], { capture: true })); return }
  if (command === 'context') { const context = prepareContext(root); console.log(JSON.stringify(context, null, 2)); return }
  if (command === 'login') { assert.equal(flags.length, 0); await runCli(['login']); return }
  if (command === 'link' || command === 'init') {
    // Explicit operator choice only; never infer a workspace or create on failure.
    const required = command === 'link' ? '--project' : '--workspace'
    assert.equal(flags.length, 2, `Use ${command} ${required} <name-or-id>`)
    assert.equal(flags[0], required)
    assert.ok(flags[1] && !flags[1].startsWith('-'), 'A target is required')
    await runCli(command === 'link' ? ['link', '--project', flags[1], '--environment', settings.environment] : ['init', '--name', settings.projectName, '--workspace', flags[1]])
    return
  }
  assert.ok(['plan', 'apply', 'deploy', 'status'].includes(command), 'Use inspect, tools, context, login, link, init, plan, apply, deploy or status')
  assert.equal(flags.length, 0, 'Edit reviewed .railway/hearth.json settings; provider override flags are not accepted')
  const status = await json(['status', '--environment', settings.environment, '--json'])
  assert.equal(status.name, settings.projectName, 'Linked project name differs from reviewed cloud settings; link the intended project before continuing')
  assert.ok(status.environments?.edges?.some(edge => edge.node.name === settings.environment), 'Selected environment is absent')
  if (command === 'plan' || command === 'apply') {
    // Native apply previews again and confirms; never auto-confirm destructive changes.
    await runCli(['config', command, '--file', '.railway/railway.ts', '--environment', settings.environment])
    return
  }
  const services = settings.web ? ['hearth', 'web'] : ['hearth']
  if (command === 'deploy') {
    const context = prepareContext(root)
    await runCli(['config', 'apply', '--file', '.railway/railway.ts', '--environment', settings.environment])
    const publicAddresses = await domains(services, settings.environment)
    const binary = await cliBinary()
    const deployments = {}
    for (const service of services) {
      // The already-filtered snapshot lives under ignored target/. Prevent the
      // CLI from reapplying a parent .gitignore to this isolated source root.
      const args = ['up', relative(root, context.directory), '--path-as-root', '--no-gitignore', '--project', status.id, '--service', service, '--environment', settings.environment, '--detach', '--json']
      const uploaded = spawnSync(binary, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
      assert.ok(!uploaded.error && uploaded.status === 0, 'Upload failed; inspect provider status before retrying')
      deployments[service] = deploymentId(uploaded.stdout)
    }
    const deadline = Date.now() + 20 * 60_000
    for (;;) {
      let complete = true
      for (const service of services) complete = deploymentState(await json(['deployment', 'list', '--service', service, '--environment', settings.environment, '--limit', '10', '--json']), deployments[service]) && complete
      if (complete) break
      assert.ok(Date.now() < deadline, 'Provider build/readiness timed out; inspect authenticated provider status before retrying')
      console.log('Waiting for the uploaded build and runtime health checks…')
      await pause(10_000)
    }
    const readiness = await checkPublicReadiness(publicAddresses.hearth, publicAddresses.web)
    console.log(JSON.stringify({ project: settings.projectName, environment: settings.environment, publicAddresses, sourceManifest: context.manifestSha256, ...readiness }, null, 2))
  } else {
    const publicAddresses = {}
    for (const service of services) publicAddresses[service] = selectDomain(await json(['domain', 'list', '--service', service, '--environment', settings.environment, '--json']))
    assert.ok(publicAddresses.hearth && (!settings.web || publicAddresses.web), 'Public domains are not configured')
    console.log(JSON.stringify({ project: settings.projectName, publicAddresses, ...await checkPublicReadiness(publicAddresses.hearth, publicAddresses.web) }, null, 2))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
