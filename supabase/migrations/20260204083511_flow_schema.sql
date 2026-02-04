create extension if not exists pgcrypto;

-- Profiles for user settings
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- API keys for iOS Shortcuts ingestion
create table if not exists public.user_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz,
  last_used_ip text
);

-- Raw transactions
create table if not exists public.raw_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  txn_timestamp timestamptz not null,
  amount numeric(14,2) not null,
  currency text not null,
  counterparty text,
  card text,
  direction text,
  txn_type text,
  category text,
  subcategory text,
  confidence text,
  context jsonb,
  raw_text text,
  net numeric(14,2),
  idempotency_key text,
  source text not null default 'sms',
  ai_model text,
  ai_mode text,
  created_at timestamptz not null default now()
);

create unique index if not exists raw_ledger_user_id_idem_key
  on public.raw_ledger (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists raw_ledger_user_ts_idx
  on public.raw_ledger (user_id, txn_timestamp desc);

-- Merchant map
create table if not exists public.merchant_map (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern text not null,
  display_name text,
  consolidated_name text,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pattern)
);

create trigger merchant_map_set_updated_at
  before update on public.merchant_map
  for each row execute procedure public.set_updated_at();

-- FX rates
create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null,
  rate_to_qar numeric(14,6) not null,
  formula text,
  updated_at timestamptz not null default now(),
  unique (user_id, currency)
);

create trigger fx_rates_set_updated_at
  before update on public.fx_rates
  for each row execute procedure public.set_updated_at();

-- User context / corrections / preferences
create table if not exists public.user_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  key text,
  value text,
  details text,
  date_added timestamptz,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists user_context_user_idx
  on public.user_context (user_id, type);

-- Recipients
create table if not exists public.recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text,
  bank_account text,
  short_name text,
  long_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger recipients_set_updated_at
  before update on public.recipients
  for each row execute procedure public.set_updated_at();

-- Insights
create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date timestamptz not null,
  insights text not null,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;
alter table public.user_keys enable row level security;
alter table public.raw_ledger enable row level security;
alter table public.merchant_map enable row level security;
alter table public.fx_rates enable row level security;
alter table public.user_context enable row level security;
alter table public.recipients enable row level security;
alter table public.insights enable row level security;

-- Policies
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_update" on public.profiles
  for update using (auth.uid() = user_id);

create policy "user_keys_select" on public.user_keys
  for select using (auth.uid() = user_id);
create policy "user_keys_insert" on public.user_keys
  for insert with check (auth.uid() = user_id);
create policy "user_keys_update" on public.user_keys
  for update using (auth.uid() = user_id);
create policy "user_keys_delete" on public.user_keys
  for delete using (auth.uid() = user_id);

create policy "raw_ledger_select" on public.raw_ledger
  for select using (auth.uid() = user_id);
create policy "raw_ledger_insert" on public.raw_ledger
  for insert with check (auth.uid() = user_id);
create policy "raw_ledger_update" on public.raw_ledger
  for update using (auth.uid() = user_id);
create policy "raw_ledger_delete" on public.raw_ledger
  for delete using (auth.uid() = user_id);

create policy "merchant_map_select" on public.merchant_map
  for select using (auth.uid() = user_id);
create policy "merchant_map_insert" on public.merchant_map
  for insert with check (auth.uid() = user_id);
create policy "merchant_map_update" on public.merchant_map
  for update using (auth.uid() = user_id);
create policy "merchant_map_delete" on public.merchant_map
  for delete using (auth.uid() = user_id);

create policy "fx_rates_select" on public.fx_rates
  for select using (auth.uid() = user_id);
create policy "fx_rates_insert" on public.fx_rates
  for insert with check (auth.uid() = user_id);
create policy "fx_rates_update" on public.fx_rates
  for update using (auth.uid() = user_id);
create policy "fx_rates_delete" on public.fx_rates
  for delete using (auth.uid() = user_id);

create policy "user_context_select" on public.user_context
  for select using (auth.uid() = user_id);
create policy "user_context_insert" on public.user_context
  for insert with check (auth.uid() = user_id);
create policy "user_context_update" on public.user_context
  for update using (auth.uid() = user_id);
create policy "user_context_delete" on public.user_context
  for delete using (auth.uid() = user_id);

create policy "recipients_select" on public.recipients
  for select using (auth.uid() = user_id);
create policy "recipients_insert" on public.recipients
  for insert with check (auth.uid() = user_id);
create policy "recipients_update" on public.recipients
  for update using (auth.uid() = user_id);
create policy "recipients_delete" on public.recipients
  for delete using (auth.uid() = user_id);

create policy "insights_select" on public.insights
  for select using (auth.uid() = user_id);
create policy "insights_insert" on public.insights
  for insert with check (auth.uid() = user_id);
create policy "insights_update" on public.insights
  for update using (auth.uid() = user_id);
create policy "insights_delete" on public.insights
  for delete using (auth.uid() = user_id);
