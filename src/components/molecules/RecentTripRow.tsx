import { ChevronRight, CircleCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Pill } from '../atoms/Pill';

type RecentTripRowProps = {
  to: string;
  icon: LucideIcon;
  city: string;
  dates: string;
  itemCount: number;
  percent: number;
};

export function RecentTripRow({
  to,
  icon,
  city,
  dates,
  itemCount,
  percent,
}: RecentTripRowProps) {
  const done = percent === 100;
  const Icon = done ? CircleCheck : icon;

  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-outline-variant
        bg-surface-container-low p-3 hover:bg-surface-container-high"
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-base
          bg-surface-container"
      >
        <Icon
          className={`size-5 ${done ? 'text-primary' : 'text-secondary'}`}
          aria-hidden="true"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{city}</span>
        <span className="truncate text-xs text-outline tabular-nums">
          {dates} · {itemCount} items
        </span>
      </span>
      <Pill tone="primary" className="shrink-0 tabular-nums">
        {percent}% packed
      </Pill>
      <ChevronRight className="size-4 shrink-0 text-outline" aria-hidden="true" />
    </Link>
  );
}
