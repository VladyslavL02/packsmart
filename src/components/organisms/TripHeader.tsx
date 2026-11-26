import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Member } from '../../engine/types';
import { MemberPicker } from '../molecules/MemberPicker';
import { ShareButton } from '../molecules/ShareButton';

type TripHeaderProps = {
  place: string;
  details: string;
  members: Member[];
  currentMemberId: string | null;
  onMemberChange: (memberId: string) => void;
};

export function TripHeader({
  place,
  details,
  members,
  currentMemberId,
  onMemberChange,
}: TripHeaderProps) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Link
          to="/"
          aria-label="Back to trips"
          className="flex size-9 shrink-0 items-center justify-center rounded-base border
            border-outline-variant bg-surface-container hover:bg-surface-container-high"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight break-words">{place}</h1>
          <p className="text-xs text-on-surface-variant tabular-nums">{details}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <MemberPicker members={members} value={currentMemberId} onChange={onMemberChange} />
        <ShareButton />
      </div>
    </header>
  );
}
