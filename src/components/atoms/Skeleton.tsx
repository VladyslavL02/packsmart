type SkeletonProps = { label: string; className?: string };

export function Skeleton({ label, className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-base bg-surface-container-high ${className}`}
      role="status"
      aria-label={label}
    />
  );
}
