import { tripDays } from './dates';
import { MAX_LUGGAGE_COUNT, TripInputSchema } from './types';
import type { LuggageEntry, LuggageType, Member, TripInput, TripType } from './types';

export const MAX_NAME_LENGTH = 30;
export const MAX_PER_KIND = 10;

// Same fields as City in services/weatherApi.ts: the engine can't import from services.
export type TripCity = {
  id: number | string;
  name: string;
  country: string;
  admin1?: string;
  latitude: number;
  longitude: number;
};

export type TripForm = {
  city: TripCity | null;
  startDate: string;
  endDate: string;
  tripType: TripType;
  luggage: LuggageEntry[];
  members: Member[];
  notes: string;
};

export const LUGGAGE_LABELS: Record<LuggageType, string> = {
  personal: 'Personal item',
  carryOn: 'Carry-on',
  checked: 'Checked suitcase',
};

export function initialForm(): TripForm {
  return {
    city: null,
    startDate: '',
    endDate: '',
    tripType: 'city',
    luggage: [{ type: 'carryOn', count: 1 }],
    members: [{ id: crypto.randomUUID(), name: 'Adult 1', kind: 'adult' }],
    notes: '',
  };
}

function defaultName(members: Member[], kind: Member['kind']): string {
  const prefix = kind === 'adult' ? 'Adult' : 'Kid';
  const taken = new Set(members.map((member) => member.name));
  let n = members.filter((member) => member.kind === kind).length + 1;
  while (taken.has(`${prefix} ${n}`)) {n += 1;}

  return `${prefix} ${n}`;
}

/** Add or drop members of one kind. A change that would leave nobody is ignored. */
export function setMemberCount(
  members: Member[],
  kind: Member['kind'],
  count: number,
  newId: () => string,
): Member[] {
  const target = Math.max(0, count);
  const next = [...members];
  let current = next.filter((member) => member.kind === kind).length;
  for (; current < target; current += 1) {
    next.push({ id: newId(), name: defaultName(next, kind), kind });
  }
  for (; current > target; current -= 1) {
    next.splice(next.map((member) => member.kind).lastIndexOf(kind), 1);
  }

  return next.length > 0 ? next : members;
}

export function renameMember(members: Member[], id: string, name: string): Member[] {
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH).trim();
  if (!trimmed) {return members;}

  return members.map((member) => (member.id === id ? { ...member, name: trimmed } : member));
}

export function removeMember(members: Member[], id: string): Member[] {
  return members.length > 1 ? members.filter((member) => member.id !== id) : members;
}

export function toggleLuggage(luggage: LuggageEntry[], type: LuggageType): LuggageEntry[] {
  return luggage.some((entry) => entry.type === type)
    ? luggage.filter((entry) => entry.type !== type)
    : [...luggage, { type, count: 1 }];
}

export function setLuggageCount(
  luggage: LuggageEntry[],
  type: LuggageType,
  count: number,
): LuggageEntry[] {
  const clamped = Math.min(MAX_LUGGAGE_COUNT, Math.max(1, count));

  return luggage.map((entry) => (entry.type === type ? { ...entry, count: clamped } : entry));
}

/** Null until the form is a valid trip. */
export function toTripInput(form: TripForm): TripInput | null {
  const { city, notes, ...rest } = form;
  if (!city) {return null;}
  const parsed = TripInputSchema.safeParse({
    ...rest,
    city: city.name,
    country: city.country || undefined,
    latitude: city.latitude,
    longitude: city.longitude,
    notes: notes.trim() || undefined,
  });

  return parsed.success ? parsed.data : null;
}

/** The schema allows past dates (saved trips age), so the form checks that itself. */
export function canGenerate(form: TripForm, today: string): boolean {
  return form.startDate >= today && toTripInput(form) !== null;
}

/** "7-day Barcelona · 3 travelers · Carry-on", leaving out what isn't known yet. */
export function tripSummary(form: TripForm): string {
  const { city, startDate, endDate, members, luggage } = form;
  const days =
    startDate && endDate && endDate >= startDate ? tripDays(startDate, endDate) : null;
  const place = days === null ? city?.name : `${days}-day ${city?.name ?? 'trip'}`;
  const travelers = `${members.length} ${members.length === 1 ? 'traveler' : 'travelers'}`;
  const bags = luggage.map((entry) => LUGGAGE_LABELS[entry.type]).join(' + ');

  return [place, travelers, bags].filter(Boolean).join(' · ');
}
