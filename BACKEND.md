# Havak — backend contract

**Who owns what:** you build and host the server (Phase 3.5). I build the client
against this contract and swap `store.js` over to it when it is live.

This file is the agreement between the two. If the server matches what is
written here, the client will work without renegotiation. Where you disagree
with something, change *this file* and tell me — that is cheaper than
discovering the mismatch during integration.

Read alongside `DESIGN.md` section 5.

---

## 1. What I need from you to connect

**Settled 2026-09-25: our own FastAPI server, not direct-to-Supabase.** The
client talks only to the API; Supabase is the database and bucket store behind
it. Server code is in `server/`, deployed by you.

| | |
| --- | --- |
| Base URL | the deployed FastAPI origin — **still needed**, and must be HTTPS |
| Public/anon key | no longer used by the client; the API holds the secrets instead |
| Auth style | our own JWT endpoints (§5). Bearer token in `Authorization` |
| Storage style | signed upload URLs minted by the API (§6) |
| Naming | `snake_case` on the wire, matching the database. The client maps in `api.js` |

The only thing still outstanding to write `api.js` is the deployed base URL and
`ALLOWED_ORIGINS` set to the published site.

**Never send me the `service_role` key or any secret.** The frontend is static —
anything it holds is readable by anyone who opens the page source. If an
operation needs a secret, it belongs on the server, not in the client.

---

## 2. The five tables

Field names below are what the client sends and expects back. If you prefer
`snake_case` in the database, say so and I will map it in one place — just tell
me which convention wins so we are not each half-converting.

```sql
-- people
users (
  id          uuid primary key,          -- matches the auth user id
  name        text not null,
  email       text not null unique,
  roles       text[] not null,           -- any of 'reporter','cleaner','donor'
  place       text,
  avatar_key  text,                      -- path in the avatars bucket; null = initials
  joined_at   timestamptz not null default now()
)
-- NOTE: no password column. Passwords live in the auth system, never here.

-- a polluted spot
reports (
  id           uuid primary key,
  reporter_id  uuid not null references users(id),
  title        text not null,
  description  text not null,
  lat          numeric not null,         -- REAL position; what a cleaner navigates to
  lng          numeric not null,
  loc_x        numeric not null,         -- 0-100, where to draw it on the artwork
  loc_y        numeric not null,          --   (derived from lat/lng, stored for speed)
  loc_label    text not null,            -- human readable place
  level        int  not null check (level between 1 and 5),
  hazardous    boolean not null default false,
  est_minutes  int  not null,
  payout       int  not null,            -- AMD, fixed at report time
  status       text not null default 'open'
               check (status in ('open','claimed','cleaned','confirmed')),
  rating       int check (rating between 1 and 5),   -- set at confirmation
  disputed     boolean not null default false,
  created_at   timestamptz not null default now(),
  cleaned_at   timestamptz,
  confirmed_at timestamptz
)

-- a cleaner taking a job
claims (
  id          uuid primary key,
  report_id   uuid not null references reports(id),
  cleaner_id  uuid not null references users(id),
  status      text not null check (status in ('active','done','released')),
  claimed_at  timestamptz not null default now(),
  cleaned_at  timestamptz
)
-- at most ONE active claim per report:
create unique index one_active_claim on claims (report_id)
  where status = 'active';

-- money in
donations (
  id          uuid primary key,
  donor_id    uuid not null references users(id),
  amount      int  not null check (amount > 0),   -- AMD
  target      text not null,                      -- 'general' or a report id
  created_at  timestamptz not null default now()
)

-- money out: which donation paid for which cleanup
alloc (
  id           uuid primary key,
  donation_id  uuid not null references donations(id),
  report_id    uuid not null references reports(id),
  cleaner_id   uuid not null references users(id),
  amount       int  not null check (amount > 0),
  at           timestamptz not null default now()
)

-- media: rows hold KEYS, never bytes
media (
  id          uuid primary key,
  owner_id    uuid not null references users(id),
  report_id   uuid references reports(id),
  kind        text not null check (kind in ('before','after')),
  mime        text not null,
  bucket_key  text not null,             -- path in the storage bucket
  created_at  timestamptz not null default now()
)
```

---

## 3. Invariants the server must enforce

The client also checks these, for fast feedback. **That is not security** — a
client check is a courtesy to the user, and anyone can bypass it. These must
hold in the database.

1. A report may be claimed **only when `status = 'open'`**. Two cleaners tapping
   "claim" at the same second must produce exactly one winner. The partial
   unique index above does this; the loser must get a clear error, not a crash.
2. Only the **claiming cleaner** may move a report `claimed → cleaned`.
3. Only the **reporting user** may move a report `cleaned → confirmed`, and only
   they may set `rating`.
4. `alloc` rows are **never written by the client**. Only the payout function
   (§4) writes them.
5. `donations` are insert-only. No client may edit or delete one after the fact.
6. A user may only edit **their own** `users` row, and may never edit `roles` of
   another user.
7. `payout` is fixed when the report is created and never edited afterwards.
8. `lat`/`lng` are the truth for a report's position; `loc_x`/`loc_y` are a
   derived display convenience. If they ever disagree, lat/lng wins.

## 4. The two operations that cannot live in the client

Everything else is plain row reads and writes. These two are not.

```
claim_report(report_id) -> { ok, claim } | { ok:false, reason:'already_claimed' }
```
Atomic. Checks the report is `open`, creates the claim, sets the report to
`claimed`, all in one transaction.

```
confirm_and_pay(report_id, rating) -> { ok, allocations[] }
```
Runs when the reporter confirms. Sets `status='confirmed'`, stores the rating,
then draws down the payout and writes `alloc` rows:

- **earmarked donations first** — those whose `target` is this report id,
- **then the general pot, oldest first (FIFO)**,
- stopping when `payout` is covered.

If the pot cannot cover it, allocate what exists and return the shortfall; do
not fail the confirmation. A cleaned riverbank is still cleaned.

If `rating <= 2`, set `disputed = true` and **do not allocate** — a human
decides. (`DESIGN.md` task 5.4.)

This function is the single most important thing on the server. It is what makes
the donor dashboard honest instead of a pie chart, and it must be the only
writer of `alloc`.

---

## 5. Auth

The client needs:

- sign up with name, email, password, roles → returns a session
- log in with email, password → returns a session
- log out
- a session that survives an app relaunch (token in localStorage is fine)
- the current user's id and profile, readable synchronously after boot

**Passwords must be hashed server-side.** The current build stores them in plain
text on the device and says so on screen; that notice comes out the day this
lands, because it stops being true.

If you use Supabase Auth, the `users` row should be created by a trigger on
signup so a user can never exist without a profile.

## 6. Media

Rows hold `bucket_key`; bytes live in the bucket. The client needs either:

- **signed upload URLs** — client asks the server for one, PUTs the file
  directly. Preferred: bytes never pass through your API.
- or direct upload with the anon key, with bucket policies restricting writes to
  the signed-in user's own folder.

Reads should be signed URLs with a sensible expiry, or a public bucket if you
decide report photos are public. Tell me which — it changes how the client
caches them offline.

Expect photos around 200–800 KB after client-side downscaling, and videos up to
~50 MB. The client caps count and size before upload.

**Profile pictures** are a second, separate bucket (`avatars`), not the report
media table: one row per user, overwritten on change, referenced by
`users.avatar_key`. Keep it **public-read** even if report media is signed — an
avatar appears next to every name on every list, and re-signing dozens of URLs
per screen is a cost with no privacy gained. Writes restricted to the owner's
own path. The client downscales to 256×256 before upload, so these are ~20 KB.

## 7. Errors

One shape, always, so the client can show something useful:

```json
{ "error": { "code": "already_claimed", "message": "Someone else took this spot." } }
```

Codes the client handles specifically:
`already_claimed`, `not_authorised`, `not_found`, `validation_failed`,
`storage_quota`. Anything else shows a generic failure and is logged.

---

## 8. Offline

The client queues writes made with no signal and replays them on reconnect, so
the server will sometimes receive an action minutes or hours late.

Two things I need from you for that to be safe:

1. **Idempotency.** The client sends a `client_id` (a uuid it generates) on every
   insert. If the same `client_id` arrives twice — because a reply was lost and
   the client retried — the second must be ignored, not duplicated.
2. **Server time wins.** `created_at` is set by the server, not the client. A
   phone with a wrong clock must not reorder the ledger.

The one real conflict is two cleaners claiming the same report while one is
offline. The database decides (§3.1) and the client tells the loser plainly.

---

## 9. Still open

### Settled 2026-09-25

- **Our own FastAPI server** (§1). Built in `server/`, routes listed in
  `server/README.md`.
- **`snake_case`** on the wire. The client maps in one place.
- **Report photos are signed, avatars are public.** A report photo carries the
  GPS of a real place; an avatar appears beside every name on every list and
  signing dozens per screen buys no privacy. Offline caching therefore stores
  report media as blobs in IndexedDB, not as URLs — a signed URL expires
  (`READ_URL_TTL`, 6 hours) and a cached one would break.
- **Passwords** are bcrypt hashes in `users.password_hash`, added by
  `sql/002_server.sql`. The "passwords are not secure" notice comes off the
  screen when the client cuts over.
- **Idempotency** needed a column the original schema did not have. `client_id`
  is now on `reports`, `claims`, `donations` and `media`, each with a unique
  index, so a replayed offline write returns the original row instead of
  duplicating it.

### Still open

- **The deployed base URL.** Blocks `api.js`.
- **Who owns deletion requests?** Real names, photos and GPS of real people.
  `DESIGN.md` open decision #7 — not a coding task, but it blocks going live.
- **Do you want PostGIS?** The client sorts the cleaner's board by distance. It
  can do that in JavaScript over a small result set, but if Dilijan grows past a
  few hundred open reports, a `geography` column with a spatial index is the
  right answer. Cheap to add now, awkward later.
