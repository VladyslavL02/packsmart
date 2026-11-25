begin;

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  country text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  trip_type text not null,                    -- validated by Zod; no CHECK, so presets need no migration
  luggage jsonb not null default '[]',        -- [{type,count}], matches LuggageEntrySchema
  members jsonb not null default '[]',        -- [{id,name,kind}], matches MemberSchema
  notes text check (char_length(notes) <= 500),
  weather_summary jsonb,                      -- WeatherSummarySchema, null until fetched
  created_at timestamptz not null default now()
);

create table public.packing_items (
  id uuid primary key default gen_random_uuid(),  -- client may supply crypto.randomUUID()
  trip_id uuid not null references public.trips(id) on delete cascade,
  key text,
  title text not null,
  category text not null,                          -- Zod CategorySchema; no CHECK, like trip_type
  scope text not null check (scope in ('shared','adult','child')),
  member_id text,                                  -- null = shared
  quantity int not null default 1 check (quantity > 0),
  is_packed boolean not null default false,
  source text not null check (source in ('rules','ai','user')),
  reason text,
  created_at timestamptz not null default now()
);
create index packing_items_trip_id_idx on public.packing_items(trip_id);

alter table public.trips enable row level security;
alter table public.packing_items enable row level security;

-- Access is by unguessable trip link (uuid). There is no auth, so policies are permissive on purpose.
create policy "trips_select" on public.trips for select to anon, authenticated using (true);
create policy "trips_insert" on public.trips for insert to anon, authenticated with check (true);
create policy "trips_update" on public.trips for update to anon, authenticated using (true) with check (true);
create policy "trips_delete" on public.trips for delete to anon, authenticated using (true);   -- Phase 6 rollback
create policy "items_select" on public.packing_items for select to anon, authenticated using (true);
create policy "items_insert" on public.packing_items for insert to anon, authenticated with check (true);
create policy "items_update" on public.packing_items for update to anon, authenticated using (true) with check (true);
create policy "items_delete" on public.packing_items for delete to anon, authenticated using (true);

-- Realtime: full old row on UPDATE/DELETE so the two-tab sync can match by id + trip_id.
alter table public.packing_items replica identity full;
alter publication supabase_realtime add table public.packing_items;

commit;
