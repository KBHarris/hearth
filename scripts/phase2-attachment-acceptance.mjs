import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
export async function verifyAttachments({storage,alice,bob,carol,id,news,request,json,op,view,submitted,ready,checks,scanDatabase}){
  if(!storage){checks.attachments_require_configured_private_storage=(await request(`/api/v1/blobs/${id}`,{id:'f'.repeat(64),device_key:alice.identity.enrollment.device_key,cipher_bytes:17,digest:'e'.repeat(64)},alice.session.token)).status===503;assert.ok(checks.attachments_require_configured_private_storage);return}
  const canary='HEARTH_ATTACHMENT_CANARY_private_file'
  const plaintext=Buffer.from((canary+'\n').repeat(30000)),filename=canary+'.txt'
  async function upload(install,channel,name,mime,bytes){
    const prepared=json(install.client,'prepare_file',{id:channel,name,mime,plaintext:bytes.toString('hex')})
    assert.equal(prepared.file.bytes,bytes.length);assert.equal(prepared.key,undefined)
    assert.ok(!Buffer.from(prepared.ciphertext,'hex').includes(Buffer.from(canary)))
    install.sealed=op(install.client,'seal')
    const body={id:prepared.file.id,device_key:install.identity.enrollment.device_key,cipher_bytes:prepared.file.cipher_bytes,digest:prepared.file.digest}
    assert.equal((await request(`/api/v1/blobs/${channel}`,body)).status,401)
    const reserved=await request(`/api/v1/blobs/${channel}`,body,install.session.token)
    assert.equal(reserved.status,200);const bytesOut=Buffer.from(prepared.ciphertext,'hex')
    assert.notEqual((await fetch(reserved.value.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from('wrong-size')})).status,200,'PUT signature must reject a different ciphertext length')
    assert.equal((await fetch(reserved.value.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:bytesOut})).status,200)
    assert.equal((await fetch(reserved.value.url.split('?')[0])).status,403)
    assert.equal((await request(`/api/v1/blobs/${channel}/${body.id}/complete`,{device:install.identity.enrollment.device_key},install.session.token)).status,204)
    assert.equal((await request(`/api/v1/blobs/${channel}`,body,install.session.token)).status,409)
    return {...prepared,lease:reserved.value.url,reservation:body}
  }
  const file=await upload(alice,id,filename,'text/plain',plaintext)
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNwmPD/PwgzwBgAX7ILOaSjuloAAAAASUVORK5CYII=','base64')
  const preview=await upload(alice,id,'preview.png','image/png',png)
  const sent=json(alice.client,'send_file',{id,file:file.file.id,thumbnail:preview.file.id,text:'Encrypted file fixture'})
  await submitted(alice,id,sent,'message');await ready(()=>view(bob.client).messages.some(m=>m.id===sent.operation_id))
  const local=view(bob.client).messages.find(m=>m.id===sent.operation_id).attachments[0]
  assert.equal(local.name,filename);assert.equal(local.key,undefined);assert.equal(local.thumbnail.id,preview.file.id)
  const url=await request(`/api/v1/blobs/${id}/${local.id}?device=${bob.identity.enrollment.device_key}`,undefined,bob.session.token)
  assert.equal(url.status,200);assert.equal(url.headers.get('cache-control'),'no-store')
  assert.equal((await request(`/api/v1/blobs/${id}/${local.id}?device=${carol.identity.enrollment.device_key}`,undefined,bob.session.token)).status,403)
  const encrypted=Buffer.from(await (await fetch(url.value.url)).arrayBuffer()).toString('hex')
  const open=ciphertext=>json(bob.client,'open_file',{id,file:local.id,ciphertext})
  assert.equal(open(encrypted),plaintext.toString('hex'))
  assert.throws(()=>open(encrypted.slice(0,-2)))
  assert.throws(()=>open('00'+encrypted.slice(2)))
  assert.throws(()=>json(bob.client,'open_file',{id:news,file:local.id,ciphertext:encrypted}))
  const sealed=op(bob.client,'seal');bob.client.openMessaging(sealed,bob.session.account.id,(await request('/.well-known/hearth')).value.server_key)
  assert.equal(open(encrypted),plaintext.toString('hex'))
  assert.ok(!Buffer.from(sealed,'hex').includes(Buffer.from(canary)))
  checks.encrypted_chunked_attachment_download_tamper_scope_and_sealed_restart_pass=true
  assert.equal(json(bob.client,'open_file',{id,file:preview.file.id,ciphertext:preview.ciphertext}),png.toString('hex'))
  checks.encrypted_thumbnail_and_local_view_exclude_file_keys=true
  assert.throws(()=>json(bob.client,'send_file',{id,file:local.id,emoji:'party',text:''}))
  const emoji=json(alice.client,'send_file',{id,file:preview.file.id,emoji:'party',text:''})
  await submitted(alice,id,emoji,'message');await ready(()=>!!view(bob.client).emoji[id]?.party)
  assert.equal(view(bob.client).emoji[id].party.key,undefined)
  checks.owner_custom_emoji_is_encrypted_and_member_definition_is_rejected=true
  assert.throws(()=>json(bob.client,'prepare_file',{id:news,name:'no.txt',mime:'text/plain',plaintext:'00'}))
  await scanDatabase(canary);storage.scan(canary)
  checks.attachment_canary_absent_from_host_database_logs_and_s3_volume=true
  if(process.argv.includes('--phase3')){
    const bytes=Buffer.alloc(50_000_000,0x5a),large=await upload(bob,id,'boundary-50MB.bin','application/octet-stream',bytes)
    assert.equal(large.file.cipher_bytes,50_000_768)
    const uploadMessage=json(bob.client,'send_file',{id,file:large.file.id,text:'50 MB boundary fixture'})
    await submitted(bob,id,uploadMessage,'message');await ready(()=>view(alice.client).messages.some(m=>m.id===uploadMessage.operation_id))
    const decrypted=Buffer.from(json(alice.client,'open_file',{id,file:large.file.id,ciphertext:large.ciphertext}),'hex')
    assert.equal(createHash('sha256').update(decrypted).digest('hex'),createHash('sha256').update(bytes).digest('hex'))
    assert.equal((await request(`/api/v1/blobs/${id}`,{...large.reservation,id:randomBytes(32).toString('hex'),cipher_bytes:50_000_769},bob.session.token)).status,400)
    checks.exact_50MB_encrypted_round_trip_and_over_limit_rejection_pass=true
    const path=`/api/v1/blobs/${id}/${large.file.id}?device=${alice.identity.enrollment.device_key}`
    const before=await request(path,undefined,alice.session.token);assert.equal(before.status,200)
    assert.equal((await request(path,undefined,bob.session.token,'DELETE')).status,403)
    assert.equal((await request(path.replace(alice.identity.enrollment.device_key,bob.identity.enrollment.device_key),undefined,alice.session.token,'DELETE')).status,403)
    assert.equal((await request(path,undefined,undefined,'DELETE')).status,401)
    assert.equal((await request(path,undefined,alice.session.token,'DELETE')).status,204)
    assert.equal((await request(path,undefined,alice.session.token,'DELETE')).status,204)
    assert.equal((await request(path,undefined,alice.session.token)).status,410)
    assert.equal((await fetch(before.value.url)).status,404)
    // An already-issued PUT may still finish. It must never restore readable state.
    assert.equal((await fetch(large.lease,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:Buffer.from(large.ciphertext,'hex')})).status,200)
    assert.equal((await request(`/api/v1/blobs/${id}/${large.file.id}/complete`,{device:bob.identity.enrollment.device_key},bob.session.token)).status,410)
    assert.equal((await request(`/api/v1/blobs/${id}`,large.reservation,bob.session.token)).status,410)
    assert.equal((await request(path,undefined,alice.session.token)).status,410)
    assert.equal((await request(path,undefined,alice.session.token,'DELETE')).status,204)
    assert.equal((await fetch(before.value.url)).status,404)
    checks.operator_removal_blocks_uploader_wrong_device_and_late_lease_resurrection=true
  }
}
