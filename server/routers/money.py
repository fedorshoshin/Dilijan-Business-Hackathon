"""Donations in, allocations out, and the donor's "what did my money buy".

Donations are insert-only (invariant 3.5). `alloc` is written only by
payout.confirm_and_pay (invariant 3.4) — there is deliberately no endpoint here
that creates one.

Card processing is out of scope for the pilot (DESIGN.md §3): the ledger is real,
the charge is simulated.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter

from .. import db
from ..errors import NOT_AUTHORISED, NOT_FOUND, VALIDATION_FAILED, ApiError
from ..models import NewDonation
from ..security import CurrentUser

router = APIRouter(tags=["money"])


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
        exists = await db.fetchrow("select 1 from reports where id = $1", report_id)
        if not exists:
            raise ApiError(NOT_FOUND, "That spot no longer exists.")
        target = str(report_id)

    if body.client_id:
        existing = await db.fetchrow(
            """select id, donor_id, amount, target, created_at
                 from donations where client_id = $1""",
            body.client_id,
        )
        if existing:
            return existing

    return await db.fetchrow(
        """insert into donations (id, donor_id, amount, target, client_id)
           values ($1, $2, $3, $4, $5)
        returning id, donor_id, amount, target, created_at""",
        uuid4(),
        user["id"],
        body.amount,
        target,
        body.client_id,
    )


@router.get("/donations/mine")
async def my_donations(user: dict = CurrentUser):
    """Each donation with how much of it has been spent, and on what.

    This is the honest version of a donor dashboard: not a percentage, but the
    actual cleanups the money paid for.
    """
    return await db.fetch(
        """
        select d.id, d.amount, d.target, d.created_at,
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
                         'cleaner', jsonb_build_object('id', cu.id, 'name', cu.name)
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
    )


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
    """The cleaner's side of the ledger."""
    rows = await db.fetch(
        """select a.id, a.amount, a.at, r.id as report_id, r.title, r.loc_label, r.rating
             from alloc a
             join reports r on r.id = a.report_id
            where a.cleaner_id = $1
            order by a.at desc""",
        user["id"],
    )
    return {"total": sum(r["amount"] for r in rows), "payments": rows}
