import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';

export function Checkbox({ className = '', ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <span className={`relative inline-flex size-5 shrink-0 ${className}`}>
      <input
        type="checkbox"
        className="peer size-5 cursor-pointer appearance-none rounded-sm border border-outline
          bg-surface-container-lowest checked:border-primary-container
          checked:bg-primary-container focus:outline-none focus-visible:border-primary"
        {...props}
      />
      <Check
        className="pointer-events-none absolute inset-0 m-auto size-3.5 text-on-primary-container
          opacity-0 peer-checked:opacity-100"
        strokeWidth={3}
        aria-hidden="true"
      />
    </span>
  );
}
