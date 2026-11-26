import { useMemo } from 'react';
import { packingProgress } from '../../engine/listView';
import { TRIP_TYPE_META } from '../../lib/tripMeta';
import { useTripStore } from '../../store/tripStore';
import { RecentTripRow } from '../molecules/RecentTripRow';

const MAX_SHOWN = 5;

// Dates are date-only strings (read as UTC), so format them in UTC too.
const DATE_RANGE = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function RecentTrips() {
  const trips = useTripStore((state) => state.trips);
  const items = useTripStore((state) => state.items);
  const recent = useMemo(
    () =>
      Object.values(trips)
        .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
        .slice(0, MAX_SHOWN),
    [trips],
  );
  if (recent.length === 0) {return null;}

  return (
    <section className="mt-8 flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-outline uppercase">Recent trips</h2>
      {recent.map((trip) => {
        const progress = packingProgress(items[trip.id] ?? []);

        return (
          <RecentTripRow
            key={trip.id}
            to={`/trip/${trip.id}`}
            icon={TRIP_TYPE_META[trip.tripType].icon}
            city={trip.city}
            dates={DATE_RANGE.formatRange(new Date(trip.startDate), new Date(trip.endDate))}
            itemCount={progress.total}
            percent={progress.percent}
          />
        );
      })}
    </section>
  );
}
