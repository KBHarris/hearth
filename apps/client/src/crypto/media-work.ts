/** Urgent media authorization still shares the single MLS owner. The owner
 * drains this work only between operations or after a durably saved batch. */
export class MediaWork {
  private pending:{run:()=>Promise<void>;authorization:boolean}[]=[]
  private draining=false
  private held=0
  get waiting(){return this.pending.length>0}
  async batch<T>(action:()=>Promise<T>):Promise<T>{
    this.held++
    try{return await action()}finally{this.held--}
  }
  add<T>(action:()=>Promise<T>,authorization=false):Promise<T>{
    if(this.pending.length>=128)return Promise.reject(new Error('Media authorization queue is full.'))
    return new Promise((resolve,reject)=>{this.pending.push({authorization,run:async()=>{try{resolve(await action())}catch(error){reject(error)}}})})
  }
  async drain(){
    if(this.draining||this.held)return
    this.draining=true
    const work=this.pending.splice(0)
    // Fresh policy reads go ahead of queued key exports. Work added during this
    // drain still waits for the next durable boundary; MLS ownership is unchanged.
    work.sort((left,right)=>Number(right.authorization)-Number(left.authorization))
    try{for(const action of work)await action.run()}finally{this.draining=false}
  }
}
