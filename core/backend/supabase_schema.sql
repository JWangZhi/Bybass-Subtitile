-- 1. Table: jobs (Store User Data)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending',
  progress integer default 0,
  original_filename text not null,
  video_path text,
  source_lang text default 'auto',
  target_lang text default 'vi',
  burn_subtitles boolean default false,
  audio_path text,
  srt_path text,
  burned_video_path text,
  segments jsonb default '[]'::jsonb,
  allow_collection boolean default false, -- Dynamic Consent Flag
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  error_message text
);

-- 2. Table: training_datasets (Store Anonymized AI Data)
create table if not exists public.training_datasets (
  id uuid primary key default gen_random_uuid(),
  source_job_id uuid references public.jobs(id) on delete set null, -- Nullable to allow job deletion
  transcript_text text,
  segments jsonb, -- Cleaned segments (start, end, text)
  source_lang text,
  target_lang text,
  duration_seconds float,
  created_at timestamp with time zone default now()
);

-- 3. Enable Row Level Security (RLS) - MUST be run AFTER tables are created
alter table public.jobs enable row level security;
alter table public.training_datasets enable row level security;

-- 4. Realtime
alter publication supabase_realtime add table public.jobs;

-- 5. RLS Policies (Restricted)
-- Allow anyone to read jobs (if they have the UUID)
create policy "Enable select for anon" on public.jobs for select using (true);
-- Allow anyone to create jobs
create policy "Enable insert for anon" on public.jobs for insert with check (true);
-- Explicitly NO UPDATE/DELETE for anon (Service Role will bypass)

-- Same for training_datasets
create policy "Enable select for anon" on public.training_datasets for select using (true);
create policy "Enable insert for anon" on public.training_datasets for insert with check (true);
