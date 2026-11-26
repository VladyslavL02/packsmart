import { Check, Link } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/Button';

/** Copies the page URL. */
export function ShareButton() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn('[share] could not copy the link:', error);
    }
  };

  const Icon = copied ? Check : Link;

  return (
    <Button variant="surface" className="h-10 text-sm" onClick={share}>
      <Icon className="size-4" aria-hidden="true" />
      <span aria-live="polite">{copied ? 'Copied' : 'Share'}</span>
    </Button>
  );
}
