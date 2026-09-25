# Havak API — FastAPI server

The static PWA has no backend of its own. This is that backend: FastAPI in front
of the Supabase Postgres database and its storage buckets.

Endpoints implement `BACKEND.md`. If you change a route shape, change that file
too — the client is written against it.

## Layout

| File | Holds |
| --- | --- |
| `main.py` | app, CORS, health check, router wiring |
| `db.py` | asyncpg pool and three query helpers |
| `security.py` | bcrypt password hashing, JWT sessions, `current_user` |
| `errors.py` | the single error shape the client switches on |
| `models.py` | request body validation |
| `payout.py` | `confirm_and_pay` — the donation draw-down |
| `storage.py` | signed upload/read URLs for the two buckets |
| `routers/` | `auth`, `reports`, `money`, `media` |

## Before first run

1. **Run the migrations**, in order, in the Supabase SQL editor:
   `../sql/rls.sql`, then `../sql/002_server.sql`.
2. **Create two storage buckets** (Storage → New bucket):
   - `report-media` — **not** public. Reads are signed.
   - `avatars` — **public**. An avatar renders beside every name on every list.

   Leave their policies empty. Only this server holds the service key, so
   nothing else can write to them.
3. **Fill in `.env`** from `.env.example`. All secrets, none of it reaches the
   browser.

## Run

```
pip install -r requirements.txt
uvicorn server.main:app --host 0.0.0.0 --port $PORT
```

Run it from the *project root*, not from inside `server/` — the imports are
package-relative (`server.main`). Interactive docs at `/docs`, health check at
`/health`.

For a service manager, one worker is plenty for a pilot:

```
uvicorn server.main:app --host 0.0.0.0 --port 8000 --workers 1 --proxy-headers
```

`--proxy-headers` matters behind nginx or a platform router, otherwise logged
client IPs are all the proxy.

## Two things that will bite you on deploy

**HTTPS is mandatory, not a nicety.** The published site is HTTPS, so a browser
refuses to call an HTTP API from it — mixed content is blocked outright. Put the
server behind TLS (Caddy or nginx + certbot, or a platform that terminates it
for you). An HTTP-only API will look like "the app is broken" with nothing but a
console error to show why.

**`ALLOWED_ORIGINS` must list the published site exactly.** Scheme and host, no
trailing slash, no path. Get it wrong and every request fails CORS while the
server logs a cheerful 200 for the preflight. This is the single most common
reason a working API appears dead from the browser.

## The endpoints

| | |
| --- | --- |
| `POST /auth/signup` | name, email, password, roles → `{token, user}` |
| `POST /auth/login` | email, password → `{token, user}` |
| `POST /auth/logout` | stateless; the client drops the token |
| `GET /me` · `PATCH /me` | own profile; patch takes name, place, roles, avatar_key |
| `GET /users/{id}` | another person's public profile — no email |
| `GET /reports` | `?status=` `?reporter_id=` — all spots |
| `POST /reports` · `GET /reports/{id}` · `DELETE /reports/{id}` | delete only while `open` |
| `POST /reports/{id}/claim` | atomic; one winner |
| `POST /reports/{id}/release` | hand the job back |
| `POST /reports/{id}/cleaned` | claiming cleaner only |
| `POST /reports/{id}/confirm` | reporter only; rates and pays |
| `GET /claims/mine` | the cleaner's board |
| `POST /donations` · `GET /donations/mine` | insert-only; `mine` shows what each donation bought |
| `GET /pot` | platform totals, nobody's individual giving |
| `GET /reports/{id}/allocations` · `GET /me/earnings` | the ledger, both directions |
| `POST /media/upload-url` → PUT → `GET /reports/{id}/media` | bytes go straight to the bucket |
| `POST /me/avatar/upload-url` · `DELETE /me/avatar` | one avatar per user, overwritten |

Every route except `/health` needs `Authorization: Bearer <token>`.

## What is deliberately not here

No endpoint writes `alloc` — only `payout.confirm_and_pay` does (invariant 3.4).
No endpoint edits or deletes a donation (3.5). No endpoint sets `payout` after a
report is created (3.7). If the client needs one of those, the invariant is
wrong and `BACKEND.md` should change first.

Donation *amounts* are still whatever the client sends, because card processing
is out of scope and the money is simulated. That is the one honest gap: the
ledger is internally consistent, but nobody checked that a donor really paid.
Attaching a payment provider means the amount comes from the provider's webhook
instead of the request body.
