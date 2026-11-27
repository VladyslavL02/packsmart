import { useEffect, useState } from 'react';
import { packingProgress } from '../../engine/listView';
import { formatDateRange } from '../../lib/format';
import { TRIP_TYPE_META } from '../../lib/tripMeta';
import { fetchTripSummaries } from '../../services/tripRepo';
import type { TripWithItems } from '../../services/tripRepo';
import { useTripStore } from '../../store/tripStore';
import { RecentTripRow } from '../molecules/RecentTripRow';

const MAX_SHOWN = 5;

export function RecentTrips() {
  const openedAt = useTripStore((state) => state.recent);
  const forgetTrips = useTripStore((state) => state.forgetTrips);
  const [summaries, setSummaries] = useState<TripWithItems[]>([]);
  const ids = Object.keys(openedAt)
    .sort((a, b) => openedAt[b].localeCompare(openedAt[a]))
    .slice(0, MAX_SHOWN);
  // A string, so the fetch runs again only when the shown trips change.
  const key = ids.join(',');

  useEffect(() => {
    if (!key) {return;}
    const requested = key.split(',');
    let cancelled = false;
    fetchTripSummaries(requested).then(
      (found) => {
        if (cancelled) {return;}
        setSummaries(found);
        const known = new Set(found.map(({ trip }) => trip.id));
        const missing = requested.filter((id) => !known.has(id));
        // Changes `recent`, so the next-newest trips are fetched in their place.
        if (missing.length > 0) {forgetTrips(missing);}
      },
      (error: unknown) => {
        // Offline isn't "deleted": hide the section and forget nothing.
        console.warn('[recent] could not load recent trips:', error);
        if (!cancelled) {setSummaries([]);}
      },
    );

    return () => {
      cancelled = true;
    };
  }, [key, forgetTrips]);

  const recent = ids.flatMap((id) => summaries.find(({ trip }) => trip.id === id) ?? []);
  if (recent.length === 0) {return null;}

  return (
    <section className="mt-8 flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-outline uppercase">Recent trips</h2>
      {recent.map(({ trip, items }) => {
        const progress = packingProgress(items);

        return (
          <RecentTripRow
            key={trip.id}
            to={`/trip/${trip.id}`}
            icon={TRIP_TYPE_META[trip.tripType].icon}
            city={trip.city}
            dates={formatDateRange(trip.startDate, trip.endDate)}
            itemCount={progress.total}
            percent={progress.percent}
          />
        );
      })}
    </section>
  );
}
