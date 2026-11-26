import { CloudRain, CloudSun } from 'lucide-react';
import type { WeatherSummary } from '../../engine/types';
import { Card } from '../atoms/Card';

const degrees = (value: number) => {
  const rounded = Math.round(value);

  return `${rounded > 0 ? '+' : ''}${rounded}°`;
};

function rainLine({ rainDays, maxPrecipProbability }: WeatherSummary): string {
  const chance = `${Math.round(maxPrecipProbability)}% max chance`;
  if (rainDays === 0) {return `No rain expected · ${chance}`;}

  return `Rain expected on ${rainDays} ${rainDays === 1 ? 'day' : 'days'} · ${chance}`;
}

export function WeatherCard({ weather }: { weather: WeatherSummary }) {
  const Icon = weather.maxPrecipProbability >= 50 ? CloudRain : CloudSun;

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-outline
        uppercase">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        Weather
      </h2>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {degrees(weather.minTemp)} … {degrees(weather.maxTemp)}C
      </p>
      <p className="text-xs text-on-surface-variant tabular-nums">{rainLine(weather)}</p>
      {weather.isSeasonalEstimate && <p className="text-xs text-outline">Seasonal estimate</p>}
    </Card>
  );
}
