import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/20 hover:from-violet-400 hover:to-purple-500 hover:shadow-violet-400/30 hover:scale-[1.02] active:scale-[0.98]',
        secondary:
          'bg-white/[0.06] text-gray-200 border border-[#1e1e2e] hover:bg-white/[0.1]',
        ghost: 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-white/[0.06]',
        outline:
          'border border-white/[0.12] text-gray-300 hover:bg-white/[0.05]',
        success:
          'bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400',
        danger: 'bg-red-600/80 text-white hover:bg-red-500',
        info: 'bg-blue-600/80 text-white hover:bg-blue-500',
        purple:
          'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/20 hover:from-violet-400 hover:to-purple-500 hover:scale-[1.02] active:scale-[0.98]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { buttonVariants }
