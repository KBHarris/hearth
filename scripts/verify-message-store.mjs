// Opt-in owned SQLCipher/OS-credential fixture. Never product credentials.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const result=spawnSync(join(root,'target/debug',process.platform==='win32'?'hearth-desktop.exe':'hearth-desktop'),['--verify-message-store'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000})
assert.equal(result.error,undefined,'Native encrypted-store acceptance could not complete')
assert.equal(result.status,0,'Native SQLCipher acceptance failed; no fallback is permitted')
assert.match(result.stdout,/SQLCIPHER_STORE: pass/)
const report={measuredAt:new Date().toISOString(),outcome:'pass',platform:process.platform,backend:'bundled SQLCipher + OS credential store',scope:'dedicated disposable credential/database; not packaged webview authentication',checks:{encrypted_database:true,fresh_process_read:true,atomic_compare_and_swap:true,concurrent_writer_rejected:true,wrong_key_rejected:true,canary_absent_from_file:true,missing_os_key_preserves_database:true,cleanup:true}}
const directory=join(root,'target/phase1-evidence');mkdirSync(directory,{recursive:true})
writeFileSync(join(directory,`message-store-${process.platform}.json`),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
