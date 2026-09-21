# Havak MVP — Design Doc

**Status:** in build · **Date:** 2026-09-21
**Context:** 3rd place at the Dilijan Business Hackathon; invited to build a real MVP.
**Target:** a **pilot** — real Dilijan users on their own phones, with every core
feature actually working. Delivered as an installable, offline-capable mobile
app, built so it can be wrapped for the app stores later without a rewrite.

The hackathon build (`index.html` + `app.js`) is a one-page desktop-ish demo with
a single hardcoded user. The MVP is a different shape: a phone app with real
accounts, three roles, three dashboards, and money that can be traced from donor
to cleaned riverbank.

---

## 1. What we are building

Three people, one loop:

```
  REPORTER  ──reports a polluted spot──▶  CLEANER  ──claims it, cleans it──┐
      ▲                                                                    │
      │                                                                    ▼
      └──────confirms + rates 1–5──────────────────────────  cleaner gets paid
                                                                       ▲
                                    DONOR ──money──▶ [ platform pot ] ──┘
                                                          │
                                                          └─▶ "what did my money buy?"
```

The loop only closes if all three sides exist. That is why the MVP is three
roles and not one.

---

## 2. How "mobile app" gets delivered

Three routes exist. Only one of them ships this month.

| Route | What it gives | Cost to get there | Verdict |
| --- | --- | --- | --- |
| **A. PWA** — installable web app | Home-screen icon, own window with no browser chrome, splash screen, offline, camera, GPS, storage that survives | Builds and publishes today on our current hosting | **Build this now** |
| **B. Capacitor wrapper** | Everything in A, plus a real `.ipa`/`.apk` in the App Store and Play Store, native camera, push | Same codebase, wrapped. Needs a Mac/build machine, Apple ($99/yr) + Google ($25) developer accounts, review cycles | **Build this next**, once we want store presence |
| **B-lite. TWA** — PWA published to Play Store | Everything in A, plus a real Play Store listing and install count. Android only | Generated from the PWA by PWABuilder/Bubblewrap, **no code changes**. Google account ($25), about a day | **Cheapest store badge** if Android is enough |
| **C. Native rewrite** (Swift / Kotlin / React Native) | Marginally smoother in places | Throws away the web app; two codebases; months | **No.** Nothing on the MVP list needs it |

**Decided 2026-09-21: route A is the deliverable for this milestone.**
No store listing required. B-lite stays on the shelf as the cheap option.

**The plan: A now, B when you want store listings.** This is not a compromise —
Capacitor *runs the exact PWA* inside a native shell. Every hour spent on Phase
0–7 counts toward the store build. Route C is the only one that wastes work, and
nothing on your requirements list justifies it.

**What this means practically.** Users open a link, tap "Add to Home Screen",
and get an icon that launches full-screen with no address bar. It takes photos
and video, works in a Dilijan forest with no signal, and remembers everything.
For an investor demo and for real Dilijan pilot users, that is an app.

**Being straight about the two gaps:**

1. **No store listing yet.** No "download on the App Store" badge until we do
   route B. Agreed as fine for this milestone; B-lite reopens it cheaply.
2. **iOS storage eviction.** Safari clears data for *uninstalled* web apps after
   ~7 days of no use. Once the user adds it to the home screen this stops. So
   the install prompt isn't polish, it's a data-retention feature — which is why
   it's Phase 0, not Phase 7.

---

## 3. Constraints (these shape everything)

| Constraint | Consequence |
| --- | --- |
| **Phone first, always** | Every screen designed at 390 px. Desktop is the afterthought, not the reverse. |
| Published as **static files**, no server *we* host | No Node process, no build step. The frontend is static; it calls a hosted backend (section 5) over HTTPS. |
| `index.html` must stay the homepage | Root becomes the install/landing page; the app lives behind it. |
| **Any API key we ship is public** | Security lives in database policies, not in hiding keys. See 5.3. |
| localStorage caps at ~5 MB | Structured data only. **Media goes to a storage bucket**, cached in IndexedDB. |
| Payment processing out of scope | Donations are simulated end to end. The *ledger* is real; the card charge is not. |

**The one thing still genuinely missing:** payment processing. Money moves in
the ledger, so every screen is truthful about who is owed what, but no card is
charged and no cleaner is actually paid out. That needs a payment provider and
a legal entity to receive funds — a business decision, not a technical one.

---

## 4. Architecture

```
index.html             landing + "install the app" page
app.html               the app shell — hash-routed, full-screen
manifest.webmanifest   name, icons, theme colour, display:standalone
sw.js                  service worker: offline cache of shell + assets
icons/                 192/512 px PWA icons, maskable variants
style.css              one stylesheet, existing tokens, extended
js/store.js            the ONLY data layer the views know about (async)
js/api.js              backend client — swapped in behind store.js at Phase 3.5
js/sync.js             offline write queue + replay on reconnect (5.4)
js/media.js            blob put/get — IndexedDB, then the storage bucket
js/auth.js             signup / login / logout / session / route guard
js/router.js           hash router  (#/feed #/report #/board #/give #/me)
js/geo.js              real coordinates <-> positions on the drawn map
js/map.js              the Dilijan map: pins, tap-to-place
js/money.js            the payout formula, and later the allocation ledger (7.2)
js/views/*.js          one file per screen
```

**`store.js` is the seam.** No view file ever touches `localStorage`, Supabase
or IndexedDB directly. That is what makes the Phase 3.5 cutover a one-file
change instead of a rewrite.

Plain scripts in IIFEs under a small `Havak.*` namespace — matching the existing
`app.js` style. No build step, because a build step cannot run at serve time.

Hash routing (`app.html#/board`) rather than paths: deep links never 404 on
static hosting, and it survives the Capacitor wrapper unchanged.

### 4.1 What makes it feel native rather than like a website

These are requirements, not decoration — they are the difference between "a
site on my phone" and "an app".

- **Bottom tab bar**, thumb-reachable, 5 tabs max, 56 px tall, persistent.
- **`display: standalone`** — no address bar, own app switcher entry.
- **Safe-area insets** (`env(safe-area-inset-*)`) so nothing hides under the
  iPhone notch or home indicator.
- **No page reloads, ever.** Route changes are instant; screens slide in with
  eased 200 ms transitions.
- **Sheets slide up from the bottom** and are swipe-dismissable, as they already
  do in the hackathon build.
- **Native inputs**: `capture="environment"` straight to the camera,
  `inputmode="decimal"` for amounts, correct keyboard per field.
- **Tap targets ≥44 px**, `touch-action` set so taps never wait 300 ms.
- **No hover-dependent UI** — there is no cursor on a phone.
- **Offline-first**: the shell loads with no network; writes are local anyway.
- **Optimistic feedback**: every tap responds inside 100 ms, even mid-save.

### 4.2 Data model

Five collections. Today they are arrays under one localStorage key
(`havak-mvp-v1`); from Phase 3.5 they are Postgres tables with the same shape.

```js
users:    [{ id, name, email, pass, roles:[], place, joinedAt, avatarSeed }]
session:  { userId } | null

reports:  [{ id, reporterId, title, desc,
             loc:{ lat, lng, x, y, label },   // real position; x/y derived for the
                                       //   drawn map; label for a human
             level: 1..5,              // how bad it is
             hazardous: bool,          // chemicals, sharps, asbestos…
             estMinutes: int,          // reporter's estimate
             media: [mediaId],
             status: 'open'|'claimed'|'cleaned'|'confirmed',
             createdAt, payout }]

claims:   [{ id, reportId, cleanerId, claimedAt, cleanedAt,
             proofMedia:[mediaId], status }]

donations:[{ id, donorId, amount, target:'general'|<reportId>, createdAt, spent }]

alloc:    [{ id, donationId, reportId, cleanerId, amount, at }]
```

Media blobs live in IndexedDB keyed by `mediaId`, never in localStorage.

### 4.3 Report lifecycle — the single source of truth

```
 open ──claim──▶ claimed ──mark cleaned──▶ cleaned ──reporter confirms──▶ confirmed
   ▲                 │                                      │
   └──── unclaim ────┘                          rating 1–5 stored here
                                                            │
                                            payout allocated to cleaner
```

Every screen derives what it shows from this one status field. No screen keeps
its own idea of state.

---

## 5. The backend (pilot requirement)

**Decided 2026-09-21: this milestone is a pilot, not a demo.** Real Dilijan
reporters and cleaners install it on their own phones and must see each other's
work. That makes a shared backend mandatory, not optional.

### 5.1 What changes, and what does not

The five collections in 4.2 stay exactly as they are. They become Postgres
tables instead of arrays in localStorage. Nothing about the report lifecycle,
the roles, or the money ledger changes.

Two seams were built for precisely this swap:

- **No view touches storage.** Every read and write goes through `store.js`, so
  the backend swap is one file, not thirty.
- **Reports hold `media: [mediaId]`, never image bytes.** Keys here, blobs
  elsewhere. That is already the S3 shape — we only change which bucket the
  keys point into.

### 5.2 Supabase, and why

Postgres, authentication and blob storage in one service, with a JS client that
works from a static page with **no build step** — which we require, because we
have no build step. Free tier covers a Dilijan pilot comfortably.

| Concern | Today | Pilot |
| --- | --- | --- |
| Users | localStorage, plain-text passwords | Supabase Auth, properly hashed |
| The five collections | localStorage arrays | Postgres tables |
| Photos and video | IndexedDB on the phone | Storage bucket; keys in the row |
| Two phones see each other | ❌ | ✅ |

### 5.3 The static-frontend security problem — read this one

A static app's API key is visible to anyone who opens the page source. This is
not a Supabase flaw; it is what "no server" means. Supabase is designed for it:
the `anon` key is *meant* to be public, and safety comes entirely from **Row
Level Security** policies enforced inside Postgres.

**Get RLS wrong and the database is world-readable and world-writable.** The
policies are the security model, so they are a deliverable with their own tests,
not a checkbox:

| Table | Who may read | Who may write |
| --- | --- | --- |
| `users` | own row + public profile fields of others | own row only |
| `reports` | any signed-in user | reporter owns it; only the claiming cleaner may set `cleaned`; only the reporter may set `confirmed` |
| `claims` | any signed-in user | cleaner creates own; **only if the report is still `open`** |
| `donations` | own rows only | own rows only, never editable after insert |
| `alloc` | donor of the donation, and the paid cleaner | server-side only, never the client |

Two of these carry real money logic and **cannot be trusted to the client**:
claiming a report (two cleaners must not claim the same spot) and writing
allocations. Both become Postgres functions with `security definer`, so the
rules live in the database where the client cannot route around them.

### 5.4 Offline, which is the genuinely hard part

Today offline is trivial: the phone *is* the database. Once truth lives on a
server, "works in a forest with no signal" means queuing writes and resolving
conflicts on reconnect. This is more work than the backend wiring itself.

Scoped honestly for a pilot:

- **Reads** — cache the last sync in IndexedDB, show it with an "offline" mark.
- **Writes** — queue locally and replay on reconnect. A report written with no
  signal appears in the app straight away, marked *pending*, and syncs later.
- **Conflicts** — one real case: two cleaners claim the same report while one is
  offline. The database decides (the claim function is atomic) and the loser is
  told plainly, rather than silently losing their work.

Everything else is single-writer, so last-write-wins is honest and sufficient.

### 5.5 Where it lands in the build

**Not last.** Leaving auth, RLS and sync to the end is how pilots slip. But not
first either: building six phases of UI against a remote database slows every
one of them.

The compromise is one small task now and a cutover in the middle:

1. **Phase 1.5 — make the seam async.** `store.js` keeps its localStorage guts
   but returns Promises. Views get written against the async shape from the
   start, so the cutover later changes one file rather than every screen. This
   is cheap today and expensive to retrofit after Phase 6.
2. **Phases 2 and 3** — report form and media, built locally and fast.
3. **Phase 3.5 — the cutover.** Supabase auth, tables, RLS, storage, sync.
4. **Phases 4, 5, 6** — board, confirmation and donations built directly against
   the real shared backend, so the hardest flows are proven across two phones
   rather than simulated on one.

### 5.6 Who builds which half

**Decided 2026-09-21: you build and host the server; I build the client against
it.** I cannot create or host the backend from here, and you would rather own
the infrastructure, so the split is clean.

The risk with any such split is that each side builds to its own assumptions and
the mismatch only surfaces at integration. **`BACKEND.md` is the contract that
prevents that** — table shapes, the invariants the database must enforce, the
two operations that cannot live in the client, the error shape, and what the
offline queue will do to your API. If you disagree with anything in it, change
that file and tell me; that is far cheaper than discovering it during the
cutover.

What I still need from you before writing `api.js`: the base URL, the public
key, and whether this is Supabase or your own server. The `service_role` key or
any other secret must never enter this repo — the frontend is static, so
anything it holds is readable by anyone.

*Open decision #6.*

---

## 6. App navigation

Bottom tabs, and which of them you see depends on your roles:

| Tab | Icon | Shown to | Screen |
| --- | --- | --- | --- |
| Map | pin | everyone | The Dilijan map + nearby reports |
| Report | camera | reporters | Capture flow — opens straight to the camera |
| Jobs | broom | cleaners | Board of claimable work + my jobs |
| Give | heart | donors | Donate + "where my money went" |
| Me | avatar | everyone | Profile, roles, dashboards, log out |

A user with all three roles sees five tabs; a donor-only user sees three. The
role toggles in **Me** add and remove tabs live.

---

## 7. Two decisions worth getting right

### 7.1 Roles are additive, not exclusive

A Dilijan resident reports a dump on Tuesday, joins a cleanup on Saturday, and
donates on payday. One account, `roles: ['reporter','cleaner','donor']`, with
tabs shown per role. Sign-up asks "what do you want to do?" and allows more than
one; the profile can change it later.

**Decided 2026-09-21: multi-role.** One account holds any combination of the
three. Each role is a separate flow, and the same person can be in all three.

### 7.2 The money ledger is what makes the donor dashboard honest

Most demos fake "what was my money spent on?" with a pie chart. We can do the
real thing cheaply:

- A donation is either **earmarked** to one report, or goes to the **general pot**.
- When a cleanup is **confirmed**, its payout is drawn down — earmarked money
  first, then the general pot oldest-first (FIFO) — and each draw writes an
  `alloc` row.
- The donor dashboard is then just: *your donations → their alloc rows → the
  cleanups they paid for*, with before/after photos attached.

So a donor sees "your 5 000 AMD paid for the Parz Lake trail cleanup, cleaned
17 Sep, rated 5/5" — with the photo. That is the whole product in one screen,
and it falls straight out of the data model.

**Payout formula (default, tune later):**
`1 000 AMD base + 40 AMD/min estimated + 50% hazard surcharge`, rounded to 100.
Shown to the cleaner *before* they claim, so the offer is honest.

---

## 8. Task breakdown

Ordered so each phase is demoable on its own and nothing is built before the
thing it depends on. `Done when:` is the check to run before ticking it.

**Progress: Phases 0, 1, 1.5 and 2 are built and verified** (2026-09-21). 51 automated checks
drive a real Chromium at 390×844 and cover every "done when" below for those
phases — guard, session, role toggles, offline launch, corrupt-storage fallback,
report validation, map placement, hazard path, payout arithmetic, cross-role
detail views, tap targets, no sideways scroll.

### Phase 0 — Foundations + app shell *(no visible feature; everything rests on it)*

| # | Task | Done when |
| --- | --- | --- |
| 0.1 ✅ | `store.js`: load/save/migrate/reset over one localStorage key | Reload keeps data; corrupt JSON falls back to seed without a crash |
| 0.2 ✅ | Seed data: 6 users, ~10 reports across all statuses, donation history | Fresh install shows a populated, believable town |
| 0.3 ✅ | `app.html` shell + `router.js` + **bottom tab bar** | Tabs swap screens instantly; Android back button works |
| 0.4 ✅ | **`manifest.webmanifest` + icons + `display:standalone`** | "Add to Home Screen" gives a full-screen app with no address bar |
| 0.5 ✅ | **`sw.js` service worker — cache the shell and assets** | Aeroplane mode: the app still opens and navigates |
| 0.6 ✅ | **Install prompt** on the landing page (+ iOS "tap Share → Add" hint) | A phone user installs without being told how |
| 0.7 ✅ | **Safe-area insets + 390 px baseline + no-zoom viewport** | Nothing under the notch or home indicator; no sideways scroll |
| 0.8 ✅ | Complete the token set and enforce it; shared sheet/toast/field/empty-state CSS | No hex outside `:root`; spacing and type on scale (component sizes and border widths are exempt); one class list used by every later screen |
| 0.9 ✅ | Screen transitions — eased 200 ms slide, respects `prefers-reduced-motion` | Feels like an app, not a page load |

### Phase 1 — All users: accounts

| # | Task | Done when |
| --- | --- | --- |
| 1.1 ✅ | Sign-up: name, email, password, role tick-boxes | New account persists and lands signed in |
| 1.2 ✅ | Log in / log out, session in localStorage | Relaunch keeps you in; logout returns to landing |
| 1.3 ✅ | Route guard | Opening `#/board` signed out bounces to login, then returns there after |
| 1.4 ✅ | Profile: avatar, name, place, roles, member-since, role toggles | Toggling a role adds/removes its tab live |
| 1.5 ✅ | One-tap demo logins (donor / reporter / cleaner) | A judge reaches any role in one tap |
| 1.6 ✅ | Honest note: "demo accounts, passwords are not secure" | Visible once on sign-up, not nagging. **Removed at Phase 3.5**, when it stops being true |

### Phase 1.5 — Make the seam async *(small, and expensive to skip)*

`store.js` keeps its localStorage guts but starts returning Promises, so every
screen from Phase 2 on is written against the shape the backend will need. Doing
this after Phase 6 would mean rewriting every view.

| # | Task | Done when |
| --- | --- | --- |
| 1.5.1 ✅ | `store.js` read/write methods return Promises | Existing screens work unchanged through the async API |
| 1.5.2 ✅ | Loading and error states in the shared component set | Every screen can show "loading" and "that failed" without inventing its own |
| 1.5.3 ✅ | Re-run the Phase 0–1 check suite | All 26 checks still pass |

### Phase 2 — Reporter: the report itself

| # | Task | Done when |
| --- | --- | --- |
| 2.1 ✅ | Report form: title, description, **pollution level 1–5**, **hazardous flag**, **estimated cleanup time** | All five fields validate and save |
| 2.2 ✅ | Location: tap the map to place a pin + text label; offer **device GPS** with manual fallback | Pin persists; denying location permission still allows a report |
| 2.3 ✅ | Hazard path: flagging hazardous shows a "do not touch it yourself" warning | Warning appears; report marked for official handling |
| 2.4 ✅ | Reporter dashboard: my reports + live status of each | Statuses match the lifecycle in 4.3 |
| 2.5 ✅ | Report detail screen, shared by all three roles | Same route works signed in as any role |

### Phase 3 — Camera and media *(riskiest piece; isolate it)*

| # | Task | Done when |
| --- | --- | --- |
| 3.1 | `media.js`: put/get/delete blobs in IndexedDB | 50 MB video stored and played back after relaunch |
| 3.2 | **Camera capture** — `capture="environment"`, multiple photos per report | Tapping "Add photo" opens the camera, not a file browser |
| 3.3 | Video attach with a poster frame | Plays inline on iOS and Android, no layout jump |
| 3.4 | Downscale photos before storing; cap count and total size | Quota errors surface as a clear message, never a silent loss |
| 3.5 | Before/after gallery on the report detail, swipeable | Swipes with a thumb on a real phone |

### Phase 3.5 — Backend cutover *(the pilot phase; blocked on decision #6)*

Everything after this is built against the real shared backend, so the hardest
flows are proven across two phones rather than simulated on one.

| # | Task | Done when |
| --- | --- | --- |
| 3.5.1 | Supabase project, schema for the five tables, migrations checked into the repo | Schema recreatable from the repo alone |
| 3.5.2 | **RLS policies for every table** (5.3) | A signed-in user provably cannot read or write another user's rows |
| 3.5.3 | `claim_report()` and `allocate_payout()` as `security definer` functions | Two cleaners racing for one report: exactly one wins |
| 3.5.4 | Swap `auth.js` to Supabase Auth; migrate the demo accounts | Passwords hashed server-side; existing flows unchanged |
| 3.5.5 | Swap `store.js` internals to `api.js` | No view file changes |
| 3.5.6 | Media moves to a storage bucket; rows keep the keys | Photo taken on phone A is visible on phone B |
| 3.5.7 | `sync.js` — offline write queue and replay (5.4) | Report written offline appears for others on reconnect |
| 3.5.8 | Two-device test | Report on A appears on B; B claims it; it leaves A's board |

### Phase 4 — Cleaner: board and work

| # | Task | Done when |
| --- | --- | --- |
| 4.1 | Board of available reports (cards + map) | Only `open` reports appear by default |
| 4.2 | Filters: location, estimated time, **hide hazardous**, **unclaimed only** | Each filter provably changes the list; choices survive navigation |
| 4.3 | Claim a report → it leaves everyone else's board | Second cleaner no longer sees it |
| 4.4 | Release a claim | Returns to `open` for everyone |
| 4.5 | Mark cleaned, with after-photo proof | Moves to `cleaned`, awaits confirmation |
| 4.6 | Cleaner dashboard: to-do / cleaned / **earned money** | Earnings equal the sum of their `alloc` rows |

### Phase 5 — Closing the loop

| # | Task | Done when |
| --- | --- | --- |
| 5.1 | Reporter sees their spot has been cleaned | Badge on the Me tab and the reporter dashboard |
| 5.2 | Confirm screen: before/after side by side, **rate cleanliness 1–5** | Rating stored on the report |
| 5.3 | Confirmation triggers payout allocation (7.2) | `alloc` rows written; cleaner's earnings rise |
| 5.4 | Dispute path: rating 1–2 → flagged, not auto-paid | Report goes to `cleaned` + `disputed`, visible to both |

### Phase 6 — Donor

| # | Task | Done when |
| --- | --- | --- |
| 6.1 | Donate to the general pot (preset amounts + custom) | Donation recorded, pot balance rises |
| 6.2 | Donate to a specific report, from its detail screen | Earmarked donation shows on that report |
| 6.3 | Simulated checkout — clearly labelled, no card fields implying a real charge | "No real payment is taken" stated on the screen |
| 6.4 | **Donor dashboard: what was my money spent on?** | Each donation traces to named cleanups with photos and dates |
| 6.5 | Unspent balance shown honestly ("2 000 AMD not yet allocated") | Donated total = allocated + unallocated, always |

### Phase 7 — Ship quality

| # | Task | Done when |
| --- | --- | --- |
| 7.1 | Landing page reworked: three roles + install-the-app call to action | A stranger installs it in 15 seconds |
| 7.2 | **Real-device pass** — iPhone Safari and Android Chrome, installed | Every flow completes on a real phone, not just a simulator |
| 7.3 | Empty states for every list | No screen ever shows a blank void |
| 7.4 | Demo reset restoring the seed | One button, with a confirm |
| 7.5 | Full E2E walkthrough of all three roles, written down | Each of the three flows completes start to finish |
| 7.6 | Accessibility: contrast, labels, focus order, reduced motion | Keyboard and screen-reader run through each flow works |

### Phase 8 — Store build *(parked: not needed for this milestone)*

| # | Task | Done when |
| --- | --- | --- |
| 8.1 | Wrap the PWA with Capacitor, no app-code changes | `.apk` runs on an Android device |
| 8.2 | Swap to native camera and filesystem plugins | Capture works through the native layer |
| 8.3 | Icons, splash screens, store listing copy and screenshots | Assets complete for both stores |
| 8.4 | Apple + Google developer accounts, signing, submission | Builds submitted for review |

*Needs from you: developer accounts, and a Mac or a cloud build service for iOS.*

---

## 9. Definition of done for the MVP

The app is **installed on real phones from a link**, launches full-screen with
no address bar, and opens with no signal. Because this is a pilot, the flows
must work **across separate devices** — a report made on one phone appears on
another person's board:

1. **Reporter** signs up → photographs a hazardous spot → sets level 4 and a
   90-minute estimate → watches it get claimed → confirms it clean → rates 4/5.
2. **Cleaner** signs in → filters the board to non-hazardous jobs under 2 hours
   near the centre → claims one → marks it cleaned with an after-photo → sees
   the payment land in their dashboard.
3. **Donor** signs in → gives to the general pot and to one specific cleanup →
   opens their dashboard → sees exactly which cleanups their money paid for.

And two checks that only a pilot needs:

4. **Two phones, one town.** A report made on phone A is on phone B's board
   within a refresh. When B claims it, it leaves A's board.
5. **No signal.** A report written in a forest with no bars is saved, marked
   pending, and appears for everyone else once signal returns.

---

## 10. Out of scope (stated so it is not a surprise)

- Real payment processing, payouts, KYC, tax receipts.
- Push notifications, email, SMS *(push arrives with Phase 8)*.
- Real-time updates: the board refreshes on open and on pull, not by live socket.
- Moderation tooling, admin/municipality role.
- Armenian translation of the app UI *(landing keeps its bilingual touches)*.

## 11. Parked from the hackathon build

Eco-points, the voting wheel, the funding cloud and the PDF certificate are not
in the MVP list. They stay in the repo and on the landing page, but no MVP task
depends on them. Decide after Phase 7 whether points return as the retention
layer.

## 12. Decisions

### Settled (2026-09-21)

0. **This is a pilot, not a demo.** Real users on their own phones, all core
   features actually working. Consequences: a shared backend is mandatory
   (section 5), passwords must be hashed server-side, and the definition of
   done now spans two devices.

1. **Format: PWA.** ✅ No store listing needed for this milestone. Phase 8 is
   parked, not cancelled — the TWA route to the Play Store stays available for
   ~$25 and a day's work whenever a store badge is wanted.
2. **Multi-role accounts.** ✅ One account holds any combination of donor,
   reporter and cleaner. Tabs are driven by roles and change live when roles are
   toggled (7.1, task 1.4).

### Still open

3. **Payout formula** — default in 7.2. *Blocks Phase 5.*
4. **Who pays cleaners: money or points?** The task list says money, so money it
   is; confirm that is the real intent for Dilijan and not a hackathon artifact.
5. **Certificate** — keep, drop, or rebuild on the new account model (section 11).
6. **Which backend, and its connection details** — you are building the server
   (5.6). I need the base URL, the public key, and whether it is Supabase or
   your own service before writing `api.js`. Everything else is agreed in
   `BACKEND.md`. *Blocks Phase 3.5.*
7. **Who is liable for the pilot's data?** Real names, photos and locations of
   real people, on a real server. Someone has to own deletion requests and a
   privacy note. Not a coding task, but it blocks going live with real users.
