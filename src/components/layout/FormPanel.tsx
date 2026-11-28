import type { ComponentProps } from 'react';

/** A plain stack of section cards on mobile; one card around everything on desktop. */
export function FormPanel({ className = '', ...props }: ComponentProps<'form'>) {
  return (
    <form
      className={`flex flex-col gap-4 md:gap-5 md:rounded-xl md:border md:border-outline-variant
        md:bg-surface-container-low md:p-8 ${className}`}
      {...props}
    />
  );
}
