import { Loader2 } from 'lucide-react';
import { Button } from '../atoms/Button';

type AiStatusRowProps = {
  status: 'loading' | 'ok' | 'empty' | 'unavailable' | undefined;
  onRetry: () => void;
};

export function AiStatusRow({ status, onRetry }: AiStatusRowProps) {
  if (status !== 'loading' && status !== 'unavailable') {return null;}

  return (
    <div role="status" className="flex items-center gap-2 text-xs text-on-surface-variant">
      {status === 'loading' ? (
        <>
          <Loader2 className="size-4 animate-spin text-secondary" aria-hidden="true" />
          Finding extra suggestions…
        </>
      ) : (
        <>
          Suggestions unavailable ·
          <Button variant="ghost" className="px-2! py-1!" onClick={onRetry}>
            Retry
          </Button>
        </>
      )}
    </div>
  );
}
