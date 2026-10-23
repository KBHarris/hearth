/* External provider code runs only in an opaque-origin data frame. No app APIs,
   tokens, account IDs, message content or cryptographic material enter here. */
(()=>{
  let initialized=false,nonce='',adapter=null,desired={playing:false,positionMs:0},lastPlaying=null
  const report=(value)=>parent.postMessage({type:'hearth-player-status',nonce,...value},'*')
  function script(url,done){const tag=document.createElement('script');tag.src=url;tag.onload=done??null;tag.onerror=()=>report({failed:true});document.head.append(tag)}
  function ready(value){adapter=value;report({ready:true});apply()}
  function apply(){if(!adapter)return;adapter.position(current=>{if(Number.isFinite(current)&&Math.abs(current-desired.positionMs)>2000)adapter.seek(desired.positionMs)});if(lastPlaying!==desired.playing){lastPlaying=desired.playing;desired.playing?adapter.play():adapter.pause()}}
  addEventListener('message',event=>{
    if(event.source!==parent)return
    const value=event.data
    if(value?.type==='hearth-player-control'&&initialized&&value.nonce===nonce&&typeof value.playing==='boolean'&&Number.isFinite(value.positionMs)&&value.positionMs>=0&&value.positionMs<=86400000){desired={playing:value.playing,positionMs:value.positionMs};apply();return}
    if(initialized||value?.type!=='hearth-player-init'||!/^[a-f0-9]{64}$/.test(value.nonce??''))return
    initialized=true;nonce=value.nonce
    try{
      const url=new URL(value.url)
      if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)throw Error()
      const provider=value.provider,container=document.getElementById('player')
      if(provider==='youtube'&&/^https:\/\/www\.youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(value.url)){
        window.onYouTubeIframeAPIReady=()=>{const player=new YT.Player(container,{width:'100%',height:320,videoId:url.searchParams.get('v'),playerVars:{autoplay:0,widget_referrer:value.origin,playsinline:1},events:{onReady:()=>ready({position:callback=>callback(player.getCurrentTime()*1000),seek:ms=>player.seekTo(ms/1000,true),play:()=>player.playVideo(),pause:()=>player.pauseVideo()}),onError:event=>report({failed:true,code:Number.isInteger(event.data)?event.data:undefined})}})}
        script('https://www.youtube.com/iframe_api')
      }else if(provider==='spotify'&&/^https:\/\/open\.spotify\.com\/(track|episode)\/[a-zA-Z0-9]{22}$/.test(value.url)){
        window.onSpotifyIframeApiReady=api=>api.createController(container,{uri:'spotify:'+url.pathname.slice(1).replace('/',':'),width:'100%',height:320},controller=>{let position=0;controller.addListener('playback_update',event=>{if(Number.isFinite(event.data?.position))position=event.data.position});controller.addListener('ready',()=>ready({position:callback=>callback(position),seek:ms=>controller.seek(ms/1000),play:()=>controller.play(),pause:()=>controller.pause()}))})
        script('https://open.spotify.com/embed/iframe-api/v1')
      }else if(provider==='soundcloud'&&/^https:\/\/soundcloud\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(value.url)&&url.pathname.length<=161){
        const frame=document.createElement('iframe');frame.src='https://w.soundcloud.com/player/?url='+encodeURIComponent(value.url)+'&auto_play=false';frame.allow='autoplay';frame.width='100%';frame.height='320';frame.title='SoundCloud player';container.append(frame)
        script('https://w.soundcloud.com/player/api.js',()=>{const widget=SC.Widget(frame);widget.bind(SC.Widget.Events.READY,()=>ready({position:callback=>widget.getPosition(callback),seek:ms=>widget.seekTo(ms),play:()=>widget.play(),pause:()=>widget.pause()}))})
      }else throw Error()
    }catch{report({failed:true})}
  })
})()
