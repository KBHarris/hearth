// Local-only pre-publication scan. Reports never contain secret values.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {dirname,join,resolve,sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url)),report=join(root,'target/public-audit')
const scanner=join(root,'target/native-tools/gitleaks',process.platform==='win32'?'gitleaks.exe':'gitleaks')
assert.ok(existsSync(scanner),'Install the verified official Gitleaks binary first')
mkdirSync(report,{recursive:true})
const run=(args)=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});assert.equal(result.status,0,result.stderr);return result.stdout}
const files=run(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean)
const snapshot=join(report,`source-${Date.now()}`)
mkdirSync(snapshot)
let count=0
for(const file of files){
  const source=resolve(root,file),destination=resolve(snapshot,file)
  assert.ok(source.startsWith(resolve(root)+sep)&&destination.startsWith(snapshot+sep),'File escaped source snapshot')
  if(!existsSync(source))continue
  assert.ok(!lstatSync(source).isSymbolicLink(),'Audit symlink separately: '+file)
  assert.ok(!/(?:^|\/)(?:\.env|s3\.json|id_rsa|id_ed25519)$|\.(?:pfx|p12|key|pem)$/i.test(file),'Private material must not be tracked: '+file)
  mkdirSync(dirname(destination),{recursive:true});copyFileSync(source,destination);count++
}
const results={measuredAt:new Date().toISOString(),commits:Number(run(['rev-list','--all','--count']).trim()),sourceFiles:count,scans:{}}
for(const [name,args] of [['history',['git','--log-opts','--all --full-history',root]],['source',['dir',snapshot]]]){
  const path=join(report,name+'.json')
  const scan=spawnSync(scanner,[...args,'--redact=100','--ignore-gitleaks-allow','--report-format','json','--report-path',path,'--log-level','warn'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024})
  writeFileSync(join(report,name+'.log'),scan.stdout+scan.stderr)
  assert.ok([0,1].includes(scan.status)&&existsSync(path),'Secret scanner did not complete; inspect local audit log')
  const findings=JSON.parse(readFileSync(path,'utf8'))??[]
  results.scans[name]={outcome:findings.length?'review':'pass',findings:findings.map(item=>({rule:item.RuleID,file:item.File,line:item.StartLine,commit:item.Commit}))}
}
writeFileSync(join(report,'summary.json'),JSON.stringify(results,null,2)+'\n')
console.log(JSON.stringify(results,null,2))
