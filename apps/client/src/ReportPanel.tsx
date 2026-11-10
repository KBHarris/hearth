import {useEffect,useState} from 'react'
import type {LocalMessage,ReportEvidence,ReportKey} from '@hearth/sdk'
import {Modal} from './Modal'
import type {MessagingSession,ReportReview} from './crypto/messaging-session'

function Evidence({evidence,name}:{evidence:ReportEvidence;name:(id:string)=>string}){
  return <div className="report-evidence"><p><strong>Reason:</strong> {evidence.reason}</p>{evidence.selected.map(proof=><blockquote key={proof.operation_id}><strong>{name(proof.member.account_id)}</strong><small>Confirmed as really sent by them · {proof.content.kind==='edit'?'Edit of selected message':'Selected message'}</small><p>{'title' in proof.content?proof.content.title:null}</p><p>{'text' in proof.content?proof.content.text:'question' in proof.content?proof.content.question:''}</p>{'options' in proof.content&&<ul>{proof.content.options.map(option=><li key={option}>{option}</li>)}</ul>}</blockquote>)}</div>
}
export function ReportPanel({service,channel,target,messages,name,onClose}:{service:MessagingSession;channel:string;target:string;messages:LocalMessage[];name:(id:string)=>string;onClose:()=>void}){
  const [keys,setKeys]=useState<ReportKey[]>([]),[recipient,setRecipient]=useState(''),[selected,setSelected]=useState([target]),[reason,setReason]=useState(''),[preview,setPreview]=useState<ReportEvidence|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(false)
  useEffect(()=>{let active=true;void service.reportKeys(channel).then(keys=>{if(active){setKeys(keys);setRecipient(keys[0]?.member.enrollment.device_key??'')}}).catch(error=>{if(active)setError(String(error))});return()=>{active=false}},[service,channel])
  async function prepare(){setBusy(true);setError('');try{setPreview(await service.reportPreview(channel,selected,reason))}catch(error){setError(String(error))}finally{setBusy(false)}}
  async function send(){setBusy(true);setError('');try{const key=keys.find(key=>key.member.enrollment.device_key===recipient);if(!key)throw new Error('Choose a moderator.');await service.submitReport(channel,selected,reason,key);setSent(true)}catch(error){setError(String(error))}finally{setBusy(false)}}
  return <Modal title="Report a message" onClose={onClose} description="Send the messages you pick, in readable form, to one moderator’s device. The server only stores the report in encrypted form. The moderator can keep a copy.">
    {sent?<><p role="status">Report sent to the selected moderator.</p><button onClick={onClose}>Done</button></>:<>
      {keys.length===0&&<p>No moderator has turned on their report inbox for this channel yet. Ask a moderator to open Reports from the channel’s More menu.</p>}
      <label htmlFor="report-recipient">Moderator</label><select id="report-recipient" value={recipient} disabled={busy||keys.length===0} onChange={event=>{setRecipient(event.target.value);setPreview(null)}}>{keys.length===0&&<option value="">No moderator can receive reports yet</option>}{keys.map(key=><option key={key.member.enrollment.device_key} value={key.member.enrollment.device_key}>{name(key.member.account_id)} · device {key.member.enrollment.device_key.slice(0,8)}</option>)}</select>
      <fieldset disabled={busy}><legend>Messages to share (up to 10)</legend>{messages.filter(m=>!m.deleted&&!m.attachments.length).map(message=><label key={message.id}><input type="checkbox" checked={selected.includes(message.id)} onChange={event=>{setSelected(value=>event.target.checked?[...value,message.id]:value.filter(id=>id!==message.id));setPreview(null)}}/>{name(message.author_id)}: {message.text.slice(0,160)}</label>)}</fieldset>
      <label htmlFor="report-reason">Reason</label><textarea id="report-reason" maxLength={1024} value={reason} disabled={busy} onChange={event=>{setReason(event.target.value);setPreview(null)}}/>
      <button disabled={busy||!keys.length||!reason.trim()||selected.length<1||selected.length>10} onClick={()=>void prepare()}>Review what will be sent</button>
      {preview&&<><h3>This text will be shared</h3><Evidence evidence={preview} name={name}/><p>Edits to these messages are included, with proof of who sent them. No other messages or files are shared.</p><button className="primary-button" disabled={busy} onClick={()=>void send()}>Send report</button></>}
    </>}{error&&<p role="alert" className="input-error">{error}</p>}
  </Modal>
}
export function ModeratorReports({service,channel,name,onClose}:{service:MessagingSession;channel:string;name:(id:string)=>string;onClose:()=>void}){
  const [reports,setReports]=useState<ReportReview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
  async function refresh(){setBusy(true);setError('');try{setReports(await service.reportQueue(channel))}catch(error){setError(String(error))}finally{setBusy(false)}}
  return <Modal title="Moderator reports" onClose={onClose} description="Turn on this device’s private report inbox and read reports sent to it. Opening a report checks that each shared message really came from its sender.">
    <button className="primary-button" disabled={busy} onClick={()=>void refresh()}>Turn on inbox and check for reports</button>
    {reports.length===0&&<p>No reports on this device yet.</p>}{reports.map(report=><article key={report.envelope.id}><h3>{report.resolved?'Resolved':'Open report'} · {name(report.envelope.reporter.account_id)}</h3>{report.evidence?<Evidence evidence={report.evidence} name={name}/>:<p role="alert">{report.error}</p>}{report.evidence&&!report.resolved&&<button disabled={busy} onClick={()=>{setBusy(true);void service.resolveReport(channel,report.envelope.id).then(refresh).catch(error=>setError(String(error))).finally(()=>setBusy(false))}}>Mark resolved</button>}</article>)}{error&&<p role="alert" className="input-error">{error}</p>}
  </Modal>
}
