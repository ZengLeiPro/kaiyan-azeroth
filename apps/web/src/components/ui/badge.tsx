import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80 active:bg-primary/70 active:scale-[0.98]',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/70 active:scale-[0.98]',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80 active:bg-destructive/70 active:scale-[0.98]',
        outline: 'text-foreground active:bg-accent/50 active:scale-[0.98]',
        success:
          'border-transparent bg-primary/10 text-primary dark:bg-primary/20 active:bg-primary/20 active:scale-[0.98]',
        warning:
          'border-transparent bg-warning/10 text-warning dark:bg-warning/20 active:bg-warning/20 active:scale-[0.98]',
        info: 'border-transparent bg-info/10 text-info dark:bg-info/20 active:bg-info/20 active:scale-[0.98]',
        // 无底色变体：仅保留结构，配色完全交给外部 className（status token），避免 default 的 primary 底色/hover 残留
        soft: 'border-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
