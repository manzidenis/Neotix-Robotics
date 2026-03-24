import { cn } from '@/lib/utils'

const variants: Record<string, string> = {
  unreviewed: 'bg-white/5 text-white/40 border-white/10',
  validated:  'bg-white/10 text-white border-white/30',
  deleted:    'bg-white/4 text-white/30 border-white/8',
  flagged:    'bg-white/8 text-white/70 border-white/20',
  single:     'bg-white/6 text-white/60 border-white/15',
  bimanual:   'bg-white/6 text-white/60 border-white/15',
  active:     'bg-white/12 text-white border-white/40',
  imported:   'bg-violet-500/15 text-violet-300 border-violet-500/30',
  exported:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  merged:     'bg-blue-500/15 text-blue-300 border-blue-500/30',
  export:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  merge:      'bg-blue-500/15 text-blue-300 border-blue-500/30',
  default:    'bg-white/5 text-white/50 border-white/12',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: keyof typeof variants | string
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border',
        variants[variant] ?? variants.default,
        className
      )}
    >
      {children}
    </span>
  )
}
