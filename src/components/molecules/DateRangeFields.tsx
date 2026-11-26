import { Calendar } from 'lucide-react';
import { tripDays } from '../../engine/dates';
import { TextInput } from '../atoms/TextInput';

type DateRangeFieldsProps = {
  startDate: string;
  endDate: string;
  today: string;
  onChange: (startDate: string, endDate: string) => void;
};

export function DateRangeFields({ startDate, endDate, today, onChange }: DateRangeFieldsProps) {
  const inPast = startDate !== '' && startDate < today;
  const backwards = startDate !== '' && endDate !== '' && endDate < startDate;
  const days = startDate && endDate && !backwards ? tripDays(startDate, endDate) : null;

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-xs text-outline">
          <span className="flex items-center gap-1">
            <Calendar className="size-3" aria-hidden="true" />
            Departure
          </span>
          <TextInput
            type="date"
            value={startDate}
            min={today}
            onChange={(event) => {
              const start = event.target.value;
              // Moving the start past the end drags the end along.
              onChange(start, endDate && start > endDate ? start : endDate);
            }}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-outline">
          <span className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1">
              <Calendar className="size-3" aria-hidden="true" />
              Return
            </span>
            {days !== null && (
              <span className="text-primary tabular-nums">
                {days} {days === 1 ? 'day' : 'days'}
              </span>
            )}
          </span>
          <TextInput
            type="date"
            value={endDate}
            min={startDate || today}
            onChange={(event) => onChange(startDate, event.target.value)}
          />
        </label>
      </div>
      {inPast && <p className="text-xs text-error">The departure date is in the past.</p>}
      {backwards && <p className="text-xs text-error">The return date is before departure.</p>}
    </div>
  );
}
