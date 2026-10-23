/** Urgent media authorization still shares the single MLS owner. The owner
 * drains this work only between operations or after a durably saved batch. */
export class MediaWork {
  private pending:(()=>Promise<void>)[]=[]
  private draining=false
  add<T>(action:()=>Promise<T>):Promise<T>{
    if(this.pending.length>=128)return Promise.reject(new Error('Media authorization queue is full.'))
    return new Promise((resolve,reject)=>{this.pending.push(async()=>{try{resolve(await action())}catch(error){reject(error)}})})
  }
  async drain(){
    if(this.draining)return
    this.draining=true
    const work=this.pending.splice(0)
    try{for(const action of work)await action()}finally{this.draining=false}
  }
}
