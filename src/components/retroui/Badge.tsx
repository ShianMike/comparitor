import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit items-center gap-1 rounded-md border-2 border-border font-mono font-bold uppercase tracking-[0.08em]',
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground',
        solid: 'bg-foreground text-background',
        success: 'bg-success text-black',
        warning: 'bg-warning text-black',
        danger: 'bg-destructive text-white',
        surface: 'bg-primary text-primary-foreground',
      },
      size: {
        sm: 'px-2 py-0.5 text-[10px]',
        md: 'px-2.5 py-1 text-xs',
        lg: 'px-3 py-1.5 text-sm',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
)

interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ children, size, variant, className, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ size, variant }), className)} {...props}>
      {children}
    </span>
  )
}
