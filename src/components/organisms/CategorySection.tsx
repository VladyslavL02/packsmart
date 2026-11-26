import type { LucideIcon } from 'lucide-react';
import type { Member, PackingItem } from '../../engine/types';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { Pill } from '../atoms/Pill';
import { ItemRow } from '../molecules/ItemRow';

type CategorySectionProps = {
  label: string;
  icon: LucideIcon;
  items: PackingItem[];
  members: Member[];
  maxQuantity: number;
  onToggle: (itemId: string) => void;
  onQuantity: (itemId: string, quantity: number) => void;
  onDelete: (itemId: string) => void;
  /** Gets only the rows on screen, so a filtered view ticks just what it shows. */
  onMarkAll: (itemIds: string[]) => void;
};

export function CategorySection({
  label,
  icon: Icon,
  items,
  members,
  maxQuantity,
  onToggle,
  onQuantity,
  onDelete,
  onMarkAll,
}: CategorySectionProps) {
  const ownerName = (memberId: string | null) =>
    members.find((member) => member.id === memberId)?.name ?? 'Shared';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{label}</h2>
        <Pill className="tabular-nums">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Pill>
        {items.some((item) => !item.isPacked) && (
          <Button
            variant="ghost"
            className="ml-auto px-2! py-1! text-xs"
            onClick={() => onMarkAll(items.map((item) => item.id))}
          >
            Mark all done
          </Button>
        )}
      </div>
      <ul className="divide-y divide-outline-variant">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            owner={ownerName(item.memberId)}
            maxQuantity={maxQuantity}
            onToggle={() => onToggle(item.id)}
            onQuantity={(quantity) => onQuantity(item.id, quantity)}
            onDelete={() => onDelete(item.id)}
          />
        ))}
      </ul>
    </Card>
  );
}
