import {createRoot} from 'react-dom/client'
import type {Conversation} from '@hearth/sdk'
import {CallPanel} from '../CallPanel'
import type {MessagingSession} from '../crypto/messaging-session'
import type {DirectCall} from './direct-call'
import {GroupCallPanel} from '../GroupCallPanel'
import type {GroupCall} from './group-call'
import type {VoiceRoomCall} from './voice-room'
import {VoiceRoomPanel} from '../VoiceRoomPanel'
import type {ChannelRoster} from '@hearth/sdk'
import '../index.css'
import '../App.css'

export function mountCallPanels(calls:DirectCall[],people:{service:MessagingSession;session:{account:{id:string;username:string}}}[],conversation:Conversation){
  const element=document.createElement('div');element.style.cssText='max-width:1050px;margin:24px auto';document.body.append(element)
  const root=createRoot(element)
  const name=(id:string)=>people.find(p=>p.session.account.id===id)?.session.account.username??'Participant'
  const render=()=>root.render(<>{people.map((person,index)=><section key={person.session.account.id} id={`call-fixture-${index}`}><h2>{person.session.account.username}</h2><CallPanel call={calls[index]} state={calls[index].state} service={person.service} conversation={conversation} account={person.session.account.id} name={name}/></section>)}</>)
  render();return {render,close:()=>{root.unmount();element.remove()}}
}
export function mountGroupPanels(calls:GroupCall[],people:{service:MessagingSession;session:{account:{id:string;username:string}}}[],conversation:Conversation){
  const element=document.createElement('div');element.style.cssText='max-width:1050px;margin:24px auto';document.body.append(element)
  const root=createRoot(element)
  const name=(id:string)=>people.find(person=>person.session.account.id===id)?.session.account.username??'Participant'
  const render=()=>root.render(<>{people.map((person,index)=><section key={person.session.account.id} id={`group-fixture-${index}`}><h2>{person.session.account.username}</h2><GroupCallPanel call={calls[index]} state={calls[index].state} service={person.service} conversation={conversation} account={person.session.account.id} name={name}/></section>)}</>)
  render();return {render,close:()=>{root.unmount();element.remove()}}
}
export function mountVoicePanels(calls:VoiceRoomCall[],people:{service:MessagingSession;session:{account:{id:string;username:string}}}[],channel:ChannelRoster){
  const element=document.createElement('div');element.style.cssText='max-width:1050px;margin:24px auto';document.body.append(element)
  const root=createRoot(element),name=(id:string)=>people.find(person=>person.session.account.id===id)?.session.account.username??'Participant'
  const render=()=>root.render(<>{people.map((person,index)=><section key={person.session.account.id} id={`voice-fixture-${index}`}><h2>{person.session.account.username}</h2><VoiceRoomPanel call={calls[index]} state={calls[index].state} service={person.service} channel={channel} name={name}/></section>)}</>)
  render();return {render,close:()=>{root.unmount();element.remove()}}
}
