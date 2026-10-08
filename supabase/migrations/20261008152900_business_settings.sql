create table app.user_business_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null check (version > 0),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 131072),
  updated_at timestamptz not null default now()
);
alter table app.user_business_settings enable row level security;
grant select, insert, update on app.user_business_settings to app_user;
create policy business_settings_owner on app.user_business_settings for all to app_user
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
