// One disposable, authenticated S3 container; no production project or volumes touched.
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {writeFileSync,rmSync,mkdirSync,readdirSync,readFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
export async function blobFixture(directory){
  const name=`hearth-blob-fixture-${randomUUID()}`,path=join(directory,'s3.json')
  const access=randomBytes(16).toString('hex'),secret=randomBytes(32).toString('hex')
  writeFileSync(path,JSON.stringify({identities:[{name:'fixture',credentials:[{accessKey:access,secretKey:secret}],actions:['Admin','Read','Write']}]}),{mode:0o600})
  const lease=createServer();await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));const port=lease.address().port;await new Promise(resolve=>lease.close(resolve))
  function docker(args){const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});if(result.error||result.status!==0)throw new Error('Isolated S3 fixture command failed');return (result.stdout+result.stderr).trim()}
  try{
    docker(['run','-d','--name',name,'--entrypoint','/bin/sh','-v',`${fileURLToPath(new URL('../deploy/storage-entrypoint.sh',import.meta.url))}:/etc/hearth/storage-entrypoint.sh:ro`,'-p',`127.0.0.1:${port}:8333`,'-v',`${path}:/etc/hearth/s3.json:ro`,'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d','/etc/hearth/storage-entrypoint.sh','server','-dir=/data','-s3','-s3.port=8333','-s3.config=/run/hearth/s3.json','-s3.allowedOrigins=http://127.0.0.1:5174,http://tauri.localhost,tauri://localhost','-master.telemetry=false'])
    const endpoint=`http://127.0.0.1:${port}`;let ready=false
    for(let i=0;i<100;i++){try{const response=await fetch(endpoint,{signal:AbortSignal.timeout(500)});if(response.status===403){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
    assert.ok(ready,'Private S3 fixture never became available')
    return {env:{HEARTH_S3_ENDPOINT:endpoint,HEARTH_S3_PUBLIC_ENDPOINT:endpoint,HEARTH_S3_ACCESS_KEY:access,HEARTH_S3_SECRET_KEY:secret},
      scan(canary){const output=join(directory,'blob-canary');mkdirSync(output,{recursive:true});docker(['cp',`${name}:/data/.`,output]);function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const p=join(path,entry.name);if(entry.isDirectory())walk(p);else assert.ok(!readFileSync(p).includes(Buffer.from(canary)),'Plaintext attachment appeared in stored object bytes')}}walk(output);assert.ok(!docker(['logs',name]).includes(canary));assert.equal(resolve(output),resolve(directory,'blob-canary'));rmSync(output,{recursive:true,force:true})},
      close(){assert.match(name,/^hearth-blob-fixture-[a-f0-9-]+$/);docker(['rm','-f',name]);rmSync(path,{force:true})}}
  }catch(error){try{docker(['rm','-f',name])}catch{}rmSync(path,{force:true});throw error}
}
