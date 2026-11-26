import type { ComponentProps } from 'react';

export function Card({ className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-xl border border-outline-variant bg-surface-container-low ${className}`}
      {...props}
    />
  );
}
