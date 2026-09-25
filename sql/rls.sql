-- Havak — row level security for the pilot
--
-- Run once in the Supabase SQL editor. Safe to re-run: every policy is dropped
-- before it is created.
--
-- Why this file exists: the frontend is static, so the publishable key it ships
-- is readable by anyone who opens the page source. That key is not a secret and
-- was never meant to be one. These policies are the only thing deciding what it
-- can do. See DESIGN.md 5.3.
--
-- The rule behind every policy below: a signed-in person may read what the app
-- needs to show them, and may only write rows that are their own.

-- ---------------------------------------------------------------------------
-- 1. Turn it on
-- ---------------------------------------------------------------------------

alter table users     enable row level security;
alter table reports   enable row level security;
alter table claims    enable row level security;
alter table donations enable row level security;
alter table alloc     enable row level security;
alter table media     enable row level security;

-- Nobody signed out touches anything. The app requires an account, so the
-- anonymous role has no business in these tables at all.
revoke all on users, reports, claims, donations, alloc, media from anon;

-- ---------------------------------------------------------------------------
-- 2. users — your own row, and nobody else's
-- ---------------------------------------------------------------------------
-- This table holds real names, emails and home places of real Dilijan people.
-- Emails never leave this table: other people's names are served by the
-- users_public view below, which does not expose email.

drop policy if exists users_select_own on users;
create policy users_select_own on users
  for select to authenticated
  using (id = auth.uid());

drop policy if exists users_insert_own on users;
create policy users_insert_own on users
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists users_update_own on users;
create policy users_update_own on users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy: account deletion is a support action (decision #7), not
-- something the client does on its own.

-- What everyone else is allowed to see about a person: enough to render a name
-- and a face next to a report. No email, ever.
--
-- security_invoker stays off (the default), so the view runs as its owner and
-- reads past the policy above. That is the point of it.
create or replace view users_public as
  select id, name, place, roles, avatar_key, joined_at
  from users;

revoke all on users_public from anon;
grant select on users_public to authenticated;

-- ---------------------------------------------------------------------------
-- 3. reports — everyone reads, the author writes, the active cleaner updates
-- ---------------------------------------------------------------------------
-- A cleaner has to browse spots they did not report, so reads are open to any
-- signed-in user. Nothing here is private: a polluted riverbank is a public
-- fact, and making it visible is the whole product.

drop policy if exists reports_select_all on reports;
create policy reports_select_all on reports
  for select to authenticated
  using (true);

drop policy if exists reports_insert_own on reports;
create policy reports_insert_own on reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- Two people legitimately change a report: the reporter (confirms and rates it)
-- and whoever currently holds the active claim (marks it cleaned).
drop policy if exists reports_update_involved on reports;
create policy reports_update_involved on reports
  for update to authenticated
  using (
    reporter_id = auth.uid()
    or exists (
      select 1 from claims c
      where c.report_id = reports.id
        and c.cleaner_id = auth.uid()
        and c.status = 'active'
    )
  )
  with check (
    reporter_id = auth.uid()
    or exists (
      select 1 from claims c
      where c.report_id = reports.id
        and c.cleaner_id = auth.uid()
        and c.status = 'active'
    )
  );

-- Withdrawing a report is only fair while nobody has started work on it.
drop policy if exists reports_delete_own_open on reports;
create policy reports_delete_own_open on reports
  for delete to authenticated
  using (reporter_id = auth.uid() and status = 'open');

-- ---------------------------------------------------------------------------
-- 4. claims — visible to all, written by the cleaner taking the job
-- ---------------------------------------------------------------------------
-- Reads stay open because a reporter needs to see who claimed their spot, and
-- the reports policy above reads this table to decide who may update a report.

drop policy if exists claims_select_all on claims;
create policy claims_select_all on claims
  for select to authenticated
  using (true);

drop policy if exists claims_insert_own on claims;
create policy claims_insert_own on claims
  for insert to authenticated
  with check (cleaner_id = auth.uid());

drop policy if exists claims_update_own on claims;
create policy claims_update_own on claims
  for update to authenticated
  using (cleaner_id = auth.uid())
  with check (cleaner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5. donations — private to the donor, and append-only
-- ---------------------------------------------------------------------------
-- How much someone gave is their business. Totals that the app shows publicly
-- come from the pot view below, which sums without revealing who gave what.

drop policy if exists donations_select_own on donations;
create policy donations_select_own on donations
  for select to authenticated
  using (donor_id = auth.uid());

drop policy if exists donations_insert_own on donations;
create policy donations_insert_own on donations
  for insert to authenticated
  with check (donor_id = auth.uid());

-- No update, no delete: a ledger you can edit is not a ledger.

-- ---------------------------------------------------------------------------
-- 6. alloc — the traceability ledger: readable by all, written on confirmation
-- ---------------------------------------------------------------------------
-- "What did my money buy" only works if allocations are readable. Amounts and
-- report ids are not sensitive; who donated is not stored here.

drop policy if exists alloc_select_all on alloc;
create policy alloc_select_all on alloc
  for select to authenticated
  using (true);

-- Money may only be allocated against a report by the person who reported it,
-- at the moment they confirm the work. This is a guard rail, not a vault — see
-- the note at the bottom of this file.
drop policy if exists alloc_insert_by_reporter on alloc;
create policy alloc_insert_by_reporter on alloc
  for insert to authenticated
  with check (
    exists (
      select 1 from reports r
      where r.id = alloc.report_id
        and r.reporter_id = auth.uid()
    )
  );

-- No update, no delete.

-- ---------------------------------------------------------------------------
-- 7. media — rows hold keys, never bytes
-- ---------------------------------------------------------------------------

drop policy if exists media_select_all on media;
create policy media_select_all on media
  for select to authenticated
  using (true);

drop policy if exists media_insert_own on media;
create policy media_insert_own on media
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists media_delete_own on media;
create policy media_delete_own on media
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. The pot — public totals without exposing individual donations
-- ---------------------------------------------------------------------------

create or replace view pot as
  select
    (select coalesce(sum(amount), 0) from donations) as donated,
    (select coalesce(sum(amount), 0) from alloc)     as allocated;

revoke all on pot from anon;
grant select on pot to authenticated;

-- ---------------------------------------------------------------------------
-- What this does NOT protect against
-- ---------------------------------------------------------------------------
-- Every policy above answers "is this row yours?". None of them answers "is
-- this value honest?". A user who opens the console can still:
--
--   * insert a donation saying they gave 1,000,000 AMD without paying,
--   * set an inflated payout on their own report,
--   * rate their own spot five stars.
--
-- That is acceptable for this pilot precisely because card processing is out of
-- scope and the money is simulated (DESIGN.md section 3). It stops being
-- acceptable the day a real payment provider is attached. The fix then is to
-- move donations and allocations into SECURITY DEFINER functions, so the amount
-- is decided by the server rather than sent by the client.
