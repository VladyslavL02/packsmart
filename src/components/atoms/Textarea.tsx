import type { ComponentProps } from 'react';

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={`w-full resize-none rounded-base border border-outline-variant
        bg-surface-container-lowest p-3 text-sm text-on-surface placeholder:text-outline
        focus:border-primary focus:outline-none ${className}`}
      {...props}
    />
  );
}
