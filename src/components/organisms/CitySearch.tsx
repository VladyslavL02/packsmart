import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { searchCities } from '../../services/weatherApi';
import type { City } from '../../services/weatherApi';
import type { TripCity } from '../../engine/tripForm';
import { FieldMessage } from '../atoms/FieldMessage';
import { TextInput } from '../atoms/TextInput';
import { CityOption } from '../molecules/CityOption';

const DEBOUNCE_MS = 300;

const region = (city: TripCity) => [city.admin1, city.country].filter(Boolean).join(' · ');

type CitySearchProps = { value: TripCity | null; onChange: (city: TripCity | null) => void };

export function CitySearch({ value, onChange }: CitySearchProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  // Kept with the query that produced it, so an older list never shows under newer text.
  const [result, setResult] = useState<{ query: string; cities: City[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searching = value === null && query.trim().length >= 2;

  useEffect(() => {
    if (!searching) {return;}
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const cities = await searchCities(query, controller.signal);
      // searchCities answers [] on abort, which would wrongly clear the list.
      if (!controller.signal.aborted) {setResult({ query, cities });}
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searching]);

  const done = searching && result?.query === query;
  const cities = done ? result.cities : [];
  const expanded = open && cities.length > 0;
  const noResults = done && cities.length === 0;

  const pick = (city: City) => {
    setQuery(city.name);
    setOpen(false);
    onChange(city);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {setOpen(false);}
    if (!expanded) {return;}
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + cities.length) % cities.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(cities[active]);
    }
  };

  return (
    <div>
      <div className="flex flex-col gap-1">
        <label htmlFor="city" className="text-xs text-outline">
          City
        </label>
        <div className="relative">
          <TextInput
            id="city"
            role="combobox"
            aria-expanded={expanded}
            aria-controls="city-options"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="e.g. Barcelona"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
              setActive(0);
              // Edited text no longer means the picked city.
              if (value) {onChange(null);}
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          />
          <ul
            id="city-options"
            role="listbox"
            hidden={!expanded}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-base border
              border-outline-variant bg-surface-container-high shadow-xl"
          >
            {cities.map((city, index) => (
              <CityOption
                key={city.id}
                name={city.name}
                region={region(city)}
                active={index === active}
                // Keeps focus in the input, so blur doesn't close the list before the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(city)}
              />
            ))}
          </ul>
        </div>
      </div>
      <FieldMessage tone={value ? 'info' : 'muted'}>
        {value ? region(value) : noResults ? 'No cities found' : null}
      </FieldMessage>
    </div>
  );
}
