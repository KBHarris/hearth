import {useEffect,useState} from 'react'
import type {LocalAttachment} from '@hearth/sdk'
export type FileDownloader=(conversation:string,file:LocalAttachment)=>Promise<Blob>
export function EncryptedImage({conversation,file,download,emoji=false}:{conversation:string;file:LocalAttachment;download:FileDownloader;emoji?:boolean}){
  const [url,setUrl]=useState(''),[error,setError]=useState(false)
  useEffect(()=>{let active=true,object='';void download(conversation,file).then(blob=>{object=URL.createObjectURL(blob);if(active)setUrl(object);else URL.revokeObjectURL(object)}).catch(()=>{if(active)setError(true)});return()=>{active=false;if(object)URL.revokeObjectURL(object)}},[conversation,file,download])
  return url?<img className={emoji?'custom-emoji':'attachment-thumbnail'} src={url} alt={emoji?file.name:'Local image preview'}/>:<span title={error?'Encrypted preview unavailable':'Loading encrypted preview'}>{emoji?`:${file.name.replace(/\.png$/,'')}:`:error?'Preview unavailable':'Loading preview…'}</span>
}
export function Attachment({conversation,file,download}:{conversation:string;file:LocalAttachment;download:FileDownloader}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  async function save(){setBusy(true);setError('');let url='';try{const blob=await download(conversation,file);url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(error){if(url)URL.revokeObjectURL(url);setError(error instanceof Error?error.message:'File could not be decrypted.')}finally{setBusy(false)}}
  return <div className="encrypted-attachment">{file.thumbnail&&<EncryptedImage conversation={conversation} file={file.thumbnail} download={download}/>}<button disabled={busy} onClick={()=>void save()}>{busy?'Decrypting…':`Download ${file.name}`} ({(file.bytes/1024).toFixed(1)} KiB)</button>{error&&<small role="alert">{error}</small>}</div>
}
