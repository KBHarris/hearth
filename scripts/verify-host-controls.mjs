// Explicit local Docker acceptance. The immutable distribution is only read.
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {copyFileSync,readFileSync,writeFileSync,mkdirSync,linkSync,realpathSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
import {createServer} from 'node:net'
import {spawn,spawnSync} from 'node:child_process'
const root=resolve('.'),source=realpathSync(resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'target/manual-test/guided-efd4af6'))
const integrityOnly=process.argv.includes('--integrity-only')
const id=randomBytes(12).toString('hex'),project='hearth-host-'+id,directory=join(root,'target/host-acceptance',id)
assert.ok(directory.startsWith(join(root,'target/host-acceptance')+sep))
mkdirSync(join(directory,'deploy'),{recursive:true})
const manifest=JSON.parse(readFileSync(join(source,'manifest.json'),'utf8'))
async function port(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port}
const backend=await port(),storage=await port()
for(const file of ['compose.yaml','compose.https.yaml','setup.mjs','.env.example','Caddyfile','storage-entrypoint.sh'])copyFileSync(join(source,'deploy',file),join(directory,'deploy',file))
const compose=readFileSync(join(directory,'deploy/compose.yaml'),'utf8').replace('name: '+manifest.server.composeProject,'name: '+project)
writeFileSync(join(directory,'deploy/compose.yaml'),compose)
const env=readFileSync(join(directory,'deploy/.env.example'),'utf8').replace('HEARTH_PORT='+manifest.server.backendPort,'HEARTH_PORT='+backend).replace('HEARTH_S3_PORT='+manifest.server.s3LoopbackPort,'HEARTH_S3_PORT='+storage).replace('http://127.0.0.1:'+manifest.server.s3LoopbackPort,'http://127.0.0.1:'+storage)
writeFileSync(join(directory,'deploy/.env.example'),env)
const archives=Object.keys(manifest.files).filter(file=>/^Hearth_Server_Test_[a-f0-9]+\.tar$/.test(file));assert.equal(archives.length,1)
linkSync(join(source,archives[0]),join(directory,archives[0]))
for(const file of Object.keys(manifest.files).filter(file=>file.startsWith('deploy/')))manifest.files[file]=createHash('sha256').update(readFileSync(join(directory,file))).digest('hex')
manifest.server.composeProject=project;manifest.server.backendPort=backend;manifest.server.s3LoopbackPort=storage
writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
const signingKey=process.env.TAURI_SIGNING_PRIVATE_KEY_PATH??join(root,'.release-keys/updater.key')
assert.equal(spawnSync(process.execPath,[join(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--private-key-path',signingKey,'--app-version',manifest.client.version,join(directory,'manifest.json')],{cwd:root,stdio:'ignore',windowsHide:true}).status,0,'Sign the disposable manifest with the local test release key')
const code=await new Promise((resolve,reject)=>{const child=spawn('cargo',['test','--locked','-p','hearth-desktop','--lib',integrityOnly?'managed_host_package_integrity':'managed_host_lifecycle_and_failed_update_restore','--','--ignored','--nocapture'],{cwd:root,env:{...process.env,HEARTH_HOST_TEST_DIR:directory},stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',resolve)})
assert.equal(code,0,'Native host/backup acceptance failed; cleanup removes only the disposable project')
const report=JSON.parse(readFileSync(join(directory,'native-report.json'),'utf8'));assert.equal(report.outcome,'pass')
mkdirSync(join(root,'target/host-controls-evidence'),{recursive:true});writeFileSync(join(root,'target/host-controls-evidence',integrityOnly?'integrity.json':'native.json'),JSON.stringify({measuredAt:new Date().toISOString(),...report},null,2)+'\n')
console.log(JSON.stringify(report))
