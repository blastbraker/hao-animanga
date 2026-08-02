alter table public.repositories drop constraint if exists repositories_media_kind_check;
alter table public.repositories
  add constraint repositories_media_kind_check
  check (media_kind in ('ANIME', 'MANGA', 'NOVEL'));
