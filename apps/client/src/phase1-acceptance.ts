import {verifyPackagedPhase3} from './phase3-acceptance'
// Opt-in bundled harness: uses the product worker, SDK, session and storage commands.
import {invoke,isTauri} from '@tauri-apps/api/core'
import {HearthClient,HearthError,type Session,type DeviceEnrollment} from '@hearth/sdk'
import {AuthCrypto,AuthCryptoError} from './crypto/client'
import {createIdentity,readIdentity,identityScope} from './crypto/vault-store'
import {messageScope,readMessages,writeMessages} from './crypto/message-store'
import {MessagingSession,initialChat,type ChatState} from './crypto/messaging-session'

type Install={crypto:AuthCrypto;session:Session;device:DeviceEnrollment;service?:MessagingSession;state:ChatState}
const installs:Install[]=[]
const checks:Record<string,boolean>={}
let stage='bootstrap'
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
function require(value:unknown){if(!value)throw new Error('Acceptance assertion failed')}
async function until(predicate:()=>boolean){for(let i=0;i<400;i++){for(const install of installs)if(install.state.fatal)throw new Error('Encrypted storage failed');if(predicate())return;await pause(100)}throw new Error('Acceptance timed out')}

async function run(){
  require(isTauri())
  const config=await invoke<{origin:string;serverKey:string;setupCode:string;storage?:boolean;phase3?:boolean}>('phase1_config')
  // Pace multi-account automated bursts against the unchanged server limits.
  const requestTimes:number[]=[]
  const fixtureFetch=window.fetch.bind(window)
  window.fetch=(...args)=>{if(String(args[0]).includes('/api/v1/'))requestTimes.push(Date.now());return fixtureFetch(...args)}
  const pace=async()=>{for(let i=0;i<900;i++){if(requestTimes.filter(at=>Date.now()-at<65000).length<50)return;await pause(100)}throw new Error('Acceptance timed out')}
  const client=new HearthClient(config.origin)
  const server=config.serverKey
  const password='HEARTH_PACKAGED_FIXTURE_PASSWORD_private_only'
  const canary='HEARTH_PACKAGED_MESSAGE_CANARY_private_content'
  async function register(username:string,owner=false){
    const crypto=new AuthCrypto()
    try{
      stage=`${username} registration crypto start`
      const message=await crypto.request('registrationStart',password)
      stage=`${username} registration server start`
      const response=owner?await client.ownerStart({username,message,setup_code:config.setupCode}):await client.registerStart({username,message,invite_code:null})
      stage=`${username} registration crypto finish`
      const upload=await crypto.request('registrationFinish',password,response.message,username,server)
      stage=`${username} registration server finish`
      if(owner)await client.ownerFinish({username,message:upload,setup_code:config.setupCode})
      else await client.registerFinish({username,message:upload,invite_code:null})
    }finally{crypto.close()}
  }
  async function login(username:string):Promise<Install>{
    const crypto=new AuthCrypto()
    stage=`${username} login crypto start`
    const message=await crypto.request('loginStart',password)
    stage=`${username} login server start`
    const response=await client.loginStart({username,message})
    stage=`${username} login crypto finish`
    const proof=await crypto.request('loginFinish',password,response.message,username,server)
    stage=`${username} login server finish`
    const session=await client.loginFinish({exchange_id:response.exchange_id,message:proof})
    const scope=identityScope(session.account.id,server)
    stage=`${username} identity store read`
    const saved=await readIdentity(scope)
    stage=`${username} identity prepare`
    const prepared=JSON.parse(await crypto.request('prepareIdentity','',saved ?? undefined,session.account.id,server)) as {envelope:string;enrollment:DeviceEnrollment}
    stage=`${username} identity store create`
    const durable=await createIdentity(scope,prepared.envelope)
    require(durable===prepared.envelope)
    stage=`${username} device enrollment`
    await client.enrollFirstDevice(session.token,prepared.enrollment)
    stage=`${username} identity commit`
    await crypto.request('commitIdentity','')
    const install={crypto,session,device:prepared.enrollment,state:initialChat}
    installs.push(install);return install
  }
  async function start(install:Install){
    install.service=new MessagingSession(install.crypto,install.session,install.device,server,config.origin,state=>{install.state=state})
    await install.service.start()
    await until(()=>install.state.connection==='Connected')
  }
  stage='owner authentication'
  await register('alice',true)
  const alice=await login('alice')
  stage='owner server settings'
  await client.configureServer(alice.session.token,{server_name:'Packaged acceptance',registration_mode:'open'})
  await register('bob')
  const bob=await login('bob')
  checks.packaged_worker_opaque_and_native_identity_vault=true
  stage='encrypted conversation'
  await start(alice);await start(bob)
  const id=await alice.service!.create(['bob'])
  await until(()=>bob.state.joined.includes(id))
  await alice.service!.send(id,{kind:'text',text:canary,reply_to:null})
  await until(()=>bob.state.messages.some(message=>message.text===canary))
  const original=bob.state.messages.find(message=>message.text===canary)!
  await bob.service!.send(id,{kind:'text',text:'Packaged reply',reply_to:original.id})
  await until(()=>alice.state.messages.some(message=>message.reply_to===original.id))
  await alice.service!.send(id,{kind:'edit',id:original.id,text:canary+' edited'})
  await until(()=>bob.state.messages.some(message=>message.id===original.id && message.edited))
  await alice.service!.send(id,{kind:'delete',id:original.id})
  await until(()=>bob.state.messages.some(message=>message.id===original.id && message.deleted))
  checks.packaged_authenticated_gateway_text_reply_edit_delete=true
  stage='durable storage'
  const scope=messageScope(bob.session.account.id,server,bob.device.device_key)
  const saved=await readMessages(scope)
  const canaryHex=Array.from(new TextEncoder().encode(canary),byte=>byte.toString(16).padStart(2,'0')).join('')
  require(saved && !saved.envelope.includes(canaryHex))
  let rejected=false
  try{await writeMessages(scope,0,saved!.envelope)}catch{rejected=true}
  require(rejected)
  checks.packaged_sqlcipher_compare_and_swap_preserves_state=true
  bob.service!.close();bob.crypto.close()
  await alice.service!.send(id,{kind:'text',text:canary+' offline',reply_to:null})
  const resumed=await login('bob')
  require(resumed.device.device_key===bob.device.device_key)
  stage='offline messaging resume'
  await start(resumed)
  stage='offline backlog receive'
  await until(()=>resumed.state.messages.some(message=>message.text===canary+' offline'))
  require(resumed.state.messages.some(message=>message.id===original.id && message.deleted))
  checks.fresh_worker_restores_native_keys_sqlcipher_history_and_offline_backlog=true
  stage='recovery export'
  const phrase='HEARTH_PACKAGED_RECOVERY_FIXTURE_private_only'
  const kit=await alice.crypto.request('exportRecovery',phrase,undefined,alice.session.account.id,server)
  stage='recovery authentication'
  const recovery=new AuthCrypto()
  const response=await client.loginStart({username:'alice',message:await recovery.request('loginStart',password)})
  const session=await client.loginFinish({exchange_id:response.exchange_id,message:await recovery.request('loginFinish',password,response.message,'alice',server)})
  stage='recovery wrong passphrase rejection'
  let wrongRejected=false
  try{await recovery.request('restoreIdentity','wrong passphrase',kit,session.account.id,server)}catch{wrongRejected=true}
  require(wrongRejected)
  stage='recovery identity restore'
  const restored=JSON.parse(await recovery.request('restoreIdentity',phrase,kit,session.account.id,server)) as {envelope:string;enrollment:DeviceEnrollment}
  require(restored.enrollment.identity_key===alice.device.identity_key && restored.enrollment.device_key!==alice.device.device_key)
  stage='recovery device approval'
  await client.restoreDevice(session.token,{enrollment:restored.enrollment,link_id:null})
  await recovery.request('commitIdentity','')
  const linked:Install={crypto:recovery,session,device:restored.enrollment,state:initialChat};installs.push(linked)
  stage='recovery device start'
  await start(linked)
  stage='recovery group join'
  await until(()=>linked.state.joined.includes(id))
  stage='recovery old history exclusion'
  require(linked.state.messages.length===0)
  stage='recovery new message send'
  await alice.service!.send(id,{kind:'text',text:canary+' restored',reply_to:null})
  stage='recovery new message receive'
  await until(()=>linked.state.messages.some(message=>message.text===canary+' restored'))
  checks.recovery_fresh_device_rekeys_and_reads_new_messages_without_old_history=true
  stage='existing install identity preservation'
  require((await readIdentity(identityScope(alice.session.account.id,server)))!==restored.envelope)
  checks.existing_install_identity_is_preserved=true
  stage='signed community admission and history'
  const community=await client.createCommunity(alice.session.token,'Packaged community')
  await alice.service!.secureCommunity(community.id)
  const channel=await client.createChannel(alice.session.token,community.id,{name:'packaged-channel',category_id:null,kind:'text'})
  await alice.service!.secureChannel(channel.id);await alice.service!.openChannel(channel.id)
  await alice.service!.setHistory(channel.id,'since_invite')
  await alice.service!.send(channel.id,{kind:'text',text:canary+' before invitation',reply_to:null})
  const invite=await alice.service!.createInvite(community.id,3600,1)
  await alice.service!.send(channel.id,{kind:'text',text:canary+' after invitation',reply_to:null})
  await client.joinCommunity(resumed.session.token,invite.code);await resumed.service!.secureJoin(community.id,invite.code)
  await resumed.service!.openChannel(channel.id)
  require(!resumed.state.joined.includes(channel.id))
  await alice.service!.approveMember(channel.id,resumed.session.account.id,resumed.device.identity_key)
  await until(()=>resumed.state.joined.includes(channel.id))
  await resumed.service!.requestHistory(channel.id)
  await until(()=>resumed.state.messages.some(m=>m.conversation_id===channel.id&&m.text===canary+' after invitation'))
  require(!resumed.state.messages.some(m=>m.conversation_id===channel.id&&m.text===canary+' before invitation'))
  checks.packaged_signed_admission_and_since_invite_history_pass=true
  const historical=resumed.state.messages.find(m=>m.conversation_id===channel.id&&m.text===canary+' after invitation')!
  await resumed.service!.send(channel.id,{kind:'reaction',id:historical.id,emoji:'👍',active:true})
  await until(()=>alice.state.messages.find(m=>m.id===historical.id)?.reactions['👍']?.includes(resumed.session.account.id)??false)
  require((await resumed.service!.search('AFTER invitation',channel.id)).some(m=>m.id===historical.id))
  checks.packaged_channel_reactions_and_local_search_pass=true
  if(config.storage){
    stage='encrypted file through packaged worker and private S3'
    await alice.service!.sendAttachment(channel.id,new File([canary+' file'],'packaged-file.txt',{type:'text/plain'}),'Packaged file')
    await until(()=>resumed.state.messages.some(m=>m.conversation_id===channel.id&&m.attachments.length>0))
    const file=resumed.state.messages.find(m=>m.conversation_id===channel.id&&m.attachments.length>0)!.attachments[0]
    require(await (await resumed.service!.downloadAttachment(channel.id,file)).text()===canary+' file')
    checks.packaged_encrypted_file_upload_and_download_pass=true
  }
  if(config.phase3){linked.service?.close();await verifyPackagedPhase3(client,alice,resumed,checks,until,label=>{stage=label},community.id,canary,pace)}
  for(const install of installs){install.service?.close();install.crypto.close()}
  await pause(200)
  await invoke('phase1_finish',{report:{outcome:'pass',checks}})
}
void run().catch(async(error:unknown)=>{
  for(const install of installs){install.service?.close();install.crypto.close()}
  checks[stage.replaceAll(' ','_')]=false
  // Enumerated failure classes only: never forward SDK/native error text.
  let failure='unclassified'
  if(error instanceof AuthCryptoError)failure=error.failure
  else if(error instanceof HearthError){
    const statuses:Record<number,string>={400:'bad_request',401:'unauthorized',403:'forbidden',404:'not_found',409:'conflict',429:'rate_limited',503:'unavailable'}
    failure=error.kind==='http'?(statuses[error.status] ?? 'http_other'):error.kind
  }else{
    const message=error instanceof Error?error.message:typeof error==='string'?error:''
    const known:Record<string,string>={
      'Acceptance assertion failed':'assertion',
      'Acceptance timed out':'acceptance_timeout',
      'Authentication was interrupted. Please try again.':'worker_interrupted',
      'The password or authentication exchange could not be verified.':'auth_crypto',
      'The identity operation could not be verified. Check your kit, passphrase, account and server; existing keys were preserved.':'identity_crypto',
      'Your system key store is unavailable or locked. Unlock it and try again.':'key_store',
      'Encrypted storage failed':'encrypted_storage',
      'The message was rejected after an encryption or permission update. Retry after updates arrive.':'message_epoch_conflict',
    }
    failure=known[message] ?? failure
  }
  checks[`failure_${failure}`]=false
  try{await invoke('phase1_finish',{report:{outcome:'fail',checks}})}catch{document.getElementById('stage')!.textContent='Packaged acceptance failed.'}
})
