import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Member } from '../../engine/types';
import { Button } from '../atoms/Button';
import { FieldMessage } from '../atoms/FieldMessage';
import { Select } from '../atoms/Select';
import { TextInput } from '../atoms/TextInput';

type QuickAddBarProps = {
  members: Member[];
  currentMemberId: string | null;
  /** False when nothing was added because it is already on the list. */
  onAdd: (title: string, memberId: string | null) => boolean;
};

/** Sticks to the bottom of the screen on mobile. */
export function QuickAddBar({ members, currentMemberId, onAdd }: QuickAddBarProps) {
  const [title, setTitle] = useState('');
  // Null follows "I am"; a manual pick ('' is Shared) lasts until the next add.
  const [picked, setPicked] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const owner = picked ?? currentMemberId ?? '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {return;}
    if (!onAdd(title, owner || null)) {
      setDuplicate(true);

      return;
    }
    setTitle('');
    setPicked(null);
    setDuplicate(false);
  };

  return (
    <form
      onSubmit={submit}
      className="sticky bottom-0 z-10 -mx-4 border-t border-outline-variant bg-surface/90 px-4
        pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mx-0
        md:rounded-xl md:border md:bg-surface-container-low md:px-3"
    >
      <div className="flex items-center gap-2">
        <Plus className="hidden size-4 shrink-0 text-outline sm:block" aria-hidden="true" />
        <TextInput
          aria-label="New item"
          placeholder="Add an item"
          maxLength={80}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDuplicate(false);
          }}
        />
        <Select
          className="w-28 shrink-0"
          aria-label="Item owner"
          value={owner}
          onChange={(event) => {
            setPicked(event.target.value);
            setDuplicate(false);
          }}
        >
          <option value="">Shared</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Select>
        <Button type="submit" className="h-10 text-sm" disabled={!title.trim()}>
          Add
        </Button>
      </div>
      <FieldMessage tone="error">{duplicate ? 'Already on the list' : null}</FieldMessage>
    </form>
  );
}
