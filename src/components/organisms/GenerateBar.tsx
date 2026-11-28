import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '../atoms/Button';

type GenerateBarProps = {
  summary: string;
  disabled: boolean;
  busy: boolean;
  error: string | null;
};

/** Submits the surrounding form. Sticks to the bottom of the screen on mobile. */
export function GenerateBar({ summary, disabled, busy, error }: GenerateBarProps) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-outline-variant
        bg-surface/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur
        md:static md:mx-0 md:border-0 md:bg-transparent md:p-0"
    >
      <p className="text-xs text-on-surface-variant md:hidden">{summary}</p>
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
      <Button type="submit" disabled={disabled || busy} className="w-full py-3.5 text-base">
        {busy ? 'Generating…' : 'Generate packing list'}
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowRight className="size-5" aria-hidden="true" />
        )}
      </Button>
      <p className="hidden text-center text-xs text-outline md:block">
        Instant list from the weather forecast and trip type. AI extras arrive a few seconds later.
      </p>
    </div>
  );
}
