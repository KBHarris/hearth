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
const hostTar = `Hearth_Host_${version}.tar`
const preparedFiles = ['manifest.json','manifest.json.sig',archive,'deploy/compose.yaml','deploy/compose.https.yaml','deploy/setup.mjs','deploy/.env.example','deploy/Caddyfile','deploy/storage-entrypoint.sh','deploy/compose.media.yaml','deploy/compose.turn.yaml','deploy/compose.turn-tls.yaml','deploy/media/setup.mjs','deploy/media/turn-entrypoint.sh']
const packed = spawnSync('tar', ['-cf', join(assets,hostTar), ...preparedFiles], {cwd:directory, encoding:'utf8', windowsHide:true})
assert.equal(packed.status,0,'Could not assemble the host-only TAR')
const server={schema:1,version,min_client_version:version,source_commit:manifest.sourceCommit,image_id:manifest.server.imageId,archive_url:base+archive,archive_sha256:manifest.files[archive],host_archive_sha256:digest(join(assets,hostTar))}
writeFileSync(join(assets,'server.json'),JSON.stringify(server,null,2)+'\n');sign(join(assets,'server.json'))
writeFileSync(join(assets,'latest.json'),JSON.stringify({version,notes:'A simpler, friendlier Hearth: communities on the left rail, one Settings menu, tabs instead of expandable sections, plain wording throughout and a clear message when a username or password is wrong. Update both the app and the hosted server.',pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature:installerSignature,url:base+manifest.client.installer}}},null,2)+'\n')
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
writeFileSync(join(assets,'host-package.json'),JSON.stringify({schema:1,version,min_client_version:version,architecture:manifest.server.architecture,archive_url:base+hostTar,archive_sha256:digest(join(assets,hostTar))},null,2)+'\n')
sign(join(assets,'host-package.json'))
files.push(hostTar,'host-package.json','host-package.json.sig')
writeFileSync(join(assets,'SHA256SUMS.txt'),files.map(file=>`${digest(join(assets,file))}  ${file}`).join('\n')+'\n')
writeFileSync(join(assets,'RELEASE_NOTES.md'),`# Hearth Preview ${version}

A simpler, friendlier Hearth. Nothing about how messages are encrypted or stored has changed in this release; it is a redesign of what you see and read.

What is new
- Layout: your communities sit on the left rail with a Home button for direct messages, and the sidebar shows the channels of the community you are in. Server switching, Add server and Hosting & updates moved to the bottom of the rail.
- One Settings menu beside your name (profile and status, privacy, devices and backup, server settings, sign out) replaces the row of sidebar links.
- Messages: Reply, Open thread, Pin, Edit, Delete and Report appear when you point at a message (always shown on touch screens, or switch them on permanently under Privacy). Polls, events, watch-together and attachments live under the + beside the message box. Enter sends; Shift+Enter starts a new line.
- No more expandable arrows: Account & devices, Hosting & updates, the server test and device linking use tabs or plain sections. Hosting is laid out as numbered steps, with Backups and Updates on their own tabs.
- Plain wording everywhere, including error and status messages from messaging, calls, hosting, updates and backups. "Identity fingerprint" is now "safety code", a "passphrase" is a "backup password", and the hosting "runtime" is "hosting tools (Docker Desktop)".
- Sign-in: a wrong username or password now says so clearly beside the Sign in button, and Hearth remembers the username you last used on each server.
- Fixed: keyboard focus could leave a dialog that contained a collapsed section.

Updating
Update the Windows app first, then the hosted server (Hosting & updates, Updates tab). The server update makes and checks a backup first and keeps your server settings, keys and saved messages. The server itself only changes version in this release.

Known limits
Automated local checks and their limits are recorded in docs/PROGRESS.md. Clean-machine installs, two-household network tests, physical audio/video devices and non-Windows packaging still need manual testing. A local health check does not prove your server can be reached from the internet. Backup exports contain private server keys and passwords; keep them protected. The Windows installer has no publisher signature yet, so Windows shows an unknown-publisher warning; Hearth's own update signatures are verified. Spotify playback remains disabled.

Source: ${manifest.sourceCommit}
`)
console.log(JSON.stringify({directory:assets,version,assets:[...files,'SHA256SUMS.txt'],sourceCommit:manifest.sourceCommit}))
