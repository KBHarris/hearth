// Disposable packaged-webview acceptance using the product session and crypto worker.
import {HearthClient,type DeviceEnrollment,type Session,type Governance} from '@hearth/sdk'
import type {MessagingSession,ChatState} from './crypto/messaging-session'
type Install={session:Session;device:DeviceEnrollment;service?:MessagingSession;state:ChatState}
export async function verifyPackagedPhase3(client:HearthClient,alice:Install,bob:Install,checks:Record<string,boolean>,until:(predicate:()=>boolean)=>Promise<void>,stage:(label:string)=>void,community:string,canary:string){
  const require=(value:unknown)=>{if(!value)throw new Error('Acceptance assertion failed')}
  const owner=alice.service!,member=bob.service!
  stage('phase three encrypted forum')
  const forum=await client.createChannel(alice.session.token,community,{name:'packaged-forum',category_id:null,kind:'forum'})
  await owner.secureChannel(forum.id);await owner.openChannel(forum.id);await member.openChannel(forum.id)
  await until(()=>bob.state.joined.includes(forum.id))
  await owner.send(forum.id,{kind:'forum_post',title:'Packaged forum',text:canary+' forum'})
  await until(()=>bob.state.messages.some(m=>m.text===canary+' forum'))
  const post=bob.state.messages.find(m=>m.text===canary+' forum')!
  await member.send(forum.id,{kind:'text',text:canary+' forum reply',reply_to:post.id})
  await until(()=>alice.state.messages.some(m=>m.text===canary+' forum reply'))
  checks.packaged_forum_posts_and_replies_are_encrypted=true
  stage('phase three encrypted poll')
  await owner.send(forum.id,{kind:'poll',question:'Which game?',options:['First','Second'],multiple:false,parent:post.id})
  await until(()=>bob.state.messages.some(m=>m.poll&&m.text==='Which game?'))
  const poll=bob.state.messages.find(m=>m.poll&&m.text==='Which game?')!
  await member.send(forum.id,{kind:'poll_vote',id:poll.id,choices:[1]})
  await until(()=>alice.state.messages.find(m=>m.id===poll.id)?.poll?.votes[bob.session.account.id]?.[0]===1)
  await owner.send(forum.id,{kind:'poll_close',id:poll.id})
  await until(()=>bob.state.messages.find(m=>m.id===poll.id)?.poll?.closed===true)
  checks.packaged_authenticated_poll_vote_and_author_close_pass=true
  stage('phase three selected encrypted report')
  require((await owner.reportQueue(forum.id)).length===0)
  const keys=await member.reportKeys(forum.id);require(keys.length===1)
  await member.submitReport(forum.id,[post.id],canary+' report',keys[0])
  const queue=await owner.reportQueue(forum.id)
  require(queue.length===1&&queue[0].evidence?.reason===canary+' report'&&queue[0].evidence.selected.length===1)
  await owner.resolveReport(forum.id,queue[0].envelope.id)
  require((await owner.reportQueue(forum.id))[0].resolved)
  checks.packaged_report_selection_moderator_verification_and_resolution_pass=true
  stage('phase three delegated moderation')
  const initial=(await owner.loadGovernance(community)).governance
  const roster=alice.state.channels[forum.id]
  require(roster.authority)
  const role=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')
  const policy:Governance=initial??{community_id:community,revision:0,everyone:15,roles:[],assignments:[],overrides:[],sanctions:[],limits:[],rules:'',screening:false,owner:roster.authority!.owner,signature:''}
  await owner.saveGovernance(community,{...policy,revision:policy.revision+1,roles:[{id:role,name:'Moderator',permissions:256|512}],assignments:[{account_id:bob.session.account.id,role_ids:[role]}]})
  const delegated=(await member.loadGovernance(community)).governance!
  await member.saveGovernance(community,{...delegated,revision:delegated.revision+1,limits:[{channel_id:forum.id,slowmode_seconds:1,retention_days:null}]})
  require((await owner.loadGovernance(community)).governance?.moderator_admission?.account_id===bob.session.account.id)
  checks.packaged_delegated_moderation_keeps_owner_authority_pass=true
  stage('phase three ownership transfer')
  await owner.offerOwnership(community,bob.session.account.id);await member.acceptOwnership(community)
  require((await client.communityStructure(alice.session.token,community)).community.owner_id===bob.session.account.id)
  await member.offerOwnership(community,alice.session.account.id);await owner.acceptOwnership(community)
  require((await client.communityStructure(bob.session.token,community)).community.owner_id===alice.session.account.id)
  checks.packaged_ownership_handoff_after_delegation_and_return_pass=true
  stage('phase three private blocks and export')
  await client.setBlock(alice.session.token,bob.session.account.id,true)
  require((await client.blocks(alice.session.token)).some(a=>a.id===bob.session.account.id))
  require((await client.blocks(bob.session.token)).length===0)
  await client.setBlock(alice.session.token,bob.session.account.id,false)
  let cursor='',records=0
  for(;;){const page=await client.accountExport(alice.session.token,cursor);const raw=JSON.stringify(page);require(page.account.id===alice.session.account.id&&!raw.includes(canary)&&!raw.includes('token_hash')&&!raw.includes('password_file'));records+=page.records.length;if(!page.next)break;cursor=page.next}
  require(records>0)
  require((await client.pushConfiguration(alice.session.token)).public_key.length===87)
  checks.packaged_private_block_export_and_generic_push_configuration_pass=true
  stage('phase three account departure and audience removal')
  await member.deleteAccount()
  let denied=false
  try{await client.session(bob.session.token)}catch{denied=true}
  require(denied)
  await owner.openChannel(forum.id)
  await owner.send(forum.id,{kind:'text',text:canary+' after departure',reply_to:post.id})
  await until(()=>alice.state.messages.some(m=>m.text===canary+' after departure'))
  const updated=await client.conversations(alice.session.token)
  require(updated.find(g=>g.id===forum.id)?.members.every(m=>m.account_id!==bob.session.account.id))
  require(alice.state.messages.some(m=>m.text===canary+' forum reply'))
  checks.packaged_signed_departure_revokes_session_prunes_audience_and_preserves_received_history=true

}
