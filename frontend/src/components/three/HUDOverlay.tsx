import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const t = pos.startsWith('t'), l = pos.endsWith('l')
  return (
    <div className={`absolute w-10 h-10 ${t ? 'top-4' : 'bottom-4'} ${l ? 'left-4' : 'right-4'}`}>
      <div className={`absolute w-5 h-px bg-cyan-400/70 ${t ? 'top-0' : 'bottom-0'} ${l ? 'left-0' : 'right-0'}`} />
      <div className={`absolute w-px h-5 bg-cyan-400/70 ${t ? 'top-0' : 'bottom-0'} ${l ? 'left-0' : 'right-0'}`} />
    </div>
  )
}

export default function HUDOverlay() {
  const [tick, setTick] = useState(0)
  const [utc, setUtc] = useState('')

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1)
      setUtc(new Date().toISOString().split('T')[1].slice(0, 8))
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="absolute inset-0 pointer-events-none z-10 select-none">
      <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />

      {/* Top-left status */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
        className="absolute top-10 left-10 space-y-1"
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[10px] font-mono text-cyan-400 tracking-[0.2em]">NEOTIX·YAM·PRO</span>
        </div>
        {[
          ['SYS', 'ONLINE'],
          ['UTC', utc || '--:--:--'],
          ['MODE', 'INTERACTIVE'],
          ['API', 'v1.0.0'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[10px] font-mono">
            <span className="text-cyan-700 w-10">{k}:</span>
            <span className="text-cyan-400">{v}</span>
          </div>
        ))}
      </motion.div>

      {/* Bottom-left telemetry */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.9, duration: 0.5 }}
        className="absolute bottom-10 left-10 space-y-1"
      >
        {[
          ['DOF', '7-AXIS'],
          ['JOINTS', tick % 2 === 0 ? '● ACTIVE' : '○ ACTIVE'],
          ['FRAME', String((tick * 30) % 100000).padStart(6, '0')],
          ['FPS', '30'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2 text-[10px] font-mono">
            <span className="text-cyan-700 w-12">{k}:</span>
            <span className="text-cyan-400">{v}</span>
          </div>
        ))}
      </motion.div>

      {/* Top-right signal */}
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="absolute top-10 right-10 flex flex-col items-end gap-1"
      >
        <div className="flex items-end gap-0.5 mb-1">
          {[3, 5, 7, 9, 11].map((h, i) => (
            <div
              key={i}
              className={`w-1 rounded-sm transition-colors ${tick % 7 > i ? 'bg-cyan-400' : 'bg-slate-700'}`}
              style={{ height: h }}
            />
          ))}
          <span className="text-[10px] font-mono text-cyan-600 ml-1">SIG</span>
        </div>
        <div className="text-[10px] font-mono text-cyan-700">LATENCY &lt; 1ms</div>
        <div className="text-[10px] font-mono text-cyan-700">STREAM READY</div>
      </motion.div>

      {/* Scan line */}
      <div className="absolute inset-0 overflow-hidden opacity-[0.04]">
        <motion.div
          animate={{ y: ['-2%', '102%'] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          className="w-full h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent"
        />
      </div>
    </div>
  )
}
