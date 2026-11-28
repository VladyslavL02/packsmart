import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

/** `className` sizes the wrapper. */
export function Select({ className = '', ...props }: ComponentProps<'select'>) {
  return (
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select
        className="h-10 w-full appearance-none truncate rounded-base border border-outline-variant
          bg-surface-container-lowest pr-8 pl-3 text-sm text-on-surface [color-scheme:dark]
          focus:border-primary focus:outline-none"
        {...props}
      />
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2
          text-outline"
        aria-hidden="true"
      />
    </span>
  );
}
