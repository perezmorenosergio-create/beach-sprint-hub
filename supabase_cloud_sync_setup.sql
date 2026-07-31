-- Ejecutar en Supabase > SQL Editor
-- Garantiza que cada usuario pueda leer y escribir únicamente sus propios datos.

alter table public.athletes enable row level security;
alter table public.sessions enable row level security;
alter table public.session_athletes enable row level security;
alter table public.splits enable row level security;

drop policy if exists "Users manage own athletes" on public.athletes;
create policy "Users manage own athletes" on public.athletes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own sessions" on public.sessions;
create policy "Users manage own sessions" on public.sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own session athletes" on public.session_athletes;
create policy "Users manage own session athletes" on public.session_athletes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own splits" on public.splits;
create policy "Users manage own splits" on public.splits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
