-- Havak — migration 002: what the FastAPI server needs on top of the base tables
--
-- Run once in the Supabase SQL editor, after sql/rls.sql. Safe to re-run.
--
-- Three things the base schema is missing:
--   1. password storage — auth moved from Supabase Auth to our own server
--   2. client_id columns — BACKEND.md section 8 promises idempotent inserts,
--      and there was nowhere to put the key that makes that work
--   3. the indexes the read paths actually hit

-- ---------------------------------------------------------------------------
-- 1. Passwords live here now, hashed
-- ---------------------------------------------------------------------------
-- BACKEND.md section 2 said "no password column, passwords live in the auth
-- system". With our own FastAPI server, this IS the auth system. The column
-- holds a bcrypt hash and never a password.

alter table users add column if not exists password_hash text;

-- ---------------------------------------------------------------------------
-- 2. Idempotency
-- ---------------------------------------------------------------------------
-- The app queues writes made in a forest with no signal and replays them on
-- reconnect. If a reply is lost the client retries, so the same logical insert
-- can arrive twice. The client generates a uuid per action; these indexes make
-- the second arrival a no-op instead of a duplicate report.

alter table reports   add column if not exists client_id uuid;
alter table claims    add column if not exists client_id uuid;
alter table donations add column if not exists client_id uuid;
alter table media     add column if not exists client_id uuid;

create unique index if not exists reports_client_id_key   on reports   (client_id) where client_id is not null;
create unique index if not exists claims_client_id_key    on claims    (client_id) where client_id is not null;
create unique index if not exists donations_client_id_key on donations (client_id) where client_id is not null;
create unique index if not exists media_client_id_key     on media     (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The one-active-claim guard
-- ---------------------------------------------------------------------------
-- Two cleaners tapping "claim" in the same second must produce exactly one
-- winner (invariant 3.1). The server also locks the report row, but this index
-- is the thing that makes it true regardless of what the server does.

create unique index if not exists one_active_claim on claims (report_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 4. Indexes for the read paths
-- ---------------------------------------------------------------------------

create index if not exists reports_status_created_idx on reports (status, created_at desc);
create index if not exists reports_reporter_idx       on reports (reporter_id);
create index if not exists claims_cleaner_idx         on claims (cleaner_id);
create index if not exists donations_donor_idx        on donations (donor_id);
create index if not exists donations_target_idx       on donations (target, created_at);
create index if not exists alloc_donation_idx         on alloc (donation_id);
create index if not exists alloc_report_idx           on alloc (report_id);
create index if not exists media_report_idx           on media (report_id);

-- ---------------------------------------------------------------------------
-- 5. The client no longer writes alloc
-- ---------------------------------------------------------------------------
-- rls.sql let the reporting user insert alloc rows, because back then the
-- browser was the only writer. Now confirm_and_pay on the server is the only
-- writer (invariant 3.4), so that permission is no longer needed by anyone.

drop policy if exists alloc_insert_by_reporter on alloc;

-- A note on RLS generally: the server connects as the database owner, which
-- bypasses every policy in rls.sql. That is expected — authorisation now lives
-- in FastAPI. Keep the policies anyway. They are the seatbelt if the publishable
-- key ever ships again, or if someone points a second client at this database.
