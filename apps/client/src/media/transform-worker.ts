import {MediaKeys} from './frame-keys.ts'
type Frame={data:ArrayBuffer}
type Transformer={options:{direction:'send'|'receive';slot:number};readable:ReadableStream<Frame>;writable:WritableStream<Frame>}
const context=self as unknown as {onmessage:((event:MessageEvent)=>void)|null;onrtctransform:((event:{transformer:Transformer})=>void)|null;postMessage:(value:unknown)=>void}
let keys:MediaKeys,chain=Promise.resolve(),initialized=false
let resolveReady:()=>void,rejectReady:(error:Error)=>void
const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject})
void ready.catch(()=>{})
const fatal=()=>{rejectReady(new Error('Media encryption unavailable'));context.postMessage({op:'fatal'})}
context.onmessage=({data})=>{
  if(data.op==='pause'){keys?.pause();context.postMessage({op:'paused',id:data.id});return}
  if(data.op==='stats'){context.postMessage({op:'stats',...keys?.stats});return}
  chain=chain.then(async()=>{
    try{
      if(data.op==='init'&&!initialized){
        initialized=true;keys=new MediaKeys(data.role,data.slots??3);await keys.install(data.key,data.epoch,data.id);keys.resume(data.id);resolveReady();context.postMessage({op:'ready'})
      }else if(data.op==='install'&&initialized){await keys.install(data.key,data.epoch,data.id);context.postMessage({op:'installed',id:data.id,epoch:data.epoch,decrypted:keys.stats.decrypted})}
      else if(data.op==='resume'&&initialized){keys.resume(data.id);context.postMessage({op:'resumed',id:data.id})}
      else throw new Error('Invalid media command')
    }finally{data.key=''}
  }).catch(fatal)
}
context.onrtctransform=({transformer})=>{
  const {direction,slot}=transformer.options
  const pipeline=new TransformStream<Frame,Frame>({async transform(frame,controller){
    await ready
    const generation=keys.generation
    const result=await keys.frame(direction,slot,new Uint8Array(frame.data))
    if(result&&generation===keys.generation){frame.data=result.buffer as ArrayBuffer;controller.enqueue(frame)}
  }})
  void transformer.readable.pipeThrough(pipeline).pipeTo(transformer.writable).catch(fatal)
}
