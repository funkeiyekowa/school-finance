-- ============================================================
-- SCHOOL FINANCE SUITE — Supabase Schema
-- Run this in your Supabase SQL editor to set up the database
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (linked to auth.users)
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'pending',
  active boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select using (auth.uid() = id);

create policy "Admins can read all profiles"
  on profiles for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

create policy "Admins can update all profiles"
  on profiles for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

create policy "Service can insert profiles"
  on profiles for insert with check (true);

-- ============================================================
-- SCHOOL SETTINGS
-- ============================================================
create table if not exists school_settings (
  id uuid primary key default uuid_generate_v4(),
  school_name text not null default 'My School',
  address text,
  phone text,
  email text,
  logo_url text,
  currency_symbol text not null default '₦',
  currency_code text not null default 'NGN',
  receipt_prefix text not null default 'RCT-',
  voucher_prefix text not null default 'VCH-',
  receipt_footer text default 'Thank you for your payment.',
  current_term text default 'Term 1',
  current_year text default '2026',
  updated_at timestamptz default now()
);

alter table school_settings enable row level security;

create policy "Authenticated users can read settings"
  on school_settings for select using (auth.role() = 'authenticated');

create policy "Admins can update settings"
  on school_settings for update using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

create policy "Admins can insert settings"
  on school_settings for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

-- Insert default settings
insert into school_settings (school_name, currency_symbol, currency_code)
values ('School Finance Suite', '₦', 'NGN')
on conflict do nothing;

-- ============================================================
-- ROLES
-- ============================================================
create table if not exists roles (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  description text,
  is_default boolean not null default false,
  permissions jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table roles enable row level security;

create policy "Authenticated users can read roles"
  on roles for select using (auth.role() = 'authenticated');

create policy "Admins can manage roles"
  on roles for all using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

-- Default roles
insert into roles (name, description, is_default, permissions) values
('admin', 'Full access to all features', false, '{"income":true,"expenses":true,"students":true,"vendors":true,"reconciliation":true,"reports":true,"receipts":true,"setup":true,"roles":true,"team":true,"activity":true,"sms_alerts":true}'),
('editor', 'Can record and edit transactions', false, '{"income":true,"expenses":true,"students":true,"vendors":true,"reconciliation":false,"reports":true,"receipts":true,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":true}'),
('viewer', 'Read-only access', true, '{"income":false,"expenses":false,"students":true,"vendors":false,"reconciliation":false,"reports":true,"receipts":false,"setup":false,"roles":false,"team":false,"activity":false,"sms_alerts":false}')
on conflict (name) do nothing;

-- ============================================================
-- STUDENTS
-- ============================================================
create table if not exists students (
  id uuid primary key default uuid_generate_v4(),
  student_code text not null unique,
  full_name text not null,
  grade text,
  academic_year text,
  gender text,
  date_of_birth date,
  admission_date date,
  address text,
  guardian_name text,
  guardian_phone text,
  guardian_email text,
  status text not null default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table students enable row level security;

create policy "Active users can read students"
  on students for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Staff can insert students"
  on students for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create policy "Staff can update students"
  on students for update using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create index if not exists idx_students_code on students(student_code);
create index if not exists idx_students_name on students(full_name);
create index if not exists idx_students_grade on students(grade);

-- ============================================================
-- VENDORS
-- ============================================================
create table if not exists vendors (
  id uuid primary key default uuid_generate_v4(),
  vendor_code text not null unique,
  name text not null,
  category text,
  contact_person text,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table vendors enable row level security;

create policy "Active users can read vendors"
  on vendors for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Staff can manage vendors"
  on vendors for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

-- ============================================================
-- FEE SCHEDULES
-- ============================================================
create table if not exists fee_schedules (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  amount numeric(12,2) not null default 0,
  category text not null default 'School Fees',
  grade text,
  term text,
  academic_year text,
  active boolean not null default true,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table fee_schedules enable row level security;

create policy "Active users can read fee schedules"
  on fee_schedules for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Admins can manage fee schedules"
  on fee_schedules for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor') and active = true)
  );

-- ============================================================
-- INCOME ENTRIES
-- ============================================================
create table if not exists income_entries (
  id uuid primary key default uuid_generate_v4(),
  receipt_no text not null unique,
  date date not null,
  student_id uuid references students(id) on delete set null,
  student_name text,
  category text not null,
  description text,
  amount numeric(12,2) not null,
  payment_method text not null default 'Cash',
  term text,
  recorded_by text,
  reconciled boolean not null default false,
  payment_source text not null default 'manual',
  sms_inbox_id uuid,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table income_entries enable row level security;

create policy "Active users can read income"
  on income_entries for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Staff can insert income"
  on income_entries for insert with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create policy "Staff can update income"
  on income_entries for update using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create index if not exists idx_income_date on income_entries(date);
create index if not exists idx_income_student on income_entries(student_id);
create index if not exists idx_income_receipt on income_entries(receipt_no);
create index if not exists idx_income_category on income_entries(category);

-- ============================================================
-- EXPENSE ENTRIES
-- ============================================================
create table if not exists expense_entries (
  id uuid primary key default uuid_generate_v4(),
  voucher_no text not null unique,
  date date not null,
  vendor_id uuid references vendors(id) on delete set null,
  vendor_name text,
  category text not null,
  description text,
  amount numeric(12,2) not null,
  payment_method text not null default 'Cash',
  approved_by text,
  reconciled boolean not null default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table expense_entries enable row level security;

create policy "Active users can read expenses"
  on expense_entries for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Staff can manage expenses"
  on expense_entries for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create index if not exists idx_expense_date on expense_entries(date);
create index if not exists idx_expense_vendor on expense_entries(vendor_id);
create index if not exists idx_expense_voucher on expense_entries(voucher_no);

-- ============================================================
-- BANK TRANSACTIONS (for reconciliation)
-- ============================================================
create table if not exists bank_transactions (
  id uuid primary key default uuid_generate_v4(),
  date date not null,
  description text not null,
  amount numeric(12,2) not null,
  direction text not null default 'Money In',
  reference text,
  sender_name text,
  bank_transaction_id text unique,
  match_status text not null default 'unmatched',
  matched_income_id uuid references income_entries(id) on delete set null,
  matched_expense_id uuid references expense_entries(id) on delete set null,
  confidence numeric(4,2),
  source text not null default 'manual',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table bank_transactions enable row level security;

create policy "Active users can read bank transactions"
  on bank_transactions for select using (
    exists (select 1 from profiles where id = auth.uid() and active = true)
  );

create policy "Staff can manage bank transactions"
  on bank_transactions for all using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor') and active = true)
  );

-- ============================================================
-- SMS INBOX (payment alerts from SMSGate)
-- ============================================================
create table if not exists sms_inbox (
  id uuid primary key default uuid_generate_v4(),
  event_id text unique,
  message_id text unique,
  device_id text,
  sender text,
  recipient text,
  sim_number integer,
  message_text text not null,
  received_at timestamptz,
  parsed_student_number text,
  parsed_student_name text,
  parsed_amount numeric(12,2),
  parsed_currency text default 'NGN',
  parsed_reference text,
  parser_version text default 'v1',
  processing_status text not null default 'received',
  match_status text not null default 'unmatched',
  match_reason text,
  matched_student_id uuid references students(id) on delete set null,
  matched_fee_id uuid references fee_schedules(id) on delete set null,
  confidence_score numeric(5,4),
  raw_payload jsonb,
  review_notes text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table sms_inbox enable row level security;

create policy "Staff can read sms inbox"
  on sms_inbox for select using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor','staff') and active = true)
  );

create policy "Staff can update sms inbox"
  on sms_inbox for update using (
    exists (select 1 from profiles where id = auth.uid() and role in ('admin','editor') and active = true)
  );

create policy "Service can insert sms inbox"
  on sms_inbox for insert with check (true);

create index if not exists idx_sms_event_id on sms_inbox(event_id);
create index if not exists idx_sms_message_id on sms_inbox(message_id);
create index if not exists idx_sms_sender on sms_inbox(sender);
create index if not exists idx_sms_student_no on sms_inbox(parsed_student_number);
create index if not exists idx_sms_status on sms_inbox(processing_status, match_status);
create index if not exists idx_sms_received on sms_inbox(received_at);

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table if not exists activity_log (
  id uuid primary key default uuid_generate_v4(),
  timestamp timestamptz default now(),
  user_email text,
  user_name text,
  action text not null,
  details text,
  created_at timestamptz default now()
);

alter table activity_log enable row level security;

create policy "Admins can read activity log"
  on activity_log for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active = true)
  );

create policy "Service can insert activity"
  on activity_log for insert with check (true);

create index if not exists idx_activity_timestamp on activity_log(timestamp);

-- ============================================================
-- FUNCTION: auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_count int;
  assigned_role text;
  is_active boolean;
begin
  select count(*) into user_count from public.profiles;
  if user_count = 0 then
    assigned_role := 'admin';
    is_active := true;
  else
    assigned_role := 'pending';
    is_active := false;
  end if;

  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    assigned_role,
    is_active
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- FUNCTION: get next sequence number
-- ============================================================
create or replace function get_next_receipt_no(prefix text)
returns text as $$
declare
  max_num int := 0;
  result text;
begin
  select coalesce(max(
    case when receipt_no like prefix || '%'
    then cast(substring(receipt_no from length(prefix)+1) as integer)
    else 0 end
  ), 0) into max_num
  from income_entries;
  result := prefix || lpad(cast(max_num + 1 as text), 4, '0');
  return result;
end;
$$ language plpgsql security definer;

create or replace function get_next_voucher_no(prefix text)
returns text as $$
declare
  max_num int := 0;
  result text;
begin
  select coalesce(max(
    case when voucher_no like prefix || '%'
    then cast(substring(voucher_no from length(prefix)+1) as integer)
    else 0 end
  ), 0) into max_num
  from expense_entries;
  result := prefix || lpad(cast(max_num + 1 as text), 4, '0');
  return result;
end;
$$ language plpgsql security definer;
