import { ConnectionError, ExternalE2EEKeyProvider, Room, RoomEvent, Track, isE2EESupported } from 'livekit-client'
import type { RemoteTrack } from 'livekit-client'
import EncryptionWorker from 'livekit-client/e2ee-worker?worker'
import { invoke } from '@tauri-apps/api/core'
import { HearthClient } from '@hearth/sdk'
import './style.css'

const button = document.querySelector<HTMLButtonElement>('#run')!
const status = document.querySelector<HTMLElement>('#status')!
const reportElement = document.querySelector<HTMLElement>('#report')!
const source = document.querySelector<HTMLCanvasElement>('#source')!
const received = document.querySelector<HTMLVideoElement>('#received')!
const wrong = document.querySelector<HTMLVideoElement>('#wrong')!
const receivedAudio = document.querySelector<HTMLAudioElement>('#received-audio')!
const desktop = (window as Window & { __HEARTH_DESKTOP_SPIKE__?: boolean }).__HEARTH_DESKTOP_SPIKE__ === true
const fixtureOrigin = desktop ? 'http://127.0.0.1:5174' : location.origin
receivedAudio.volume = 0

const capabilities = {
  userAgent: navigator.userAgent,
  secureContext: isSecureContext,
  peerConnection: typeof RTCPeerConnection !== 'undefined',
  scriptTransform: typeof RTCRtpScriptTransform !== 'undefined',
  legacyEncodedStreams: typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype,
  worker: typeof Worker !== 'undefined',
  webCrypto: typeof crypto?.subtle !== 'undefined',
  canvasCapture: 'captureStream' in HTMLCanvasElement.prototype,
  audioContext: typeof AudioContext !== 'undefined',
  sdkE2eeSupported: isE2EESupported(),
}
document.querySelector<HTMLElement>('#capabilities')!.textContent = JSON.stringify(capabilities, null, 2)

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)) }

async function until(predicate: () => boolean | Promise<boolean>, label: string, timeout = 12000) {
  const deadline = performance.now() + timeout
  while (performance.now() < deadline) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(label)
}

type FrameStats = { decoded: number; packets: number }
async function frameStats(track: RemoteTrack | undefined): Promise<FrameStats> {
  const result = { decoded: 0, packets: 0 }
  const stats = await track?.getRTCStatsReport()
  stats?.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
      result.decoded += stat.framesDecoded ?? 0
      result.packets += stat.packetsReceived ?? 0
    }
  })
  return result
}

async function audioStats(track: RemoteTrack | undefined) {
  const result = { packets: 0, samples: 0, energy: 0 }
  const stats = await track?.getRTCStatsReport()
  stats?.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
      result.packets += stat.packetsReceived ?? 0
      result.samples += stat.totalSamplesReceived ?? 0
      result.energy += stat.totalAudioEnergy ?? 0
    }
  })
  return result
}

async function run() {
  button.disabled = true
  reportElement.textContent = 'Running…'
  status.textContent = 'Checking runtime and connecting to local LiveKit…'
  const rooms: Room[] = []
  const connectionStates: Record<string, { publisher: string[]; subscriber: string[] }> = {}
  const candidateCounts: Record<string, { local: number; localMdns: number; localLoopback: number; remote: number; remoteLoopback: number }> = {}
  const workers: Worker[] = []
  const streams: MediaStream[] = []
  let audio: AudioContext | undefined
  let audioActivation: Promise<void> | undefined
  let animation: ReturnType<typeof setInterval> | undefined
  let connectionMonitor: ReturnType<typeof setInterval> | undefined
  const started = performance.now()
  const checks: Record<string, boolean | number> = {}
  let stage = 'runtime capabilities'
  const stageNames = ['runtime capabilities', 'native MLS over webview IPC', 'fixture bootstrap',
    'Hearth server discovery from webview', 'encryption worker setup publisher', 'connect publisher',
    'verify encryption publisher', 'encryption worker setup receiver', 'connect receiver',
    'verify encryption receiver', 'encryption worker setup wrong-key', 'connect wrong-key',
    'verify encryption wrong-key', 'synthetic source creation', 'publish encrypted synthetic tracks',
    'matching key media decoding', 'matching key audio tone', 'wrong key rejection',
    'establish old key decoding', 'fresh key replacement']
  function setStage(next: string) {
    stage = next
    status.textContent = `Checking ${next}…`
    if (desktop) void invoke('phase0_stage', { stage: stageNames.indexOf(next) }).catch(() => {})
  }
  let matchedVideo: RemoteTrack | undefined
  let matchedAudio: RemoteTrack | undefined
  let wrongVideo: RemoteTrack | undefined
  let wrongKeyErrors = 0
  let matchingKeyErrors = 0
  let sourcePeak = 0
  let receivePeak = 0
  try {
    // Request audio activation synchronously within the button click, before any
    // network await consumes Firefox's user activation. Native autoplay is test-only.
    if (capabilities.audioContext && capabilities.sdkE2eeSupported) {
      audio = new AudioContext()
      audioActivation = audio.resume()
      void audioActivation.catch(() => { /* Checked at synthetic source creation. */ })
    }
    if (desktop) {
      setStage('native MLS over webview IPC')
      const native = await invoke<Record<string, number | boolean>>('phase0_mls')
      check(native.members_after_join === 2 && Object.entries(native).every(([name, value]) => name === 'members_after_join' || value === true), 'Native MLS scenario failed')
      checks.native_mls_over_webview_ipc = true
    }
    setStage('fixture bootstrap')
    const bootstrap = await fetch(fixtureOrigin + '/__media/bootstrap', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) })
    check(bootstrap.ok, 'Local fixture bootstrap failed')
    const fixture = await bootstrap.json() as { url: string; tokens: Record<string, string>; serverVersion: string; hearthOrigin?: string }
    check(fixture.url === 'ws://127.0.0.1:17880', 'Fixture URL must stay on loopback')
    if (fixture.hearthOrigin) {
      setStage('Hearth server discovery from webview')
      check(fixture.hearthOrigin === 'http://127.0.0.1:18088', 'Hearth fixture must stay on its test origin')
      const info = await new HearthClient(fixture.hearthOrigin).inspect()
      checks.hearth_health_and_discovery = info.health.status === 'ok'
    }
    setStage('runtime capabilities')
    check(Object.entries(capabilities).every(([key, value]) => ['userAgent', 'scriptTransform', 'legacyEncodedStreams'].includes(key) || value === true), 'Required media capability unavailable')
    // Fresh client-only media material. It is never included in bootstrap or signaling.
    const key = crypto.getRandomValues(new Uint8Array(32)).buffer
    const wrongKey = crypto.getRandomValues(new Uint8Array(32)).buffer
    const keyProviders: ExternalE2EEKeyProvider[] = []
    connectionMonitor = setInterval(() => {
      for (const [index, room] of rooms.entries()) {
        const states = connectionStates[['publisher', 'receiver', 'wrong-key'][index]]
        const manager = room.engine.pcManager
        const local = manager?.publisher.getLocalDescription()?.sdp?.split('\n').filter((line) => line.startsWith('a=candidate:'))
        const remote = manager?.publisher.getRemoteDescription()?.sdp?.split('\n').filter((line) => line.startsWith('a=candidate:'))
        if (local || remote) {
          const isLoopback = (line: string) => /^(127\.|::1$)/.test(line.split(' ')[4] ?? '')
          candidateCounts[['publisher', 'receiver', 'wrong-key'][index]] = {
            local: local?.length ?? 0,
            localMdns: local?.filter((line) => line.split(' ')[4]?.endsWith('.local')).length ?? 0,
            localLoopback: local?.filter(isLoopback).length ?? 0,
            remote: remote?.length ?? 0,
            remoteLoopback: remote?.filter(isLoopback).length ?? 0,
          }
        }
        for (const [side, state] of [['publisher', manager?.publisher.getICEConnectionState()],
          ['subscriber', manager?.subscriber?.getICEConnectionState()]] as const) {
          if (state && !states[side].includes(state)) states[side].push(state)
        }
      }
    }, 100)
    for (const identity of ['publisher', 'receiver', 'wrong-key']) {
      setStage(`encryption worker setup ${identity}`)
      const provider = new ExternalE2EEKeyProvider()
      const worker = new EncryptionWorker()
      workers.push(worker)
      keyProviders.push(provider)
      const room = new Room({ encryption: { keyProvider: provider, worker }, adaptiveStream: false, dynacast: false })
      rooms.push(room)
      connectionStates[identity] = { publisher: [], subscriber: [] }
      room.on(RoomEvent.SignalConnected, () => { checks[`signaling_connected_${identity}`] = true })
      room.on(RoomEvent.EncryptionError, () => {
        if (identity === 'wrong-key') wrongKeyErrors++
        else matchingKeyErrors++
      })
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (identity === 'receiver' && track.kind === Track.Kind.Video) { matchedVideo = track; track.attach(received) }
        if (identity === 'receiver' && track.kind === Track.Kind.Audio) {
          matchedAudio = track
          track.attach(receivedAudio)
          receivedAudio.muted = true
          void receivedAudio.play().catch(() => { /* Decoding assertion records failure. */ })
        }
        if (identity === 'wrong-key' && track.kind === Track.Kind.Video) { wrongVideo = track; track.attach(wrong) }
      })
      await provider.setKey(identity === 'wrong-key' ? wrongKey : key)
      await room.setE2EEEnabled(true)
      setStage(`connect ${identity}`)
      await room.connect(fixture.url, fixture.tokens[identity], { rtcConfig: { iceServers: [] } })
      setStage(`verify encryption ${identity}`)
      // SDK setup requests encryption; the worker confirms it asynchronously.
      // Publishing must wait for that acknowledgement, not only the setter promise.
      await until(() => room.isE2EEEnabled, 'Room did not acknowledge encryption')
    }
    checks.rooms_encrypted_before_publish = true
    setStage('synthetic source creation')
    const context = source.getContext('2d')!
    let frame = 0
    function paint() {
      frame++
      context.fillStyle = frame % 20 < 10 ? '#417354' : '#bc844e'
      context.fillRect(0, 0, 320, 180)
      context.fillStyle = '#f5f0df'
      context.fillRect((frame * 8) % 280, 35, 40, 60)
      context.font = '20px system-ui'
      context.fillText(`Hearth test ${frame}`, 20, 150)
    }
    paint()
    animation = setInterval(paint, 100)
    const videoStream = source.captureStream(10)
    streams.push(videoStream)
    // Oscillator connects only to a stream destination, never to speakers.
    audio ??= new AudioContext()
    await Promise.race([audioActivation ?? audio.resume(), delay(4000).then(() => { throw new Error('Audio activation timed out') })])
    const oscillator = audio.createOscillator()
    oscillator.frequency.value = 440
    const gain = audio.createGain()
    gain.gain.value = 0.1
    const audioStream = audio.createMediaStreamDestination()
    oscillator.connect(gain).connect(audioStream)
    oscillator.start()
    const sourceAnalyser = audio.createAnalyser()
    const sourceSink = audio.createGain()
    sourceSink.gain.value = 0
    gain.connect(sourceAnalyser).connect(sourceSink).connect(audio.destination)
    const sourceSamples = new Float32Array(sourceAnalyser.fftSize)
    await until(() => {
      sourceAnalyser.getFloatTimeDomainData(sourceSamples)
      sourcePeak = Math.max(...sourceSamples.map(Math.abs))
      return sourcePeak > 0.005
    }, 'Synthetic audio source did not generate samples')
    streams.push(audioStream.stream)
    setStage('publish encrypted synthetic tracks')
    await rooms[0].localParticipant.publishTrack(videoStream.getVideoTracks()[0], { source: Track.Source.Camera, videoCodec: 'vp8', simulcast: false })
    await rooms[0].localParticipant.publishTrack(audioStream.stream.getAudioTracks()[0], { source: Track.Source.Microphone, dtx: false })
    status.textContent = 'Checking matching-key decoding and wrong-key rejection…'
    setStage('matching key media decoding')
    await until(async () => (await frameStats(matchedVideo)).decoded >= 10 && Boolean(matchedAudio), 'Matching receiver did not decode video and subscribe to audio')
    check(matchedAudio, 'Audio track missing')
    setStage('matching key audio tone')
    const analyser = audio.createAnalyser()
    const audioReceiverStream = new MediaStream([matchedAudio.mediaStreamTrack])
    audio.createMediaStreamSource(audioReceiverStream).connect(analyser)
    // Pull the receive graph through a silent sink. This avoids device playback while
    // ensuring the analyser measures decoded audio rather than an idle graph.
    const silentSink = audio.createGain()
    silentSink.gain.value = 0
    analyser.connect(silentSink).connect(audio.destination)
    const samples = new Float32Array(analyser.fftSize)
    await until(() => {
      analyser.getFloatTimeDomainData(samples)
      receivePeak = Math.max(...samples.map(Math.abs))
      return receivePeak > 0.005
    }, 'Matching receiver did not recover generated audio')
    checks.matching_key_video_decodes = true
    checks.matching_key_audio_recovers_tone = true
    setStage('wrong key rejection')
    await until(async () => (await frameStats(wrongVideo)).packets > 0, 'Wrong-key receiver did not receive forwarded RTP')
    await delay(1500)
    const rejectedStats = await frameStats(wrongVideo)
    check(rejectedStats.decoded === 0 && wrongKeyErrors > 0, 'Wrong-key receiver decoded frames or produced no encryption rejection evidence')
    checks.wrong_key_receives_packets = true
    checks.wrong_key_decodes_zero_frames = true
    checks.wrong_key_encryption_errors = wrongKeyErrors
    check(matchingKeyErrors === 0, 'Matching-key encryption errors occurred before rotation')

    // Give the adversarial receiver the original key, establish that it can decode,
    // then leave it on that old key while publisher/authorized receiver rotate.
    setStage('establish old key decoding')
    await keyProviders[2].setKey(key)
    await until(async () => (await frameStats(wrongVideo)).decoded >= 5, 'Receiver did not decode when given the original key')
    checks.original_key_receiver_decodes_before_rotation = true

    setStage('fresh key replacement')
    status.textContent = 'Checking fresh media key replacement…'
    const freshKey = crypto.getRandomValues(new Uint8Array(32)).buffer
    const before = (await frameStats(matchedVideo)).decoded
    await keyProviders[1].setKey(freshKey)
    await keyProviders[0].setKey(freshKey)
    await until(async () => (await frameStats(matchedVideo)).decoded >= before + 10, 'Receiver stopped decoding after key replacement')
    checks.fresh_key_video_continues = true
    checks.matching_key_errors_during_rotation = matchingKeyErrors
    // Let already-buffered frames finish before measuring the old-key receiver.
    await delay(500)
    const staleBefore = await frameStats(wrongVideo)
    await delay(1500)
    const staleAfter = await frameStats(wrongVideo)
    check(staleAfter.packets > staleBefore.packets && staleAfter.decoded === staleBefore.decoded, 'Old-key receiver decoded new frames or stopped receiving RTP')
    checks.old_key_receives_new_packets = true
    checks.old_key_decodes_no_new_frames = true
    const final = await frameStats(matchedVideo)
    checks.matching_key_decoded_frames = final.decoded
    checks.source_audio_peak = Number(sourcePeak.toFixed(3))
    checks.received_audio_peak = Number(receivePeak.toFixed(3))
    reportElement.textContent = JSON.stringify({ outcome: 'pass', measuredAt: new Date().toISOString(), capabilities, sdkVersion: '2.22.3', serverVersion: fixture.serverVersion, checks, durationMs: Math.round(performance.now() - started) }, null, 2)
    status.textContent = 'PASS · Encrypted synthetic media through local LiveKit'
  } catch (error) {
    // Stage only: never echo JWTs, keys, SDK errors, SDP, or protocol transcripts.
    reportElement.textContent = JSON.stringify({ outcome: 'fail', measuredAt: new Date().toISOString(), capabilities, failedStage: stage, errorClass: error instanceof Error ? error.name : typeof error, checks, diagnostics: { candidateCounts, connectionStates, connectionReason: error instanceof ConnectionError ? error.reason : undefined, connectionStatus: error instanceof ConnectionError ? error.status : undefined, matchingVideo: await frameStats(matchedVideo), wrongVideo: await frameStats(wrongVideo), matchingAudio: await audioStats(matchedAudio), audioSubscribed: Boolean(matchedAudio), audioContextState: audio?.state, sourcePeak, receivePeak, matchingKeyErrors, wrongKeyErrors }, durationMs: Math.round(performance.now() - started) }, null, 2)
    status.textContent = `FAIL · ${stage}`
  } finally {
    if (animation) clearInterval(animation)
    if (connectionMonitor) clearInterval(connectionMonitor)
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    await Promise.race([Promise.allSettled(rooms.map((room) => room.disconnect())), delay(5000)])
    for (const worker of workers) worker.terminate()
    await audio?.close()
    button.disabled = false
    if (desktop) await invoke('phase0_finish', { report: JSON.parse(reportElement.textContent!) })
  }
}

button.addEventListener('click', () => { void run() })
if (desktop || new URLSearchParams(location.search).get('autorun') === '1') void run()
