import type { ReactNode } from 'react';

/** Opens and closes with a height transition. The content stays rendered while closed. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out
        motion-reduce:transition-none ${
    open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
    }`}
      // Keeps hidden controls away from the keyboard and screen readers.
      inert={!open}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
