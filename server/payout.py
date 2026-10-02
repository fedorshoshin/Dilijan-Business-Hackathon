"""Money: what a cleanup pays, and drawing it down from real donations.

This is what makes the donor dashboard honest instead of a pie chart: every AMD
a cleaner receives is traced to the donation it came from. BACKEND.md §4.

Three jobs, all here so the rules about money live in one file:

  price()           what a spot pays — the server's number, never the phone's
  confirm_and_pay() the reporter is satisfied: pay the cleaner
  settle()          pay what earlier cleanups are still owed, after new money

Order of draw-down for one cleanup:
  1. donations earmarked for this report (target = the report id)
  2. the general pot, oldest donation first — which includes money earmarked
     for a spot that was later withdrawn, so withdrawing never strands it

If the pot cannot cover a payout we allocate what exists, and the rest is owed:
the next donation pays it, oldest debt first (settle). We do not fail the
confirmation — a cleaned riverbank is still cleaned, and refusing to confirm it
would punish the wrong person.

What is owed is never stored. It is `payout - sum(alloc)` for a confirmed
report, so it cannot drift from the ledger it is derived from.

This module is the ONLY writer of `alloc` (invariant 3.4).
"""

from uuid import UUID, uuid4

import asyncpg

# The same formula as js/money.js, which shows it to people before they commit.
# The phone's copy is for explaining the number; this one decides it. If the two
# ever differ, the form quotes a price the server will not store — change both.
BASE = 1000          # AMD, for turning up at all
PER_MINUTE = 40      # AMD per estimated minute
ROUND_TO = 100

# One payout at a time, process-wide and cluster-wide. Two reporters confirming
# different reports in the same instant would otherwise both read the same
# remaining balance on a shared donation and allocate it twice. Payouts are rare
# and quick, so serialising them costs nothing and removes the whole class of
# double-spend bug.
_POT_LOCK = 8_417_301  # arbitrary, just has to be ours alone


def price(est_minutes: int, hazardous: bool) -> int:
    """Base plus time, +50% for hazardous, to the nearest 100 AMD.

    Integer arithmetic throughout, in units of half a dram, so the hazard
    surcharge never passes through a float and rounding is exactly the phone's
    Math.round (half up) rather than Python's round-half-even.
    """
    halves = (BASE + est_minutes * PER_MINUTE) * (3 if hazardous else 2)
    step = ROUND_TO * 2
    return (halves + step // 2) // step * ROUND_TO


async def _remaining(con: asyncpg.Connection, report_id: UUID | None) -> list[dict]:
    """Donations with money left in them, oldest first.

    `report_id` for money earmarked to that report; None for the general pot.
    """
    if report_id is not None:
        which, args = "d.target = $1", [str(report_id)]
    else:
        # A withdrawn spot leaves its earmarked donations naming a report that is
        # gone. Donations are insert-only (invariant 3.5), so rather than rewrite
        # the donor's record, the pot simply counts them as its own.
        which, args = (
            "(d.target = 'general' or not exists "
            "(select 1 from reports r where r.id::text = d.target))"
        ), []
    return [
        dict(r)
        for r in await con.fetch(
            f"""
            select d.id,
                   d.amount - coalesce(a.spent, 0) as remaining
            from donations d
            left join (
                select donation_id, sum(amount) as spent from alloc group by donation_id
            ) a on a.donation_id = d.id
            where {which}
              and d.amount - coalesce(a.spent, 0) > 0
            order by d.created_at
            """,
            *args,
        )
    ]


async def _draw(con: asyncpg.Connection, report_id: UUID, cleaner_id: UUID, owed: int) -> list[dict]:
    """Allocate up to `owed` to one cleaner for one report. Returns the rows."""
    allocations: list[dict] = []
    sources = await _remaining(con, report_id) + await _remaining(con, None)
    for source in sources:
        if owed <= 0:
            break
        take = min(owed, source["remaining"])
        row = await con.fetchrow(
            """insert into alloc (id, donation_id, report_id, cleaner_id, amount)
               values ($1, $2, $3, $4, $5)
            returning id, donation_id, report_id, cleaner_id, amount, at""",
            uuid4(),
            source["id"],
            report_id,
            cleaner_id,
            take,
        )
        allocations.append(dict(row))
        owed -= take
    return allocations


async def confirm_and_pay(con: asyncpg.Connection, report_id: UUID, rating: int) -> dict:
    """Confirm a cleaned report, rate it, and allocate the payout.

    Only for a rating of 3 or more — a poorer one is a dispute and never reaches
    here (routers/reports.py). Must be called inside a transaction, with the
    report row already locked.
    """
    await con.execute("select pg_advisory_xact_lock($1)", _POT_LOCK)

    report = dict(
        await con.fetchrow(
            """update reports
                  set status = 'confirmed', rating = $2, confirmed_at = now(),
                      disputed = false
                where id = $1
            returning id, reporter_id, payout, rating, disputed, status""",
            report_id,
            rating,
        )
    )

    claim = await con.fetchrow(
        """select cleaner_id from claims
            where report_id = $1 and status in ('active', 'done')
            order by claimed_at desc limit 1""",
        report_id,
    )
    if not claim:
        # Nothing to pay: confirmed, but nobody ever claimed it.
        return {"report": report, "allocations": [], "shortfall": 0}

    allocations = await _draw(con, report_id, claim["cleaner_id"], report["payout"])

    await con.execute(
        "update claims set status = 'done', cleaned_at = coalesce(cleaned_at, now()) "
        "where report_id = $1 and status = 'active'",
        report_id,
    )

    paid = sum(a["amount"] for a in allocations)
    return {
        "report": report,
        "allocations": allocations,
        "shortfall": report["payout"] - paid,  # > 0: owed, paid by settle() later
    }


async def settle(con: asyncpg.Connection) -> list[dict]:
    """Pay what confirmed cleanups are still owed, oldest confirmation first.

    Called after money arrives. Must be called inside a transaction. Cheap when
    nothing is owed — one query that finds no rows.
    """
    await con.execute("select pg_advisory_xact_lock($1)", _POT_LOCK)

    debts = await con.fetch(
        """
        select r.id, c.cleaner_id,
               r.payout - coalesce((select sum(a.amount) from alloc a
                                     where a.report_id = r.id), 0) as owed
          from reports r
          join claims c on c.report_id = r.id and c.status = 'done'
         where r.status = 'confirmed'
           and r.payout > coalesce((select sum(a.amount) from alloc a
                                     where a.report_id = r.id), 0)
         order by r.confirmed_at
        """
    )
    paid: list[dict] = []
    for debt in debts:
        # No early exit on an empty pot: a later debt may still have money
        # earmarked for its own spot.
        paid += await _draw(con, debt["id"], debt["cleaner_id"], debt["owed"])
    return paid
