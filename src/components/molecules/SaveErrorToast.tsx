import { X } from 'lucide-react';
import { Button } from '../atoms/Button';

type SaveErrorToastProps = {
  message: string;
  onDismiss: () => void;
};

/** Fixed above the quick-add bar, so it's seen wherever the user has scrolled. */
export function SaveErrorToast({ message, onDismiss }: SaveErrorToastProps) {
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-24 z-20 flex items-center gap-2 rounded-xl border
        border-outline-variant bg-error-container py-2 pr-2 pl-4 text-sm text-on-error-container
        md:bottom-6 md:mx-auto md:max-w-md"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <Button
        variant="ghost"
        className="shrink-0 p-2! text-on-error-container!"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
