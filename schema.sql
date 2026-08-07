-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create Sequence for Student IDs (STU10001, STU10002, etc.)
create sequence if not exists student_id_seq start 10001;

-- =========================================================================
-- 1. DATABASE TABLES DEFINITION
-- =========================================================================

-- Admins Whitelist (emails whitelisted for Google OAuth Login)
create table if not exists admins (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  role text not null default 'Administrator',
  created_at timestamptz not null default now()
);

-- App Settings
create table if not exists settings (
  id uuid primary key default uuid_generate_v4(),
  expiry_days integer not null default 5,
  website_name text not null default 'Hostels Near DYPCET',
  maintenance_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Students Database
create table if not exists students (
  id uuid primary key default uuid_generate_v4(),
  student_id text unique not null default ('STU' || nextval('student_id_seq')::text),
  name text not null,
  mobile text unique not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected', 'Expired')),
  registration_date date not null default current_date,
  approval_date date,
  expiry_date date,
  last_login timestamptz,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hostels Database
create table if not exists hostels (
  id uuid primary key default uuid_generate_v4(),
  hostel_name text not null,
  owner_name text not null,
  gender text not null check (gender in ('Boys', 'Girls')),
  area text not null,
  phone text not null,
  maps text not null,
  photo text, -- Supabase Storage file reference path
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin Action Audit Logs
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  admin_email text not null,
  student_id text not null,
  student_name text not null,
  action text not null check (action in ('Approve', 'Reject', 'Reapprove', 'Delete', 'Expired')),
  action_details text,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- 2. PERFORMANCE INDEXES
-- =========================================================================
create index if not exists idx_students_mobile on students(mobile);
create index if not exists idx_students_status on students(status);
create index if not exists idx_hostels_area on hostels(area);
create index if not exists idx_hostels_gender on hostels(gender);

-- =========================================================================
-- 3. TIMESTAMP & METADATA TRIGGER MECHANISMS
-- =========================================================================
create or replace function update_modified_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger tg_students_updated_at before update on students for each row execute procedure update_modified_column();
create or replace trigger tg_hostels_updated_at before update on hostels for each row execute procedure update_modified_column();
create or replace trigger tg_settings_updated_at before update on settings for each row execute procedure update_modified_column();

-- =========================================================================
-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- Helper function to verify if the active Supabase token belongs to a whitelisted Admin
create or replace function is_admin()
returns boolean as $$
begin
  return (
    auth.role() = 'authenticated' and 
    exists (
      select 1 from admins 
      where lower(email) = lower(auth.jwt() ->> 'email')
    )
  );
end;
$$ language plpgsql security definer;

-- Enable RLS on all tables
alter table admins enable row level security;
alter table settings enable row level security;
alter table students enable row level security;
alter table hostels enable row level security;
alter table audit_logs enable row level security;

-- Admins Table policies
create policy admin_all_admins on admins for all using (is_admin());

-- Settings Table policies
create policy public_read_settings on settings for select using (true);
create policy admin_all_settings on settings for all using (is_admin());

-- Students Table policies
create policy admin_all_students on students for all using (is_admin());

-- Hostels Table policies
create policy admin_all_hostels on hostels for all using (is_admin());

-- Audit Logs policies
create policy admin_all_audit on audit_logs for all using (is_admin());

-- =========================================================================
-- 5. SECURE APIs (RPC FUNCTIONS)
-- =========================================================================

-- A. Register Student (RPC API)
-- Prevents duplicate mobile numbers, handles deletion of expired rows automatically
create or replace function register_student(
  p_name text,
  p_mobile text
) returns json as $$
declare
  v_existing_status text;
  v_existing_expiry date;
  v_new_id text;
begin
  p_mobile := trim(p_mobile);
  p_name := trim(p_name);
  
  -- Validation checks
  if length(p_mobile) != 10 then
    return json_build_object('success', false, 'message', 'Mobile number must be exactly 10 digits.');
  end if;
  if length(p_name) < 2 then
    return json_build_object('success', false, 'message', 'Name must be at least 2 characters long.');
  end if;

  select status, expiry_date into v_existing_status, v_existing_expiry
  from students where mobile = p_mobile;
  
  if found then
    if v_existing_status = 'Approved' then
      if v_existing_expiry is not null and current_date > v_existing_expiry then
        -- Automatically delete expired duplicate row to register fresh
        delete from students where mobile = p_mobile;
      else
        return json_build_object('success', false, 'status', 'Approved', 'message', 'You are already approved. Please login.');
      end if;
    elsif v_existing_status = 'Pending' then
      return json_build_object('success', false, 'status', 'Pending', 'message', 'Your registration is waiting for administrator approval.');
    elsif v_existing_status = 'Rejected' then
      return json_build_object('success', false, 'status', 'Rejected', 'message', 'Your registration has been rejected. Please contact administrator.');
    elsif v_existing_status = 'Expired' then
      delete from students where mobile = p_mobile;
    end if;
  end if;

  -- Add student record (student_id is auto-generated by the database sequence)
  insert into students (name, mobile, status)
  values (p_name, p_mobile, 'Pending')
  returning student_id into v_new_id;

  return json_build_object('success', true, 'status', 'Pending', 'message', 'Your request has been sent to Administrator. Please wait for approval.');
end;
$$ language plpgsql security definer;

-- B. Student Login (RPC API)
-- Validates details, auto-expires past approvals, and updates login logs
create or replace function login_student(
  p_name text,
  p_mobile text
) returns json as $$
declare
  v_student_id text;
  v_name text;
  v_status text;
  v_expiry date;
  v_today date := current_date;
begin
  p_mobile := trim(p_mobile);
  p_name := trim(p_name);

  select student_id, name, status, expiry_date into v_student_id, v_name, v_status, v_expiry
  from students where mobile = p_mobile;

  if not found then
    return json_build_object('success', false, 'message', 'Invalid Login Details.');
  end if;

  if lower(v_name) != lower(p_name) then
    return json_build_object('success', false, 'message', 'Invalid Login Details.');
  end if;

  if v_status = 'Approved' then
    if v_expiry is not null and v_today > v_expiry then
      update students set status = 'Expired' where student_id = v_student_id;
      return json_build_object('success', false, 'message', 'Your approval has expired. Please register again.');
    end if;

    -- Update last login
    update students set last_login = now() where student_id = v_student_id;

    return json_build_object(
      'success', true,
      'studentId', v_student_id,
      'name', v_name,
      'mobileNumber', p_mobile,
      'status', 'Approved',
      'expiryDate', to_char(v_expiry, 'YYYY-MM-DD')
    );
  elsif v_status = 'Pending' then
    return json_build_object('success', false, 'message', 'Your registration is waiting for administrator approval.');
  elsif v_status = 'Rejected' then
    return json_build_object('success', false, 'message', 'Your registration has been rejected. Please contact administrator.');
  elsif v_status = 'Expired' then
    return json_build_object('success', false, 'message', 'Your approval has expired. Please register again.');
  end if;

  return json_build_object('success', false, 'message', 'Invalid Login Details.');
end;
$$ language plpgsql security definer;

-- C. Fetch Hostels (RPC API)
-- Protects data access so only approved active students or admins can read hostel details
create or replace function get_hostels(
  p_student_id text,
  p_mobile text
) returns table (
  id uuid,
  hostel_name text,
  owner_name text,
  gender text,
  area text,
  phone text,
  maps text,
  photo text,
  description text
) as $$
begin
  if not exists (
    select 1 from students 
    where student_id = p_student_id 
      and mobile = p_mobile 
      and status = 'Approved' 
      and (expiry_date is null or expiry_date >= current_date)
  ) then
    if not is_admin() then
      raise exception 'Access Denied: You are not an approved student or administrator.';
    end if;
  end if;

  return query
  select h.id, h.hostel_name, h.owner_name, h.gender, h.area, h.phone, h.maps, h.photo, h.description
  from hostels h
  order by h.hostel_name asc;
end;
$$ language plpgsql security definer;

-- =========================================================================
-- 6. AUTOMATED AUDIT TRIGGER FOR ADMIN WRITES
-- =========================================================================

-- Trigger function for Status changes (Approve, Reject, Reapprove)
create or replace function log_admin_action()
returns trigger as $$
declare
  v_admin_email text;
begin
  v_admin_email := lower(coalesce(auth.jwt() ->> 'email', 'system'));
  
  if old.status <> new.status and new.status <> 'Expired' then
    insert into audit_logs (admin_email, student_id, student_name, action, action_details)
    values (
      v_admin_email,
      new.student_id,
      new.name,
      case 
        when new.status = 'Approved' and old.status = 'Expired' then 'Reapprove'::text
        when new.status = 'Approved' then 'Approve'::text
        when new.status = 'Rejected' then 'Reject'::text
        else new.status::text
      end,
      'Status updated from ' || old.status || ' to ' || new.status || 
      case when new.status = 'Approved' then ' (Expiry date: ' || new.expiry_date || ')' else '' end
    );
  end if;
  
  return new;
end;
$$ language plpgsql security definer;

-- Trigger function for student deletions
create or replace function log_admin_delete()
returns trigger as $$
declare
  v_admin_email text;
begin
  v_admin_email := lower(coalesce(auth.jwt() ->> 'email', 'system'));
  
  insert into audit_logs (admin_email, student_id, student_name, action, action_details)
  values (
    v_admin_email,
    old.student_id,
    old.name,
    'Delete',
    'Record deleted from students database.'
  );
  
  return old;
end;
$$ language plpgsql security definer;

-- Bind triggers to the students table
create or replace trigger tg_students_audit
after update on students
for each row
execute procedure log_admin_action();

create or replace trigger tg_students_delete_audit
after delete on students
for each row
execute procedure log_admin_delete();

-- =========================================================================
-- 7. SUPABASE STORAGE BUCKET POLICIES (hostel-photos)
-- =========================================================================

-- Insert bucket config if not exists
insert into storage.buckets (id, name, public)
values ('hostel-photos', 'hostel-photos', true)
on conflict (id) do nothing;

-- Allow public read access to objects inside the bucket
create policy "Public Read Access"
on storage.objects for select
using (bucket_id = 'hostel-photos');

-- Allow whitelisted admins to upload files
create policy "Admin Upload Access"
on storage.objects for insert
with check (bucket_id = 'hostel-photos' and is_admin());

-- Allow whitelisted admins to update files
create policy "Admin Update Access"
on storage.objects for update
using (bucket_id = 'hostel-photos' and is_admin())
with check (bucket_id = 'hostel-photos' and is_admin());

-- Allow whitelisted admins to delete files
create policy "Admin Delete Access"
on storage.objects for delete
using (bucket_id = 'hostel-photos' and is_admin());
