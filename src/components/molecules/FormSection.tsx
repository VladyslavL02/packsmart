import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type FormSectionProps = {
  icon: LucideIcon;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
};

/** A card of its own on mobile; a plain block inside the one form card on desktop. */
export function FormSection({ icon: Icon, title, aside, children }: FormSectionProps) {
  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-outline-variant
        bg-surface-container-low p-4 md:gap-2 md:rounded-none md:border-0 md:bg-transparent
        md:p-0"
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          className="flex items-center gap-2 text-xs font-medium tracking-wider
            text-on-surface-variant uppercase md:tracking-normal md:text-outline md:normal-case"
        >
          <Icon className="size-4 text-primary md:hidden" aria-hidden="true" />
          {title}
        </h2>
        {aside && <span className="text-xs text-outline">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
