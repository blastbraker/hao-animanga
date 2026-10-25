-- Supabase Admin creates the auth row, then sets app_metadata in the same
-- transaction. Validate the final row at commit, not the intermediate insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  account auth.users%rowtype;
begin
  select * into account from auth.users where id=new.id;
  if not found then return new; end if;
  if coalesce((account.raw_app_meta_data->>'invited')::boolean, false) is not true
     and account.invited_at is null then
    raise exception 'An invitation is required to create a HAO account';
  end if;
  insert into public.profiles (id, display_name, role)
  values (account.id, coalesce(account.raw_user_meta_data->>'display_name', split_part(account.email, '@', 1), 'HAO member'), 'member')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create constraint trigger on_auth_user_created
  after insert on auth.users
  deferrable initially deferred
  for each row execute procedure public.handle_new_user();
