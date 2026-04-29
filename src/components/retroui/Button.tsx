import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'font-head inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border-2 border-border text-sm uppercase tracking-[0.04em] transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-hard hover:translate-x-1 hover:translate-y-1 hover:bg-primary-hover hover:shadow-hard-sm active:translate-x-1.5 active:translate-y-1.5 active:shadow-none',
        secondary:
          'bg-secondary text-secondary-foreground shadow-hard hover:translate-x-1 hover:translate-y-1 hover:bg-secondary-hover hover:shadow-hard-sm active:translate-x-1.5 active:translate-y-1.5 active:shadow-none',
        outline:
          'bg-card text-foreground shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none active:translate-x-1 active:translate-y-1',
        ghost: 'border-transparent bg-transparent text-foreground hover:border-border hover:bg-muted',
        danger:
          'bg-destructive text-white shadow-hard hover:translate-x-1 hover:translate-y-1 hover:shadow-hard-sm active:shadow-none',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2',
        lg: 'px-5 py-3 text-base',
        icon: 'size-10 p-0',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { children, size = 'md', className, variant = 'default', asChild = false, ...props },
    forwardedRef,
  ) => {
    const Component = asChild ? Slot : 'button'

    return (
      <Component
        ref={forwardedRef}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {children}
      </Component>
    )
  },
)

Button.displayName = 'Button'
