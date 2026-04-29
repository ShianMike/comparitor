/* eslint-disable react-refresh/only-export-components */
import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  className?: string
}

function CardRoot({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border-2 border-border bg-card shadow-hard transition-all',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: CardProps) {
  return <div className={cn('border-b-2 border-border p-4', className)} {...props} />
}

function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('font-head text-xl uppercase leading-tight tracking-tight', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1 text-sm text-muted-foreground', className)} {...props} />
}

function CardContent({ className, ...props }: CardProps) {
  return <div className={cn('p-4', className)} {...props} />
}

export const Card = Object.assign(CardRoot, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  Content: CardContent,
})
