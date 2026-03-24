import { useState, useRef, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
}

export function Dropdown({ value, options, onChange, placeholder = 'Select…' }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find((o) => o.value === value)
  const Icon = open ? ChevronUp : ChevronDown

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', fontSize: 12,
          background: open ? 'rgba(255,255,255,0.1)' : 'transparent',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 6, color: '#fff', cursor: 'pointer',
          fontFamily: 'inherit', transition: 'all 0.15s', whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.4)' }}>
          {selected?.label ?? placeholder}
        </span>
        <Icon style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '100%',
          background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8, padding: 4, zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          maxHeight: 220, overflowY: 'auto',
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 10px', fontSize: 12, fontFamily: 'inherit',
                border: 'none', borderRadius: 5, cursor: 'pointer',
                color: opt.value === value ? '#fff' : 'rgba(255,255,255,0.5)',
                background: opt.value === value ? 'rgba(255,255,255,0.1)' : 'transparent',
                transition: 'all 0.12s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                e.currentTarget.style.color = '#fff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = opt.value === value ? 'rgba(255,255,255,0.1)' : 'transparent'
                e.currentTarget.style.color = opt.value === value ? '#fff' : 'rgba(255,255,255,0.5)'
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
