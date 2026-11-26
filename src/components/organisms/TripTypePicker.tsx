import { TRIP_TYPES } from '../../engine/types';
import type { TripType } from '../../engine/types';
import { TRIP_TYPE_META } from '../../lib/tripMeta';
import { OptionCard } from '../molecules/OptionCard';

type TripTypePickerProps = { value: TripType; onChange: (value: TripType) => void };

export function TripTypePicker({ value, onChange }: TripTypePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Trip format"
      className="grid grid-cols-2 gap-2 md:grid-cols-4"
    >
      {TRIP_TYPES.map((type) => {
        const meta = TRIP_TYPE_META[type];

        return (
          <OptionCard
            key={type}
            role="radio"
            aria-checked={value === type}
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
