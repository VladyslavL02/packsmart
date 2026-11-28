import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { Skeleton } from '../components/atoms/Skeleton';
import { SaveErrorToast } from '../components/molecules/SaveErrorToast';
import { AiStatusRow } from '../components/organisms/AiStatusRow';
import { CategorySection } from '../components/organisms/CategorySection';
import { FilterBar } from '../components/organisms/FilterBar';
import { ProgressCard } from '../components/organisms/ProgressCard';
import { QuickAddBar } from '../components/organisms/QuickAddBar';
import { TripHeader } from '../components/organisms/TripHeader';
import { WeatherCard } from '../components/organisms/WeatherCard';
import {
  filterCounts,
  filterItems,
  groupByCategory,
  packingProgress,
  shownAiStatus,
  travelersLabel,
} from '../engine/listView';
import type { ItemFilter } from '../engine/listView';
import type { PackingItem } from '../engine/types';
import { formatDateRange } from '../lib/format';
import { CATEGORY_META, TRIP_TYPE_META } from '../lib/tripMeta';
import { subscribeToTrip } from '../services/tripRepo';
import { MAX_QUANTITY, useTripStore } from '../store/tripStore';

// One shared array: a selector returning a fresh [] each time would loop.
const NO_ITEMS: PackingItem[] = [];

function HomeLink() {
  return (
    <Link
      to="/"
      className="rounded-base bg-primary-container px-4 py-2 font-semibold
        text-on-primary-container hover:bg-primary"
    >
      Plan a trip
    </Link>
  );
}

function TripNotFound() {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Trip not found</h1>
      <p className="text-sm text-on-surface-variant">This link doesn't match a saved trip.</p>
      <HomeLink />
    </Card>
  );
}

function TripLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Couldn't load this trip</h1>
      <p className="text-sm text-on-surface-variant">Check your connection and try again.</p>
      <Button onClick={onRetry}>Retry</Button>
      <HomeLink />
    </Card>
  );
}

function TripSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton label="Loading trip" className="h-16" />
      <div className="grid gap-3 md:grid-cols-2" aria-hidden="true">
        <div className="h-28 animate-pulse rounded-xl bg-surface-container-high" />
        <div className="h-28 animate-pulse rounded-xl bg-surface-container-high" />
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-14 animate-pulse rounded-xl bg-surface-container-high" />
        ))}
      </div>
    </div>
  );
}

function TripView({ tripId }: { tripId: string }) {
  const trip = useTripStore((state) => state.trips[tripId]);
  const items = useTripStore((state) => state.items[tripId] ?? NO_ITEMS);
  const currentMemberId = useTripStore((state) => state.currentMember[tripId] ?? null);
  const aiStatus = useTripStore((state) => state.aiStatus[tripId]);
  const togglePacked = useTripStore((state) => state.togglePacked);
  const setQuantity = useTripStore((state) => state.setQuantity);
  const deleteItem = useTripStore((state) => state.deleteItem);
  const addUserItem = useTripStore((state) => state.addUserItem);
  const markCategoryPacked = useTripStore((state) => state.markCategoryPacked);
  const setCurrentMember = useTripStore((state) => state.setCurrentMember);
  const touchTrip = useTripStore((state) => state.touchTrip);
  const runAiSuggestions = useTripStore((state) => state.runAiSuggestions);
  const saveError = useTripStore((state) =>
    state.saveErrorTripId === tripId ? state.saveError : null,
  );
  const clearSaveError = useTripStore((state) => state.clearSaveError);
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [unpackedOnly, setUnpackedOnly] = useState(false);

  useEffect(() => {
    // The router keeps the scroll position, and Generate sits at the bottom of Home.
    window.scrollTo(0, 0);
    touchTrip(tripId);
  }, [tripId, touchTrip]);

  const { members } = trip;
  const groups = useMemo(
    () => groupByCategory(filterItems(items, filter, currentMemberId, unpackedOnly)),
    [items, filter, currentMemberId, unpackedOnly],
  );
  const progress = useMemo(() => packingProgress(items), [items]);
  const counts = useMemo(
    () => filterCounts(items, members, currentMemberId, unpackedOnly),
    [items, members, currentMemberId, unpackedOnly],
  );

  const details = [
    formatDateRange(trip.startDate, trip.endDate),
    travelersLabel(trip.members),
    TRIP_TYPE_META[trip.tripType].label,
  ].join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <TripHeader
        place={[trip.city, trip.country].filter(Boolean).join(', ')}
        details={details}
        members={trip.members}
        currentMemberId={currentMemberId}
        onMemberChange={(memberId) => setCurrentMember(tripId, memberId)}
      />
      <div className="grid gap-3 md:grid-cols-2">
        {trip.weather && <WeatherCard weather={trip.weather} />}
        <ProgressCard progress={progress} className={trip.weather ? '' : 'md:col-span-2'} />
      </div>
      <FilterBar
        filter={filter}
        counts={counts}
        members={trip.members}
        canFilterMine={currentMemberId !== null}
        unpackedOnly={unpackedOnly}
        onFilter={setFilter}
        onUnpackedOnly={setUnpackedOnly}
      />
      <AiStatusRow
        status={shownAiStatus(aiStatus, items)}
        onRetry={() => void runAiSuggestions(tripId)}
      />
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          label={CATEGORY_META[group.category].label}
          icon={CATEGORY_META[group.category].icon}
          items={group.items}
          members={trip.members}
          maxQuantity={MAX_QUANTITY}
          onToggle={(itemId) => togglePacked(tripId, itemId)}
          onQuantity={(itemId, quantity) => setQuantity(tripId, itemId, quantity)}
          onDelete={(itemId) => deleteItem(tripId, itemId)}
          onMarkAll={(itemIds) => markCategoryPacked(tripId, group.category, itemIds)}
        />
      ))}
      {groups.length === 0 && (
        <Card className="p-6 text-center">
          <p className="text-sm font-medium">Nothing here</p>
          <p className="text-xs text-on-surface-variant">
            Try another filter or turn off Unpacked only.
          </p>
        </Card>
      )}
      <QuickAddBar
        members={trip.members}
        currentMemberId={currentMemberId}
        onAdd={(title, memberId) => addUserItem(tripId, title, memberId)}
      />
      {saveError && <SaveErrorToast message={saveError} onDismiss={clearSaveError} />}
    </div>
  );
}

export function TripPage() {
  const { tripId = '' } = useParams();
  const loadTrip = useTripStore((state) => state.loadTrip);
  const applyRemoteUpsert = useTripStore((state) => state.applyRemoteUpsert);
  const applyRemoteDelete = useTripStore((state) => state.applyRemoteDelete);
  const clearSaveError = useTripStore((state) => state.clearSaveError);
  // hasOwn: /trip/constructor must not find an inherited property.
  const exists = useTripStore((state) => Object.hasOwn(state.trips, tripId));
  const load = useTripStore((state) =>
    Object.hasOwn(state.load, tripId) ? state.load[tripId] : undefined,
  );

  // Reloads even a trip already in memory: changes made while away weren't received.
  useEffect(() => {
    const unsubscribe = subscribeToTrip(tripId, {
      onUpsert: applyRemoteUpsert,
      onDelete: applyRemoteDelete,
      // Joining takes a moment, so fetch again to pick up what changed before it.
      onReady: () => void loadTrip(tripId),
    });
    void loadTrip(tripId);

    return () => {
      unsubscribe();
      clearSaveError();
    };
  }, [tripId, loadTrip, applyRemoteUpsert, applyRemoteDelete, clearSaveError]);

  // Keyed, so filters and the quick-add draft don't carry over between trips.
  if (exists) {return <TripView key={tripId} tripId={tripId} />;}
  if (load === 'missing') {return <TripNotFound />;}
  if (load === 'error') {return <TripLoadError onRetry={() => void loadTrip(tripId)} />;}

  return <TripSkeleton />;
}
