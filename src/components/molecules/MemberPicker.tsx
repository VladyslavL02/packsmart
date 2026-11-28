import { UserRound } from 'lucide-react';
import type { Member } from '../../engine/types';
import { Select } from '../atoms/Select';

type MemberPickerProps = {
  members: Member[];
  value: string | null;
  onChange: (memberId: string) => void;
};

export function MemberPicker({ members, value, onChange }: MemberPickerProps) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-on-surface-variant">
      <UserRound className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="shrink-0">I am:</span>
      <Select
        className="w-32"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        {value === null && (
          <option value="" disabled>
            Choose…
          </option>
        )}
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
