import { Sparkles } from 'lucide-react';
import { Textarea } from '../atoms/Textarea';

const MAX_NOTES = 500;

type NotesFieldProps = { value: string; onChange: (value: string) => void };

export function NotesField({ value, onChange }: NotesFieldProps) {
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-outline-variant
        bg-surface-container-low p-4 md:rounded-none md:border-0 md:bg-transparent md:p-0"
    >
      <label
        htmlFor="trip-notes"
        className="flex items-center gap-2 text-xs font-medium text-secondary"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Special trip details (optional)
      </label>
      <Textarea
        id="trip-notes"
        rows={3}
        maxLength={MAX_NOTES}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="e.g. traveling with a dog, kid has allergies, bringing a drone…"
      />
      <span className="self-end text-xs text-outline tabular-nums">
        {value.length}/{MAX_NOTES}
      </span>
    </section>
  );
}
