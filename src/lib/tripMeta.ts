import { Backpack, Briefcase, BriefcaseBusiness, Building2 } from 'lucide-react';
import { Luggage, Mountain, Umbrella } from 'lucide-react';
import { Baby, FileText, HeartPulse, Package, Plug, Shirt, SprayCan, Tent } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Category, LuggageType, TripType } from '../engine/types';

// A full Record: a new trip type without a card here fails typecheck. /add-trip-preset adds to it.
export const TRIP_TYPE_META: Record<
  TripType,
  { label: string; subtitle: string; icon: LucideIcon }
> = {
  city: { label: 'City', subtitle: 'Urban walks', icon: Building2 },
  mountains: { label: 'Mountains', subtitle: 'Alpine & trails', icon: Mountain },
  beach: { label: 'Beach', subtitle: 'Warm & swim', icon: Umbrella },
  business: { label: 'Business', subtitle: 'Suits & tech', icon: Briefcase },
  camping: { label: 'Camping', subtitle: 'Tents & nights out', icon: Tent },
};

export const LUGGAGE_ICONS: Record<LuggageType, LucideIcon> = {
  personal: Backpack,
  carryOn: BriefcaseBusiness,
  checked: Luggage,
};

export const CATEGORY_META: Record<Category, { label: string; icon: LucideIcon }> = {
  clothing: { label: 'Clothing', icon: Shirt },
  toiletries: { label: 'Toiletries', icon: SprayCan },
  documents: { label: 'Documents', icon: FileText },
  electronics: { label: 'Electronics', icon: Plug },
  health: { label: 'Health', icon: HeartPulse },
  kids: { label: 'Kids', icon: Baby },
  misc: { label: 'Other', icon: Package },
};
