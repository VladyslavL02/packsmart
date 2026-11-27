import { Trash2 } from 'lucide-react';
import type { PackingItem } from '../../engine/types';
import { Button } from '../atoms/Button';
import { Checkbox } from '../atoms/Checkbox';
import { Pill } from '../atoms/Pill';
import { AiBadge } from './AiBadge';
import { Stepper } from './Stepper';

type ItemRowProps = {
  item: PackingItem;
  owner: string;
  maxQuantity: number;
  onToggle: () => void;
  onQuantity: (quantity: number) => void;
  onDelete: () => void;
};

export function ItemRow({
  item,
  owner,
  maxQuantity,
  onToggle,
  onQuantity,
  onDelete,
}: ItemRowProps) {
  return (
    <li className="flex items-start gap-3 px-3 py-3 hover:bg-surface-container">
      <Checkbox
        className="mt-0.5"
        checked={item.isPacked}
        onChange={onToggle}
        aria-label={`Packed: ${item.title} (${owner})`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span
              className={`min-w-0 break-words ${item.isPacked ? 'text-outline line-through' : ''}`}
            >
              {item.title}
            </span>
            {item.source === 'ai' && <AiBadge />}
          </p>
          {item.reason && (
            <p className="text-xs break-words text-on-surface-variant">{item.reason}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Stepper
            value={item.quantity}
            min={1}
            max={maxQuantity}
            label={`quantity of ${item.title}`}
            format={(quantity) => `×${quantity}`}
            onChange={onQuantity}
          />
          <Pill className="ml-auto max-w-32 min-w-0">
            <span className="truncate">{owner}</span>
          </Pill>
          <Button
            variant="ghost"
            className="px-2!"
            aria-label={`Delete ${item.title} (${owner})`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  );
}
