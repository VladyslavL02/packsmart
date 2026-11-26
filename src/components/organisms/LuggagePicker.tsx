import { useState } from 'react';
import {
  LUGGAGE_LABELS,
  MAX_LUGGAGE_COUNT,
  setLuggageCount,
  toggleLuggage,
} from '../../engine/tripForm';
import { LUGGAGE } from '../../engine/types';
import type { LuggageEntry, LuggageType } from '../../engine/types';
import { LUGGAGE_ICONS } from '../../lib/tripMeta';
import { OptionCard } from '../molecules/OptionCard';
import { Stepper } from '../molecules/Stepper';

type LuggagePickerProps = { value: LuggageEntry[]; onChange: (value: LuggageEntry[]) => void };

export function LuggagePicker({ value, onChange }: LuggagePickerProps) {
  // A deselected bag's last count, shown while its counter closes.
  const [closing, setClosing] = useState<Partial<Record<LuggageType, number>>>({});

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
            onClick={() => {
              if (entry) {setClosing((counts) => ({ ...counts, [type]: entry.count }));}
              onChange(toggleLuggage(value, type));
            }}
            footerOpen={Boolean(entry)}
            footer={
              <Stepper
                label={`${LUGGAGE_LABELS[type]} count`}
                value={entry?.count ?? closing[type] ?? 1}
                min={1}
                max={MAX_LUGGAGE_COUNT}
                onChange={(count) => onChange(setLuggageCount(value, type, count))}
              />
            }
          />
        );
      })}
    </div>
  );
}
