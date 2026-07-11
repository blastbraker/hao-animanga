create extension if not exists pgcrypto;
create extension if not exists citext;

create type media_kind as enum ('ANIME', 'MANGA', 'MANHWA', 'LIGHT_NOVEL');
create type library_status as enum ('PLANNING', 'WATCHING_READING', 'ON_HOLD', 'COMPLETED', 'DROPPED');
create type source_kind as enum ('ANILIST', 'JELLYFIN', 'DIRECT_MEDIA', 'MIHON_EXTENSION', 'ANIYOMI_EXTENSION', 'EPUB');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  suspended_at timestamptz,
  created_at timestamptz not null default now()
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  token_hash text not null unique,
  invited_by uuid not null references profiles(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table works (
  id uuid primary key default gen_random_uuid(),
  kind media_kind not null,
  title text not null,
  alternate_titles text[] not null default '{}',
  synopsis text not null default '',
  cover_url text,
  banner_url text,
  release_year integer,
  release_status text,
  genres text[] not null default '{}',
  maturity_rating text,
  average_score numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table editions (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  title text not null,
  sequence numeric(8,2),
  language text,
  created_at timestamptz not null default now()
);

create table release_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  number numeric(10,3) not null,
  title text,
  duration_seconds integer,
  released_at timestamptz,
  unique (edition_id, number)
);

create table source_records (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references works(id) on delete cascade,
  edition_id uuid references editions(id) on delete cascade,
  source_kind source_kind not null,
  provider_id text not null,
  external_id text not null,
  provenance jsonb not null default '{}',
  last_seen_at timestamptz not null default now(),
  unique (source_kind, provider_id, external_id)
);

create table library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  status library_status not null default 'PLANNING',
  favorite boolean not null default false,
  rating numeric(3,1) check (rating between 0 and 10),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, work_id)
);

create table progress (
  user_id uuid not null references profiles(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  release_item_id uuid references release_items(id) on delete set null,
  completed_units numeric(10,3) not null default 0,
  position_seconds numeric(12,3),
  position_percent numeric(6,3) check (position_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key(user_id, work_id)
);

create table custom_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique(user_id, name)
);

create table custom_list_items (
  list_id uuid not null references custom_lists(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  position integer not null default 0,
  primary key(list_id, work_id)
);

create table provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider_type text not null,
  display_name text not null,
  endpoint text,
  encrypted_credentials bytea,
  health text not null default 'unknown',
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table bridge_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  public_key text not null,
  endpoint text,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table repositories (
  id uuid primary key default gen_random_uuid(),
  bridge_id uuid not null references bridge_devices(id) on delete cascade,
  media_kind text not null check (media_kind in ('ANIME', 'MANGA')),
  url text not null,
  name text not null,
  signer_fingerprint text,
  acknowledged_at timestamptz,
  enabled boolean not null default false,
  unique(bridge_id, url)
);

create table epub_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  work_id uuid not null references works(id) on delete cascade,
  storage_key text not null unique,
  original_name text not null,
  byte_size bigint not null,
  sha256 text not null,
  processing_status text not null default 'pending',
  manifest jsonb,
  created_at timestamptz not null default now()
);

create table audit_events (
  id bigserial primary key,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  subject_type text not null,
  subject_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index works_search_idx on works using gin(to_tsvector('simple'::regconfig, title));
create index library_user_updated_idx on library_entries(user_id, updated_at desc);
create index audit_created_idx on audit_events(created_at desc);

alter table profiles enable row level security;
alter table invitations enable row level security;
alter table works enable row level security;
alter table editions enable row level security;
alter table release_items enable row level security;
alter table source_records enable row level security;
alter table library_entries enable row level security;
alter table progress enable row level security;
alter table custom_lists enable row level security;
alter table custom_list_items enable row level security;
alter table provider_connections enable row level security;
alter table bridge_devices enable row level security;
alter table repositories enable row level security;
alter table epub_assets enable row level security;
alter table audit_events enable row level security;

create policy "profiles own row" on profiles using (auth.uid() = id);
create policy "library own rows" on library_entries using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "progress own rows" on progress using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "lists own rows" on custom_lists using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "list items through owner" on custom_list_items using (exists(select 1 from custom_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "connections own rows" on provider_connections using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bridges own rows" on bridge_devices using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "epubs own rows" on epub_assets using (auth.uid() = user_id) with check (auth.uid() = user_id);
