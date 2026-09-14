import * as React from 'react';

import { cn } from '@/lib/utils';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  showLabel?: boolean;
  /** When true, the bar animates from 0 to the target value on mount */
  animate?: boolean;
  /** Delay in ms before animation starts (useful for staggering) */
  animateDelay?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value = 0,
      max = 100,
      showLabel = false,
      animate = false,
      animateDelay = 0,
      ...props
    },
    ref
  ) => {
    const targetPercentage = Math.min(Math.max(0, (value / max) * 100), 100);
    const [displayPercentage, setDisplayPercentage] = React.useState(
      animate ? 0 : targetPercentage
    );

    React.useEffect(() => {
      if (animate) {
        const timer = setTimeout(() => {
          setDisplayPercentage(targetPercentage);
        }, 50 + animateDelay);
        return () => clearTimeout(timer);
      }
      setDisplayPercentage(targetPercentage);
    }, [animate, targetPercentage, animateDelay]);

    return (
      <div
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-primary/20', className)}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        {...props}
      >
        <div
          className={cn(
            'h-full bg-primary transition-all ease-out',
            animate ? 'duration-1000' : 'duration-300'
          )}
          style={{ width: `${displayPercentage}%` }}
        />
        {showLabel && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
            {Math.round(displayPercentage)}%
          </span>
        )}
      </div>
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
