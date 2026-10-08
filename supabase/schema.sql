-- Koko + KOZMO schema stub
-- Run in Supabase SQL editor. No secrets included.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  follower_count integer not null default 0,
  following_count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text,
  description text,
  video_url text not null,
  thumbnail_url text,
  duration_ms integer,
  like_count integer not null default 0,
  comment_count integer not null default 0,
  view_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists videos_created_at_idx on public.videos (created_at desc);
create index if not exists videos_user_id_idx on public.videos (user_id);

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, video_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

create type public.kozmo_game_id as enum (
  'rush',
  'colosseum',
  'magnet',
  'tower',
  'bomba'
);

create table if not exists public.kozmo_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id public.kozmo_game_id not null,
  score integer not null check (score >= 0),
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists kozmo_scores_leaderboard_idx
  on public.kozmo_scores (game_id, score desc);

-- Profile bootstrap on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.kozmo_scores enable row level security;

-- Open read policies for social feed; write restricted to owner.
create policy "profiles are readable" on public.profiles for select using (true);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);

create policy "videos are readable" on public.videos for select using (true);
create policy "videos insert own" on public.videos for insert with check (auth.uid() = user_id);
create policy "videos update own" on public.videos for update using (auth.uid() = user_id);

create policy "likes readable" on public.likes for select using (true);
create policy "likes insert own" on public.likes for insert with check (auth.uid() = user_id);
create policy "likes delete own" on public.likes for delete using (auth.uid() = user_id);

create policy "comments readable" on public.comments for select using (true);
create policy "comments insert own" on public.comments for insert with check (auth.uid() = user_id);

create policy "follows readable" on public.follows for select using (true);
create policy "follows insert own" on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows delete own" on public.follows for delete using (auth.uid() = follower_id);

create policy "kozmo scores readable" on public.kozmo_scores for select using (true);
create policy "kozmo scores insert own" on public.kozmo_scores for insert with check (auth.uid() = user_id);
