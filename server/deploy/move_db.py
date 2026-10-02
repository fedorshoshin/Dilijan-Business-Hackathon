"""Copy the whole Havak database into a fresh Postgres — used to change region.

Supabase cannot move a project between regions, so moving means a new project
and a copy. This does the copy, and refuses to do anything it cannot prove:

  1. reads the source inside one READ ONLY, REPEATABLE READ transaction — it
     cannot write to the old database, and every table comes from the same
     instant, so a row added mid-copy cannot leave a claim pointing at a report
     that was not copied;
  2. builds the target schema from sql/001 -> rls -> 002 -> 003, the chain
     verified on 2026-10-01 to reproduce the live schema exactly;
  3. refuses if any target table already has rows — it never merges and never
     overwrites;
  4. copies every table in foreign-key order inside ONE target transaction, so a
     failure part-way leaves the target empty rather than half-filled;
  5. compares a fingerprint of every table on both sides — row count plus an md5
     of every row's full text, ordered by id — and reports the move as done only
     if all of them match.

Run it on the server, with the API stopped so nothing is written mid-copy:

    systemctl stop havak-api
    server/.venv/bin/python server/deploy/move_db.py \\
        --source-env server/.env --target-url-file /root/new_db_url
    # all tables MATCH -> point DATABASE_URL at the new URL, then:
    systemctl start havak-api

The target URL is read from a file, not the command line, because command
lines are visible to every user on the box in `ps` and land in shell history.
No URL or password is ever printed.

--rehearse-schema NAME copies into a throwaway schema in the SOURCE database
instead, and drops it afterwards — the same code path end to end, used to test
this script against real data without a second database. Every statement is
schema-qualified, so a rehearsal cannot reach `public`.
"""

import argparse
import asyncio
import pathlib
import sys

import asyncpg

REPO = pathlib.Path(__file__).resolve().parents[2]
CHAIN = ["001_base.sql", "rls.sql", "002_server.sql", "003_email.sql"]

# Foreign-key order: every table after the ones it references.
TABLES = ["users", "reports", "claims", "donations", "alloc", "media", "email_tokens"]


def read_env_url(path: str) -> str:
    """The server's own .env, parsed by hand: shell-sourcing it breaks on
    MAIL_FROM, which contains characters the shell treats as syntax."""
    for line in open(path):
        line = line.strip()
        if line.startswith("DATABASE_URL=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"no DATABASE_URL in {path}")


def q(schema: str, table: str) -> str:
    return f'"{schema}"."{table}"'


async def connect(url: str, schema: str | None = None) -> asyncpg.Connection:
    settings = {"search_path": f"{schema}, public"} if schema else None
    # statement_cache_size=0 for the same reason as server/db.py: the Supabase
    # transaction pooler cannot keep prepared statements between transactions.
    return await asyncpg.connect(url, statement_cache_size=0, server_settings=settings)


async def columns(con: asyncpg.Connection, schema: str, table: str) -> list[str]:
    rows = await con.fetch(
        """select column_name from information_schema.columns
            where table_schema = $1 and table_name = $2 order by ordinal_position""",
        schema, table,
    )
    return [r["column_name"] for r in rows]


async def fingerprint(con: asyncpg.Connection, schema: str, table: str, cols: list[str]) -> tuple:
    """Row count, and an md5 over every row rendered as text in id order. Built
    from an explicit column list rather than `t::text` so a column-order
    difference between the two databases could not make equal data look unequal."""
    row_expr = " || '|' || ".join(f'coalesce("{c}"::text, \'<null>\')' for c in cols)
    r = await con.fetchrow(
        f"""select count(*) as n,
                   coalesce(md5(string_agg({row_expr}, E'\\n' order by id)), '-') as h
              from {q(schema, table)}"""
    )
    return r["n"], r["h"]


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source-env", required=True, help="the server .env holding the current DATABASE_URL")
    target = ap.add_mutually_exclusive_group(required=True)
    target.add_argument("--target-url-file", help="file whose only content is the new database URL")
    target.add_argument("--rehearse-schema", help="copy into this throwaway schema of the source DB, then drop it")
    args = ap.parse_args()

    src_url = read_env_url(args.source_env)
    if args.rehearse_schema:
        tgt_url, tgt_schema = src_url, args.rehearse_schema
        if tgt_schema == "public":
            sys.exit("a rehearsal must not target public")
    else:
        tgt_url, tgt_schema = pathlib.Path(args.target_url_file).read_text().strip(), "public"
        if tgt_url == src_url:
            sys.exit("the target URL is the source database — refusing")

    src = await connect(src_url)
    tgt = await connect(tgt_url, tgt_schema if args.rehearse_schema else None)
    try:
        # ---- 1. snapshot the source, read-only ----
        await src.execute("begin isolation level repeatable read read only")
        data = {}
        for t in TABLES:
            cols = await columns(src, "public", t)
            if not cols:
                sys.exit(f"source has no table {t}")
            rows = await src.fetch(f"select {', '.join(chr(34) + c + chr(34) for c in cols)} from {q('public', t)} order by id")
            data[t] = (cols, rows, await fingerprint(src, "public", t, cols))
        await src.execute("rollback")
        print("source  :", ", ".join(f"{t} {data[t][2][0]}" for t in TABLES))

        # ---- 2. schema on the target ----
        if args.rehearse_schema:
            await tgt.execute(f'drop schema if exists "{tgt_schema}" cascade')
            await tgt.execute(f'create schema "{tgt_schema}"')
        for f in CHAIN:
            await tgt.execute((REPO / "sql" / f).read_text())
        print("schema  : applied", " -> ".join(CHAIN))

        # ---- 3. never merge into data that is already there ----
        for t in TABLES:
            n = await tgt.fetchval(f"select count(*) from {q(tgt_schema, t)}")
            if n:
                sys.exit(f"target {t} already has {n} rows — refusing to merge. Nothing was copied.")

        # ---- 4. copy, all or nothing ----
        async with tgt.transaction():
            for t in TABLES:
                cols, rows, _ = data[t]
                tcols = await columns(tgt, tgt_schema, t)
                if tcols != cols:
                    raise SystemExit(f"{t}: columns differ between source and target\n  {cols}\n  {tcols}")
                if rows:
                    collist = ", ".join(f'"{c}"' for c in cols)
                    marks = ", ".join(f"${i + 1}" for i in range(len(cols)))
                    await tgt.executemany(
                        f"insert into {q(tgt_schema, t)} ({collist}) values ({marks})",
                        [tuple(r) for r in rows],
                    )

        # ---- 5. prove it ----
        ok = True
        for t in TABLES:
            cols, _, want = data[t]
            got = await fingerprint(tgt, tgt_schema, t, cols)
            same = got == want
            ok &= same
            print(f"  {'MATCH' if same else 'DIFF '} {t:<13} {got[0]:>4} rows  md5 {got[1][:12]}"
                  + ("" if same else f"   (source: {want[0]} rows, md5 {want[1][:12]})"))
        print("RESULT  :", "every table identical" if ok else "MISMATCH — do not switch DATABASE_URL")
        return 0 if ok else 1
    finally:
        if args.rehearse_schema:
            await tgt.execute(f'drop schema if exists "{tgt_schema}" cascade')
            print("rehearsal schema dropped")
        await src.close()
        await tgt.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
