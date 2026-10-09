// Operator bootstrap: generates configuration and retrieves the protected owner code.
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { isIP } from 'node:net'

const deploy = fileURLToPath(new URL('./', import.meta.url))
export function initializeConfig(directory) {
  const config = join(directory, '.env')
  let created = false
  if (!existsSync(config)) {
    const text = readFileSync(join(directory, '.env.example'), 'utf8').replace('POSTGRES_PASSWORD=change-me', `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}`)
    try {
      writeFileSync(config, text, { flag: 'wx', mode: 0o600 })
      created = true
    } catch (error) { if (error.code !== 'EEXIST') throw error }
  }
  const text = readFileSync(config, 'utf8')
  if ((text.match(/^POSTGRES_PASSWORD=/gm) ?? []).length !== 1) throw new Error('Use exactly one POSTGRES_PASSWORD entry; existing configuration was preserved.')
  const password = text.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1]?.trim()
  if (!password || password === 'change-me' || password.length < 32 || !/^[a-zA-Z0-9_-]+$/.test(password)) {
    throw new Error('Existing deploy/.env needs a URL-safe random POSTGRES_PASSWORD of at least 32 characters. It was preserved; never rotate a running database password casually.')
  }
  const port = Number(text.match(/^HEARTH_PORT=(.+)$/m)?.[1]?.trim() ?? 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HEARTH_PORT must be a valid TCP port')
  return { port, created }
}

export function publicAddress(directory) {
  const text=readFileSync(join(directory,'.env'),'utf8')
  const entries=text.match(/^HEARTH_PUBLIC_ADDRESS=.*$/gm)??[]
  if(entries.length!==1)throw new Error('For --https, set exactly one HEARTH_PUBLIC_ADDRESS in deploy/.env to your public IPv4 or DNS name.')
  const address=entries[0].slice('HEARTH_PUBLIC_ADDRESS='.length).trim()
  const dns=/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(address)
  if(isIP(address)!==4&&!dns)throw new Error('HEARTH_PUBLIC_ADDRESS must be an IPv4 or DNS name without scheme, port, path or spaces.')
  const hostname=address.toLowerCase()
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw new Error('HEARTH_PUBLIC_ADDRESS must be publicly reachable.')
  if(isIP(address)===4){
    const [first,second]=address.split('.').map(Number)
    if(first===0||first===10||first===127||first>=224||(first===169&&second===254)||(first===172&&second>=16&&second<=31)||(first===192&&second===168)||(first===100&&second>=64&&second<=127))throw new Error('Use your public WAN IPv4, not a private, loopback or CGNAT address.')
  }
  return address
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => !['--init-only', '--podman', '--show-setup-code', '--https'].includes(arg))) throw new Error('Usage: node deploy/setup.mjs [--init-only] [--podman] [--show-setup-code] [--https]')
  const { port, created } = initializeConfig(deploy)
  if (created) console.log('Created deploy/.env with a random database password. Secrets are not printed.')
  const address=args.includes('--https')?publicAddress(deploy):undefined
  const composeFiles=['-f',join(deploy,'compose.yaml')]
  if(address)composeFiles.push('-f',join(deploy,'compose.https.yaml'))
  if (args.includes('--show-setup-code')) {
    const engine = args.includes('--podman') ? 'podman' : 'docker'
    const result = spawnSync(engine, ['compose', ...composeFiles, 'exec', '-T', 'server', 'hearth-server', '--setup-code'], { cwd: deploy, stdio: 'inherit', windowsHide: true })
    if (result.error || result.status !== 0) throw new Error('Start the stack first, then retrieve the code from this server.')
    console.log('\nUse this code only to create the first owner account. Do not share it.')
  } else if (args.includes('--init-only')) {
    console.log('Configuration ready. Existing configuration was preserved.')
  } else {
    const engine = args.includes('--podman') ? 'podman' : 'docker'
    const result = spawnSync(engine, ['compose', ...composeFiles, 'up', '-d', '--build', '--wait'], { cwd: deploy, stdio: 'inherit', windowsHide: true })
    if (result.error) throw new Error(`${engine} with Compose must be installed and running`)
    if (result.status !== 0) throw new Error('Stack startup failed. Existing volumes and configuration were preserved; inspect the Compose status.')
    const origin = `http://127.0.0.1:${port}`
    const response = await fetch(origin + '/health', { signal: AbortSignal.timeout(8000) })
    if (!response.ok || (await response.json()).status !== 'ok') throw new Error('Stack is running but Hearth health did not pass')
    console.log(`Local Hearth health passes at ${origin}. If owner setup is incomplete, run this installer with --show-setup-code and enter that code in the client.`)
    if(!address)console.log(`Connect your Hearth client to ${origin}.`)
    if(address){
      const publicOrigin=`https://${address}`
      try {
        const publicHealth=await fetch(publicOrigin+'/health',{signal:AbortSignal.timeout(15000),redirect:'error'})
        if(!publicHealth.ok||(await publicHealth.json()).status!=='ok')throw new Error('HTTPS health failed')
        console.log(`Public HTTPS health passes at ${publicOrigin}. Both clients can use this address. Confirm reachability from another network before inviting your friend.`)
      } catch {
        throw new Error(`Local Hearth is healthy, but trusted HTTPS at ${publicOrigin} is not ready from this PC. Check TCP 80/443 forwarding, Windows firewall, Caddy logs and certificate issuance. A router without NAT loopback may require checking from your friend's network. Services and data were preserved.`)
      }
    }
  }
}
