import { CloudRain, CloudSun } from 'lucide-react';
import { useState } from 'react';
import type { WeatherSummary } from '../../engine/types';
import { Collapse } from '../atoms/Collapse';
import { Skeleton } from '../atoms/Skeleton';

type WeatherState = 'idle' | 'loading' | WeatherSummary;

function content(state: WeatherState) {
  if (state === 'idle') {return null;}
  // Same height as the loaded strip, so the swap doesn't move anything.
  if (state === 'loading') {return <Skeleton label="Loading weather" className="h-8" />;}
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

export function WeatherStrip({ state }: { state: WeatherState }) {
  // The last thing shown stays rendered while the strip closes.
  const [shown, setShown] = useState(state);
  if (state !== 'idle' && state !== shown) {setShown(state);}

  return (
    <Collapse open={state !== 'idle'}>
      {/* The spacing is inside, so a closed strip takes no room at all. */}
      {shown !== 'idle' && <div className="pt-3 md:pt-2">{content(shown)}</div>}
    </Collapse>
  );
}
