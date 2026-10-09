// Assemble already-built artifacts; never reads a running stack's operator secrets.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const [outputRoot,imageName,installer]=process.argv.slice(2)
assert.ok(outputRoot&&imageName&&installer,'Usage: node scripts/build-phase2-bundle.mjs OUTPUT_ROOT IMAGE INSTALLER')
function run(name,args){const result=spawnSync(name,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error(`${name} bundle command failed: ${result.stderr?.slice(-1000)??''}`);return result.stdout.trim()}
const commit=run('git',['rev-parse','HEAD']);assert.match(commit,/^[a-f0-9]{40}$/)
assert.equal(run('git',['status','--porcelain','--untracked-files=no']),'','Commit tracked source changes before freezing a bundle')
const short=commit.slice(0,7),directory=resolve(outputRoot,`phase2-${short}`)
assert.equal(dirname(directory),resolve(outputRoot));assert.ok(!existsSync(directory),'Refuse to overwrite a prepared bundle')
const info=JSON.parse(run('docker',['image','inspect',imageName]))[0]
assert.match(info.Id,/^sha256:[a-f0-9]{64}$/);assert.equal(info.Os,'linux');assert.equal(info.Architecture,'amd64')
mkdirSync(join(directory,'deploy'),{recursive:true});mkdirSync(join(directory,'client'))
const deploy=join(directory,'deploy')
for(const file of ['setup.mjs','compose.https.yaml','Caddyfile','storage-entrypoint.sh'])copyFileSync(join(root,'deploy',file),join(deploy,file))
let compose=readFileSync(join(root,'deploy/compose.yaml'),'utf8').replace('name: hearth','name: hearth-phase2-test')
const build='    build:\n      context: ..\n      dockerfile: crates/hearth-server/Dockerfile'
compose=compose.replaceAll('\r\n','\n');assert.ok(compose.includes(build))
compose=compose.replace(build,`    image: ${info.Id}\n    pull_policy: never`)
writeFileSync(join(deploy,'compose.yaml'),compose)
let env=readFileSync(join(root,'deploy/.env.example'),'utf8').replace('HEARTH_PORT=8080','HEARTH_PORT=8182').replace('HEARTH_S3_PORT=8333','HEARTH_S3_PORT=18334').replace('http://127.0.0.1:8333','http://127.0.0.1:18334')
writeFileSync(join(deploy,'.env.example'),env)
const installerName='Hearth_Phase2_0.2.0_x64-setup.exe';copyFileSync(resolve(installer),join(directory,'client',installerName))
writeFileSync(join(directory,'client/START_HERE.md'),`# Hearth Phase 2 Test\n\nInstall ${installerName} on Windows. This unsigned test build uses a separate application\nprofile from Hearth Phase 1. WebView2 may require an internet download.\n\nAsk the host for the public HTTPS server address and an account invite. Register a new\naccount, export a recovery kit and compare fingerprints over a trusted channel.\nFor communities, use a separate community invite and wait for owner approval.\nKeep both clients online for joining/history transfer. The host has the full checklist.\n\nSource commit: ${commit}. No host configuration or secrets are included in this ZIP.\n`)
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(directory,'client/SHA256SUMS.txt'),`${digest(join(directory,'client',installerName))}  ${installerName}\n`)
const zipName=`Hearth_Phase2_${short}_Windows_Test.zip`,archiveName=`Hearth_Server_Phase2_${short}.tar`
const quote=value=>"'"+value.replaceAll("'","''")+"'"
run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath @(${readdirSync(join(directory,'client')).map(f=>quote(join(directory,'client',f))).join(',')}) -DestinationPath ${quote(join(directory,zipName))}`])
run('docker',['save','--output',join(directory,archiveName),imageName])
copyFileSync(join(root,'docs/TWO_PC_PHASE2_TEST.md'),join(directory,'TWO_PC_PHASE2_TEST.md'))
writeFileSync(join(directory,'START_HOST_HERE.md'),`# Host the Phase 2 test\n\nSource: ${commit}\n\nSend your friend only [the client ZIP](${zipName}). Install it on your PC too.\nKeep this host folder in place and follow [the two-PC guide](TWO_PC_PHASE2_TEST.md).\n\nOpen PowerShell here:\n\n\`\`\`powershell\ndocker load --input ${archiveName}\nnode deploy/setup.mjs\nnode deploy/setup.mjs --show-setup-code\n\`\`\`\n\nConnect locally at http://127.0.0.1:8182 first. HTTPS needs your actual public IP/domain,\nrouter TCP 80/443 forwarding and the guide's explicit proxy handover. Existing Phase 1\ndata is preserved. Generated operator secrets belong only on the host.\n`)
const files={}
for(const f of [zipName,archiveName,'client/'+installerName,'deploy/compose.yaml','deploy/compose.https.yaml','deploy/setup.mjs','deploy/Caddyfile','deploy/storage-entrypoint.sh','deploy/.env.example','START_HOST_HERE.md','TWO_PC_PHASE2_TEST.md'])files[f]=digest(join(directory,f))
writeFileSync(join(directory,'manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),sourceCommit:commit,client:{version:'0.2.0',identifier:'chat.hearth.phase2-test',unsigned:true,profile:'independent'},server:{image:imageName,imageId:info.Id,architecture:info.Architecture,composeProject:'hearth-phase2-test',backendPort:8182,s3LoopbackPort:18334},files},null,2)+'\n')
console.log(JSON.stringify({directory,sourceCommit:commit,clientZip:zipName,serverArchive:archiveName,imageId:info.Id}))
