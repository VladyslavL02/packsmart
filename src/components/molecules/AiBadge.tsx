import { Sparkles } from 'lucide-react';
import { Pill } from '../atoms/Pill';

export function AiBadge() {
  return (
    <Pill tone="ai" className="py-0.5">
      <Sparkles className="size-3" aria-hidden="true" />
      AI
    </Pill>
  );
}
