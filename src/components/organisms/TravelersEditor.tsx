import { removeMember, renameMember, setMemberCount } from '../../engine/tripForm';
import type { Member } from '../../engine/types';
import { MemberChip } from '../molecules/MemberChip';
import { Stepper } from '../molecules/Stepper';

const MAX_PER_KIND = 10;
const KINDS = [
  { kind: 'adult', label: 'Adults' },
  { kind: 'child', label: 'Kids' },
] as const;

type TravelersEditorProps = { value: Member[]; onChange: (value: Member[]) => void };

export function TravelersEditor({ value, onChange }: TravelersEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {KINDS.map(({ kind, label }) => {
          const count = value.filter((member) => member.kind === kind).length;

          return (
            <div
              key={kind}
              className="flex flex-wrap items-center justify-between gap-2 rounded-base
                bg-surface-container px-3 py-2"
            >
              <span className="text-sm font-medium">{label}</span>
              <Stepper
                label={label}
                value={count}
                // The last traveler can't be removed.
                min={value.length > count ? 0 : 1}
                max={MAX_PER_KIND}
                onChange={(next) =>
                  onChange(setMemberCount(value, kind, next, () => crypto.randomUUID()))
                }
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        {value.map((member) => (
          <MemberChip
            key={member.id}
            member={member}
            removable={value.length > 1}
            onRename={(name) => onChange(renameMember(value, member.id, name))}
            onRemove={() => onChange(removeMember(value, member.id))}
          />
        ))}
      </div>
    </div>
  );
}
