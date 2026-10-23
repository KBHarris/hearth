import type {DeliveryEvent} from '@hearth/sdk'
/** Preserve the verified prefix on an invalid later envelope. No delivery is
 * exposed/acknowledged until its entire accepted prefix is durably CAS-saved. */
export async function deliveryBatch<T>(events:readonly DeliveryEvent[],lastSeq:number,callbacks:{before:(event:DeliveryEvent)=>Promise<void>;receive:(event:DeliveryEvent)=>Promise<T>;persist:()=>Promise<void>;emit:(items:readonly {event:DeliveryEvent;value:T}[])=>void}){
  if(events.length>16)throw new Error('Delivery batch exceeds its bound.')
  const accepted:{event:DeliveryEvent;value:T}[]=[]
  let failure:unknown
  try{for(const event of events){if(event.seq<=lastSeq)continue;await callbacks.before(event);const value=await callbacks.receive(event);accepted.push({event,value});lastSeq=event.seq}}catch(error){failure=error}
  if(accepted.length){await callbacks.persist();callbacks.emit(accepted)}
  if(failure)throw failure
}
