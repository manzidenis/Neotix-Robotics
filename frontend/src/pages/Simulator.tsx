import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Square, ChevronRight, ChevronLeft, RotateCcw, RotateCw, Wifi, WifiOff, Film, Search, HelpCircle, Gauge } from 'lucide-react'
import { episodesApi, WS_BASE } from '@/lib/api'
import { useAppStore, useAuthStore } from '@/store'
import { Episode, SimInfo } from '@/types'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/utils'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

export default function SimulatorPage() {
  const { setSimulatorConnected, setSimulatorFrame, setSimulatorCamera } = useAppStore()

  const ws = useRef<WebSocket | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevBlobUrl = useRef<string | null>(null)

  const [connected, setConnected] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [frameIdx, setFrameIdx] = useState(0)
  const [totalFrames, setTotalFrames] = useState(0)
  const [epInfo, setEpInfo] = useState<SimInfo | null>(null)
  const [loadingEp, setLoadingEp] = useState<number | null>(null)
  const [simError, setSimError] = useState<string | null>(null)
  const [cam, setCam] = useState({ azimuth: 135, elevation: -20, distance: 1.5 })
  const [lookat, setLookat] = useState([0, 0, 0.3])
  const [simPage, setSimPage] = useState(1)
  const [simSearch, setSimSearch] = useState('')
  const [speed, setSpeed] = useState(1)
  const [fps, setFps] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const isDragging = useRef(false)
  const dragStart = useRef<{ x: number; y: number; button: number }>({ x: 0, y: 0, button: 0 })
  const camRef = useRef(cam)
  camRef.current = cam
  const lookatRef = useRef(lookat)
  lookatRef.current = lookat
  const playingRef = useRef(playing)
  playingRef.current = playing

  // FPS tracking
  const fpsFrames = useRef(0)
  const fpsTimer = useRef(0)

  // Camera throttle: limit messages to ~30/sec
  const lastCamSend = useRef(0)
  const pendingCam = useRef<object | null>(null)
  const camRafId = useRef(0)

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttempt = useRef(0)
  const maxReconnect = 5

  const SIM_PAGE_SIZE = 15
  const { data: episodes } = useQuery<{ items: Episode[]; total: number; pages: number }>({
    queryKey: ['episodes-sim', simPage, simSearch],
    queryFn: () => episodesApi.list({ page: simPage, page_size: SIM_PAGE_SIZE, task: simSearch || undefined }),
    staleTime: 5_000,
  })

  const connect = useCallback(() => {
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }

    const token = useAuthStore.getState().token
    const socket = new WebSocket(`${WS_BASE}/ws/simulator?token=${encodeURIComponent(token || '')}`)
    socket.binaryType = 'arraybuffer'

    socket.onopen = () => {
      setConnected(true)
      setSimulatorConnected(true)
      reconnectAttempt.current = 0
    }

    socket.onclose = () => {
      setConnected(false)
      setSimulatorConnected(false)
      setPlaying(false)
      // Auto-reconnect with exponential backoff
      if (reconnectAttempt.current < maxReconnect) {
        const delay = Math.min(1000 * 2 ** reconnectAttempt.current, 10000)
        reconnectAttempt.current++
        reconnectTimer.current = setTimeout(() => connect(), delay)
      }
    }

    socket.onerror = () => {
      setConnected(false)
      setSimulatorConnected(false)
    }

    socket.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const view = new DataView(e.data)
        const headerLen = view.getUint32(0, false)
        const headerStr = new TextDecoder().decode(new Uint8Array(e.data, 4, headerLen))
        const meta = JSON.parse(headerStr)

        const jpegBytes = new Uint8Array(e.data, 4 + headerLen)
        const blob = new Blob([jpegBytes], { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)

        if (imgRef.current) imgRef.current.src = url
        if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current)
        prevBlobUrl.current = url
        if (!hasFrame) setHasFrame(true)

        setFrameIdx(meta.frame_index)
        setTotalFrames(meta.total_frames)
        setSimulatorFrame(meta.frame_index, meta.total_frames)
        // Only sync camera from server when NOT actively dragging to prevent feedback jitter
        if (meta.camera && !isDragging.current) {
          setCam(meta.camera)
          setSimulatorCamera(meta.camera)
        }

        // FPS counter
        fpsFrames.current++
        const now = performance.now()
        if (now - fpsTimer.current >= 1000) {
          setFps(fpsFrames.current)
          fpsFrames.current = 0
          fpsTimer.current = now
        }
      } else {
        const msg = JSON.parse(e.data)
        if (msg.type === 'info') {
          setEpInfo(msg as SimInfo)
          setTotalFrames(msg.total_frames)
          setLoadingEp(null)
          setSimError(null)
        } else if (msg.type === 'error') {
          console.error('Simulator:', msg.message)
          setLoadingEp(null)
          setSimError(msg.message)
        }
      }
    }

    ws.current = socket
    return socket
  }, [setSimulatorConnected, setSimulatorFrame, setSimulatorCamera])

  useEffect(() => {
    const s = connect()
    return () => {
      reconnectAttempt.current = maxReconnect // prevent reconnect on unmount
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      s.close()
      if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current)
    }
  }, [connect])

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg))
  }, [])

  // Throttled camera send — at most one message per ~16ms (60 updates/sec)
  const sendCameraThrottled = useCallback((msg: object) => {
    const now = performance.now()
    if (now - lastCamSend.current >= 16) {
      send(msg)
      lastCamSend.current = now
      pendingCam.current = null
    } else {
      pendingCam.current = msg
      cancelAnimationFrame(camRafId.current)
      camRafId.current = requestAnimationFrame(() => {
        if (pendingCam.current) {
          send(pendingCam.current)
          lastCamSend.current = performance.now()
          pendingCam.current = null
        }
      })
    }
  }, [send])

  const loadEpisode = (ep: Episode) => {
    setLoadingEp(ep.id)
    setPlaying(false)
    setSimError(null)
    setFps(0)
    fpsFrames.current = 0
    fpsTimer.current = performance.now()
    setHasFrame(false)
    if (imgRef.current) imgRef.current.src = ''
    if (prevBlobUrl.current) { URL.revokeObjectURL(prevBlobUrl.current); prevBlobUrl.current = null }
    send({ type: 'load', episode_id: ep.id })
  }

  const togglePlay = useCallback(() => {
    const next = !playingRef.current
    setPlaying(next)
    send({ type: next ? 'play' : 'pause' })
  }, [send])

  const step = useCallback((dir: 'forward' | 'back') => {
    setPlaying(false)
    send({ type: 'step', direction: dir })
  }, [send])

  const seek = useCallback((frame: number) => {
    send({ type: 'seek', frame })
  }, [send])

  const changeSpeed = useCallback((newSpeed: number) => {
    setSpeed(newSpeed)
    send({ type: 'speed', speed: newSpeed })
  }, [send])

  const resetCamera = useCallback(() => {
    setLookat([0, 0, 0.3])
    send({ type: 'reset_camera' })
  }, [send])

  const restart = useCallback(() => {
    setPlaying(false)
    send({ type: 'seek', frame: 0 })
  }, [send])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          e.preventDefault()
          step('forward')
          break
        case 'ArrowLeft':
          e.preventDefault()
          step('back')
          break
        case 'r':
        case 'R':
          resetCamera()
          break
        case 'Home':
        case '0':
          e.preventDefault()
          restart()
          break
        case '?':
          setShowHelp(h => !h)
          break
        case ']':
          setSpeed(s => {
            const idx = SPEEDS.indexOf(s)
            const next = idx < SPEEDS.length - 1 ? SPEEDS[idx + 1] : s
            send({ type: 'speed', speed: next })
            return next
          })
          break
        case '[':
          setSpeed(s => {
            const idx = SPEEDS.indexOf(s)
            const next = idx > 0 ? SPEEDS[idx - 1] : s
            send({ type: 'speed', speed: next })
            return next
          })
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, step, resetCamera, restart, send])

  // Mouse camera control
  const onMouseDown = (e: React.MouseEvent) => {
    if (!epInfo) return
    isDragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY, button: e.button }
    e.preventDefault()
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !epInfo) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    dragStart.current = { x: e.clientX, y: e.clientY, button: dragStart.current.button }

    if (dragStart.current.button === 2) {
      const scale = camRef.current.distance * 0.002
      const azRad = (camRef.current.azimuth * Math.PI) / 180
      const la = lookatRef.current
      const newLookat = [
        la[0] + (-dx * Math.cos(azRad) - dy * Math.sin(azRad)) * scale,
        la[1] + (-dx * Math.sin(azRad) + dy * Math.cos(azRad)) * scale,
        la[2],
      ]
      setLookat(newLookat)
      sendCameraThrottled({ type: 'camera', ...camRef.current, lookat: newLookat })
    } else {
      const newCam = {
        ...camRef.current,
        azimuth:   camRef.current.azimuth   + dx * 0.5,
        elevation: Math.max(-89, Math.min(89, camRef.current.elevation - dy * 0.3)),
      }
      setCam(newCam)
      sendCameraThrottled({ type: 'camera', ...newCam, lookat: lookatRef.current })
    }
  }

  const onMouseUp = () => {
    isDragging.current = false
    // Cancel any pending throttled camera message and send final position
    cancelAnimationFrame(camRafId.current)
    if (pendingCam.current) {
      send(pendingCam.current)
      pendingCam.current = null
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    if (!epInfo) return
    const newCam = { ...camRef.current, distance: Math.max(0.3, camRef.current.distance + e.deltaY * 0.005) }
    setCam(newCam)
    sendCameraThrottled({ type: 'camera', ...newCam, lookat: lookatRef.current })
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Episode sidebar */}
      <div className="w-80 flex-shrink-0 flex flex-col" style={{ borderRight: '1px solid rgba(255,255,255,0.08)', background: '#0a0a0a' }}>
        <div className="p-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-xs font-semibold tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>EPISODES</p>
          <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>{episodes?.total ?? 0} total</p>
          <div style={{ position: 'relative', marginTop: 8 }}>
            <Search style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', width: 11, height: 11, color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
            <input
              placeholder="Search task or episode…"
              value={simSearch}
              onChange={(e) => { setSimSearch(e.target.value); setSimPage(1) }}
              style={{ width: '100%', padding: '5px 8px 5px 24px', fontSize: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, color: '#fff', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {episodes?.items?.map((ep) => (
            <button key={ep.id} onClick={() => loadEpisode(ep)}
              className={`w-full text-left px-2.5 py-2 rounded text-xs transition-all ${loadingEp === ep.id ? 'bg-white/15 text-white' : epInfo?.episode_id === ep.id ? 'bg-white/10 text-white border border-white/20' : 'hover:text-white'}`}
              style={loadingEp !== ep.id && epInfo?.episode_id !== ep.id ? { color: 'rgba(255,255,255,0.4)' } : undefined}
              onMouseEnter={(e) => { if (loadingEp !== ep.id && epInfo?.episode_id !== ep.id) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
              onMouseLeave={(e) => { if (loadingEp !== ep.id && epInfo?.episode_id !== ep.id) e.currentTarget.style.background = '' }}>
              <p className="font-mono font-semibold">ep_{String(ep.episode_index).padStart(6, '0')}</p>
              <p className="truncate" style={{ color: 'rgba(255,255,255,0.25)' }}>{ep.task_label || '—'}</p>
              <p className="font-mono" style={{ color: 'rgba(255,255,255,0.25)' }}>{formatDuration(ep.duration)}</p>
            </button>
          ))}
        </div>
        <div style={{ padding: '6px 8px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>{simPage}/{episodes?.pages ?? 1}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setSimPage(p => Math.max(1, p - 1))} disabled={simPage === 1}
              style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: simPage === 1 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)', cursor: simPage === 1 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronLeft style={{ width: 12, height: 12 }} />
            </button>
            <button onClick={() => setSimPage(p => Math.min(episodes?.pages ?? 1, p + 1))} disabled={simPage === (episodes?.pages ?? 1)}
              style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: simPage === (episodes?.pages ?? 1) ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.5)', cursor: simPage === (episodes?.pages ?? 1) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChevronRight style={{ width: 12, height: 12 }} />
            </button>
          </div>
        </div>
      </div>

      {/* Main viewport */}
      <div className="flex-1 flex flex-col" style={{ background: '#000' }}>
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0a0a0a' }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {connected
                ? <><Wifi className="w-3.5 h-3.5" style={{ color: '#fff' }} /><span className="text-xs" style={{ color: '#fff' }}>Connected</span></>
                : <><WifiOff className="w-3.5 h-3.5" style={{ color: 'rgba(255,255,255,0.25)' }} /><span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{reconnectAttempt.current > 0 && reconnectAttempt.current < maxReconnect ? 'Reconnecting…' : 'Disconnected'}</span></>
              }
            </div>
            {epInfo && fps > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: fps >= 20 ? 'rgba(255,255,255,0.5)' : '#f87171', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {fps} FPS
              </span>
            )}
          </div>
          {epInfo && (
            <div className="text-[10px] font-mono flex items-center gap-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <span>{epInfo.bimanual ? '14D · bimanual' : '7D · single-arm'}</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>AZ {cam.azimuth.toFixed(1)}°</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>EL {cam.elevation.toFixed(1)}°</span>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>D {cam.distance.toFixed(2)}m</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setShowHelp(h => !h)}><HelpCircle className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={resetCamera} disabled={!epInfo}><RotateCcw className="w-3.5 h-3.5" /> Reset Cam</Button>
          </div>
        </div>

        {/* Canvas area */}
        <div
          ref={containerRef}
          className="flex-1 relative flex items-center justify-center overflow-hidden cursor-crosshair select-none"
          style={{ background: '#000' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {simError ? (
            <div className="flex flex-col items-center gap-3 px-6 text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <WifiOff className="w-6 h-6 text-red-400" />
              </div>
              <p className="text-sm text-red-400 font-medium">Simulator Error</p>
              <p className="text-xs max-w-md" style={{ color: 'rgba(255,255,255,0.4)' }}>{simError}</p>
            </div>
          ) : !epInfo ? (
            <div className="flex flex-col items-center gap-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <Film className="w-14 h-14" style={{ opacity: 0.2 }} />
              <p className="text-sm">Select an episode from the sidebar</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>Left drag to orbit · Scroll to zoom · Right drag to pan</p>
            </div>
          ) : (
            <img
              ref={imgRef}
              alt=""
              className="max-w-full max-h-full object-contain"
              style={{ imageRendering: 'crisp-edges', display: hasFrame ? 'block' : 'none' }}
            />
          )}

          {loadingEp && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-white">
                <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <p className="text-xs font-mono">Loading episode…</p>
              </div>
            </div>
          )}

          {/* Controls help overlay */}
          <AnimatePresence>
            {showHelp && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center"
                style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)', zIndex: 20 }}
                onClick={() => setShowHelp(false)}
              >
                <div style={{ maxWidth: 340, padding: 24, borderRadius: 14, background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)' }} onClick={(e) => e.stopPropagation()}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 14px' }}>Keyboard & Mouse Controls</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 14px', fontSize: 12 }}>
                    {[
                      ['Space', 'Play / Pause'],
                      ['←', 'Step back 1 frame'],
                      ['→', 'Step forward 1 frame'],
                      ['0', 'Restart from beginning'],
                      ['R', 'Reset camera'],
                      ['[', 'Slower speed'],
                      [']', 'Faster speed'],
                      ['?', 'Toggle this help'],
                    ].map(([key, desc]) => (
                      <div key={key} style={{ display: 'contents' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', textAlign: 'center', fontSize: 11 }}>{key}</span>
                        <span style={{ color: 'rgba(255,255,255,0.5)', lineHeight: '24px' }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0, lineHeight: 1.5 }}>
                      <strong style={{ color: 'rgba(255,255,255,0.5)' }}>Mouse:</strong> Left drag to orbit · Scroll to zoom · Right drag to pan
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Playback controls */}
        {epInfo && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0a0a0a' }}>
            <div className="flex items-center gap-3">
              <Button size="icon-sm" variant="ghost" onClick={() => step('back')}><ChevronLeft className="w-4 h-4" /></Button>
              <button onClick={togglePlay} className="text-white hover:text-white/80 transition-colors">
                {playing ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <Button size="icon-sm" variant="ghost" onClick={() => step('forward')}><ChevronRight className="w-4 h-4" /></Button>
              <button onClick={restart} title="Restart from beginning" className="text-white/40 hover:text-white transition-colors">
                <RotateCw className="w-4 h-4" />
              </button>

              {/* Speed control */}
              <div className="flex items-center gap-1">
                <Gauge className="w-3 h-3" style={{ color: 'rgba(255,255,255,0.25)' }} />
                {SPEEDS.map((s) => (
                  <button key={s} onClick={() => changeSpeed(s)}
                    style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, fontFamily: 'monospace',
                      border: speed === s ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
                      background: speed === s ? 'rgba(255,255,255,0.1)' : 'transparent',
                      color: speed === s ? '#fff' : 'rgba(255,255,255,0.25)',
                      cursor: 'pointer', transition: 'all 0.1s',
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              <input
                type="range" min={0} max={Math.max(0, totalFrames - 1)} value={frameIdx}
                onChange={(e) => seek(Number(e.target.value))}
                className="flex-1 accent-white h-1"
              />

              <span className="text-xs font-mono flex-shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {String(frameIdx).padStart(5, '0')} / {String(totalFrames).padStart(5, '0')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
