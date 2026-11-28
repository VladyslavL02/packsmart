import type { ComponentProps } from 'react';

const VARIANTS = {
  primary: 'bg-primary-container text-on-primary-container font-semibold hover:bg-primary',
  surface: `border border-outline-variant bg-surface-container text-on-surface
    hover:bg-surface-container-high`,
  ghost: 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
};

type ButtonProps = ComponentProps<'button'> & { variant?: keyof typeof VARIANTS };

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-base px-4 py-2
        transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50
        ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
