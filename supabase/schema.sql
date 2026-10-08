-- Koko core: perfiles + videos para el feed vertical.
-- Ejecutar en el SQL Editor de Supabase.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  description text,
  video_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx on public.videos (created_at desc);

alter table public.profiles enable row level security;
alter table public.videos enable row level security;

create policy "profiles_select" on public.profiles for select using (true);
create policy "videos_select" on public.videos for select using (true);

-- Escritura propia (cuando haya auth de verdad)
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "videos_insert_own" on public.videos
  for insert with check (auth.uid() = user_id);
