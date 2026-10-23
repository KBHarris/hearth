import type {LocalCallSignal} from '@hearth/sdk'
type Observer={listener:(event:LocalCallSignal)=>void;locked:(conversation?:string)=>void;epochChanged?:(conversation:string,epoch?:number)=>void|Promise<void>}

/** Every call consumer must stop or acknowledge its publication pause before an
 * MLS commit is applied. A failing consumer cannot prevent the others' notice.
 */
export class CallObservers {
  private observers=new Set<Observer>()
  add(listener:Observer['listener'],locked:Observer['locked'],epochChanged?:Observer['epochChanged']){
    const observer={listener,locked,epochChanged};this.observers.add(observer)
    return ()=>{this.observers.delete(observer)}
  }
  lock(conversation?:string){
    for(const observer of [...this.observers]){
      try{observer.locked(conversation)}catch{/* Finish notifying others even during teardown. */}
    }
  }
  emit(event:LocalCallSignal){
    const errors:unknown[]=[]
    for(const observer of [...this.observers]){
      try{observer.listener(event)}catch(error){errors.push(error)}
    }
    if(errors.length){this.lock(event.conversation_id);throw new AggregateError(errors,'Call observer failed')}
  }
  async changeEpoch(conversation:string,epoch?:number){
    const pending=[...this.observers].map(observer=>{
      try{return Promise.resolve(observer.epochChanged?observer.epochChanged(conversation,epoch):observer.locked(conversation))}
      catch(error){return Promise.reject(error)}
    })
    try{await Promise.all(pending)}catch(error){this.lock(conversation);throw error}
  }
}
