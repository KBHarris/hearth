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
writeFileSync(join(assets,'latest.json'),JSON.stringify({version,notes:'Retains your hosted server after reopening and adds signed host preparation, runtime installation, optional sign-in startup, portable server backups and outside-network checks.',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature:installerSignature,url:base+manifest.client.installer}}},null,2)+'\n')
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
const zip=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Compress-Archive -LiteralPath @(${['client','deploy',...hostFiles.filter(file=>!file.includes('/'))].map(file=>quote(join(stage,file))).join(',')}) -DestinationPath ${quote(join(assets,hostZip))}`],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(zip.status,0,'Could not assemble the allowlisted host ZIP: '+(zip.stderr??''))
const files=[clientZip,hostZip,archive,manifest.client.installer,manifest.client.installer+'.sig','server.json','server.json.sig','latest.json','manifest.json','manifest.json.sig']
// A small signed catalog and a host-only TAR support in-app preparation on every desktop OS.
const hostTar = `Hearth_Host_${version}.tar`
const preparedFiles = ['manifest.json','manifest.json.sig',archive,'deploy/compose.yaml','deploy/compose.https.yaml','deploy/setup.mjs','deploy/.env.example','deploy/Caddyfile','deploy/storage-entrypoint.sh']
const packed = spawnSync('tar', ['-cf', join(assets,hostTar), ...preparedFiles], {cwd:directory, encoding:'utf8', windowsHide:true})
assert.equal(packed.status,0,'Could not assemble the host-only TAR')
writeFileSync(join(assets,'host-package.json'),JSON.stringify({schema:1,version,min_client_version:'0.3.5',architecture:manifest.server.architecture,archive_url:base+hostTar,archive_sha256:digest(join(assets,hostTar))},null,2)+'\n')
sign(join(assets,'host-package.json'))
files.push(hostTar,'host-package.json','host-package.json.sig')
writeFileSync(join(assets,'SHA256SUMS.txt'),files.map(file=>`${digest(join(assets,file))}  ${file}`).join('\n')+'\n')
writeFileSync(join(assets,'RELEASE_NOTES.md'),`# Hearth Preview ${version}\n\nWindows x64 Host/Join preview. Download ${clientZip} for a client, or ${hostZip} for an extracted host package. Existing hosts can keep their current server and configuration while updating the desktop app.\n\nAdds saved-host recovery after reopening, including when browser server storage is empty or Docker is unavailable. Adds signed host-package preparation, explicit runtime installation, optional start-at-sign-in, portable backup/export and fresh-host restore, and a timed outside-network check bound to the server identity. Package downloads require this release's signed catalog and TAR assets to be published. The network location in outside-check results is declared by the tester; it is not geolocated or cryptographically attested.\n\nBackup exports contain private server keys and credentials along with encrypted history. Keep them on protected storage. Keep the original server stopped when restoring onto another computer. Hearth refuses fresh import over an existing host's volumes. Runtime installers retain their own OS permission and license prompts. No third-party tunnel or probe is enrolled automatically.\n\nLocal web, Windows/Linux compilation, isolated Docker recovery and Windows native checks are recorded in the repository. The installed upgrade verifies that the existing host stays running and its entry reappears with empty browser storage. Clean Windows runtime provisioning, reboot/sign-in execution, new two-household messaging and macOS/Linux installation acceptance remain open. Earlier Phase 3 buddy acceptance does not close these checks. The Windows installer has no Authenticode publisher signature; Hearth verifies updater signatures.\n\nSource: ${manifest.sourceCommit}\n`)
console.log(JSON.stringify({directory:assets,version,assets:[...files,'SHA256SUMS.txt'],sourceCommit:manifest.sourceCommit}))
