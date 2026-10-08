"""Reports and the cleaning lifecycle.

  open ──claim──▶ claimed ──cleaned──▶ cleaned ──confirm 3-5──▶ confirmed
   │                 │  ▲                 │
   │                 │  └──confirm 1-2────┘  sent back to the same cleaner
   │                 └──release──▶ open
   ├──edit──▶ open (the reporter changes anything, price included)
   └──withdraw──▶ (gone)

Each transition is its own endpoint rather than a PATCH on `status`, because each
has a different rule about who is allowed to make it (BACKEND.md §3) and a
free-form status field would make those rules invisible.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter, Query

from .. import db, payout, storage
from ..errors import ALREADY_CLAIMED, NOT_AUTHORISED, NOT_FOUND, VALIDATION_FAILED, ApiError
from ..models import Confirm, NewReport, ReportPatch
from ..security import CurrentUser

router = APIRouter(tags=["reports"])

# lat/lng/loc_* are numeric in Postgres, which asyncpg hands back as Decimal and
# json cannot serialise. Cast once, here, rather than converting at every caller.
FIELDS = """
    r.id, r.reporter_id, r.title, r.description,
    r.lat::float8 as lat, r.lng::float8 as lng,
    r.loc_x::float8 as loc_x, r.loc_y::float8 as loc_y,
    r.loc_label, r.level, r.hazardous, r.est_minutes, r.payout,
    r.status, r.rating, r.disputed,
    r.created_at, r.cleaned_at, r.confirmed_at,
    jsonb_build_object(
        'id', u.id, 'name', u.name, 'avatar_key', u.avatar_key
    ) as reporter,
    case when c.id is null then null else jsonb_build_object(
        'id', c.id, 'cleaner_id', c.cleaner_id, 'claimed_at', c.claimed_at,
        'cleaner', jsonb_build_object(
            'id', cu.id, 'name', cu.name, 'avatar_key', cu.avatar_key
        )
    ) end as claim,
    (select m.bucket_key from media m
      where m.report_id = r.id and m.kind = 'before' and m.mime like 'image/%'
      order by m.created_at limit 1) as cover_key,
    (select count(*)::int from media m where m.report_id = r.id) as media_count,
    (select coalesce(sum(d.amount), 0)::int from donations d
      where d.target = r.id::text) as earmarked
"""

FROM = """
    from reports r
    join users u on u.id = r.reporter_id
    left join claims c on c.report_id = r.id and c.status = 'active'
    left join users cu on cu.id = c.cleaner_id
"""


async def _load(report_id: UUID) -> dict:
    row = await db.fetchrow(f"select {FIELDS} {FROM} where r.id = $1", report_id)
    if not row:
        raise ApiError(NOT_FOUND, "That spot no longer exists.")
    return row


@router.get("/reports")
async def list_reports(
    _: dict = CurrentUser,
    status: str | None = Query(default=None),
    reporter_id: UUID | None = None,
    limit: int = Query(default=200, ge=1, le=500),
):
    """Every signed-in user may read every report: a polluted riverbank is a
    public fact, and surfacing it is the product."""
    if status and status not in {"open", "claimed", "cleaned", "confirmed"}:
        raise ApiError(VALIDATION_FAILED, "Unknown status filter.")
    rows = await db.fetch(
        f"""select {FIELDS} {FROM}
            where ($1::text is null or r.status = $1)
              and ($2::uuid is null or r.reporter_id = $2)
            order by r.created_at desc
            limit $3""",
        status,
        reporter_id,
        limit,
    )
    return storage.sign_urls(rows)


@router.get("/reports/{report_id}")
async def get_report(report_id: UUID, _: dict = CurrentUser):
    return storage.sign_urls(await _load(report_id))


@router.post("/reports", status_code=201)
async def create_report(body: NewReport, user: dict = CurrentUser):
    if "reporter" not in (user["roles"] or []):
        raise ApiError(NOT_AUTHORISED, "Turn on the reporter role to report a spot.")

    # Replayed offline write: the client retried because it never saw our reply.
    # Hand back the report it already created instead of making a second one.
    if body.client_id:
        existing = await db.fetchrow(
            f"select {FIELDS} {FROM} where r.client_id = $1", body.client_id
        )
        if existing:
            return storage.sign_urls(existing)

    row = await db.fetchrow(
        """insert into reports
             (id, reporter_id, title, description, lat, lng, loc_x, loc_y,
              loc_label, level, hazardous, est_minutes, payout, client_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        returning id""",
        uuid4(),
        user["id"],
        body.title.strip(),
        body.description.strip(),
        body.lat,
        body.lng,
        body.loc_x,
        body.loc_y,
        body.loc_label.strip(),
        body.level,
        body.hazardous,
        body.est_minutes,
        # The reporter's own price, bounded in models.py. Older copies of the
        # app send none and get the suggested one.
        body.payout if body.payout is not None else payout.price(body.est_minutes, body.hazardous),
        body.client_id,
    )
    return storage.sign_urls(await _load(row["id"]))


@router.patch("/reports/{report_id}")
async def edit_report(report_id: UUID, body: ReportPatch, user: dict = CurrentUser):
    """Change a report — only your own, and only before anyone starts work.

    The same window as withdrawing: once a cleaner has claimed the spot, they
    took it on for the place, the job and the price they saw, so none of those
    may move under them. Photos have their own endpoints (routers/media.py).
    """
    # Absent and null both mean unchanged: every column here is NOT NULL.
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for key in ("title", "description", "loc_label"):
        if key in changes:
            changes[key] = changes[key].strip()

    async with db.transaction() as con:
        report = await con.fetchrow(
            "select reporter_id, status from reports where id = $1 for update", report_id
        )
        if not report:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        if report["reporter_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "You can only edit your own report.")
        if report["status"] != "open":
            raise ApiError(VALIDATION_FAILED, "Someone is already working on this spot.")
        if changes:
            # Column names come from ReportPatch's own fields, never the request.
            sets = ", ".join(f"{key} = ${i}" for i, key in enumerate(changes, start=2))
            await con.execute(
                f"update reports set {sets} where id = $1", report_id, *changes.values()
            )

    return storage.sign_urls(await _load(report_id))


@router.delete("/reports/{report_id}")
async def delete_report(report_id: UUID, user: dict = CurrentUser):
    """Withdraw a report — only your own, and only before anyone starts work.

    One transaction, with the row locked first: a cleaner claiming in the same
    instant either waits and finds the spot gone, or got there first and this
    refuses. Never half of each.

    Money earmarked for the spot is not touched — payout.py counts donations
    that name a missing report as part of the general pot.
    """
    async with db.transaction() as con:
        report = await con.fetchrow(
            "select reporter_id, status from reports where id = $1 for update", report_id
        )
        if not report:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        if report["reporter_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "You can only withdraw your own report.")
        if report["status"] != "open":
            raise ApiError(VALIDATION_FAILED, "Someone is already working on this spot.")
        # An open spot can still carry 'released' claims from cleaners who gave
        # it back; they reference the report and would block deleting it.
        await con.execute("delete from claims where report_id = $1", report_id)
        keys = await con.fetch(
            "delete from media where report_id = $1 returning bucket_key", report_id
        )
        await con.execute("delete from reports where id = $1", report_id)

    # Only once the rows are gone for certain. A failed delete here leaves an
    # orphaned file, which is harmless; deleting first could leave a report
    # pointing at photos that no longer exist.
    for row in keys:
        await storage.delete(storage.MEDIA_BUCKET, row["bucket_key"])
    return {"ok": True}


@router.post("/reports/{report_id}/claim")
async def claim_report(report_id: UUID, user: dict = CurrentUser):
    """Take the job. Atomic: two cleaners tapping at once produce one winner."""
    if "cleaner" not in (user["roles"] or []):
        raise ApiError(NOT_AUTHORISED, "Turn on the cleaner role to claim a spot.")

    async with db.transaction() as con:
        # The lock is what makes this a race with exactly one winner: the second
        # transaction waits here, then reads status = 'claimed' and gives up.
        report = await con.fetchrow(
            "select id, status, hazardous, reporter_id from reports where id = $1 for update",
            report_id,
        )
        if not report:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        # Reporting a spot and then cleaning it yourself means confirming your
        # own work and signing off your own payment from other people's
        # donations. Two different people, or the money means nothing.
        if report["reporter_id"] == user["id"]:
            raise ApiError(
                NOT_AUTHORISED,
                "You reported this spot, so someone else has to clean it and you confirm the work.",
            )
        if report["hazardous"]:
            raise ApiError(
                NOT_AUTHORISED,
                "This spot is flagged hazardous and is handled by officials, not volunteers.",
            )
        if report["status"] != "open":
            raise ApiError(ALREADY_CLAIMED, "Someone else took this spot.")

        await con.execute(
            """insert into claims (id, report_id, cleaner_id, status)
               values ($1, $2, $3, 'active')""",
            uuid4(),
            report_id,
            user["id"],
        )
        await con.execute("update reports set status = 'claimed' where id = $1", report_id)

    return storage.sign_urls(await _load(report_id))


@router.post("/reports/{report_id}/release")
async def release_claim(report_id: UUID, user: dict = CurrentUser):
    """Give the job back. Only the holder, and only before it is marked clean."""
    async with db.transaction() as con:
        claim = await con.fetchrow(
            """select id, cleaner_id from claims
                where report_id = $1 and status = 'active' for update""",
            report_id,
        )
        if not claim:
            raise ApiError(NOT_FOUND, "Nobody is holding this spot.")
        if claim["cleaner_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "This is not your claim.")

        await con.execute("update claims set status = 'released' where id = $1", claim["id"])
        # A sent-back job given up carries its dispute away with it: the next
        # cleaner starts clean, not under someone else's poor rating.
        await con.execute(
            """update reports set status = 'open', rating = null, disputed = false
                where id = $1 and status = 'claimed'""",
            report_id,
        )
    return storage.sign_urls(await _load(report_id))


@router.post("/reports/{report_id}/cleaned")
async def mark_cleaned(report_id: UUID, user: dict = CurrentUser):
    """Say it is done. Only the claiming cleaner (invariant 3.2)."""
    async with db.transaction() as con:
        row = await con.fetchrow(
            """select r.status, c.cleaner_id
                 from reports r
                 left join claims c on c.report_id = r.id and c.status = 'active'
                where r.id = $1 for update of r""",
            report_id,
        )
        if not row:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        if row["cleaner_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "Only the cleaner who claimed this can mark it cleaned.")
        if row["status"] != "claimed":
            raise ApiError(VALIDATION_FAILED, "This spot is not currently being cleaned.")

        # Task 4.5: the after-photo is the proof the reporter confirms from, so
        # it is a rule here and not merely a disabled button on the phone.
        proof = await con.fetchrow(
            """select 1 from media
                where report_id = $1 and kind = 'after' and mime like 'image/%'
                limit 1""",
            report_id,
        )
        if not proof:
            raise ApiError(
                VALIDATION_FAILED,
                "Add a photo of the cleaned spot first — that is what the reporter checks.",
            )

        await con.execute(
            "update reports set status = 'cleaned', cleaned_at = now() where id = $1", report_id
        )
        await con.execute(
            "update claims set cleaned_at = now() where report_id = $1 and status = 'active'",
            report_id,
        )
    return storage.sign_urls(await _load(report_id))


@router.post("/reports/{report_id}/confirm")
async def confirm_report(report_id: UUID, body: Confirm, user: dict = CurrentUser):
    """The reporter's verdict on the work. Only the reporting user (invariant 3.3).

    3 to 5: confirmed, and the cleaner is paid from real donations.
    1 or 2: a dispute. The spot goes back to the same cleaner with the rating
    on it — still theirs, to finish and mark cleaned again, or to give back. No
    money moves. (DESIGN.md 5.4: the earlier plan held disputed spots for "a
    human to decide", but there is no such human or screen in the pilot, so the
    money would have waited forever. Sending it back needs nobody else.)
    """
    async with db.transaction() as con:
        report = await con.fetchrow(
            "select id, reporter_id, status from reports where id = $1 for update", report_id
        )
        if not report:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        if report["reporter_id"] != user["id"]:
            raise ApiError(NOT_AUTHORISED, "Only the person who reported this can confirm it.")
        if report["status"] != "cleaned":
            raise ApiError(VALIDATION_FAILED, "This spot has not been marked cleaned yet.")

        if body.rating <= 2:
            await con.execute(
                """update reports
                      set status = 'claimed', rating = $2, disputed = true, cleaned_at = null
                    where id = $1""",
                report_id,
                body.rating,
            )
            await con.execute(
                "update claims set cleaned_at = null where report_id = $1 and status = 'active'",
                report_id,
            )
            result = {"allocations": [], "shortfall": 0}
        else:
            result = await payout.confirm_and_pay(con, report_id, body.rating)

    return {
        "report": storage.sign_urls(await _load(report_id)),
        "allocations": result["allocations"],
        "shortfall": result["shortfall"],
        "disputed": body.rating <= 2,
    }


@router.get("/claims/mine")
async def my_claims(user: dict = CurrentUser):
    """The cleaner's own work, current and finished."""
    # `claim` in FIELDS is the *active* claim, which is null once a job is
    # finished — so a cleaner's own finished work needs its own object rather
    # than a flat alias that would collide with r.cleaned_at.
    rows = await db.fetch(
        f"""select {FIELDS},
                   jsonb_build_object(
                       'id', mine.id, 'report_id', r.id, 'cleaner_id', mine.cleaner_id,
                       'status', mine.status, 'claimed_at', mine.claimed_at,
                       'cleaned_at', mine.cleaned_at
                   ) as my_claim
            {FROM}
            join claims mine on mine.report_id = r.id and mine.cleaner_id = $1
            where mine.status in ('active', 'done')
            order by mine.claimed_at desc""",
        user["id"],
    )
    return storage.sign_urls(rows)
