// Validate a prepared bundle in a unique disposable Compose project. Never uses host .env.
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {createServer} from 'node:net'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {initializeConfig,initializeStorage} from '../deploy/setup.mjs'
import {verifyInstalledTestClient} from './verify-installed-test-client.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),bundle=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Usage: node scripts/verify-test-bundle.mjs BUNDLE')
const manifest=JSON.parse(readFileSync(join(bundle,'manifest.json'),'utf8')),checks={}
for(const [file,expected] of Object.entries(manifest.files)){
  assert.ok(resolve(bundle,file).startsWith(bundle+'\\')||resolve(bundle,file).startsWith(bundle+'/'))
  assert.equal(createHash('sha256').update(readFileSync(join(bundle,file))).digest('hex'),expected)
}
checks.all_manifest_hashes_match=true
assert.ok(!existsSync(join(bundle,'deploy/.env'))&&!existsSync(join(bundle,'deploy/s3.json')))
checks.host_secrets_absent_from_distribution=true
const project=`hearth-host-${randomUUID().replaceAll('-','').slice(0,24)}`,directory=join(root,'target/bundle-acceptance',project)
mkdirSync(directory,{recursive:true})
function command(args){const result=spawnSync('docker',args,{cwd:directory,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error(`Bundle Docker ${args[0]} failed`);return result.stdout.trim()}
function compose(args){return command(['compose','--project-name',project,'--env-file',join(directory,'.env'),'-f',join(directory,'compose.yaml'),...args])}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
const port=await freePort(),s3Port=await freePort()
for(const f of ['compose.yaml','.env.example','storage-entrypoint.sh'])copyFileSync(join(bundle,'deploy',f),join(directory,f))
initializeConfig(directory);initializeStorage(directory)
let env=readFileSync(join(directory,'.env'),'utf8').replace('HEARTH_PORT=8183',`HEARTH_PORT=${port}`).replace('HEARTH_S3_PORT=18335',`HEARTH_S3_PORT=${s3Port}`).replace('http://127.0.0.1:18335',`http://127.0.0.1:${s3Port}`)
writeFileSync(join(directory,'.env'),env,{mode:0o600})
const quote=value=>"'"+value.replaceAll("'","''")+"'"
try{
  const zip=Object.keys(manifest.files).find(f=>f.endsWith('.zip')),extract=join(directory,'client')
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(join(bundle,zip))} -DestinationPath ${quote(extract)}`],{encoding:'utf8',windowsHide:true})
  assert.equal(result.status,0);assert.deepEqual(readdirSync(extract).sort(),[manifest.client.installer,'SHA256SUMS.txt','START_HERE.txt'].sort())
  assert.equal(createHash('sha256').update(readFileSync(join(extract,manifest.client.installer))).digest('hex'),manifest.files['client/'+manifest.client.installer])
  checks.friend_zip_contains_only_installer_guide_and_checksum=true
  command(['load','--input',join(bundle,Object.keys(manifest.files).find(f=>f.endsWith('.tar')))])
  assert.equal(JSON.parse(command(['image','inspect',manifest.server.image]))[0].Id,manifest.server.imageId)
  assert.equal(JSON.parse(command(['image','inspect',manifest.server.image]))[0].Config.Labels['org.opencontainers.image.revision'],manifest.sourceCommit)
  checks.loaded_server_archive_matches_pinned_image=true
  compose(['up','-d','--wait','--wait-timeout','120'])
  const origin=`http://127.0.0.1:${port}`
  async function json(path){const response=await fetch(origin+path,{signal:AbortSignal.timeout(5000)});assert.ok(response.ok);return response.json()}
  assert.equal((await json('/health')).status,'ok');assert.equal((await json('/api/v1/setup')).setup_complete,false)
  const key=(await json('/.well-known/hearth')).server_key
  assert.match(key,/^[a-f0-9]{64}$/)
  const setup=compose(['exec','-T','server','hearth-server','--setup-code']);assert.match(setup,/^[a-f0-9]{64}$/)
  checks.fresh_server_health_discovery_and_owner_bootstrap_pass=true
  assert.equal(compose(['exec','-T','postgres','psql','-U','hearth','-d','hearth','-tAc','SELECT max(version) FROM _sqlx_migrations WHERE success']), '23')
  checks.all_23_migrations_applied_to_fresh_data=true
  let privateS3=false
  for(let attempt=0;attempt<60;attempt++){try{if((await fetch(`http://127.0.0.1:${s3Port}`,{signal:AbortSignal.timeout(1000)})).status===403){privateS3=true;break}}catch{}await delay(250)}
  assert.ok(privateS3);checks.storage_rejects_anonymous_requests=true
  compose(['restart','server']);let healthy=false
  for(let attempt=0;attempt<60;attempt++){try{if((await json('/health')).status==='ok'){healthy=true;break}}catch{}await delay(250)}
  assert.ok(healthy);assert.equal((await json('/.well-known/hearth')).server_key,key)
  checks.server_restart_preserves_signing_identity=true
  const native=await verifyInstalledTestClient({bundle,origin,output:directory,hostProject:project});Object.assign(checks,native.checks)
  const report={measuredAt:new Date().toISOString(),outcome:'pass',sourceCommit:manifest.sourceCommit,checks,humanPending:['clean buddy-PC installation and two-house reachability','actual Windows SmartScreen experience on the buddy PC','manual encrypted messaging between the two households'],nativeClient:native}
  writeFileSync(join(bundle,'VALIDATION.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{
  try{compose(['down','--volumes','--remove-orphans'])}finally{assert.match(project,/^hearth-host-[a-f0-9]{24}$/);assert.equal(resolve(directory),resolve(root,'target/bundle-acceptance',project));rmSync(directory,{recursive:true,force:true})}
}
