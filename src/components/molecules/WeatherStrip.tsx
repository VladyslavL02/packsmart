import { CloudRain, CloudSun } from 'lucide-react';
import type { WeatherSummary } from '../../engine/types';
import { Skeleton } from '../atoms/Skeleton';

type WeatherState = 'idle' | 'loading' | WeatherSummary;

const STRIP = 'flex h-8 items-center gap-2 rounded-base bg-surface-container px-3 text-xs';

function content(state: WeatherState) {
  if (state === 'loading') {return <Skeleton label="Loading weather" className="h-8" />;}
  if (state === 'idle') {
    return (
      <p className={`${STRIP} text-outline`}>
        <CloudSun className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">Pick a city and dates to see the weather</span>
      </p>
    );
  }
  const Icon = state.maxPrecipProbability >= 50 ? CloudRain : CloudSun;

  return (
    <p className={`${STRIP} tabular-nums`}>
      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="truncate">
        {Math.round(state.minTemp)} to {Math.round(state.maxTemp)} °C ·{' '}
        {Math.round(state.maxPrecipProbability)}% rain
        {state.isSeasonalEstimate && <span className="text-outline"> · seasonal estimate</span>}
      </span>
    </p>
  );
}

/** Always the same height: hint, skeleton or forecast, so nothing below it moves. */
export function WeatherStrip({ state }: { state: WeatherState }) {
  return <div className="pt-2">{content(state)}</div>;
}
