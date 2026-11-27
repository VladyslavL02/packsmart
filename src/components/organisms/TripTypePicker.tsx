import type { KeyboardEvent } from 'react';
import { TRIP_TYPES } from '../../engine/types';
import type { TripType } from '../../engine/types';
import { TRIP_TYPE_META } from '../../lib/tripMeta';
import { OptionCard } from '../molecules/OptionCard';

type TripTypePickerProps = { value: TripType; onChange: (value: TripType) => void };

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function TripTypePicker({ value, onChange }: TripTypePickerProps) {
  // A radio group is one Tab stop; the arrow keys move the choice, as with native radios.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEPS[event.key];
    if (step === undefined) {return;}
    event.preventDefault();
    const index = TRIP_TYPES.indexOf(value);
    const next = (index + step + TRIP_TYPES.length) % TRIP_TYPES.length;
    onChange(TRIP_TYPES[next]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Trip format"
      className="grid grid-cols-2 gap-2 md:grid-cols-4"
      onKeyDown={onKeyDown}
    >
      {TRIP_TYPES.map((type) => {
        const meta = TRIP_TYPE_META[type];

        return (
          <OptionCard
            key={type}
            role="radio"
            aria-checked={value === type}
            tabIndex={value === type ? 0 : -1}
            icon={meta.icon}
            title={meta.label}
            subtitle={meta.subtitle}
            selected={value === type}
            onClick={() => onChange(type)}
          />
        );
      })}
    </div>
  );
}
