import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Cpu, ArrowRight, X, AlertCircle, Play, Square, VolumeX, Volume2, ChevronRight } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore, useAppStore } from '@/store'
import { queryClient } from '@/queryClient'
import { toast } from 'sonner'

// counter
function useCountUp(target: number, duration = 1200, start = false) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (!start) return
    let raf: number
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      setVal(Math.floor(p * target))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, start])
  return val
}

// Auth Modal
function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const update = (field: string, val: string) => { setError(''); setForm((f) => ({ ...f, [field]: val })) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        await authApi.register({ username: form.username, email: form.email, password: form.password })
        toast.success('Account Created Successfully')
        setMode('login')
        setForm((f) => ({ ...f, password: '' }))
      } else {
        const data = await authApi.login(form.username, form.password)
        queryClient.clear()
        useAppStore.getState().setActiveDataset(null, null)
        setAuth(data.access_token, data.user)
        toast.success(`Welcome, ${data.user.username}`)
        navigate('/app')
      }
    } catch (err: unknown) {
      const axiosErr = err as { code?: string; response?: { data?: { detail?: string } } }
      const detail = axiosErr?.response?.data?.detail
      const isTimeout = axiosErr?.code === 'ECONNABORTED'
      setError(isTimeout ? 'Server not responding. Make sure the backend is running.' : detail ?? (mode === 'login' ? 'Account not found or incorrect password.' : 'Registration failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 7,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
    color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)' }}
    >
      <motion.div initial={{ scale: 0.94, y: 14, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.94, y: 14, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 340, margin: '0 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', padding: '28px 28px 24px', background: '#0c0c0c' }}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4, display: 'flex' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')} onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
          <X style={{ width: 14, height: 14 }} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}>NEOTIX</span>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', margin: '3px 0 0' }}>Robotics Data Platform</p>
        </div>

        <div style={{ display: 'flex', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', padding: 3, marginBottom: 16, background: 'rgba(255,255,255,0.03)' }}>
          {(['login', 'register'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', transition: 'all 0.15s', background: mode === m ? '#fff' : 'transparent', color: mode === m ? '#000' : 'rgba(255,255,255,0.4)', fontFamily: 'inherit' }}>
              {m === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input placeholder="Username" value={form.username} onChange={(e) => update('username', e.target.value)} required style={inp}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')} />
          {mode === 'register' && (
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required style={inp}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')} onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)')} />
          )}
          <input placeholder="Password" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} required style={{ ...inp, borderColor: error ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)')} onBlur={(e) => (e.currentTarget.style.borderColor = error ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)')} />

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, y: -4, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '8px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', overflow: 'hidden' }}
              >
                <AlertCircle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 1, color: '#fff' }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <button type="submit" disabled={loading}
            style={{ width: '100%', padding: '9px 0', borderRadius: 7, background: '#fff', color: '#000', fontSize: 13, fontWeight: 700, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, marginTop: 4, fontFamily: 'inherit' }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </motion.div>
    </motion.div>
  )
}

const DEMOS = [
  {
    label: 'Ep #000',
    env: '/data/ball_to_cup/videos/chunk-000/observation.images.env/episode_000000.mp4',
    wrist: '/data/ball_to_cup/videos/chunk-000/observation.images.wrist/episode_000000.mp4',
  },
  {
    label: 'Ep #001',
    env: '/data/ball_to_cup/videos/chunk-000/observation.images.env/episode_000001.mp4',
    wrist: '/data/ball_to_cup/videos/chunk-000/observation.images.wrist/episode_000001.mp4',
  },
]

// Hero demo player
function HeroDemo() {
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(true)
  const envRef = useRef<HTMLVideoElement>(null)
  const wristRef = useRef<HTMLVideoElement>(null)
  const ep = DEMOS[active]

  const toggle = () => {
    ;[envRef.current, wristRef.current].forEach((v) => { if (v) playing ? v.pause() : v.play() })
    setPlaying(!playing)
  }
  const onTime = () => {
    if (envRef.current && wristRef.current && Math.abs(wristRef.current.currentTime - envRef.current.currentTime) > 0.15)
      wristRef.current.currentTime = envRef.current.currentTime
  }
  useEffect(() => {
    ;[envRef.current, wristRef.current].forEach((v) => {
      if (v) { v.currentTime = 0; v.load(); v.play().catch(() => {}) }
    })
    setPlaying(true)
  }, [active])

  return (
    <div style={{ width: '100%' }}>
      {/* Episode tabs + meta */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
        {DEMOS.map((d, i) => (
          <button key={i} onClick={() => setActive(i)} style={{ padding: '3px 9px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', border: `1px solid ${active === i ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'}`, background: active === i ? 'rgba(255,255,255,0.1)' : 'transparent', color: active === i ? '#fff' : 'rgba(255,255,255,0.4)' }}>
            {d.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>30 fps · 7-DOF</span>
      </div>

      {/* ENV + WRIST stacked */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {([{ label: 'ENV', ref: envRef, src: ep.env, main: true }, { label: 'WRIST', ref: wristRef, src: ep.wrist, main: false }] as const).map(({ label, ref, src, main }) => (
          <div key={label} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#000', aspectRatio: '16/9' }}>
            <video ref={ref as React.RefObject<HTMLVideoElement>} src={src} muted={muted} playsInline autoPlay loop
              onTimeUpdate={main ? onTime : undefined}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', top: 5, left: 5, fontSize: 9, fontFamily: 'monospace', padding: '2px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.7)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.1)' }}>{label}</div>
            {!playing && (
              <div onClick={toggle} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)', cursor: 'pointer' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Play style={{ width: 12, height: 12, color: '#fff', marginLeft: 2 }} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7 }}>
        <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
          {playing ? <Square style={{ width: 10, height: 10 }} /> : <Play style={{ width: 10, height: 10 }} />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => { const n = !muted; setMuted(n); [envRef.current, wristRef.current].forEach((v) => { if (v) v.muted = n }) }}
          style={{ padding: 5, borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', display: 'flex' }}>
          {muted ? <VolumeX style={{ width: 12, height: 12 }} /> : <Volume2 style={{ width: 12, height: 12 }} />}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>ball_to_cup</span>
      </div>
    </div>
  )
}

// Feature visuals
function MiniChart() {
  const w = 320, h = 170
  const lines = [
    { a: 0.8, f: 2.1, off: 0 },
    { a: 0.5, f: 3.2, off: 1.2 },
    { a: 0.35, f: 1.8, off: 2.4 },
    { a: 0.6, f: 2.7, off: 0.7 },
  ]
  const path = (a: number, f: number, off: number) => {
    const pts: string[] = []
    for (let x = 0; x <= w; x += 3) pts.push(`${x},${h / 2 + Math.sin((x / w) * Math.PI * f * 2 + off) * a * 36}`)
    return `M ${pts.join(' L ')}`
  }
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
      {lines.map((l, i) => (
        <path key={i} d={path(l.a, l.f, l.off)} fill="none" stroke={`rgba(255,255,255,${0.75 - i * 0.12})`} strokeWidth={2} />
      ))}
      <line x1={0} y1={h} x2={w} y2={h} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      <line x1={0} y1={0} x2={0} y2={h} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
    </svg>
  )
}

function MiniRobot() {
  return (
    <svg width="100%" viewBox="0 0 200 160" style={{ display: 'block', maxWidth: 320 }}>
      {/* base */}
      <rect x={72} y={138} width={56} height={16} rx={6} fill="rgba(255,255,255,0.12)" />
      {/* torso */}
      <rect x={84} y={90} width={32} height={52} rx={8} fill="rgba(255,255,255,0.18)" />
      {/* shoulder joint */}
      <circle cx={100} cy={90} r={13} fill="rgba(255,255,255,0.28)" />
      {/* upper arm */}
      <line x1={100} y1={90} x2={148} y2={56} stroke="rgba(255,255,255,0.5)" strokeWidth={14} strokeLinecap="round" />
      {/* elbow joint */}
      <circle cx={148} cy={56} r={9} fill="rgba(255,255,255,0.25)" />
      {/* forearm */}
      <line x1={148} y1={56} x2={174} y2={24} stroke="rgba(255,255,255,0.42)" strokeWidth={10} strokeLinecap="round" />
      {/* wrist joint */}
      <circle cx={174} cy={24} r={7} fill="rgba(255,255,255,0.22)" />
      {/* gripper fingers */}
      <line x1={174} y1={24} x2={162} y2={12} stroke="rgba(255,255,255,0.6)" strokeWidth={4} strokeLinecap="round" />
      <line x1={174} y1={24} x2={184} y2={12} stroke="rgba(255,255,255,0.6)" strokeWidth={4} strokeLinecap="round" />
      {/* websocket pulse */}
      <circle cx={26} cy={26} r={7} fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5}>
        <animate attributeName="r" values="7;14;7" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.15;1" dur="1.8s" repeatCount="indefinite" />
      </circle>
      <text x={38} y={30} fontSize={11} fill="rgba(255,255,255,0.4)" fontFamily="monospace">WS</text>
    </svg>
  )
}

function MiniQA() {
  const items = [
    { label: 'ep_042', status: '✓', w: '75%', hi: true },
    { label: 'ep_043', status: '⚑', w: '55%', hi: false },
    { label: 'ep_044', status: '✓', w: '90%', hi: true },
    { label: 'ep_045', status: '✗', w: '30%', hi: false },
    { label: 'ep_046', status: '✓', w: '68%', hi: true },
    { label: 'ep_047', status: '✓', w: '82%', hi: true },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%' }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)' }}>
          <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.45)', flex: 1 }}>{it.label}</span>
          <div style={{ width: 70, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ width: it.w, height: '100%', background: 'rgba(255,255,255,0.45)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 14, color: it.hi ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)', width: 18, textAlign: 'center' }}>{it.status}</span>
        </div>
      ))}
    </div>
  )
}

function MiniPipeline() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', width: '100%' }}>
      {[['RAW', '456'], ['QA', '↓'], ['CLEAN', '312']].map(([label, count], i, arr) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: i === 1 ? '0 0 auto' : '1' }}>
          {i !== 1 && (
            <div style={{ flex: 1, textAlign: 'center', padding: '22px 20px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>{count}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6 }}>{label}</div>
            </div>
          )}
          {i < arr.length - 1 && <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 24, flexShrink: 0 }}>→</span>}
        </div>
      ))}
    </div>
  )
}

function FeatureCard({ title, tagline, visual, delay }: { title: string; tagline: string; visual: React.ReactNode; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.3, delay }}
      style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', padding: '32px 24px', background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 20 }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
    >
      <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>{visual}</div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>{title}</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', margin: 0, lineHeight: 1.5 }}>{tagline}</p>
      </div>
    </motion.div>
  )
}

function IngestIcon() {
  return (
    <svg width="100%" viewBox="0 0 120 100" style={{ display: 'block', maxWidth: 120 }}>
      <rect x={20} y={10} width={50} height={60} rx={4} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
      <line x1={30} y1={24} x2={58} y2={24} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
      <line x1={30} y1={34} x2={52} y2={34} stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeLinecap="round" />
      <line x1={30} y1={44} x2={56} y2={44} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
      <line x1={30} y1={54} x2={48} y2={54} stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeLinecap="round" />
      <rect x={56} y={36} width={44} height={54} rx={4} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
      <polyline points="78,52 78,66 86,58" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ReviewIcon() {
  return (
    <svg width="100%" viewBox="0 0 120 100" style={{ display: 'block', maxWidth: 120 }}>
      <rect x={10} y={14} width={60} height={42} rx={4} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
      <polygon points="32,28 32,48 48,38" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={90} cy={50} r={22} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
      <line x1={106} y1={66} x2={116} y2={78} stroke="rgba(255,255,255,0.5)" strokeWidth={3} strokeLinecap="round" />
      <polyline points="16,72 32,64 48,74 64,60 80,68" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SimulateIcon() {
  return (
    <svg width="100%" viewBox="0 0 120 100" style={{ display: 'block', maxWidth: 120 }}>
      <rect x={30} y={70} width={40} height={12} rx={4} fill="rgba(255,255,255,0.12)" />
      <rect x={38} y={38} width={24} height={36} rx={6} fill="rgba(255,255,255,0.15)" />
      <circle cx={50} cy={38} r={9} fill="rgba(255,255,255,0.22)" />
      <line x1={50} y1={38} x2={82} y2={18} stroke="rgba(255,255,255,0.4)" strokeWidth={8} strokeLinecap="round" />
      <circle cx={82} cy={18} r={6} fill="rgba(255,255,255,0.2)" />
      <line x1={82} y1={18} x2={100} y2={6} stroke="rgba(255,255,255,0.35)" strokeWidth={5} strokeLinecap="round" />
      <line x1={100} y1={6} x2={94} y2={0} stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={100} y1={6} x2={108} y2={0} stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={16} cy={16} r={5} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5}>
        <animate attributeName="r" values="5;10;5" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.15;1" dur="1.8s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg width="100%" viewBox="0 0 120 100" style={{ display: 'block', maxWidth: 120 }}>
      <rect x={18} y={20} width={52} height={60} rx={4} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={2} />
      <line x1={28} y1={36} x2={58} y2={36} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
      <line x1={28} y1={46} x2={52} y2={46} stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeLinecap="round" />
      <line x1={28} y1={56} x2={56} y2={56} stroke="rgba(255,255,255,0.2)" strokeWidth={2} strokeLinecap="round" />
      <line x1={28} y1={66} x2={44} y2={66} stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeLinecap="round" />
      <polyline points="36,28 44,20 52,28" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={80} y1={30} x2={80} y2={70} stroke="rgba(255,255,255,0.15)" strokeWidth={2} strokeLinecap="round" />
      <polyline points="72,42 80,30 88,42" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={70} y={64} width={20} height={16} rx={3} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
      <line x1={75} y1={72} x2={85} y2={72} stroke="rgba(255,255,255,0.25)" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

const STEPS: { n: string; visual: React.ReactNode; title: string; sub: string }[] = [
  { n: '01', visual: <IngestIcon />, title: 'Ingest', sub: 'Import folder or upload ZIP. Auto-detects robot type & cameras.' },
  { n: '02', visual: <ReviewIcon />, title: 'Review', sub: 'Watch video, inspect joint plots, assign QA status per episode.' },
  { n: '03', visual: <SimulateIcon />, title: 'Simulate', sub: 'Stream episode live in MuJoCo or render to MP4 asynchronously.' },
  { n: '04', visual: <ExportIcon />, title: 'Export', sub: 'Export validated episodes as a clean re-indexed LeRobot dataset.' },
]

// Workflow line-art visuals
function WorkflowChain() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, width: '100%' }}>
      {STEPS.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'stretch', flex: 1, minWidth: 0 }}>
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, delay: i * 0.08 }}
            style={{ flex: 1, padding: '32px 22px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.025)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
          >
            <div style={{ minHeight: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 14 }}>{s.visual}</div>
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.28)', marginBottom: 6 }}>{s.n}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 10 }}>{s.title}</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>{s.sub}</div>
          </motion.div>
          {i < STEPS.length - 1 && (
            <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.08 + 0.2 }}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', color: 'rgba(255,255,255,0.2)', fontSize: 22 }}>
              →
            </motion.div>
          )}
        </div>
      ))}
    </div>
  )
}

function DatasetVideoCard({ src, label }: { src: string; label: string }) {
  const [errored, setErrored] = useState(false)

  return (
    <div
      style={{ position: 'relative', borderRadius: 9, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', background: '#0a0a0a', aspectRatio: '16/9', cursor: 'pointer', flex: '1 1 0', minWidth: 100 }}
    >
      {errored ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <Play style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.15)' }} />
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)' }}>offline</span>
        </div>
      ) : (
        <video src={src} muted playsInline loop autoPlay preload="auto"
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      )}
      <div style={{ position: 'absolute', bottom: 5, left: 5, fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.6)', background: 'rgba(0,0,0,0.65)', padding: '1px 5px', borderRadius: 3, pointerEvents: 'none' }}>{label}</div>
    </div>
  )
}

const DATASETS = [
  {
    name: 'ball_to_cup',
    tag: 'Single-Arm · 7-DOF',
    desc: 'Pick-and-place — robot picks a ball and drops it into a cup.',
    episodes: 456, fps: 30,
    videos: [
      { src: '/data/ball_to_cup/videos/chunk-000/observation.images.env/episode_000000.mp4', label: 'ep_000 · env' },
      { src: '/data/ball_to_cup/videos/chunk-000/observation.images.env/episode_000001.mp4', label: 'ep_001 · env' },
      { src: '/data/ball_to_cup/videos/chunk-000/observation.images.wrist/episode_000000.mp4', label: 'ep_000 · wrist' },
    ],
  },
  {
    name: 'dirty_towels',
    tag: 'Bimanual · 14-DOF',
    desc: 'Both arms coordinate to fold a crumpled towel flat on a surface.',
    episodes: 55, fps: 30,
    videos: [
      { src: '/data/dirty_towels/videos/chunk-000/observation.images.env1/episode_000000.mp4', label: 'ep_000 · env1' },
      { src: '/data/dirty_towels/videos/chunk-000/observation.images.wrist_left/episode_000000.mp4', label: 'ep_000 · wrist_l' },
      { src: '/data/dirty_towels/videos/chunk-000/observation.images.wrist_right/episode_000000.mp4', label: 'ep_000 · wrist_r' },
    ],
  },
]

// Dataset video gallery
function DatasetSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {DATASETS.map((ds) => (
        <motion.div key={ds.name} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.09)', padding: '20px 20px 16px', background: 'rgba(255,255,255,0.02)' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <h3 style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#fff', margin: 0 }}>{ds.name}</h3>
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace' }}>{ds.tag}</span>
              </div>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)', margin: 0, lineHeight: 1.5 }}>{ds.desc}</p>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              {[['Episodes', ds.episodes], ['FPS', ds.fps]].map(([k, v]) => (
                <div key={String(k)} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>{v}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {ds.videos.map((v) => (
              <DatasetVideoCard key={v.src} src={v.src} label={v.label} />
            ))}
          </div>
          <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace', margin: '8px 0 0' }}>Hover to play · LeRobot v2.1</p>
        </motion.div>
      ))}
    </div>
  )
}

// Landing page
export default function LandingPage() {
  const [authOpen, setAuthOpen] = useState(false)
  const token = useAuthStore((s) => s.token)
  const navigate = useNavigate()
  const handleCTA = () => { if (token) navigate('/app'); else setAuthOpen(true) }

  // Stats counter — triggered once hero is mounted (always visible)
  const [statsStarted, setStatsStarted] = useState(false)
  useEffect(() => { const t = setTimeout(() => setStatsStarted(true), 600); return () => clearTimeout(t) }, [])
  const ep = useCountUp(456, 1200, statsStarted)
  const dof = useCountUp(7, 900, statsStarted)
  const fps = useCountUp(30, 900, statsStarted)
  const ds = useCountUp(2, 700, statsStarted)

  const STATS = [
    { val: ep, suffix: '+', label: 'Episodes' },
    { val: dof, suffix: 'D', label: 'Joints / arm' },
    { val: fps, suffix: ' fps', label: 'Capture rate' },
    { val: ds, suffix: '', label: 'Datasets' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#000', color: '#fff', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Responsive CSS */}
      <style>{`
        .nx-nav-links { display: flex; align-items: center; gap: 20px; }
        .nx-hero { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
        .nx-stats { display: grid; grid-template-columns: repeat(4,1fr); }
        .nx-ds-videos { display: flex; gap: 8px; }
        @media (max-width: 900px) {
          .nx-hero { grid-template-columns: 1fr; gap: 32px; }
          .nx-stats { grid-template-columns: repeat(2,1fr); row-gap: 16px; }
        }
        @media (max-width: 640px) {
          .nx-nav-links { display: none; }
          .nx-ds-videos { flex-direction: column; }
        }
      `}</style>

      {/* Navbar */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40, borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(14px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cpu style={{ width: 12, height: 12, color: '#fff' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }}>NEOTIX</span>
          </a>

          <div className="nx-nav-links">
            {['#features', '#workflow', '#examples'].map((href) => (
              <a key={href} href={href} style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', textDecoration: 'none', transition: 'color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')} onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.38)')}>
                {href.slice(1).charAt(0).toUpperCase() + href.slice(2)}
              </a>
            ))}
          </div>

          <button onClick={handleCTA}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 7, background: '#fff', color: '#000', fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            {token ? 'Open App' : 'Sign In'} <ArrowRight style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ paddingTop: 10, minHeight: '100vh', display: 'flex', alignItems: 'center', boxSizing: 'border-box' }}>
        <div className="nx-hero" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px', width: '100%' }}>

          {/* LEFT: text + stats */}
          <div>
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.13)', background: 'rgba(255,255,255,0.05)', fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.5)', marginBottom: 36 }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', display: 'inline-block' }} />
              LeRobot v2.1 · MuJoCo · WebSocket Sim
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.06 }}
              style={{ fontSize: 'clamp(28px,4.5vw,54px)', fontWeight: 900, lineHeight: 1.07, letterSpacing: '-0.03em', marginBottom: 14, color: '#fff' }}
            >
              Robotics Training<br />Data, Mastered.
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }}
              style={{ fontSize: 15, color: 'rgba(255,255,255,0.48)', lineHeight: 1.65, marginBottom: 140, maxWidth: 440 }}
            >
              The complete QA platform for robot demonstration datasets.
              Review episodes, visualize joints, replay in simulation, and export clean training sets.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.18 }}
              style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 40 }}
            >
              <button onClick={handleCTA}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 22px', borderRadius: 8, background: '#fff', color: '#000', fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                Get Started <ArrowRight style={{ width: 14, height: 14 }} />
              </button>
              <a href="#examples"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', fontWeight: 500, fontSize: 14, textDecoration: 'none', transition: 'border-color 0.15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.4)')} onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)')}
              >
                View Examples
              </a>
            </motion.div>

            {/* Stats row */}
            <motion.div className="nx-stats" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
              style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 5 }}
            >
              {STATS.map((s, i) => (
                <div key={i} style={{ textAlign: 'left', padding: '0 8px', borderRight: i < STATS.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
                  <div style={{ fontSize: 'clamp(20px,2.5vw,30px)', fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {s.val.toLocaleString()}{s.suffix}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.32)', marginTop: 5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* RIGHT: demo player */}
          <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, delay: 0.15 }}
            style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.09)', padding: 18, background: 'rgba(255,255,255,0.02)', width: '100%' }}
          >
            <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              Live Demo · ball_to_cup
            </p>
            <HeroDemo />
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', padding: '10px 24px 80px', borderTop: '1px solid rgba(255,255,255,0.07)', boxSizing: 'border-box', scrollMarginTop: 54 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>Platform Features</p>
            <h2 style={{ fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0 }}>Core Functions</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 18 }}>
            <FeatureCard title="Episode QA" tagline="Validate, flag or delete. Inline status per episode." visual={<MiniQA />} delay={0} />
            <FeatureCard title="Joint Trajectory" tagline="7-DOF / 14-DOF joint angle plots synced to video." visual={<MiniChart />} delay={0.07} />
            <FeatureCard title="Live Simulation" tagline="MuJoCo stream over WebSocket. Orbit, zoom, scrub." visual={<MiniRobot />} delay={0.14} />
            <FeatureCard title="QA Pipeline" tagline="Import → validate → export clean LeRobot dataset." visual={<MiniPipeline />} delay={0.21} />
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', padding: '20px 24px 80px', background: 'rgba(255,255,255,0.013)', borderTop: '1px solid rgba(255,255,255,0.06)', boxSizing: 'border-box', scrollMarginTop: 54 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 8 }}>Workflow</p>
            <h2 style={{ fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0 }}>Raw Data → Clean Training Set</h2>
          </div>
          <WorkflowChain />

          {/* CTA */}
          <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            style={{ textAlign: 'center', marginTop: 70 }}>
            <h2 style={{ fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, letterSpacing: '-0.03em', marginBottom: 14, whiteSpace: 'nowrap' }}>
              Ready to clean your robot training data?
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.38)', marginBottom: 28, fontSize: 15 }}>
              Sign in to start reviewing and exporting clean training sets.
            </p>
            <button onClick={handleCTA}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 28px', borderRadius: 9, background: '#fff', color: '#000', fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.88')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              {token ? 'Open Dashboard' : 'Get Started'} <ChevronRight style={{ width: 16, height: 16 }} />
            </button>
          </motion.div>
        </div>
      </section>

      {/* Examples */}
      <section id="examples" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', padding: '10px 24px 80px', borderTop: '1px solid rgba(255,255,255,0.07)', boxSizing: 'border-box', scrollMarginTop: 54 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 3 }}>
            <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(255,255,255,0.32)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 2 }}>Bundled Examples</p>
            <h2 style={{ fontSize: 'clamp(22px,3vw,36px)', fontWeight: 900, letterSpacing: '-0.025em', margin: 0 }}>Real robot footage</h2>
          </div>
          <DatasetSection />
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '20px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 5, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Cpu style={{ width: 10, height: 10, color: '#fff' }} />
            </div>
            <span style={{ fontWeight: 900, fontSize: 12, color: '#fff' }}>NEOTIX</span>
          </a>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', margin: 0 }}>LeRobot v2.1 · MuJoCo · Full-stack Assessment</p>
        </div>
      </footer>

      <AnimatePresence>
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}
