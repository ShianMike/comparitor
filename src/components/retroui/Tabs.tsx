import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  children: ReactNode
}

export function TabButton({ active = false, className, children, ...props }: TabButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-md border-2 border-border px-3 py-2 font-head text-xs uppercase tracking-[0.06em] transition-all',
        active
          ? 'translate-x-1 translate-y-1 bg-primary text-primary-foreground shadow-none'
          : 'bg-card text-foreground shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
