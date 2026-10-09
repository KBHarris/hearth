// Reproduce Linux 0600 host-file ownership inside a disposable container, even on Windows.
import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {createServer} from 'node:net'
import {fileURLToPath} from 'node:url'
const name=`hearth-storage-permissions-${randomUUID()}`,image='chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d'
function docker(args,input){const result=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true});if(result.error||result.status!==0)throw new Error('Storage permissions fixture command failed');return result.stdout.trim()}
const config=JSON.stringify({identities:[{name:'fixture',credentials:[{accessKey:randomBytes(16).toString('hex'),secretKey:randomBytes(32).toString('hex')}],actions:['Admin','Read','Write']}]})
const lease=createServer();await new Promise(resolve=>lease.listen(0,'127.0.0.1',resolve));const port=lease.address().port;await new Promise(resolve=>lease.close(resolve))
try{
  // This file belongs to an unrelated UID; seaweed must remain unable to read it.
  docker(['run','-d','--name',name,'--entrypoint','/bin/sh','-p',`127.0.0.1:${port}:8333`,'-v',`${fileURLToPath(new URL('../deploy/storage-entrypoint.sh',import.meta.url))}:/etc/hearth/storage-entrypoint.sh:ro`,image,'-c','mkdir -p /etc/hearth; while [ ! -f /etc/hearth/ready ]; do sleep 0.1; done; su-exec seaweed test ! -r /etc/hearth/s3.json; exec /bin/sh /etc/hearth/storage-entrypoint.sh server -dir=/data -s3 -s3.port=8333 -s3.config=/run/hearth/s3.json -master.telemetry=false'])
  docker(['exec','-i',name,'/bin/sh','-c','cat > /etc/hearth/s3.json; chown 65534:65534 /etc/hearth/s3.json; chmod 600 /etc/hearth/s3.json; touch /etc/hearth/ready'],config)
  let ready=false
  for(let attempt=0;attempt<100;attempt++){try{if((await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)})).status===403){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,200))}
  assert.ok(ready,'Private storage did not start with the unrelated-UID host configuration')
  assert.equal(docker(['exec',name,'stat','-c','%a','/run/hearth/s3.json']),'600')
  docker(['exec',name,'su-exec','seaweed','sh','-c','test -r /run/hearth/s3.json && test ! -r /etc/hearth/s3.json'])
  console.log(JSON.stringify({outcome:'pass',private_host_file_preserved:true,service_owned_copy_mode_600:true,anonymous_request_rejected:true}))
}finally{assert.match(name,/^hearth-storage-permissions-[a-f0-9-]+$/);docker(['rm','-f',name])}
