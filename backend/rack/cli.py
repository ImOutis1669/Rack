"""`rack` command-line tool."""

import argparse
import asyncio
import getpass
import json
import sys
from pathlib import Path
from typing import Any

from rack.api.auth import hash_password


def _hash_password() -> None:
    pw = getpass.getpass("New password: ")
    if len(pw) < 12:
        sys.exit("Use at least 12 characters.")
    if getpass.getpass("Repeat: ") != pw:
        sys.exit("Passwords differ.")
    print(hash_password(pw))
    print("Put this in .env as RACK_PASSWORD_HASH (wrap in single quotes).", file=sys.stderr)


async def _load_fixture(source: str, payload: dict[str, Any]) -> None:
    from rack.db import sessionmaker
    from rack.ingest import upsert_listings
    from rack.sources import ebay

    parsers = {"ebay": ebay.parse_search}
    listings = parsers[source](payload)
    async with sessionmaker()() as session:
        await upsert_listings(session, listings)  # deliberately leaves source_health untouched
        await session.commit()
    print(f"Loaded {len(listings)} {source} listings")


async def _refresh() -> None:
    from rack.worker.main import run_refresh

    await run_refresh()


async def _probe(source: str, query: str) -> list[dict[str, Any]]:
    """One live request; optionally record the raw response as a new fixture."""
    from rack.config import get_settings
    from rack.sources.base import SearchQuery
    from rack.sources.registry import build_adapters

    adapters = {a.name: a for a in build_adapters(get_settings())}
    adapter = adapters[source]
    listings = await adapter.search(SearchQuery(text=query, limit=20))
    for item in listings[:10]:
        print(f"{item.price_gbp!s:>8} GBP  {item.title[:70]}  {item.url}")
    print(f"{len(listings)} results")
    return [i.raw for i in listings]


def main() -> None:
    p = argparse.ArgumentParser(prog="rack")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hash-password", help="Generate RACK_PASSWORD_HASH")
    lf = sub.add_parser("load-fixture", help="Ingest a recorded source response (demo/dev)")
    lf.add_argument("source", choices=["ebay"])
    lf.add_argument("path", type=Path)
    sub.add_parser("refresh", help="Run one source refresh now")
    pr = sub.add_parser("probe", help="One live search against a source")
    pr.add_argument("source")
    pr.add_argument("query")
    pr.add_argument("--record", type=Path, default=None)
    args = p.parse_args()

    if args.cmd == "hash-password":
        _hash_password()
    elif args.cmd == "load-fixture":
        payload = json.loads(args.path.read_text(encoding="utf-8"))
        asyncio.run(_load_fixture(args.source, payload))
    elif args.cmd == "refresh":
        asyncio.run(_refresh())
    elif args.cmd == "probe":
        raw = asyncio.run(_probe(args.source, args.query))
        if args.record:
            # Wrapped as an itemSummaries payload so it loads with the same parser.
            body = json.dumps({"itemSummaries": raw}, indent=2, default=str)
            args.record.write_text(body, encoding="utf-8")
            print(f"Recorded raw items to {args.record}")


if __name__ == "__main__":
    main()
