-- Havak — migration 001: the six tables everything else is built on
--
-- Run FIRST, in the Supabase SQL editor, then rls.sql, then 002, then 003.
-- Safe to re-run: every object is created with `if not exists`, so running this
-- against the live pilot database changes nothing.
--
-- Why this file exists at all, written after the fact: the base tables were
-- created by hand in the Supabase editor during the hackathon and never checked
-- in, so migrations 002 and 003 were patches against a schema that existed only
-- inside one cloud project. Losing that project meant losing the shape of the
-- data. This file was reconstructed from the live database on 2026-10-01 and
-- matches it column for column, including the column ORDER — 002 and 003 append
-- to these tables, so applying 001, 002 and 003 in order reproduces the live
-- schema exactly rather than merely an equivalent one.
--
-- Two deliberate omissions, because they belong to the later migrations and
-- repeating them here would make the chain lie about when things arrived:
--   * `password_hash`, `email_verified_at`, `tokens_valid_from` on users (002, 003)
--   * every `client_id` column and index, and `one_active_claim`             (002)

-- gen_random_uuid() in 003 comes from pgcrypto. Supabase enables it already;
-- this line is for anyone rebuilding on plain Postgres.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. users
-- ---------------------------------------------------------------------------
-- No password column here: at the time this table was designed, auth was
-- Supabase Auth's job. 002 is where that changed.
--
-- `roles` is an array rather than a join table because a person is routinely
-- more than one thing — the pilot has people who report AND clean — and the only
-- question ever asked of it is "does this user have role X", which an array
-- answers without a join. See DESIGN.md decision 2.
--
-- No default on `id`: the server generates uuid4 in Python for every insert, so
-- a database-side default would be dead weight that hides a missing id instead
-- of failing loudly.

create table if not exists users (
  id          uuid primary key,
  name        text not null,
  email       text not null unique,
  roles       text[] not null,
  place       text,
  avatar_key  text,
  joined_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. reports — a polluted spot somebody found
-- ---------------------------------------------------------------------------
-- `lat`/`lng` are where the spot really is. `loc_x`/`loc_y` are the same point
-- as a percentage of the illustrated map, worked out once on write (js/geo.js,
-- and `to_xy` in server/seed.py) so that drawing a pin never needs the
-- projection maths. Unconstrained `numeric` because these are coordinates, and
-- rounding them to fit a declared precision is a silent loss of position.
--
-- `est_minutes` and `payout` are stored, not computed on read: they are the
-- offer made to a cleaner at the moment they took the job on. If the formula
-- that produces them is ever retuned, work already claimed must keep the terms
-- it was claimed under.
--
-- `status` is the report's own lifecycle. A claim has its own separate status
-- (see claims below) — the two are not the same thing, which is why a report
-- that goes back on the board is 'open' again while the claim it came from
-- stays 'released' as a permanent record that it happened.

create table if not exists reports (
  id           uuid primary key,
  reporter_id  uuid not null references users (id),
  title        text not null,
  description  text not null,
  lat          numeric not null,
  lng          numeric not null,
  loc_x        numeric not null,
  loc_y        numeric not null,
  loc_label    text not null,
  level        int not null check (level between 1 and 5),
  hazardous    boolean not null default false,
  est_minutes  int not null,
  payout       int not null,
  status       text not null default 'open'
                 check (status in ('open', 'claimed', 'cleaned', 'confirmed')),
  rating       int check (rating between 1 and 5),
  disputed     boolean not null default false,
  created_at   timestamptz not null default now(),
  cleaned_at   timestamptz,
  confirmed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- 3. claims — one cleaner taking one report on
-- ---------------------------------------------------------------------------
-- A row per attempt, never updated in place to mean something else. A cleaner
-- who gives a job back leaves a 'released' row behind and the next cleaner gets
-- a new one, so "who has had this spot" is answerable later — which matters the
-- first time a dispute needs it.
--
-- Nothing here stops two cleaners holding the same report at once; the partial
-- unique index that does is in 002 (`one_active_claim`).

create table if not exists claims (
  id          uuid primary key,
  report_id   uuid not null references reports (id),
  cleaner_id  uuid not null references users (id),
  status      text not null check (status in ('active', 'done', 'released')),
  claimed_at  timestamptz not null default now(),
  cleaned_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- 4. donations — money in
-- ---------------------------------------------------------------------------
-- `amount` is whole drams in an int, never a float: money in a binary float is
-- a rounding bug waiting for a total to be taken. Dram has no subunit in
-- practice, so there is nothing to lose by having no decimal places.
--
-- `target` is free text — a report id, or the name of a pot like 'general'.
-- Loose on purpose at pilot stage, and the reason donations_target_idx in 002
-- indexes it as a plain string.

create table if not exists donations (
  id         uuid primary key,
  donor_id   uuid not null references users (id),
  amount     int not null check (amount > 0),
  target     text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. alloc — money out, as a ledger
-- ---------------------------------------------------------------------------
-- One row each time part of one donation is assigned to one cleaner for one
-- finished report. Rows are only ever inserted, so what a donation paid for is
-- reconstructed by summing them rather than by trusting a running balance that
-- could drift. A donation is spent when its allocations reach its amount.
--
-- `amount > 0` and nothing else: that a donation is never over-spent is
-- enforced by confirm_and_pay in server/payout.py inside a transaction, because
-- it is a statement about the sum of other rows and a CHECK cannot see those.

create table if not exists alloc (
  id          uuid primary key,
  donation_id uuid not null references donations (id),
  report_id   uuid not null references reports (id),
  cleaner_id  uuid not null references users (id),
  amount      int not null check (amount > 0),
  at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. media — the before and after photos
-- ---------------------------------------------------------------------------
-- The whole trust model is these two pictures: a 'before' is the claim that
-- something is wrong, an 'after' is the proof it was dealt with, and a reporter
-- confirms by comparing them. `kind` is checked to exactly those two so a third
-- category cannot quietly appear and go unshown by every screen.
--
-- `bucket_key` is the object's path in R2; the bytes are never in Postgres.
-- `report_id` is nullable because a photo is uploaded before the report it
-- belongs to exists — the phone gets the file up while there is signal, then
-- attaches it. That is also why an interrupted upload can leave a row pointing
-- at no object; sweeping those is still an open job (DESIGN.md known gaps).

create table if not exists media (
  id         uuid primary key,
  owner_id   uuid not null references users (id),
  report_id  uuid references reports (id),
  kind       text not null check (kind in ('before', 'after')),
  mime       text not null,
  bucket_key text not null,
  created_at timestamptz not null default now()
);
