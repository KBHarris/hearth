import type {LinkEmbed} from '@hearth/sdk'
/** URL-derived cards never fetch a website or reveal a reader's address. */
export function localLinkPreview(text:string):LinkEmbed|null {
  for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)){
    let candidate=match[0].replace(/[.,!?:;]+$/,'')
    while(candidate.endsWith(')')&&(candidate.match(/\)/g)?.length??0)>(candidate.match(/\(/g)?.length??0))candidate=candidate.slice(0,-1)
    try{const url=new URL(candidate);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||candidate.length>2048)continue
      return {url:url.href,title:url.hostname.slice(0,160),description:''}
    }catch{/* An unfinished URL does not interrupt drafting. */}
  }
  return null
}
