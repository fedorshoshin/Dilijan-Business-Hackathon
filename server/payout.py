"""confirm_and_pay — drawing a cleaner's payout down from real donations.

This is what makes the donor dashboard honest instead of a pie chart: every AMD
a cleaner receives is traced to the donation it came from. BACKEND.md §4.

Order of draw-down:
  1. donations earmarked for this report (target = the report id)
  2. the general pot, oldest donation first

If the pot cannot cover the payout we allocate what exists and report the
shortfall. We do not fail the confirmation — a cleaned riverbank is still
cleaned, and refusing to confirm it would punish the wrong person.

This module is the ONLY writer of `alloc` (invariant 3.4).
"""

from uuid import UUID, uuid4

import asyncpg

# One payout at a time, process-wide and cluster-wide. Two reporters confirming
# different reports in the same instant would otherwise both read the same
# remaining balance on a shared donation and allocate it twice. Payouts are rare
# and quick, so serialising them costs nothing and removes the whole class of
# double-spend bug.
_POT_LOCK = 8_417_301  # arbitrary, just has to be ours alone


async def _remaining(con: asyncpg.Connection, target: str | None) -> list[dict]:
    """Donations with money left in them, oldest first.

    `target` is a report id for earmarked money, or None for the general pot.
    """
    return [
        dict(r)
        for r in await con.fetch(
            """
            select d.id,
                   d.amount - coalesce(a.spent, 0) as remaining
            from donations d
            left join (
                select donation_id, sum(amount) as spent from alloc group by donation_id
            ) a on a.donation_id = d.id
            where d.target = $1
              and d.amount - coalesce(a.spent, 0) > 0
            order by d.created_at
            """,
            target if target is not None else "general",
        )
    ]


async def confirm_and_pay(con: asyncpg.Connection, report_id: UUID, rating: int) -> dict:
    """Confirm a cleaned report, rate it, and allocate the payout.

    Must be called inside a transaction, with the report row already locked.
    Returns the updated report plus the allocations written.
    """
    await con.execute("select pg_advisory_xact_lock($1)", _POT_LOCK)

    report = dict(
        await con.fetchrow(
            """update reports
                  set status = 'confirmed', rating = $2, confirmed_at = now(),
                      disputed = ($2 <= 2)
                where id = $1
            returning id, reporter_id, payout, rating, disputed, status""",
            report_id,
            rating,
        )
    )

    # A poor rating stops the money and asks a human to look (DESIGN.md 5.4).
    # The cleanup is still confirmed; only the payment waits.
    if rating <= 2:
        return {"report": report, "allocations": [], "shortfall": report["payout"], "disputed": True}

    claim = await con.fetchrow(
        """select cleaner_id from claims
            where report_id = $1 and status in ('active', 'done')
            order by claimed_at desc limit 1""",
        report_id,
    )
    if not claim:
        # Nothing to pay: confirmed, but nobody ever claimed it.
        return {"report": report, "allocations": [], "shortfall": report["payout"], "disputed": False}

    owed = report["payout"]
    allocations: list[dict] = []
    sources = await _remaining(con, str(report_id)) + await _remaining(con, None)

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
            claim["cleaner_id"],
            take,
        )
        allocations.append(dict(row))
        owed -= take

    await con.execute(
        "update claims set status = 'done', cleaned_at = coalesce(cleaned_at, now()) "
        "where report_id = $1 and status = 'active'",
        report_id,
    )

    return {
        "report": report,
        "allocations": allocations,
        "shortfall": owed,  # > 0 means the pot ran dry; the cleaner is owed this
        "disputed": False,
    }
