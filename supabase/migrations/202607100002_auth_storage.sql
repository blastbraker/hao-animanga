create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'HAO member'),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('epubs', 'epubs', false, 52428800, array['application/epub+zip'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy "users upload own epubs" on storage.objects for insert to authenticated
with check (bucket_id='epubs' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users read own epubs" on storage.objects for select to authenticated
using (bucket_id='epubs' and (storage.foldername(name))[1]=auth.uid()::text);
create policy "users delete own epubs" on storage.objects for delete to authenticated
using (bucket_id='epubs' and (storage.foldername(name))[1]=auth.uid()::text);
