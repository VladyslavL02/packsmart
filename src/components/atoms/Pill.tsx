import type { ComponentProps } from 'react';

const TONES = {
  primary: 'bg-primary-container/15 text-primary',
  secondary: 'bg-secondary-container/40 text-on-secondary-container',
  neutral: 'bg-surface-container-high text-on-surface',
  ai: 'border border-secondary/30 bg-secondary-container/40 text-on-secondary-container',
};

type PillProps = ComponentProps<'span'> & { tone?: keyof typeof TONES };

export function Pill({ tone = 'neutral', className = '', ...props }: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
        ${TONES[tone]} ${className}`}
      {...props}
    />
  );
}
