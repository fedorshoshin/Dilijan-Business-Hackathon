# How the Havak API is deployed

**Live at `https://130.51.22.253.nip.io:8443`** — verified 2026-09-28 with a
fully validated TLS chain, working CORS, and the database reachable through
`/health`.

| | |
| --- | --- |
| Host | a VPS at `130.51.22.253`, Ubuntu 24.04.4, nginx 1.24.0 |
| Code | `/root/Dilijan-Business-Hackathon` (this repo), venv at `server/.venv` |
| Process | `havak-api.service`, uvicorn on **127.0.0.1:8000** |
| Public entry | nginx, `:8443` HTTPS → `127.0.0.1:8000` |
| Certificate | certbot-managed, `130.51.22.253.nip.io`, ECDSA |
| Allowed origin | `https://fedorshoshin.github.io` |

Two files here are copies of what is installed on the box. Change them here,
then copy them across — do not let the two drift.

| File | Installed at |
| --- | --- |
| `nginx-havak-api.conf` | `/etc/nginx/sites-available/havak-api` (symlinked into `sites-enabled/`) |
| `havak-api.service` | `/etc/systemd/system/havak-api.service` |

## The constraint that shaped all of this: the box is not ours alone

This VPS already runs **n8n** in Docker, served by the same nginx on **port 443**
under the same hostname, with the certificate certbot manages for it. Every
decision below follows from not breaking that:

- **The API is on 8443, not 443.** A separate port means nginx never has to
  route between two apps in one server block, so a mistake in the API's config
  cannot take n8n offline. A path prefix on 443 was the alternative and was
  rejected: n8n serves its own API at `/api/v1`, so the names would collide.
- **The existing certificate is reused, not reissued.** `nip.io` is *not* on the
  Public Suffix List, so Let's Encrypt counts every `*.nip.io` certificate
  against one shared quota — which does get exhausted. There was already a valid
  certificate for this exact hostname; asking for another would have spent a
  shared resource for no gain.
- **`default_server` and the `default` site were left alone.** On this box the
  live app is the thing you would casually delete.
- **Reload, never restart.** `systemctl reload nginx` keeps n8n's connections up;
  a restart drops them. Always `nginx -t` first.

## Changing the config

```
scp nginx-havak-api.conf root@130.51.22.253:/etc/nginx/sites-available/havak-api
ssh root@130.51.22.253 'nginx -t && systemctl reload nginx'
```

`nginx -t` is not optional. It is the difference between a rejected config and
an outage for somebody else's application.

## Verifying it actually works

Run these from anywhere *except* the VPS — from on the box, loopback succeeds
even when the firewall or the certificate is wrong.

```
# 1. TLS chain and hostname must validate with no --insecure anywhere
curl -sS https://130.51.22.253.nip.io:8443/health          # {"ok":true}

# 2. exactly one allow-origin header, echoing the published site
curl -sS -D- -o /dev/null -X OPTIONS \
  -H 'Origin: https://fedorshoshin.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  https://130.51.22.253.nip.io:8443/auth/login | grep -i access-control-allow-origin

# 3. a stranger's origin must NOT be echoed
curl -sS -D- -o /dev/null -X OPTIONS -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: POST' \
  https://130.51.22.253.nip.io:8443/auth/login | grep -ci access-control-allow-origin

# 4. the old cleartext hole must stay shut
curl -sS --max-time 5 http://130.51.22.253:8000/health     # must refuse

# 5. n8n must still be alive
curl -sS -o /dev/null -w '%{http_code}\n' https://130.51.22.253.nip.io/   # 200
```

`{"ok":true}` means nginx, uvicorn **and** Postgres are all reachable — the
health check queries the database on purpose. Two `allow-origin` headers in
check 2 would mean nginx and FastAPI are both emitting CORS, and the browser
will reject every response.

## Things that will bite you

**`ALLOWED_ORIGINS` takes an origin, not a URL.** Scheme and host only:
`https://fedorshoshin.github.io`, *not*
`https://fedorshoshin.github.io/Dilijan-Business-Hackathon/`. A path or a
trailing slash makes every request fail CORS while the server logs a cheerful
200 for the preflight. This was wrong in production — left at the
`your-published-site.example` placeholder — and was why the client could not
have worked regardless of TLS.

**The hostname contains the IP address.** If the VPS's public IP ever changes,
the hostname changes, the certificate stops matching, and the client's base URL,
`ALLOWED_ORIGINS` and the nginx `server_name` all need updating together. Keep
the IP static, or plan to redo this.

**`.env` is not in git, so it is not backed up by git.** Copies live in
`/root/havak-deploy-backup/`. Losing `JWT_SECRET` logs out every user.

**Renewal touches port 80, which n8n's config owns.** certbot has been renewing
this certificate successfully already; leave that mechanism alone. Check it with
`certbot renew --dry-run` rather than assuming.

## Email

Delivered through Gmail SMTP with an App Password (since 2026-09-29). Settings
are the `SMTP_` lines in `server/.env`; both supported shapes are written out in
`server/.env.example`. If delivery fails, the link is written to the journal
instead of being lost:

    journalctl -u havak-api --since '-5 min' | grep -A12 'email/log'

**Do not try to deliver from this box's own Postfix.** Outbound 25/587/465 are all
open from here, so it would appear to work, and then land in spam: the address has
no SPF, no DKIM and no reverse DNS. Relay through something with a reputation.

## Photo storage: Cloudflare R2

Bucket `havak` on account endpoint `b11871fb….r2.cloudflarestorage.com`. The
server only signs URLs; phones upload and download directly. Two things must
both be true, and each fails differently:

| Missing | What you see |
| --- | --- |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` in `server/.env` | a warning at every start; the app says "File storage is not set up" |
| The bucket's CORS rule for `https://fedorshoshin.github.io` | the browser's PUT is blocked; photos stay "Waiting to upload" |

Check CORS from anywhere (a correct rule echoes the origin back):

```
curl -sS -D- -o /dev/null -X OPTIONS \
  -H 'Origin: https://fedorshoshin.github.io' \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type' \
  https://b11871fb3b06d70d513e65922be5a9cb.r2.cloudflarestorage.com/havak/x
```

## The database is on the wrong continent

Measured from the VPS on 2026-10-01, and this is the single biggest thing
between the pilot and a usable app:

| | |
| --- | --- |
| API server | Chicago, United States |
| Database | Supabase pooler, `aws-0-ap-south-1` (Mumbai) |
| TCP round trip | ~250 ms |
| One `select 1` | ~525 ms |
| Opening a connection | ~1.7 s |

Every query pays a trip to India and back, and a query costs *two* round trips
because `statement_cache_size=0` (the Supabase transaction pooler cannot keep
prepared statements). So an endpoint is as slow as its query count: claiming a
spot is seven queries — auth, `begin`, `select … for update`, the insert, the
update, `commit`, and the reload — and takes several seconds.

To reproduce:

```bash
server/.venv/bin/python - <<'EOF'
import asyncio, os, time, asyncpg
for l in open("server/.env"):
    if "=" in l and not l.startswith("#"):
        k, v = l.strip().split("=", 1); os.environ.setdefault(k, v)
async def main():
    con = await asyncpg.connect(os.environ["DATABASE_URL"], statement_cache_size=0)
    for _ in range(5):
        t = time.monotonic(); await con.fetchval("select 1")
        print("%.0f ms" % ((time.monotonic() - t) * 1000))
    await con.close()
asyncio.run(main())
EOF
```

What would actually fix it, best first:

1. **Put both in the same region, and make it Europe.** Frankfurt is ~60 ms from
   Yerevan and would serve Dilijan users far better than Chicago does. Supabase
   cannot move a project between regions, so this means a new project and a
   dump/restore of the six tables, plus a new `DATABASE_URL`.
2. **Same region, wherever that is.** Even leaving the server in Chicago, a
   `us-east` database turns 525 ms into about 30 ms.
3. **Connect directly (port 5432) rather than through the pooler (6543)** and
   drop `statement_cache_size=0`. That halves the round trips per query. Cheap,
   but it only halves a number that should be twenty times smaller, and direct
   connections are limited in number.

Nothing in the app can paper over this. What the client *does* do is avoid
trips it does not need: claiming a spot repaints from the reply the server
already sent instead of re-reading the whole board (`js/work.js`).

## Known weak spots, honestly

- **`nip.io` is a shared convenience whose availability is not ours.** Fine for
  a pilot; move to a domain we own before anything load-bearing. Cookies set on
  any `nip.io` host are also visible to every other one.
- **A pilot holding real users' data shares a host with an automation stack.**
  Worth separating before the pilot grows.
- **The API runs as root** out of `/root`, because that is where it was already
  cloned. A dedicated unprivileged user would be better.
- **`/docs` and `/openapi.json` are public.** Schema only, no data, but there is
  no reason for them to be reachable in production.
- **An upload that never finishes leaves a row with no file.** Phones retry from
  their outbox, but one that is wiped mid-upload never will. The app shows "Not
  uploaded" rather than a broken image; nothing sweeps these rows yet.
- **The rate limits are per-IP**, and Dilijan households share addresses through
  NAT. The tight zone (10r/m) covers login, signup and forgot; emailed links got
  their own looser zone precisely because the tight one punished the wrong people.
  If real users start seeing 429s, that is the first thing to widen.
