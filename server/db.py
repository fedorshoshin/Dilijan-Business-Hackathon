"""Postgres access — a connection pool and three thin helpers.

Raw SQL on purpose. The schema is six tables agreed in BACKEND.md and it is not
going to grow legs; an ORM would add a layer of indirection over queries that
are already the clearest description of what happens.
"""

import json
import os
from contextlib import asynccontextmanager

import asyncpg

_pool: asyncpg.Pool | None = None


async def _init_connection(con: asyncpg.Connection) -> None:
    """Hand back parsed objects for json columns instead of strings.

    The report queries assemble nested reporter/cleaner objects with
    jsonb_build_object; without this codec asyncpg would return them as raw text
    and every caller would have to remember to json.loads it.
    """
    for kind in ("json", "jsonb"):
        await con.set_type_codec(
            kind, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def connect() -> None:
    """Open the pool. Called once on startup."""
    global _pool
    url = os.environ["DATABASE_URL"]
    _pool = await asyncpg.create_pool(
        url,
        init=_init_connection,
        min_size=1,
        max_size=int(os.getenv("DB_POOL_MAX", "10")),
        # Supabase's pooler does not support prepared statements; disabling the
        # cache keeps this working on both the pooler (port 6543) and a direct
        # connection (5432).
        statement_cache_size=0,
        command_timeout=30,
    )


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool is not open")
    return _pool


async def fetch(sql: str, *args) -> list[dict]:
    async with pool().acquire() as con:
        return [dict(r) for r in await con.fetch(sql, *args)]


async def fetchrow(sql: str, *args) -> dict | None:
    async with pool().acquire() as con:
        row = await con.fetchrow(sql, *args)
        return dict(row) if row else None


async def execute(sql: str, *args) -> str:
    async with pool().acquire() as con:
        return await con.execute(sql, *args)


@asynccontextmanager
async def transaction():
    """Yield a connection inside a transaction.

    Used by the two operations that cannot be a single statement: claiming a
    report and paying for one.
    """
    async with pool().acquire() as con:
        async with con.transaction():
            yield con
