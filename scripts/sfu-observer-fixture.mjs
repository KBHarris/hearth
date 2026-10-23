// Test-only token broker. Provider credentials never enter the renderer.
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto'

export async function sfuObserverFixture(url,apiKey,secret,frontendOrigin='http://127.0.0.1:5176'){
  const capability=randomBytes(32).toString('hex'),origins=new Set([frontendOrigin,'http://tauri.localhost','https://tauri.localhost','tauri://localhost'])
  let issued=0
  const server=createServer(async(request,response)=>{
    try{
      assert.ok(origins.has(request.headers.origin))
      response.setHeader('Access-Control-Allow-Origin',request.headers.origin)
      response.setHeader('Vary','Origin')
      response.setHeader('Cache-Control','no-store')
      if(request.method==='OPTIONS'){
        response.setHeader('Access-Control-Allow-Methods','POST')
        response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type')
        response.setHeader('Access-Control-Allow-Private-Network','true')
        response.writeHead(204);response.end();return
      }
      const authorization=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+capability)
      assert.ok(authorization.length===expected.length&&timingSafeEqual(authorization,expected))
      assert.ok(request.method==='POST'&&request.url==='/'&&issued<2)
      let input=''
      for await(const chunk of request){input+=chunk;assert.ok(input.length<256)}
      const {room}=JSON.parse(input)
      assert.match(room,/^hearth-[a-f0-9]{64}-[1-9][0-9]{0,15}$/)
      const identity='negative-observer-'+randomUUID(),now=Math.floor(Date.now()/1000)
      const payload={iss:apiKey,sub:identity,nbf:now-1,exp:now+60,video:{roomJoin:true,room,canSubscribe:true,canPublish:false,canPublishData:false}}
      const signingInput=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(payload)).toString('base64url')
      const token=signingInput+'.'+createHmac('sha256',secret).update(signingInput).digest('base64url')
      issued++;response.setHeader('Content-Type','application/json');response.end(JSON.stringify({url,identity,token}))
    }catch{response.writeHead(403);response.end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  return {config:{origin:'http://127.0.0.1:'+server.address().port,token:capability},close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})}
}
