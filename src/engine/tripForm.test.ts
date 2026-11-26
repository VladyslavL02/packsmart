import { describe, expect, it } from 'vitest';
import {
  LUGGAGE_LABELS,
  canGenerate,
  initialForm,
  removeMember,
  renameMember,
  setLuggageCount,
  setMemberCount,
  toTripInput,
  toggleLuggage,
  tripSummary,
  type TripCity,
  type TripForm,
} from './tripForm';
import type { LuggageEntry, Member } from './types';

const TODAY = '2026-06-01';

const adult = (id: string, name: string): Member => ({ id, name, kind: 'adult' });
const child = (id: string, name: string): Member => ({ id, name, kind: 'child' });

const city = (overrides: Partial<TripCity> = {}): TripCity => ({
  id: 1,
  name: 'Barcelona',
  country: 'Spain',
  latitude: 41.39,
  longitude: 2.17,
  ...overrides,
});

const form = (overrides: Partial<TripForm> = {}): TripForm => ({
  city: city(),
  startDate: '2026-06-10',
  endDate: '2026-06-16',
  tripType: 'city',
  luggage: [{ type: 'carryOn', count: 1 }],
  members: [adult('a1', 'Adult 1')],
  notes: '',
  ...overrides,
});

const idMaker = () => {
  let n = 0;

  return () => `new-${++n}`;
};

describe('initialForm', () => {
  it('starts empty with a city trip, one carry-on and one adult', () => {
    const initial = initialForm();

    expect(initial).toEqual({
      city: null,
      startDate: '',
      endDate: '',
      tripType: 'city',
      luggage: [{ type: 'carryOn', count: 1 }],
      members: [{ id: expect.any(String), name: 'Adult 1', kind: 'adult' }],
      notes: '',
    });
    expect(initial.members[0].id).not.toBe('');
  });
});

describe('setMemberCount', () => {
  it('appends numbered adults and kids until the count is reached', () => {
    const newId = idMaker();
    const withAdults = setMemberCount([adult('a1', 'Adult 1')], 'adult', 2, newId);
    const withKids = setMemberCount(withAdults, 'child', 2, newId);

    expect(withKids).toEqual([
      adult('a1', 'Adult 1'),
      adult('new-1', 'Adult 2'),
      child('new-2', 'Kid 1'),
      child('new-3', 'Kid 2'),
    ]);
  });

  it('uses the next free number when the default name is taken', () => {
    const result = setMemberCount([adult('a2', 'Adult 2')], 'adult', 2, idMaker());

    expect(result.map((m) => m.name)).toEqual(['Adult 2', 'Adult 3']);
  });

  it('drops the last members of that kind only', () => {
    const members = [
      adult('a1', 'Adult 1'),
      child('c1', 'Kid 1'),
      adult('a2', 'Adult 2'),
      child('c2', 'Kid 2'),
    ];

    expect(setMemberCount(members, 'adult', 1, idMaker())).toEqual([
      adult('a1', 'Adult 1'),
      child('c1', 'Kid 1'),
      child('c2', 'Kid 2'),
    ]);
  });

  it('treats a negative count as zero', () => {
    const members = [adult('a1', 'Adult 1'), child('c1', 'Kid 1')];

    expect(setMemberCount(members, 'child', -3, idMaker())).toEqual([adult('a1', 'Adult 1')]);
  });

  it('returns the list unchanged when the change would leave nobody', () => {
    const members = [adult('a1', 'Adult 1'), adult('a2', 'Adult 2')];

    expect(setMemberCount(members, 'adult', 0, idMaker())).toEqual(members);
  });

  it('allows a kids-only list', () => {
    const members = [adult('a1', 'Adult 1'), child('c1', 'Kid 1')];

    expect(setMemberCount(members, 'adult', 0, idMaker())).toEqual([child('c1', 'Kid 1')]);
  });

  it('does not mutate the input list', () => {
    const members = [adult('a1', 'Adult 1'), adult('a2', 'Adult 2')];
    const copy = structuredClone(members);

    setMemberCount(members, 'adult', 1, idMaker());
    setMemberCount(members, 'child', 1, idMaker());

    expect(members).toEqual(copy);
  });
});

describe('renameMember', () => {
  const members = [adult('a1', 'Adult 1'), child('c1', 'Kid 1')];

  it('trims the new name and renames only that member', () => {
    expect(renameMember(members, 'c1', '  Mia  ')).toEqual([
      adult('a1', 'Adult 1'),
      child('c1', 'Mia'),
    ]);
  });

  it('keeps the old name when the new one is empty or whitespace', () => {
    expect(renameMember(members, 'a1', '')).toEqual(members);
    expect(renameMember(members, 'a1', '   ')).toEqual(members);
  });

  it('truncates the name to 30 characters', () => {
    expect(renameMember(members, 'a1', 'x'.repeat(40))[0].name).toBe('x'.repeat(30));
  });
});

describe('removeMember', () => {
  it('removes the member with that id', () => {
    const members = [adult('a1', 'Adult 1'), child('c1', 'Kid 1')];

    expect(removeMember(members, 'a1')).toEqual([child('c1', 'Kid 1')]);
  });

  it('does not remove the only member', () => {
    const members = [adult('a1', 'Adult 1')];

    expect(removeMember(members, 'a1')).toEqual(members);
  });
});

describe('toggleLuggage', () => {
  it('adds an unselected type with a count of 1', () => {
    expect(toggleLuggage([{ type: 'carryOn', count: 2 }], 'checked')).toEqual([
      { type: 'carryOn', count: 2 },
      { type: 'checked', count: 1 },
    ]);
  });

  it('removes a selected type, including the last one', () => {
    expect(toggleLuggage([{ type: 'carryOn', count: 2 }], 'carryOn')).toEqual([]);
  });
});

describe('setLuggageCount', () => {
  const luggage: LuggageEntry[] = [{ type: 'carryOn', count: 2 }];

  it('clamps the count to between 1 and 9', () => {
    expect(setLuggageCount(luggage, 'carryOn', 0)).toEqual([{ type: 'carryOn', count: 1 }]);
    expect(setLuggageCount(luggage, 'carryOn', 12)).toEqual([{ type: 'carryOn', count: 9 }]);
    expect(setLuggageCount(luggage, 'carryOn', 4)).toEqual([{ type: 'carryOn', count: 4 }]);
  });

  it('ignores a type that is not selected', () => {
    expect(setLuggageCount(luggage, 'checked', 3)).toEqual(luggage);
  });
});

describe('toTripInput', () => {
  it('maps the picked city and form fields to a trip input', () => {
    expect(toTripInput(form({ notes: '  pack light  ' }))).toEqual({
      city: 'Barcelona',
      country: 'Spain',
      latitude: 41.39,
      longitude: 2.17,
      startDate: '2026-06-10',
      endDate: '2026-06-16',
      tripType: 'city',
      luggage: [{ type: 'carryOn', count: 1 }],
      members: [adult('a1', 'Adult 1')],
      notes: 'pack light',
    });
  });

  it('leaves country and blank notes undefined', () => {
    const input = toTripInput(form({ city: city({ country: '' }), notes: '   ' }));

    expect(input).not.toBeNull();
    expect(input?.country).toBeUndefined();
    expect(input?.notes).toBeUndefined();
  });

  it('returns null without a city', () => {
    expect(toTripInput(form({ city: null }))).toBeNull();
  });

  it('returns null when the end date is before the start date', () => {
    expect(toTripInput(form({ endDate: '2026-06-09' }))).toBeNull();
  });

  it('returns null without luggage', () => {
    expect(toTripInput(form({ luggage: [] }))).toBeNull();
  });

  it('returns null when notes are over 500 characters', () => {
    expect(toTripInput(form({ notes: 'x'.repeat(501) }))).toBeNull();
  });
});

describe('canGenerate', () => {
  it('allows a valid upcoming trip', () => {
    expect(canGenerate(form(), TODAY)).toBe(true);
  });

  it('allows a trip that starts today', () => {
    expect(canGenerate(form({ startDate: TODAY }), TODAY)).toBe(true);
  });

  it('blocks a start date in the past', () => {
    expect(canGenerate(form({ startDate: '2026-05-31' }), TODAY)).toBe(false);
  });

  it('blocks a form that is not a valid trip input', () => {
    expect(canGenerate(form({ city: null }), TODAY)).toBe(false);
    expect(canGenerate(form({ endDate: '2026-06-09' }), TODAY)).toBe(false);
    expect(canGenerate(form({ luggage: [] }), TODAY)).toBe(false);
    expect(canGenerate(form({ notes: 'x'.repeat(501) }), TODAY)).toBe(false);
  });
});

describe('LUGGAGE_LABELS', () => {
  it('names every luggage type', () => {
    expect(LUGGAGE_LABELS).toEqual({
      personal: 'Personal item',
      carryOn: 'Carry-on',
      checked: 'Checked suitcase',
    });
  });
});

describe('tripSummary', () => {
  it('shows the inclusive day count, city, one traveler and luggage', () => {
    expect(tripSummary(form())).toBe('7-day Barcelona · 1 traveler · Carry-on');
  });

  it('pluralizes travelers and joins luggage labels in array order', () => {
    const trip = form({
      members: [adult('a1', 'Adult 1'), adult('a2', 'Adult 2'), child('c1', 'Kid 1')],
      luggage: [
        { type: 'checked', count: 1 },
        { type: 'personal', count: 2 },
      ],
    });

    expect(tripSummary(trip)).toBe(
      '7-day Barcelona · 3 travelers · Checked suitcase + Personal item',
    );
  });

  it('shows only the city when dates are missing or reversed', () => {
    const expected = 'Barcelona · 1 traveler · Carry-on';

    expect(tripSummary(form({ startDate: '', endDate: '' }))).toBe(expected);
    expect(tripSummary(form({ endDate: '2026-06-09' }))).toBe(expected);
  });

  it('says trip when there are dates but no city', () => {
    expect(tripSummary(form({ city: null }))).toBe('7-day trip · 1 traveler · Carry-on');
  });

  it('omits the first part without city or dates, and luggage when empty', () => {
    const trip = form({ city: null, startDate: '', endDate: '', luggage: [] });

    expect(tripSummary(trip)).toBe('1 traveler');
  });
});
