import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, CheckCircle, Trash2, Flag, RotateCcw, Edit2, Check, X, Play, Square, Loader2 } from 'lucide-react'
import { episodesApi } from '@/lib/api'
import { Episode, EpisodeData, EpisodeStatus, ReplayStatus } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDuration, jointLabel, JOINT_COLORS } from '@/lib/utils'
import { toast } from 'sonner'
import { ParentSize } from '@visx/responsive'
import { scaleLinear } from '@visx/scale'
import { LinePath } from '@visx/shape'
import { AxisBottom, AxisLeft } from '@visx/axis'
import { GridRows } from '@visx/grid'

// Joint Trajectory Chart
function JointChart({ data, bimanual }: { data: EpisodeData; bimanual: boolean }) {
  const margin = { top: 10, right: 20, bottom: 36, left: 48 }
  return (
    <ParentSize>
      {({ width, height }) => {
        if (width < 10 || height < 10) return null
        const w = width - margin.left - margin.right
        const h = height - margin.top - margin.bottom
        const ts = data.timestamps
        const allVals = data.states.flat()
        const xScale = scaleLinear({ domain: [ts[0], ts[ts.length - 1]], range: [0, w] })
        const yScale = scaleLinear({ domain: [Math.min(...allVals) - 0.1, Math.max(...allVals) + 0.1], range: [h, 0] })
        return (
          <svg width={width} height={height}>
            <g transform={`translate(${margin.left},${margin.top})`}>
              <GridRows scale={yScale} width={w} stroke="#1e3a5f" strokeOpacity={0.5} numTicks={5} />
              {data.states[0].map((_, ji) => (
                <LinePath
                  key={ji}
                  data={data.states}
                  x={(_, i) => xScale(ts[i])}
                  y={(row) => yScale(row[ji])}
                  stroke={JOINT_COLORS[ji % JOINT_COLORS.length]}
                  strokeWidth={1.2}
                  strokeOpacity={0.85}
                />
              ))}
              <AxisBottom top={h} scale={xScale} numTicks={6}
                stroke="#1e3a5f" tickStroke="#1e3a5f"
                tickLabelProps={{ fill: '#64748b', fontSize: 10, dy: '0.5em' }}
                label="time (s)" labelProps={{ fill: '#64748b', fontSize: 10, dy: '2em', textAnchor: 'middle' }}
              />
              <AxisLeft scale={yScale} numTicks={5}
                stroke="#1e3a5f" tickStroke="#1e3a5f"
                tickLabelProps={{ fill: '#64748b', fontSize: 10, dx: '-0.5em' }}
                label="rad" labelProps={{ fill: '#64748b', fontSize: 10, dx: '-2em', textAnchor: 'middle' }}
              />
            </g>
          </svg>
        )
      }}
    </ParentSize>
  )
}

// Synchronized Video Player
function VideoPlayer({ episodeId, cameras }: { episodeId: number; cameras: string[] }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [progress, setProgress] = useState(0)
  const primary = refs.current[0]

  const sync = () => {
    if (!primary) return
    refs.current.slice(1).forEach((v) => {
      if (v && Math.abs(v.currentTime - primary.currentTime) > 0.1) v.currentTime = primary.currentTime
    })
  }

  const togglePlay = () => {
    refs.current.forEach((v) => { if (v) playing ? v.pause() : v.play() })
    setPlaying(!playing)
  }

  const setSpeedAll = (s: number) => {
    refs.current.forEach((v) => { if (v) v.playbackRate = s })
    setSpeed(s)
  }

  const seek = (pct: number) => {
    const dur = primary?.duration ?? 0
    refs.current.forEach((v) => { if (v) v.currentTime = dur * pct })
  }

  return (
    <div className="space-y-3">
      {/* Videos */}
      <div className="flex gap-2">
        {cameras.map((cam, i) => (
          <div key={cam} className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-cyan-600 mb-1">{cam}</p>
            <video
              ref={(el) => { refs.current[i] = el }}
              src={episodesApi.videoUrl(episodeId, cam)}
              onTimeUpdate={() => { sync(); if (primary) setProgress(primary.currentTime / (primary.duration || 1)) }}
              onEnded={() => setPlaying(false)}
              className="w-full h-48 object-contain rounded-lg bg-black"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              muted
            />
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button onClick={togglePlay} className="text-cyan-400 hover:text-cyan-300">
          {playing ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5" />}
        </button>
        <input
          type="range" min={0} max={1} step={0.001} value={progress}
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-cyan-400 h-1"
        />
        <div className="flex gap-1">
          {[0.5, 1, 2, 4].map((s) => (
            <button key={s} onClick={() => setSpeedAll(s)}
              className={`text-xs px-1.5 py-0.5 rounded font-mono ${speed === s ? 'bg-cyan-500/20 text-cyan-400' : ''}`}
              style={speed !== s ? { color: 'rgba(255,255,255,0.4)' } : undefined}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Main page
export default function EpisodeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const epId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: ep } = useQuery<Episode>({ queryKey: ['episode', epId], queryFn: () => episodesApi.get(epId), staleTime: 30_000 })
  const { data: epData } = useQuery<EpisodeData>({ queryKey: ['episode-data', epId], queryFn: () => episodesApi.getData(epId), staleTime: 300_000 })
  const { data: replayStatus } = useQuery<ReplayStatus | null>({
    queryKey: ['replay-status', epId],
    queryFn: () => episodesApi.replayStatus(epId).catch(() => null),
    refetchInterval: (query) => {
      const d = query.state.data
      return (d?.status === 'pending' || d?.status === 'running') ? 1500 : false
    },
    staleTime: 30_000,
  })

  const statusMut = useMutation({
    mutationFn: (status: EpisodeStatus) => episodesApi.setStatus(epId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['episode', epId] }),
  })

  const taskMut = useMutation({
    mutationFn: (task_label: string) => episodesApi.setTask(epId, task_label),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['episode', epId] }); toast.success('Task updated') },
  })

  const replayMut = useMutation({
    mutationFn: () => episodesApi.startReplay(epId),
    onSuccess: () => { toast.info('Render started…'); qc.invalidateQueries({ queryKey: ['replay-status', epId] }) },
  })

  const cancelReplayMut = useMutation({
    mutationFn: () => episodesApi.cancelReplay(epId),
    onSuccess: () => { toast.info('Rendering stopped'); qc.invalidateQueries({ queryKey: ['replay-status', epId] }) },
  })

  const [editTask, setEditTask] = useState(false)
  const [taskInput, setTaskInput] = useState('')
  const bimanual = (epData?.joints ?? 7) === 14

  const cameras = ep?.cameras?.length ? ep.cameras : (bimanual ? ['env1', 'wrist_left', 'wrist_right'] : ['env', 'wrist'])

  if (!ep) return <div className="p-6" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading…</div>

  return (
    <div className="p-6 space-y-3">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Button size="icon-sm" variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-bold font-mono" style={{ color: '#fff' }}>Episode {String(ep.episode_index).padStart(6, '0')}</h1>
            <Badge variant={ep.status}>{ep.status}</Badge>
            {bimanual && <Badge variant="bimanual">bimanual</Badge>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {editTask ? (
              <div className="flex gap-1">
                <Input value={taskInput} onChange={(e) => setTaskInput(e.target.value)} className="h-6 text-xs w-64" autoFocus />
                <button onClick={() => { taskMut.mutate(taskInput); setEditTask(false) }} className="text-cyan-400"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setEditTask(false)} style={{ color: 'rgba(255,255,255,0.4)' }}><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{ep.task_label || 'No task label'}</span>
                <button onClick={() => { setEditTask(true); setTaskInput(ep.task_label) }} style={{ color: 'rgba(255,255,255,0.25)' }}><Edit2 className="w-3 h-3" /></button>
              </div>
            )}
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
            <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{formatDuration(ep.duration)} · {ep.frame_count} frames</span>
          </div>
        </div>

        {/* QA actions */}
        <div className="flex gap-2 flex-shrink-0">
          <Button size="sm" variant={ep.status === 'validated' ? 'success' : 'secondary'} onClick={() => statusMut.mutate('validated')} loading={statusMut.isPending}>
            <CheckCircle className="w-3.5 h-3.5" /> Validate
          </Button>
          <Button size="sm" variant={ep.status === 'flagged' ? 'warning' : 'secondary'} onClick={() => statusMut.mutate('flagged')}>
            <Flag className="w-3.5 h-3.5" /> Flag
          </Button>
          <Button size="sm" variant={ep.status === 'deleted' ? 'destructive' : 'secondary'} onClick={() => statusMut.mutate('deleted')}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
          {ep.status !== 'unreviewed' && (
            <Button size="sm" variant="ghost" onClick={() => statusMut.mutate('unreviewed')}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>

      {/* Video */}
      {/* Camera Feeds + Simulation Replay side by side */}
      <div className="flex gap-3">
        {/* Camera Feeds — left */}
        <div className="flex-1 min-w-0 rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-xs font-semibold tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>CAMERA FEEDS</h2>
          <VideoPlayer episodeId={epId} cameras={cameras} />
        </div>

        {/* Simulation Replay — right */}
        <div className="flex-shrink-0 rounded-xl p-3" style={{ width: 420, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>SIMULATION REPLAY</h2>
            {(replayStatus?.status === 'running' || replayStatus?.status === 'pending') ? (
              <Button size="sm" variant="destructive" onClick={() => cancelReplayMut.mutate()} loading={cancelReplayMut.isPending}>
                <Square className="w-3.5 h-3.5" /> Stop
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => replayMut.mutate()} loading={replayMut.isPending}>
                <Play className="w-3.5 h-3.5" /> Replay
              </Button>
            )}
          </div>

          <AnimatePresence>
            {replayStatus && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {(replayStatus.status === 'pending' || replayStatus.status === 'running') && (
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <span>Rendering…</span>
                        <span>{replayStatus.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <motion.div className="h-full bg-cyan-500 rounded-full" animate={{ width: `${replayStatus.progress}%` }} />
                      </div>
                    </div>
                  </div>
                )}
                {replayStatus.status === 'done' && (
                  <video src={episodesApi.replayVideoUrl(epId)} controls className="w-full rounded-lg bg-black" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                )}
                {replayStatus.status === 'error' && (
                  <p className="text-xs text-red-400">{replayStatus.error_message}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Joint chart */}
      {epData && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="text-xs font-semibold tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>JOINT TRAJECTORY</h2>
          <div className="flex flex-wrap gap-2 mb-3">
            {epData.states[0]?.map((_, ji) => (
              <div key={ji} className="flex items-center gap-1">
                <div className="w-3 h-0.5 rounded-full" style={{ background: JOINT_COLORS[ji % JOINT_COLORS.length] }} />
                <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.4)' }}>{jointLabel(ji, bimanual)}</span>
              </div>
            ))}
          </div>
          <div className="h-56">
            <JointChart data={epData} bimanual={bimanual} />
          </div>
        </div>
      )}
    </div>
  )
}
