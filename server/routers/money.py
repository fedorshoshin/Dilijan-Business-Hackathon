"""Donations in, allocations out, and the donor's "what did my money buy".

Donations are insert-only (invariant 3.5). `alloc` is written only by
payout.confirm_and_pay (invariant 3.4) — there is deliberately no endpoint here
that creates one.

Card processing is out of scope for the pilot (DESIGN.md §3): the ledger is real,
the charge is simulated.
"""

import logging
from uuid import UUID, uuid4

from fastapi import APIRouter

from .. import db, payout, storage
from ..errors import NOT_AUTHORISED, NOT_FOUND, VALIDATION_FAILED, ApiError
from ..models import NewDonation
from ..security import CurrentUser

router = APIRouter(tags=["money"])
logger = logging.getLogger("havak")


@router.post("/donations", status_code=201)
async def donate(body: NewDonation, user: dict = CurrentUser):
    if "donor" not in (user["roles"] or []):
        raise ApiError(NOT_AUTHORISED, "Turn on the donor role to give.")

    target = body.target.strip() or "general"
    if target != "general":
        # An earmarked donation must name a spot that exists, or the money would
        # be unreachable by the payout draw-down.
        try:
            report_id = UUID(target)
        except ValueError:
            raise ApiError(VALIDATION_FAILED, "That is not a valid spot to give to.")
        spot = await db.fetchrow("select status from reports where id = $1", report_id)
        if not spot:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        # A confirmed spot has been paid already, so money earmarked for it now
        # would have nothing left to pay for.
        if spot["status"] == "confirmed":
            raise ApiError(
                VALIDATION_FAILED,
                "This spot is already cleaned and paid. Give to the general pot instead.",
            )
        target = str(report_id)

    if body.client_id:
        existing = await db.fetchrow(
            """select id, donor_id, amount, target, created_at
                 from donations where client_id = $1""",
            body.client_id,
        )
        if existing:
            return existing

    donation = await db.fetchrow(
        """insert into donations (id, donor_id, amount, target, client_id)
           values ($1, $2, $3, $4, $5)
        returning id, donor_id, amount, target, created_at""",
        uuid4(),
        user["id"],
        body.amount,
        target,
        body.client_id,
    )

    # New money pays old debts first: cleaners whose confirmed work found the pot
    # short. Its own transaction, after the donation is safely stored — a failure
    # here must not lose the gift, and the next donation simply tries again.
    try:
        async with db.transaction() as con:
            await payout.settle(con)
    except Exception:
        logger.exception("settling owed payouts after donation %s failed", donation["id"])

    return donation


@router.get("/donations/mine")
async def my_donations(user: dict = CurrentUser):
    """Each donation with how much of it has been spent, and on what.

    This is the honest version of a donor dashboard: not a percentage, but the
    actual cleanups the money paid for.
    """
    return storage.sign_urls(await db.fetch(
        """
        select d.id, d.amount, d.target, d.created_at,
               (select r.title from reports r where r.id::text = d.target) as target_title,
               coalesce(spent.total, 0) as allocated,
               d.amount - coalesce(spent.total, 0) as remaining,
               coalesce(bought.items, '[]'::jsonb) as bought
          from donations d
          left join (
              select donation_id, sum(amount) as total from alloc group by donation_id
          ) spent on spent.donation_id = d.id
          left join (
              select a.donation_id,
                     jsonb_agg(jsonb_build_object(
                         'report_id', r.id,
                         'title', r.title,
                         'loc_label', r.loc_label,
                         'amount', a.amount,
                         'rating', r.rating,
                         'confirmed_at', r.confirmed_at,
                         'cleaner', jsonb_build_object('id', cu.id, 'name', cu.name),
                         'before_key', (select m.bucket_key from media m
                                         where m.report_id = r.id and m.kind = 'before'
                                           and m.mime like 'image/%'
                                         order by m.created_at limit 1),
                         'after_key', (select m.bucket_key from media m
                                        where m.report_id = r.id and m.kind = 'after'
                                          and m.mime like 'image/%'
                                        order by m.created_at limit 1)
                     ) order by a.at desc) as items
                from alloc a
                join reports r on r.id = a.report_id
                join users cu on cu.id = a.cleaner_id
               group by a.donation_id
          ) bought on bought.donation_id = d.id
         where d.donor_id = $1
         order by d.created_at desc
        """,
        user["id"],
    ))


@router.get("/pot")
async def pot(_: dict = CurrentUser):
    """Platform totals. Sums only — who gave what stays private."""
    row = await db.fetchrow(
        """
        select (select coalesce(sum(amount), 0) from donations) as donated,
               (select coalesce(sum(amount), 0) from alloc)     as allocated,
               (select count(*) from reports where status = 'confirmed') as cleanups,
               (select count(*) from reports where status = 'open')      as open_spots
        """
    )
    row["available"] = row["donated"] - row["allocated"]
    return row


@router.get("/reports/{report_id}/allocations")
async def report_allocations(report_id: UUID, _: dict = CurrentUser):
    """What this cleanup was paid, and out of which donations."""
    return await db.fetch(
        """select a.id, a.donation_id, a.cleaner_id, a.amount, a.at
             from alloc a where a.report_id = $1 order by a.at""",
        report_id,
    )


@router.get("/me/earnings")
async def my_earnings(user: dict = CurrentUser):
    """The cleaner's side of the ledger: what has been paid, and what is still
    owed for confirmed work the pot could not yet cover."""
    rows = await db.fetch(
        """select a.id, a.amount, a.at, r.id as report_id, r.title, r.loc_label, r.rating
             from alloc a
             join reports r on r.id = a.report_id
            where a.cleaner_id = $1
            order by a.at desc""",
        user["id"],
    )
    owed = await db.fetchrow(
        """select coalesce(sum(r.payout - coalesce(
                     (select sum(a.amount) from alloc a where a.report_id = r.id), 0)), 0)::int as owed
             from reports r
             join claims c on c.report_id = r.id and c.status = 'done'
            where c.cleaner_id = $1 and r.status = 'confirmed'""",
        user["id"],
    )
    return {
        "total": sum(r["amount"] for r in rows),
        "owed": owed["owed"],
        "payments": rows,
    }
