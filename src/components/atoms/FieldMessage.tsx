import { useState } from 'react';

const TONES = {
  muted: 'text-outline',
  info: 'text-on-surface-variant',
  error: 'text-error',
};

type FieldMessageProps = { tone: keyof typeof TONES; children: string | null };

/** One line under a field. Its space is always taken, so a message never moves the page. */
export function FieldMessage({ tone, children }: FieldMessageProps) {
  // The last message stays in place while it fades out.
  const [shown, setShown] = useState({ tone, text: children });
  if (children && (children !== shown.text || tone !== shown.tone)) {
    setShown({ tone, text: children });
  }

  return (
    <p
      aria-live="polite"
      className={`h-5 truncate pt-1 text-xs transition-opacity duration-200
        motion-reduce:transition-none ${TONES[shown.tone]} ${children ? '' : 'opacity-0'}`}
    >
      <span aria-hidden={!children}>{shown.text}</span>
    </p>
  );
}
