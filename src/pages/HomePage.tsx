import { Briefcase, Compass, Shapes, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormPanel } from '../components/layout/FormPanel';
import { DateRangeFields } from '../components/molecules/DateRangeFields';
import { FormSection } from '../components/molecules/FormSection';
import { NotesField } from '../components/molecules/NotesField';
import { WeatherStrip } from '../components/molecules/WeatherStrip';
import { CitySearch } from '../components/organisms/CitySearch';
import { GenerateBar } from '../components/organisms/GenerateBar';
import { LuggagePicker } from '../components/organisms/LuggagePicker';
import { RecentTrips } from '../components/organisms/RecentTrips';
import { TravelersEditor } from '../components/organisms/TravelersEditor';
import { TripTypePicker } from '../components/organisms/TripTypePicker';
import { toIsoDate } from '../engine/dates';
import { canGenerate, initialForm, toTripInput, tripSummary } from '../engine/tripForm';
import type { TripForm } from '../engine/tripForm';
import type { WeatherSummary } from '../engine/types';
import { getTripWeather } from '../services/weatherApi';
import { useTripStore } from '../store/tripStore';

const weatherKey = (latitude: number, longitude: number, start: string, end: string) =>
  `${latitude},${longitude},${start},${end}`;

export function HomePage() {
  const navigate = useNavigate();
  const createTrip = useTripStore((state) => state.createTrip);
  const runAiSuggestions = useTripStore((state) => state.runAiSuggestions);
  const [form, setForm] = useState<TripForm>(initialForm);
  const [preview, setPreview] = useState<{ key: string; weather: WeatherSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Leaving the page while weather loads must not create a trip and pull the user back.
  const mounted = useRef(true);

  const update = (changes: Partial<TripForm>) => {
    setForm((current) => ({ ...current, ...changes }));
    setError(null);
  };

  const today = toIsoDate(new Date());
  const { city, startDate, endDate } = form;
  const latitude = city?.latitude;
  const longitude = city?.longitude;
  const key =
    latitude !== undefined && longitude !== undefined && startDate >= today && endDate >= startDate
      ? weatherKey(latitude, longitude, startDate, endDate)
      : null;
  const weatherState = key === null ? 'idle' : preview?.key === key ? preview.weather : 'loading';

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (key === null || latitude === undefined || longitude === undefined) {return;}
    const controller = new AbortController();
    const trip = { latitude, longitude, startDate, endDate };
    void getTripWeather(trip, new Date(), controller.signal).then((weather) => {
      if (!controller.signal.aborted) {setPreview({ key, weather });}
    });

    return () => controller.abort();
  }, [key, latitude, longitude, startDate, endDate]);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    const input = toTripInput(form);
    if (busy || !input || !canGenerate(form, today)) {return;}
    setBusy(true);
    setError(null);
    try {
      const weather = weatherState === 'idle' || weatherState === 'loading'
        ? await getTripWeather(input)
        : weatherState;
      if (!mounted.current) {return;}
      const id = createTrip(input, weather);
      navigate(`/trip/${id}`);
      // Not awaited: the list shows at once and the AI rows arrive later.
      void runAiSuggestions(id);
    } catch (cause) {
      console.warn('[home] could not create the trip:', cause);
      setError('Could not create the list. Check the form and try again.');
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="sr-only">Plan a trip</h1>
      <FormPanel
        onSubmit={generate}
        // Enter in a field must not submit: only the Generate button does.
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault();
          }
        }}
        noValidate
      >
        <FormSection icon={Compass} title="Destination & dates">
          <div>
            <div className="grid gap-2 md:grid-cols-12">
              <div className="md:col-span-6">
                <CitySearch value={city} onChange={(next) => update({ city: next })} />
              </div>
              <div className="md:col-span-6">
                <DateRangeFields
                  startDate={startDate}
                  endDate={endDate}
                  today={today}
                  onChange={(start, end) => update({ startDate: start, endDate: end })}
                />
              </div>
            </div>
            <WeatherStrip state={weatherState} />
          </div>
        </FormSection>
        <FormSection icon={Shapes} title="Trip format">
          <TripTypePicker value={form.tripType} onChange={(tripType) => update({ tripType })} />
        </FormSection>
        <FormSection icon={Briefcase} title="Luggage" aside="Select all that apply">
          <LuggagePicker value={form.luggage} onChange={(luggage) => update({ luggage })} />
        </FormSection>
        <FormSection icon={Users} title={`Travelers (${form.members.length})`}>
          <TravelersEditor value={form.members} onChange={(members) => update({ members })} />
        </FormSection>
        <NotesField value={form.notes} onChange={(notes) => update({ notes })} />
        <GenerateBar
          summary={tripSummary(form)}
          disabled={!canGenerate(form, today)}
          busy={busy}
          error={error}
        />
      </FormPanel>
      <RecentTrips />
    </>
  );
}
