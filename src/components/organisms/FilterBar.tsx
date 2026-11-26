import { ListFilter } from 'lucide-react';
import type { FilterCounts, ItemFilter } from '../../engine/listView';
import type { Member } from '../../engine/types';
import { Button } from '../atoms/Button';
import { FilterChip } from '../molecules/FilterChip';

type FilterBarProps = {
  filter: ItemFilter;
  counts: FilterCounts;
  members: Member[];
  canFilterMine: boolean;
  unpackedOnly: boolean;
  onFilter: (filter: ItemFilter) => void;
  onUnpackedOnly: (unpackedOnly: boolean) => void;
};

export function FilterBar({
  filter,
  counts,
  members,
  canFilterMine,
  unpackedOnly,
  onFilter,
  onUnpackedOnly,
}: FilterBarProps) {
  const memberId = typeof filter === 'object' ? filter.memberId : null;

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
        <FilterChip
          label="All"
          count={counts.all}
          active={filter === 'all'}
          onClick={() => onFilter('all')}
        />
        <FilterChip
          label="Mine"
          count={counts.mine}
          active={filter === 'mine'}
          disabled={!canFilterMine}
          title={canFilterMine ? undefined : 'Pick who you are first'}
          onClick={() => onFilter('mine')}
        />
        <FilterChip
          label="Shared"
          count={counts.shared}
          active={filter === 'shared'}
          onClick={() => onFilter('shared')}
        />
        {members.map((member) => (
          <FilterChip
            key={member.id}
            label={member.name}
            count={counts.byMember[member.id] ?? 0}
            active={memberId === member.id}
            onClick={() => onFilter({ memberId: member.id })}
          />
        ))}
      </div>
      <Button
        variant="surface"
        aria-pressed={unpackedOnly}
        className={`shrink-0 self-start px-3! py-1.5! text-xs ${
          unpackedOnly ? 'border-primary! text-primary!' : ''
        }`}
        onClick={() => onUnpackedOnly(!unpackedOnly)}
      >
        <ListFilter className="size-4" aria-hidden="true" />
        Unpacked only
      </Button>
    </div>
  );
}
