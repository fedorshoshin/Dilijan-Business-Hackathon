"""Fill a running Havak API with believable test data.

Seeds through the HTTP endpoints, not by inserting rows, so a successful run is
also a smoke test: accounts, the report lifecycle, the claim lock, donations and
the payout draw-down all get exercised in the order a real user would hit them.

    python server/seed.py --base-url https://api.example.com

Safe to re-run: accounts that already exist are logged into rather than
recreated, and reports carry a fixed client_id so the idempotency path returns
the original row instead of making duplicates.

Prints a token per account at the end, ready to paste into curl or Postman.

This is test data with weak, shared passwords. Do not run it against an instance
that has real pilot users in it.
"""

import argparse
import asyncio
import sys
from uuid import UUID, uuid5

import httpx

PASSWORD = "havak-pilot-2026"

# Namespace for deterministic client_ids, so a second run is idempotent rather
# than duplicating everything.
NS = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

# The map covers Dilijan town, the Aghstev valley and Parz Lake. Keep seeded
# coordinates inside it or pins land on the artwork's edge (js/geo.js).
LAT_S, LAT_N = 40.700, 40.800
LNG_W, LNG_E = 44.800, 44.980


def to_xy(lat: float, lng: float) -> tuple[float, float]:
    """Same derivation as geo.js: real position to a percentage of the artwork."""
    x = (lng - LNG_W) / (LNG_E - LNG_W) * 100
    y = (LAT_N - lat) / (LAT_N - LAT_S) * 100
    return round(min(max(x, 0), 100), 2), round(min(max(y, 0), 100), 2)


PEOPLE = [
    ("Anahit Grigoryan", "anahit@havak.am", ["reporter"], "Dilijan centre"),
    ("Vahe Sargsyan", "vahe@havak.am", ["cleaner"], "Shahumyan St"),
    ("Mariam Petrosyan", "mariam@havak.am", ["reporter", "cleaner"], "Getapnya"),
    ("Davit Hakobyan", "davit@havak.am", ["donor"], "Yerevan"),
    ("Lusine Avetisyan", "lusine@havak.am", ["reporter", "donor"], "Parz Lake road"),
]

# reporter email, title, description, lat, lng, label, level, hazardous, minutes, payout
SPOTS = [
    ("anahit@havak.am", "Bags dumped by the river bend",
     "Six or seven black bags tipped down the bank, some split open. Plastic is "
     "already in the water at the edge.",
     40.7402, 44.8631, "Aghstev river, below the old bridge", 4, False, 90, 6000),
    ("anahit@havak.am", "Bottles and cans at the picnic tables",
     "Weekend leftovers around the two tables nearest the path. Mostly glass, so "
     "it needs gloves rather than a lot of time.",
     40.7551, 44.8912, "Forest path, first picnic clearing", 2, False, 40, 2500),
    ("mariam@havak.am", "Builders' rubble tipped at the turning",
     "Someone has emptied a van of broken tiles and plasterboard at the widening "
     "where cars turn round. Too heavy for one person.",
     40.7318, 44.9204, "M4 turning, 2 km east of town", 5, False, 180, 9000),
    ("lusine@havak.am", "Litter trail up to the lake",
     "A steady scatter of wrappers and bottles along about 300 m of the verge on "
     "the way up to Parz Lake.",
     40.7736, 44.9455, "Parz Lake road, upper verge", 3, False, 75, 4500),
    ("mariam@havak.am", "Drums of something leaking",
     "Two rusted metal drums in the undergrowth with a dark stain spreading "
     "downhill from them. Sharp chemical smell. I did not go close.",
     40.7208, 44.8477, "South slope, below the forestry track", 5, True, 120, 0),
    ("anahit@havak.am", "Fly-tipping behind the bus stop",
     "Household waste piling up behind the shelter — furniture, bags, a mattress.",
     40.7466, 44.8388, "Old Dilijan, behind the bus shelter", 4, False, 100, 5500),
    ("lusine@havak.am", "Broken glass on the swimming stones",
     "Smashed bottles right where children get into the water. Small job but it "
     "matters more than its size.",
     40.7389, 44.8795, "Aghstev river, swimming stones", 3, False, 30, 2000),
    ("mariam@havak.am", "Dumped tyres in the glade",
     "Nine or ten car tyres stacked at the far edge of the glade, half overgrown "
     "so they have been there a while.",
     40.7623, 44.9077, "Forest glade, north edge", 3, False, 120, 5000),
]

DONATIONS = [
    ("davit@havak.am", 25000, "general"),
    ("davit@havak.am", 10000, "general"),
    ("lusine@havak.am", 8000, "general"),
]


class Api:
    def __init__(self, client: httpx.AsyncClient, base: str):
        self.client = client
        self.base = base.rstrip("/")

    async def call(self, method: str, path: str, token: str | None = None, **kw):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        r = await self.client.request(method, self.base + path, headers=headers, **kw)
        if r.status_code >= 400:
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            err = body.get("error", {})
            raise RuntimeError(
                f"{method} {path} -> {r.status_code} "
                f"{err.get('code', '?')}: {err.get('message', r.text[:200])}"
            )
        return r.json() if r.content else None


async def sign_in(api: Api, name: str, email: str, roles: list[str], place: str) -> dict:
    """Create the account, or log in if a previous run already made it."""
    try:
        session = await api.call(
            "POST", "/auth/signup",
            json={"name": name, "email": email, "password": PASSWORD,
                  "roles": roles, "place": place},
        )
        print(f"  created  {email:24} {'+'.join(roles)}")
    except RuntimeError as exc:
        if "already has an account" not in str(exc):
            raise
        session = await api.call(
            "POST", "/auth/login", json={"email": email, "password": PASSWORD}
        )
        print(f"  existing {email:24} {'+'.join(roles)}")
    return session


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="e.g. https://api.example.com")
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        api = Api(client, args.base_url)

        health = await api.call("GET", "/health")
        print(f"server reachable: {health}\n")

        print("accounts")
        sessions = {}
        for name, email, roles, place in PEOPLE:
            sessions[email] = await sign_in(api, name, email, roles, place)

        def tok(email: str) -> str:
            return sessions[email]["token"]

        print("\nreports")
        reports = []
        for email, title, desc, lat, lng, label, level, hazard, mins, payout in SPOTS:
            x, y = to_xy(lat, lng)
            report = await api.call(
                "POST", "/reports", token=tok(email),
                json={
                    "title": title, "description": desc,
                    "lat": lat, "lng": lng, "loc_x": x, "loc_y": y,
                    "loc_label": label, "level": level, "hazardous": hazard,
                    "est_minutes": mins, "payout": payout,
                    "client_id": str(uuid5(NS, title)),
                },
            )
            reports.append(report)
            flag = " [hazardous]" if hazard else ""
            print(f"  {report['status']:9} {title[:44]:44} {payout:>6} AMD{flag}")

        print("\ndonations")
        for email, amount, target in DONATIONS:
            donation = await api.call(
                "POST", "/donations", token=tok(email),
                json={"amount": amount, "target": target,
                      "client_id": str(uuid5(NS, f"{email}{amount}{target}"))},
            )
            print(f"  {email:24} {amount:>6} AMD -> {donation['target']}")

        # Earmarked money, so the draw-down has both kinds to draw from: the
        # payout engine must spend this before touching the general pot.
        earmarked_for = reports[0]
        await api.call(
            "POST", "/donations", token=tok("davit@havak.am"),
            json={"amount": 3000, "target": str(earmarked_for["id"]),
                  "client_id": str(uuid5(NS, "earmarked-0"))},
        )
        print(f"  {'davit@havak.am':24} {3000:>6} AMD -> earmarked: {earmarked_for['title'][:30]}")

        # Move a few spots through the lifecycle so every screen has something
        # real to show: two finished and paid, one waiting on the reporter, one
        # in progress, the rest left open.
        print("\nlifecycle")
        plan = [
            (reports[0], "mariam@havak.am", "confirm", 5),
            (reports[7], "vahe@havak.am", "confirm", 4),
            (reports[1], "vahe@havak.am", "cleaned", None),
            (reports[3], "mariam@havak.am", "claim", None),
        ]
        for report, cleaner, stage, rating in plan:
            rid = report["id"]
            # On a second run the report comes back at the status it reached last
            # time, and claiming it again would fail. Leave it where it is.
            if report["status"] != "open":
                print(f"  {report['status']:9} {report['title'][:44]:44} already seeded")
                continue

            await api.call("POST", f"/reports/{rid}/claim", token=tok(cleaner))
            if stage == "claim":
                print(f"  claimed   {report['title'][:44]:44} by {cleaner}")
                continue

            await api.call("POST", f"/reports/{rid}/cleaned", token=tok(cleaner))
            if stage == "cleaned":
                print(f"  cleaned   {report['title'][:44]:44} awaiting confirmation")
                continue

            # Only the reporting user may confirm, so the token has to be theirs.
            result = await api.call(
                "POST", f"/reports/{rid}/confirm",
                token=tok(_email_of(report)),
                json={"rating": rating},
            )
            paid = sum(a["amount"] for a in result["allocations"])
            short = result["shortfall"]
            print(
                f"  confirmed {report['title'][:44]:44} rated {rating}, "
                f"paid {paid} AMD from {len(result['allocations'])} donation(s)"
                + (f", shortfall {short}" if short else "")
            )

        pot = await api.call("GET", "/pot", token=tok("davit@havak.am"))
        print(f"\npot: {pot}")

        print("\ntokens for testing (Authorization: Bearer <token>)")
        for _, email, _, _ in PEOPLE:
            print(f"  {email:24} {sessions[email]['token']}")
        print(f"\nall accounts share the password: {PASSWORD}")
    return 0


def _email_of(report: dict) -> str:
    """Which seeded person reported this spot."""
    for email, title, *_ in SPOTS:
        if title == report["title"]:
            return email
    raise KeyError(report["title"])


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except RuntimeError as exc:
        print(f"\nseeding stopped: {exc}", file=sys.stderr)
        sys.exit(1)
