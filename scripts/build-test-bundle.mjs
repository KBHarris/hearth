// Assemble already-built artifacts; never reads a running stack's operator secrets.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
const [outputRoot,imageName,installer]=process.argv.slice(2)
assert.ok(outputRoot&&imageName&&installer,'Usage: node scripts/build-test-bundle.mjs OUTPUT_ROOT IMAGE INSTALLER')
function run(name,args){const result=spawnSync(name,args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error(`${name} bundle command failed: ${result.stderr?.slice(-1000)??''}`);return result.stdout.trim()}
const commit=run('git',['rev-parse','HEAD']);assert.match(commit,/^[a-f0-9]{40}$/)
run('git',['diff','--exit-code','HEAD','--']);assert.equal(run('git',['ls-files','--others','--exclude-standard']),'','Commit source changes before freezing a bundle')
assert.equal(JSON.parse(run('docker',['image','inspect',imageName]))[0].Config.Labels?.['org.opencontainers.image.revision'],commit,'Server image must name the frozen source commit');
const short=commit.slice(0,7),directory=resolve(outputRoot,`guided-${short}`)
assert.equal(dirname(directory),resolve(outputRoot));assert.ok(!existsSync(directory),'Refuse to overwrite a prepared bundle')
const info=JSON.parse(run('docker',['image','inspect',imageName]))[0]
assert.match(info.Id,/^sha256:[a-f0-9]{64}$/);assert.equal(info.Os,'linux');assert.equal(info.Architecture,'amd64')
mkdirSync(join(directory,'deploy'),{recursive:true});mkdirSync(join(directory,'client'))
const deploy=join(directory,'deploy')
for(const file of ['setup.mjs','compose.https.yaml','Caddyfile','storage-entrypoint.sh'])copyFileSync(join(root,'deploy',file),join(deploy,file))
let compose=readFileSync(join(root,'deploy/compose.yaml'),'utf8').replace('name: hearth','name: hearth-guided-test')
const build='    build:\n      context: ..\n      dockerfile: crates/hearth-server/Dockerfile'
compose=compose.replaceAll('\r\n','\n');assert.ok(compose.includes(build))
compose=compose.replace(build,`    image: ${info.Id}\n    pull_policy: never`)
writeFileSync(join(deploy,'compose.yaml'),compose)
let env=readFileSync(join(root,'deploy/.env.example'),'utf8').replace('HEARTH_PORT=8080','HEARTH_PORT=8183').replace('HEARTH_S3_PORT=8333','HEARTH_S3_PORT=18335').replace('http://127.0.0.1:8333','http://127.0.0.1:18335')
writeFileSync(join(deploy,'.env.example'),env)
const installerName='Hearth_Test_0.3.0_x64-setup.exe';copyFileSync(resolve(installer),join(directory,'client',installerName))
writeFileSync(join(directory,'client/START_HERE.txt'),`Hearth Test 0.3.0 - Windows x64

1. Extract this ZIP, then run ${installerName}. This is an unsigned test build; Windows may show an unknown-publisher warning. WebView2 may download if missing.
2. Open Hearth Test, choose Join a server and paste the complete invite your host sends separately. Check it, then continue. Do not use localhost to reach your buddy.
3. Create your account, then choose Join invited community. Keep both apps online while your host approves your device. If you already have an account on this new test server, choose Sign in.
4. Test a DM, community messages, a small file and reopening the app. Compare identity fingerprints with your host over your existing trusted call.

Invites are pasted into Hearth; click-to-open is not supported yet. You do not need Docker, Node or the owner's setup code. Keep your password and recovery kit private.

Source: ${commit}
Installer SHA-256 is in SHA256SUMS.txt. This ZIP contains no host configuration, account invite, setup code or recovery kit.
`)
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
writeFileSync(join(directory,'client/SHA256SUMS.txt'),`${digest(join(directory,'client',installerName))}  ${installerName}\n`)
const zipName=`Hearth_Test_${short}_Windows_x64.zip`,archiveName=`Hearth_Server_Test_${short}.tar`
const quote=value=>"'"+value.replaceAll("'","''")+"'"
run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath @(${readdirSync(join(directory,'client')).map(f=>quote(join(directory,'client',f))).join(',')}) -DestinationPath ${quote(join(directory,zipName))}`])
run('docker',['save','--output',join(directory,archiveName),imageName])
copyFileSync(join(root,'docs/TWO_PC_LATEST_TEST.md'),join(directory,'TWO_PC_LATEST_TEST.md'))
writeFileSync(join(directory,'START_HOST_HERE.md'),`# Host the latest Hearth test

Source: ${commit}

Send only [the friend ZIP](${zipName}) to your buddy. Install that client on your PC too.
Follow [the two-PC guide](TWO_PC_LATEST_TEST.md). The fresh server uses backend 8183, S3 18335 and Compose project hearth-guided-test. Existing test servers and profiles are preserved.

The app checks an existing server; host service installation still uses Docker and Node.js 22+. Start locally, configure HTTPS, verify access from another network, then create the combined account/community invite in the owner client. Keep operator files on the host and share the invite privately.
`)
const files={}
for(const f of [zipName,archiveName,'client/'+installerName,'deploy/compose.yaml','deploy/compose.https.yaml','deploy/setup.mjs','deploy/Caddyfile','deploy/storage-entrypoint.sh','deploy/.env.example','client/START_HERE.txt','client/SHA256SUMS.txt','START_HOST_HERE.md','TWO_PC_LATEST_TEST.md'])files[f]=digest(join(directory,f))
writeFileSync(join(directory,'manifest.json'),JSON.stringify({builtAt:new Date().toISOString(),sourceCommit:commit,client:{version:'0.3.0',identifier:'chat.hearth.phase3-test',unsigned:true,profile:'independent',installer:installerName},server:{image:imageName,imageId:info.Id,architecture:info.Architecture,composeProject:'hearth-guided-test',backendPort:8183,s3LoopbackPort:18335},files},null,2)+'\n')
console.log(JSON.stringify({directory,sourceCommit:commit,clientZip:zipName,serverArchive:archiveName,imageId:info.Id}))
