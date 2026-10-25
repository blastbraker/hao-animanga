-- Shared throttles survive serverless instance restarts and concurrent requests.
create table if not exists public.signup_rate_limits (
  key_hash text primary key,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
alter table public.signup_rate_limits enable row level security;
revoke all on public.signup_rate_limits from anon, authenticated;

-- Invites remain server-only, even if the Supabase dashboard signup toggle is
-- accidentally enabled. Client-supplied user_metadata cannot grant membership.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce((new.raw_app_meta_data->>'invited')::boolean, false) is not true
     and new.invited_at is null then
    raise exception 'An invitation is required to create a HAO account';
  end if;
  insert into public.profiles (id, display_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'HAO member'), 'member')
  on conflict (id) do nothing;
  return new;
end;
$$;
