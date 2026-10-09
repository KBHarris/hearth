import type {LinkEmbed} from '@hearth/sdk'

export function LinkPreview({embed}:{embed:LinkEmbed}) {
  let href=''
  try{const url=new URL(embed.url);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)href=url.href}catch{/* Invalid peer content remains inert. */}
  return <aside className="link-preview"><small>Shared preview</small>{href?<a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{embed.title}</a>:<strong>{embed.title}</strong>}<p>{embed.description}</p><small>{embed.url}</small></aside>
}
