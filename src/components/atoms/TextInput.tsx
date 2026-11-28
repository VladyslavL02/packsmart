import type { ComponentProps } from 'react';

export function TextInput({ className = '', type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={`h-10 w-full min-w-0 rounded-base border border-outline-variant
        bg-surface-container-lowest px-3 text-sm text-on-surface [color-scheme:dark]
        placeholder:text-outline focus:border-primary focus:outline-none ${className}`}
      {...props}
    />
  );
}
