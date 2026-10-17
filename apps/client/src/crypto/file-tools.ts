export const MAX_FILE=50_000_000
const digits=Array.from({length:256},(_,value)=>value.toString(16).padStart(2,'0'))
export function hex(bytes:Uint8Array){const parts:string[]=[];for(let offset=0;offset<bytes.length;offset+=8192){const part:string[]=[];for(let i=offset;i<Math.min(bytes.length,offset+8192);i++)part.push(digits[bytes[i]]);parts.push(part.join(''))}return parts.join('')}
export function unhex(value:string){if(value.length%2||!/^[a-f0-9]*$/.test(value))throw new Error('Invalid encrypted file.');const bytes=new Uint8Array(value.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(value.slice(i*2,i*2+2),16);return bytes}
/** Decode raster input locally. The uploaded thumbnail is generated here and then encrypted. */
export async function thumbnail(file:File):Promise<Blob|null>{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))return null
  const bitmap=await createImageBitmap(file)
  try {
    const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale))
    const context=canvas.getContext('2d');if(!context)throw new Error('Image preview could not be prepared.')
    context.drawImage(bitmap,0,0,canvas.width,canvas.height)
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'))
    if(!blob||blob.size>128*1024)throw new Error('Image preview is too large. Choose a smaller image.')
    return blob
  }finally{bitmap.close()}
}
