-- Central Calendar: one JSON document per signed-in person.
-- Row Level Security makes sure each account can only see and change its own row.

create table if not exists public.calendar_docs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  doc jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.calendar_docs enable row level security;

create policy "Read own calendar" on public.calendar_docs
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Create own calendar" on public.calendar_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Update own calendar" on public.calendar_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Delete own calendar" on public.calendar_docs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Keep documents to a sane size (about 5 MB).
alter table public.calendar_docs add constraint calendar_docs_doc_size check (pg_column_size(doc) < 5000000);
