// Prepare reviewable signed release assets locally; publishing is a separate command.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,copyFileSync,existsSync,mkdirSync} from 'node:fs'
import {join,resolve,basename} from 'node:path'
const root=resolve('.'),directory=resolve(process.argv[2]??'')
assert.ok(process.argv[2],'Usage: node scripts/prepare-release.mjs BUNDLE')
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')),validation=JSON.parse(readFileSync(join(directory,'VALIDATION.json'),'utf8'))
assert.equal(validation.outcome,'pass');assert.equal(validation.sourceCommit,manifest.sourceCommit);assert.ok(Object.values(validation.checks).every(value=>value===true))
const version=manifest.client.version;assert.match(version,/^\d+\.\d+\.\d+$/)
const key=process.env.TAURI_SIGNING_PRIVATE_KEY_PATH??join(root,'.release-keys/updater.key');assert.ok(existsSync(key),'Private signing key is required locally, never in a distribution')
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
for(const [file,hash] of Object.entries(manifest.files))assert.equal(digest(join(directory,file)),hash)
function sign(path){const result=spawnSync(process.execPath,[join(root,'node_modules/@tauri-apps/cli/tauri.js'),'signer','sign','--private-key-path',key,'--app-version',version,path],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,'Release signing failed; private output was not printed');return readFileSync(path+'.sig','utf8').trim()}
const assets=join(directory,'release-assets');assert.ok(!existsSync(assets),'Refuse to overwrite prepared release assets');mkdirSync(assets)
const base=`https://github.com/KBHarris/hearth/releases/download/v${version}/`
const installer=join(directory,'client',manifest.client.installer),installerSignature=sign(installer)
const archive=Object.keys(manifest.files).find(file=>/^Hearth_Server_Test_[a-f0-9]+\.tar$/.test(file));assert.ok(archive)
const server={schema:1,version,min_client_version:'0.3.1',source_commit:manifest.sourceCommit,image_id:manifest.server.imageId,archive_url:base+archive,archive_sha256:manifest.files[archive]}
writeFileSync(join(assets,'server.json'),JSON.stringify(server,null,2)+'\n');sign(join(assets,'server.json'))
writeFileSync(join(assets,'latest.json'),JSON.stringify({version,notes:'Desktop hosting no longer requires Node.js. Owner setup can authorize the selected local host without copying its private code; ordered service shutdown has a bounded grace period.',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature:installerSignature,url:base+manifest.client.installer}}},null,2)+'\n')
const clientZip=Object.keys(manifest.files).find(file=>file.endsWith('.zip'));assert.ok(clientZip)
for(const file of [clientZip,archive])copyFileSync(join(directory,file),join(assets,file))
copyFileSync(installer,join(assets,manifest.client.installer));copyFileSync(installer+'.sig',join(assets,manifest.client.installer+'.sig'))
copyFileSync(join(directory,'manifest.json'),join(assets,'manifest.json'));sign(join(assets,'manifest.json'))
const hostZip=`Hearth_Host_${version}_Windows_x64.zip`,hostFiles=[...Object.keys(manifest.files),'manifest.json','manifest.json.sig']
// Explicit manifest allowlist: operator configuration, profiles and keys cannot enter this ZIP.
assert.ok(hostFiles.every(file=>!/(?:^|\/)(?:\.env|s3\.json|\.release-keys)(?:\/|$)/.test(file)&&!file.includes('..')))
const quote=value=>"'"+value.replaceAll("'","''")+"'"
const stage=join(directory,'release-host');mkdirSync(stage)
for(const file of hostFiles){const target=join(stage,file);mkdirSync(resolve(target,'..'),{recursive:true});copyFileSync(join(directory,file),target)}
const zip=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath @(${['client','deploy',...hostFiles.filter(file=>!file.includes('/'))].map(file=>quote(join(stage,file))).join(',')}) -DestinationPath ${quote(join(assets,hostZip))}`],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(zip.status,0,'Could not assemble the allowlisted host ZIP')
const files=[clientZip,hostZip,archive,manifest.client.installer,manifest.client.installer+'.sig','server.json','server.json.sig','latest.json','manifest.json','manifest.json.sig']
writeFileSync(join(assets,'SHA256SUMS.txt'),files.map(file=>`${digest(join(assets,file))}  ${file}`).join('\n')+'\n')
writeFileSync(join(assets,'RELEASE_NOTES.md'),`Hearth Preview ${version} is a Windows x64 preview for the two-PC test.\n\nDownload ${clientZip} for a client, or ${hostZip} to host. Hosting controls require Docker Desktop running. Node.js is needed only for the advanced CLI. Read START_HOST_HERE.md in the host ZIP.\n\nAdds native host configuration without a Node.js prerequisite, protected in-memory local owner enrollment and enough time for ordered Docker shutdown. Shares only grouped pretty invite codes, with a separate server address. A host connected locally can prepare codes for its public HTTPS address without routing account credentials through that public address. The recipient enters the address and code in Join a server. Adds explicit public HTTPS checks and a compatible native deep-link dependency pin for Linux. Existing host startup safeguards and installed-version display remain included.\n\nIncludes 50 MB encrypted files, owner file removal, member sidebar/profile fingerprints, readable 32-character invite codes, UI server controls, and signed app/server updates with verified rollback backups.\n\nLocal source, real HTTP/private-S3, browser and Windows checks are recorded in the repository. The user waived the clean buddy-PC/two-house and actual OS push gates for this preview; these are not measured passes. Current hosted acceptance is recorded separately in the repository. The Windows installer has no Authenticode publisher signature; update signatures are verified by Hearth.\n\nSource: ${manifest.sourceCommit}\n`)
console.log(JSON.stringify({directory:assets,version,assets:[...files,'SHA256SUMS.txt'],sourceCommit:manifest.sourceCommit}))
