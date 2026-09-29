-- Havak — migration 003: verified email addresses and password resets
--
-- Run once in the Supabase SQL editor, after sql/002_server.sql. Safe to re-run.
--
-- Until now an account could claim any email address and a forgotten password
-- meant a permanently locked-out user with no way back in. This adds both halves:
-- a one-time link that proves control of an inbox, and a one-time link that sets
-- a new password.

-- ---------------------------------------------------------------------------
-- 1. Has this address been proven?
-- ---------------------------------------------------------------------------
-- Null means unverified. A timestamp rather than a boolean because "when" is
-- worth knowing later (an address verified before a dispute is evidence; a bare
-- true is not) and it costs the same to store.

alter table users add column if not exists email_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Making a password reset actually end the old sessions
-- ---------------------------------------------------------------------------
-- Sessions are stateless JWTs, so there has never been anything to revoke: a
-- stolen token stayed good for its full 60 days even after the owner changed
-- their password. That makes a reset half-useless against the case it exists
-- for — somebody else is in your account.
--
-- This column is the cheap fix. Every token carries an `iat` (issued-at) claim
-- already, so security.current_user can simply refuse any token issued before
-- this moment. Resetting a password sets it to now, which logs out every device
-- at once. Setting it by hand for one user is a per-account revoke; there is no
-- sessions table to maintain.
--
-- Truncated to the second on write, because `iat` has whole-second precision:
-- comparing a truncated claim against a microsecond timestamp would reject the
-- very token that was just issued.

alter table users add column if not exists tokens_valid_from timestamptz
  not null default date_trunc('second', now());


-- ---------------------------------------------------------------------------
-- 3. The links themselves
-- ---------------------------------------------------------------------------
-- token_hash, never the token. The raw value exists in exactly two places: the
-- email that was sent, and the URL the user clicks. A leaked dump of this table
-- lets nobody reset anybody's password, which is not true if you store the token
-- itself — it would be a table of live skeleton keys.

create table if not exists email_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  kind        text not null check (kind in ('verify', 'reset')),
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- The lookup every click performs. Unique: a hash collision here would mean one
-- link opening two accounts.
create unique index if not exists email_tokens_hash_key on email_tokens (token_hash);

-- Supports both "has this user asked very recently?" (the throttle that stops
-- someone being mail-bombed by repeated forgot-password requests) and the sweep
-- that retires a user's other outstanding links once one of them is used.
create index if not exists email_tokens_user_kind_idx
  on email_tokens (user_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Don't sign existing accounts out
-- ---------------------------------------------------------------------------
-- The default on tokens_valid_from is `now()`, which is right for an account being created but
-- wrong for one that already exists: applying this migration would have declared
-- every token ever issued too old, signing every user out for no reason. Wind
-- existing accounts back to the day they joined, which is the honest statement
-- that nothing has been revoked for them yet.
--
-- Safe to re-run: once wound back, tokens_valid_from is no longer greater than
-- joined_at so the row stops matching. The not-exists guard means a genuine past
-- reset is never undone.

update users
   set tokens_valid_from = date_trunc('second', joined_at)
 where joined_at is not null
   and tokens_valid_from > joined_at
   and not exists (
     select 1 from email_tokens t
      where t.user_id = users.id and t.kind = 'reset' and t.used_at is not null
   );

-- ---------------------------------------------------------------------------
-- 5. Housekeeping
-- ---------------------------------------------------------------------------
-- Nothing expires rows automatically. Used and expired tokens are harmless —
-- they are dead hashes — but they accumulate, so a monthly sweep is reasonable:
--
--   delete from email_tokens where expires_at < now() - interval '30 days';
--
-- Left as a documented manual step rather than a pg_cron job: on a pilot this
-- table gains a few rows a week, and an unattended DELETE is a worse thing to
-- get wrong than a table with some dead hashes in it.
