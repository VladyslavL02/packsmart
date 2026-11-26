import type { PackingProgress, Ratio } from '../../engine/listView';
import { Card } from '../atoms/Card';
import { Pill } from '../atoms/Pill';
import { ProgressBar } from '../atoms/ProgressBar';

type ProgressCardProps = { progress: PackingProgress; className?: string };

export function ProgressCard({ progress, className = '' }: ProgressCardProps) {
  const groups: [string, Ratio][] = [
    ['Shared', progress.shared],
    ['Adults', progress.adults],
    ['Kids', progress.kids],
  ];

  return (
    <Card className={`flex flex-col justify-between gap-3 p-4 tabular-nums ${className}`}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {progress.packed} / {progress.total} packed
        </h2>
        <Pill tone="primary">{progress.percent}%</Pill>
        <span className="ml-auto text-xs text-outline">
          {progress.total - progress.packed} remaining
        </span>
      </div>
      <ProgressBar percent={progress.percent} label="Packing progress" />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-on-surface-variant">
        {groups
          .filter(([, ratio]) => ratio.total > 0)
          .map(([label, ratio]) => (
            <li key={label}>
              {label}: {ratio.packed}/{ratio.total}
            </li>
          ))}
      </ul>
    </Card>
  );
}
