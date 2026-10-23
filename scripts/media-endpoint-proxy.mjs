// Local acceptance transport only. Distinct HTTPS localhost sites get separate
// renderers without weakening production origin validation or changing OS trust.
import {createServer} from 'node:https'
import {request} from 'node:http'
import {readFileSync} from 'node:fs'
export async function mediaEndpointProxy({certificate,key,port,frontend,sfu}){
  const sockets=new Set()
  const target=path=>path.startsWith('/hearth-media/')?new URL(path.slice('/hearth-media'.length),sfu.replace(/^ws/,'http')):new URL(path,frontend)
  const server=createServer({cert:readFileSync(certificate),key:readFileSync(key)},(incoming,response)=>{
    const url=target(incoming.url),upstream=request(url,{method:incoming.method,headers:{...incoming.headers,host:url.host}},reply=>{response.writeHead(reply.statusCode,reply.headers);reply.pipe(response)})
    upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end()});incoming.pipe(upstream)
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  server.on('upgrade',(incoming,socket,head)=>{
    const url=target(incoming.url),upstream=request(url,{method:'GET',headers:{...incoming.headers,host:url.host}})
    upstream.on('upgrade',(reply,remote,remoteHead)=>{
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(reply.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n')
      if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead)
      remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());socket.pipe(remote);remote.pipe(socket)
    })
    upstream.on('response',reply=>{reply.resume();socket.end('HTTP/1.1 '+reply.statusCode+' Unavailable\r\nConnection: close\r\n\r\n')});upstream.on('error',()=>socket.destroy());upstream.end()
  })
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)})
  return {async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}}
}
