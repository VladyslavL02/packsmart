import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { CheckDot } from '../atoms/CheckDot';
import { Collapse } from '../atoms/Collapse';

type OptionCardProps = Omit<ComponentProps<'button'>, 'title'> & {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  selected: boolean;
  /** Extra control inside the card but outside the toggle button, e.g. a count stepper. */
  footer?: ReactNode;
  footerOpen?: boolean;
};

export function OptionCard({
  icon: Icon,
  title,
  subtitle,
  selected,
  footer,
  footerOpen = false,
  ...props
}: OptionCardProps) {
  return (
    <div
      className={`flex flex-col rounded-base border transition ${
        selected
          ? 'border-primary-container bg-primary-container/15'
          : 'border-transparent bg-surface-container hover:bg-surface-container-high'
      }`}
    >
      <button type="button" className="flex flex-1 flex-col items-start p-3 text-left" {...props}>
        <span className="mb-1 flex w-full items-center justify-between">
          <Icon
            className={`size-5 ${selected ? 'text-primary' : 'text-outline'}`}
            aria-hidden="true"
          />
          <CheckDot checked={selected} />
        </span>
        <span className="text-sm font-medium">{title}</span>
        {subtitle && (
          <span className={`text-xs ${selected ? 'text-primary' : 'text-outline'}`}>
            {subtitle}
          </span>
        )}
      </button>
      {footer && (
        <Collapse open={footerOpen}>
          <div className="px-3 pb-3">{footer}</div>
        </Collapse>
      )}
    </div>
  );
}
