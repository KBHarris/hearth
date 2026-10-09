import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {Root,RootContent} from 'mdast'
import type {ReactNode} from 'react'

/** Mention labels resolve against verified participants; remote image URLs never auto-load. */
export function MessageBody({text,participants,emoji,renderEmoji}:{text:string;participants:Record<string,string>;emoji?:string[];renderEmoji?:(alias:string)=>ReactNode}) {
  const mentions=()=> (tree:Root)=>{
    const walk=(node:Root|RootContent)=>{
      if(!('children' in node) || node.type==='link' || node.type==='linkReference')return
      const children:RootContent[]=[]
      for(const child of node.children) {
        if(child.type==='text') {
          let offset=0
          for(const match of child.value.matchAll(/(?<![\w@])@([a-z0-9_]{3,32})\b|:([a-z0-9_]{1,32}):/g)) {
            const id=match[1]?participants[match[1]]:emoji?.includes(match[2])?match[2]:undefined
            if(!id)continue
            children.push({type:'text',value:child.value.slice(offset,match.index)},{type:'link',url:match[1]?`hearth-mention:${id}`:`hearth-emoji:${id}`,children:[{type:'text',value:match[0]}]})
            offset=match.index+match[0].length
          }
          children.push({type:'text',value:child.value.slice(offset)})
        }else {walk(child);children.push(child)}
      }
      // The transform only inserts phrasing nodes where an original text node occurred.
      Object.assign(node,{children})
    }
    walk(tree)
  }
  return <div className="message-body"><Markdown remarkPlugins={[remarkGfm,mentions]} skipHtml urlTransform={url=>/^https?:\/\//i.test(url)||/^hearth-mention:[a-f0-9]{64}$/.test(url)||/^hearth-emoji:[a-z0-9_]{1,32}$/.test(url)?url:''} components={{
    a:({href,children})=>href?.startsWith('hearth-emoji:')?<span>{renderEmoji?.(href.slice(13))??children}</span>:href?.startsWith('hearth-mention:')?<mark>{children}</mark>:href?<a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>:<span>{children}</span>,
    img:({alt})=><span>{alt ? `[Image: ${alt}]`:'[External image]'}</span>
  }}>{text}</Markdown></div>
}
