import {
  LUGGAGE_LABELS,
  MAX_LUGGAGE_COUNT,
  setLuggageCount,
  toggleLuggage,
} from '../../engine/tripForm';
import { LUGGAGE } from '../../engine/types';
import type { LuggageEntry } from '../../engine/types';
import { LUGGAGE_ICONS } from '../../lib/tripMeta';
import { OptionCard } from '../molecules/OptionCard';
import { Stepper } from '../molecules/Stepper';

type LuggagePickerProps = { value: LuggageEntry[]; onChange: (value: LuggageEntry[]) => void };

export function LuggagePicker({ value, onChange }: LuggagePickerProps) {
  return (
    <div role="group" aria-label="Luggage" className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {LUGGAGE.map((type) => {
        const entry = value.find((item) => item.type === type);

        return (
          <OptionCard
            key={type}
            aria-pressed={Boolean(entry)}
            icon={LUGGAGE_ICONS[type]}
            title={LUGGAGE_LABELS[type]}
            selected={Boolean(entry)}
            onClick={() => onChange(toggleLuggage(value, type))}
            footer={
              entry && (
                <Stepper
                  label={`${LUGGAGE_LABELS[type]} count`}
                  value={entry.count}
                  min={1}
                  max={MAX_LUGGAGE_COUNT}
                  onChange={(count) => onChange(setLuggageCount(value, type, count))}
                />
              )
            }
          />
        );
      })}
    </div>
  );
}
