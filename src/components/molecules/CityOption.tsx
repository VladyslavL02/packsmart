import { MapPin } from 'lucide-react';
import type { ComponentProps } from 'react';

type CityOptionProps = ComponentProps<'li'> & {
  name: string;
  region: string;
  active: boolean;
};

export function CityOption({ name, region, active, ...props }: CityOptionProps) {
  return (
    <li
      role="option"
      aria-selected={active}
      className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
        active ? 'bg-surface-container-highest' : 'hover:bg-surface-container-highest'
      }`}
      {...props}
    >
      <MapPin className="size-4 shrink-0 text-outline" aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{name}</span>
        <span className="truncate text-xs text-outline">{region}</span>
      </span>
    </li>
  );
}
