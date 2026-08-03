alter table profiles
  add column if not exists maturity_ceiling text not null default 'MATURE'
    check (maturity_ceiling in ('GENERAL', 'TEEN', 'MATURE', 'ADULT')),
  add column if not exists hide_unrated boolean not null default false,
  add column if not exists preferences jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists reading_states (
  user_id uuid not null references profiles(id) on delete cascade,
  content_key text not null check (length(content_key) between 1 and 500),
  media_kind text not null check (media_kind in ('ANIME', 'MANGA', 'NOVEL', 'EPUB')),
  work_id uuid references works(id) on delete set null,
  title text not null default '',
  release_label text not null default '',
  position_percent numeric(6,3) check (position_percent between 0 and 100),
  completed boolean not null default false,
  state jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, content_key)
);

create index if not exists reading_states_user_updated_idx
  on reading_states(user_id, server_updated_at desc);

alter table reading_states enable row level security;

drop policy if exists "reading states own rows" on reading_states;
create policy "reading states own rows" on reading_states
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

