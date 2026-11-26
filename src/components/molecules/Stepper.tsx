import { Minus, Plus } from 'lucide-react';

type StepperProps = {
  value: number;
  min: number;
  max: number;
  /** What is being counted, for the button labels: "Decrease Adults". */
  label: string;
  onChange: (value: number) => void;
};

const BUTTON = `flex size-7 items-center justify-center rounded-sm bg-surface-container-high
  text-on-surface hover:bg-surface-container-highest disabled:cursor-not-allowed
  disabled:opacity-40`;

export function Stepper({ value, min, max, label, onChange }: StepperProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={BUTTON}
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span className="min-w-5 text-center text-sm font-medium tabular-nums">{value}</span>
      <button
        type="button"
        className={BUTTON}
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
