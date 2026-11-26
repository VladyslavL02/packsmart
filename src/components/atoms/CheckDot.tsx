import { Check } from 'lucide-react';

export function CheckDot({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex size-4 items-center justify-center rounded-full ${
        checked ? 'bg-primary text-on-primary' : 'bg-surface-container-highest'
      }`}
    >
      {checked && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
    </span>
  );
}
