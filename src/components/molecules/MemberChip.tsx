import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { MAX_NAME_LENGTH } from '../../engine/tripForm';
import type { Member } from '../../engine/types';
import { Pill } from '../atoms/Pill';

type MemberChipProps = {
  member: Member;
  removable: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
};

export function MemberChip({ member, removable, onRename, onRemove }: MemberChipProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the input, and a blur that follows must not save the draft.
  const cancelled = useRef(false);
  const commit = () => {
    if (!cancelled.current && draft !== null) {onRename(draft);}
    setDraft(null);
  };

  return (
    <Pill>
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          member.kind === 'adult' ? 'bg-primary' : 'bg-secondary'
        }`}
        aria-hidden="true"
      />
      {draft === null ? (
        <button
          type="button"
          className="max-w-40 truncate"
          aria-label={`Rename ${member.name}`}
          onClick={() => {
            cancelled.current = false;
            setDraft(member.name);
          }}
        >
          {member.name}
        </button>
      ) : (
        <input
          autoFocus
          className="w-24 bg-transparent focus:outline-none"
          aria-label={`New name for ${member.name}`}
          maxLength={MAX_NAME_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {commit();}
            if (event.key === 'Escape') {
              cancelled.current = true;
              setDraft(null);
            }
          }}
        />
      )}
      {removable && (
        <button
          type="button"
          className="text-outline hover:text-error"
          aria-label={`Remove ${member.name}`}
          onClick={onRemove}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </Pill>
  );
}
