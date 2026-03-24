import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full h-9 px-3 text-sm bg-slate-900/80 border border-slate-700 rounded',
        'text-slate-200 placeholder:text-slate-500',
        'focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500',
        'transition-colors duration-150',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'
