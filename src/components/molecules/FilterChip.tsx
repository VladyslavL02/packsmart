type FilterChipProps = {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
};

export function FilterChip({ label, count, active, disabled, title, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium tabular-nums
        disabled:cursor-not-allowed disabled:opacity-50 ${
    active
      ? 'border-primary bg-primary-container/15 text-primary'
      : 'border-outline-variant bg-surface-container-low text-on-surface-variant'
    }`}
    >
      {label} ({count})
    </button>
  );
}
