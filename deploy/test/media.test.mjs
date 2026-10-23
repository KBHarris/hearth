import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,relative} from 'node:path'
import {initializeMedia,mediaSettings} from '../media/setup.mjs'
import {allowedBuildFile} from '../railway/context.mjs'
test('media defaults remain local and public networking requires explicit settings',()=>{
  assert.equal(mediaSettings().bind,'127.0.0.1')
  assert.equal(mediaSettings().profile,'standard');assert.equal(mediaSettings({profile:'sfu25'}).profile,'sfu25');assert.throws(()=>mediaSettings({profile:'unlimited'}))
  assert.equal(mediaSettings({signalPort:17880}).url,'ws://127.0.0.1:17880')
  assert.throws(()=>mediaSettings({url:'ws://127.0.0.1:7880',signalPort:17880}))
  for(const input of [{url:'ws://public.example'},{url:'wss://user:key@public.example'},{url:'wss://public.example',advertiseIp:'192.168.1.5',bind:'0.0.0.0'},{bind:'0.0.0.0'},{signalPort:7881},{apiSecret:'do-not-accept'},{turnPort:7881},{relayMax:49170},{relayMin:7800,relayMax:8000}])assert.throws(()=>mediaSettings(input))
  assert.equal(mediaSettings({url:'wss://media.example',advertiseIp:'203.0.113.4',bind:'0.0.0.0'}).local,false)
})

test('optional shared relay keeps credentials stable and loopback exceptions out of public profiles',()=>{
  const parent=resolve(tmpdir()),directory=mkdtempSync(join(parent,'hearth-media-config-'))
  try{
    const first=initializeMedia(directory,{turn:true}),env=readFileSync(first.envPath,'utf8'),local=readFileSync(join(directory,'turnserver.conf'),'utf8')
    assert.match(local,/allow-loopback-peers/)
    initializeMedia(directory,{turn:true});assert.equal(readFileSync(first.envPath,'utf8'),env)
    const secret=env.match(/HEARTH_TURN_SECRET=([a-f0-9]{64})/)[1]
    assert.throws(()=>mediaSettings({url:'wss://media.example',advertiseIp:'203.0.113.4',bind:'0.0.0.0',nodeIp:'127.0.0.1'}))
    initializeMedia(directory,{url:'wss://media.example',advertiseIp:'203.0.113.4',nodeIp:'192.168.1.5',bind:'0.0.0.0'})
    assert.match(readFileSync(join(directory,'livekit.yaml'),'utf8'),/node_ip: 203\.0\.113\.4\n/)
    assert.match(readFileSync(join(directory,'livekit.yaml'),'utf8'),/advertise_internal_ip: true/)
    initializeMedia(directory)
    const publicConfig=readFileSync(join(directory,'turnserver.conf'),'utf8')
    assert.ok(!publicConfig.includes('allow-loopback-peers'));assert.ok(publicConfig.includes(secret))
    assert.match(readFileSync(first.envPath,'utf8'),/HEARTH_TURN_URLS=turn:203\.0\.113\.4:3478/)
    assert.equal(allowedBuildFile('deploy/media/data/turnserver.conf'),false)
  }finally{assert.ok(relative(parent,resolve(directory)).startsWith('hearth-media-config-'));rmSync(directory,{recursive:true,force:true})}
})
test('media initialization preserves credentials and secret files stay out of build inputs',()=>{
  const parent=resolve(tmpdir()),directory=mkdtempSync(join(parent,'hearth-media-config-'))
  try{
    const first=initializeMedia(directory),env=readFileSync(first.envPath,'utf8'),config=readFileSync(first.configPath,'utf8')
    const again=initializeMedia(directory);assert.equal(readFileSync(again.envPath,'utf8'),env)
    assert.match(config,/enable_loopback_candidate: true/);assert.match(config,/max_participants: 25/)
    const custom=initializeMedia(directory,{signalPort:17880,tcpPort:17881,udpPort:17882,profile:'sfu25'})
    assert.match(readFileSync(custom.configPath,'utf8'),/port: 17880[\s\S]*tcp_port: 17881[\s\S]*udp_port: 17882/)
    assert.match(readFileSync(custom.envPath,'utf8'),/HEARTH_SFU_URL=ws:\/\/127.0.0.1:17880/)
    assert.match(readFileSync(custom.envPath,'utf8'),/HEARTH_REQUEST_PROFILE=sfu25/)
    for(const path of ['deploy/media/data/.env','deploy/media/data/livekit.yaml'])assert.equal(allowedBuildFile(path),false)
    const compose=readFileSync(new URL('../compose.media.yaml',import.meta.url),'utf8');assert.match(compose,/@sha256:[a-f0-9]{64}/);assert.match(compose,/127\.0\.0\.1/)
  }finally{assert.ok(relative(parent,resolve(directory)).startsWith('hearth-media-config-'));rmSync(directory,{recursive:true,force:true})}
})
