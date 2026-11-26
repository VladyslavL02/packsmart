import { CloudRain, CloudSun } from 'lucide-react';
import type { WeatherSummary } from '../../engine/types';
import { Skeleton } from '../atoms/Skeleton';

export function WeatherStrip({ state }: { state: 'idle' | 'loading' | WeatherSummary }) {
  if (state === 'idle') {return null;}
  if (state === 'loading') {return <Skeleton label="Loading weather" className="h-9" />;}
  const Icon = state.maxPrecipProbability >= 50 ? CloudRain : CloudSun;

  return (
    <p
      className="flex items-center gap-2 rounded-base bg-surface-container px-3 py-2 text-xs
        tabular-nums"
    >
      <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span>
        {Math.round(state.minTemp)} to {Math.round(state.maxTemp)} °C ·{' '}
        {Math.round(state.maxPrecipProbability)}% rain
        {state.isSeasonalEstimate && <span className="text-outline"> · seasonal estimate</span>}
      </span>
    </p>
  );
}
