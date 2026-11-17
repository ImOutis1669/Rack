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


async def _reset_password(username: str) -> None:
    """Recovery: set a user's password and end all their sessions (the env hash only creates
    the owner once, so it can't be used to reset it later)."""
    from sqlalchemy import select

    from rack.accounts import AccountError, check_password, normalize_username
    from rack.db import sessionmaker
    from rack.models import UserRow

    async with sessionmaker()() as session:
        row = await session.scalar(
            select(UserRow).where(UserRow.username == normalize_username(username))
        )
        if row is None:
            sys.exit("No such user.")
        pw = getpass.getpass("New password: ")
        try:
            check_password(pw, row.username)
        except AccountError as exc:
            sys.exit(str(exc))
        if getpass.getpass("Repeat: ") != pw:
            sys.exit("Passwords differ.")
        row.password_hash = hash_password(pw)
        row.session_epoch += 1
        await session.commit()
    print(f"Password changed for {row.username}; their sessions have ended.")


async def _users() -> None:
    from sqlalchemy import select

    from rack.db import sessionmaker
    from rack.models import UserRow

    async with sessionmaker()() as session:
        for r in (await session.execute(select(UserRow).order_by(UserRow.id))).scalars():
            state = "disabled" if r.disabled_at else "active"
            print(f"{r.id:>4}  {r.username:<24} {r.role:<7} {state}")


async def _load_fixture(source: str, path: Path) -> None:
    from rack.db import sessionmaker
    from rack.ingest import upsert_listings
    from rack.sources import ebay, grailed, vinted

    text = await asyncio.to_thread(path.read_text, encoding="utf-8")
    if source == "ebay":
        listings = ebay.parse_search(json.loads(text))
    elif source == "grailed":
        listings = grailed.parse_results(json.loads(text))
    else:
        listings = vinted.parse_page(text)
    async with sessionmaker()() as session:
        await upsert_listings(session, listings)  # deliberately leaves source_health untouched
        await session.commit()
    print(f"Loaded {len(listings)} {source} listings")


async def _refresh() -> None:
    from rack.worker.main import run_refresh

    await run_refresh()


async def _probe(source: str, query: str, record: Path | None) -> None:
    """One live request; optionally record the raw response as a new fixture."""
    from rack.config import get_settings
    from rack.sources import grailed, vinted
    from rack.sources.base import SearchQuery
    from rack.sources.registry import build_adapters

    settings = get_settings()
    adapters: dict[str, Any] = {a.name: a for a in build_adapters(settings)}
    adapter = adapters[source]
    q = SearchQuery(text=query, limit=100)
    try:
        if isinstance(adapter, vinted.VintedAdapter):
            html = await adapter.fetch_page(q)
            listings = vinted.parse_page(html)
            body = vinted.trim_page(html)
        elif isinstance(adapter, grailed.GrailedAdapter):
            payload = await adapter.fetch(q)
            listings = grailed.parse_results(payload)
            payload = {
                "hits": [
                    {k: v for k, v in h.items() if k != "_highlightResult"}
                    for h in payload.get("hits", [])
                ]
            }
            body = json.dumps(payload, indent=1, ensure_ascii=False)
        else:
            listings = await adapter.search(q)
            # Wrapped as an itemSummaries payload so it loads with the same parser.
            body = json.dumps({"itemSummaries": [i.raw for i in listings]}, indent=2, default=str)
    finally:
        close = getattr(adapter, "aclose", None)
        if close:
            await close()
    for item in listings[:10]:
        brand, size = item.brand or "-", item.size or "-"
        print(f"{item.price_gbp!s:>8} GBP  {brand:<16} {size:<10} {item.title[:60]}")
    print(f"{len(listings)} results")
    if record:
        await asyncio.to_thread(record.write_text, body, encoding="utf-8")
        print(f"Recorded to {record}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # Windows consoles can't print every character
    p = argparse.ArgumentParser(prog="rack")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hash-password", help="Generate RACK_PASSWORD_HASH")
    rp = sub.add_parser("reset-password", help="Set a user's password (ends their sessions)")
    rp.add_argument("username")
    sub.add_parser("users", help="List accounts")
    sub.add_parser("vapid-keys", help="Generate VAPID keys for Web Push")
    lf = sub.add_parser("load-fixture", help="Ingest a recorded source response (demo/dev)")
    lf.add_argument("source", choices=["ebay", "vinted", "grailed"])
    lf.add_argument("path", type=Path)
    sub.add_parser("refresh", help="Run one source refresh now")
    pr = sub.add_parser("probe", help="One live search against a source")
    pr.add_argument("source")
    pr.add_argument("query")
    pr.add_argument("--record", type=Path, default=None)
    args = p.parse_args()

    if args.cmd == "hash-password":
        _hash_password()
    elif args.cmd == "reset-password":
        asyncio.run(_reset_password(args.username))
    elif args.cmd == "users":
        asyncio.run(_users())
    elif args.cmd == "vapid-keys":
        from rack.notify.webpush import generate_vapid_keys

        public, private = generate_vapid_keys()
        print(f"VAPID_PUBLIC_KEY={public}\nVAPID_PRIVATE_KEY={private}")
        print("Add both lines to .env and restart (keep the private key secret).", file=sys.stderr)
    elif args.cmd == "load-fixture":
        asyncio.run(_load_fixture(args.source, args.path))
    elif args.cmd == "refresh":
        asyncio.run(_refresh())
    elif args.cmd == "probe":
        asyncio.run(_probe(args.source, args.query, args.record))


if __name__ == "__main__":
    main()
