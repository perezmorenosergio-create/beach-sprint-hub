
-- Beach Sprint Hub v3.5
-- Ejecutar una sola vez en Supabase > SQL Editor.

create table if not exists public.athlete_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null,
  plan_data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, athlete_id)
);

create table if not exists public.week_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null,
  week_number integer not null,
  comment_text text not null,
  author_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.training_completion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null,
  completion_key text not null,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (user_id, athlete_id, completion_key)
);

alter table public.athlete_plans enable row level security;
alter table public.week_comments enable row level security;
alter table public.training_completion enable row level security;

drop policy if exists "Users manage own athlete plans" on public.athlete_plans;
create policy "Users manage own athlete plans"
on public.athlete_plans for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own week comments" on public.week_comments;
create policy "Users manage own week comments"
on public.week_comments for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users manage own completion" on public.training_completion;
create policy "Users manage own completion"
on public.training_completion for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists athlete_plans_user_athlete_idx
on public.athlete_plans(user_id, athlete_id);

create index if not exists week_comments_user_athlete_week_idx
on public.week_comments(user_id, athlete_id, week_number);

create index if not exists training_completion_user_athlete_idx
on public.training_completion(user_id, athlete_id);
