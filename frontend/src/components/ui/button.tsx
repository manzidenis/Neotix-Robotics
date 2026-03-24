import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef } from 'react'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded font-medium transition-all focus-visible:outline-none disabled:opacity-40 disabled:pointer-events-none text-sm whitespace-nowrap',
  {
    variants: {
      variant: {
        default:     'bg-white text-black hover:bg-white/90',
        secondary:   'bg-white/8 text-white hover:bg-white/12 border border-white/15',
        ghost:       'text-white/60 hover:text-white hover:bg-white/6',
        destructive: 'bg-white/6 text-white/70 hover:bg-white/10 border border-white/20',
        outline:     'border border-white/25 text-white hover:bg-white/6 hover:border-white/40',
        success:     'bg-white/8 text-white hover:bg-white/12 border border-white/20',
        warning:     'bg-white/6 text-white/80 hover:bg-white/10 border border-white/20',
      },
      size: {
        sm:        'h-7 px-2.5 text-xs',
        default:   'h-9 px-4',
        lg:        'h-11 px-6 text-base',
        icon:      'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
      )}
      {children}
    </button>
  )
)
Button.displayName = 'Button'
