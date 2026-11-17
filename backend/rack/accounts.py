"""Accounts (v2.1): username and password rules, invite codes, and the owner bootstrap.

Pure helpers plus the few DB functions auth and admin share. No FastAPI here.
"""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from rack.config import Settings
from rack.models import InviteRow, UserRow
from rack.store import get_state

USERNAME_RE = re.compile(r"^[a-z0-9_.]{3,24}$")
RESERVED = frozenset(
    {"admin", "administrator", "root", "rack", "system", "support", "api", "null", "undefined"}
)
MIN_PASSWORD = 12
MAX_PASSWORD = 256  # argon2 cost grows with length; don't let a request make us hash megabytes
MAX_DISPLAY_NAME = 60
INVITE_BYTES = 16  # 128 bits

# A short list of passwords that pass the length rule but are guessed first anyway.
COMMON_PASSWORDS = frozenset(
    {
        "123456789012",
        "1234567890123",
        "12345678901234",
        "password1234",
        "password12345",
        "password123!",
        "passwordpassword",
        "qwertyuiopas",
        "qwerty123456",
        "qwertyqwerty",
        "111111111111",
        "000000000000",
        "aaaaaaaaaaaa",
        "abcdefghijkl",
        "abc123abc123",
        "iloveyou1234",
        "letmein12345",
        "welcome12345",
        "changeme1234",
        "football1234",
        "baseball1234",
        "monkey123456",
        "dragon123456",
        "sunshine1234",
        "princess1234",
        "trustno1trustno1",
        "1q2w3e4r5t6y",
        "1qaz2wsx3edc",
        "zaq12wsxcde3",
        "asdfghjkl123",
        "correcthorsebatterystaple",
        "passw0rdpassw0rd",
        "administrator",
        "rackrackrack",
    }
)


class AccountError(ValueError):
    """A rule was broken; the message is safe to show to the person signing up."""


def normalize_username(raw: str) -> str:
    return raw.strip().lower()


def check_username(raw: str) -> str:
    name = normalize_username(raw)
    if not USERNAME_RE.fullmatch(name):
        raise AccountError("Usernames are 3-24 characters: letters, numbers, _ and .")
    if name in RESERVED or name.strip("._") == "":
        raise AccountError("Pick another username")
    return name


def check_password(password: str, username: str = "") -> None:
    if len(password) < MIN_PASSWORD:
        raise AccountError(f"Use at least {MIN_PASSWORD} characters")
    if len(password) > MAX_PASSWORD:
        raise AccountError(f"Use at most {MAX_PASSWORD} characters")
    lowered = password.lower()
    if lowered in COMMON_PASSWORDS or len(set(password)) < 4:
        raise AccountError("That password is too easy to guess")
    if username and username in lowered:
        raise AccountError("Don't put your username in your password")


def check_display_name(raw: str | None, fallback: str) -> str:
    name = " ".join((raw or "").split())  # also drops control characters like newlines/tabs
    name = "".join(ch for ch in name if ch.isprintable())
    if len(name) > MAX_DISPLAY_NAME:
        raise AccountError(f"Names are at most {MAX_DISPLAY_NAME} characters")
    return name or fallback


def new_invite_code() -> str:
    return secrets.token_urlsafe(INVITE_BYTES)


def invite_hash(code: str) -> str:
    return hashlib.sha256(code.strip().encode()).hexdigest()


def invite_status(row: InviteRow, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    if row.used_at:
        return "used"
    if row.revoked_at:
        return "revoked"
    if row.expires_at <= now:
        return "expired"
    return "open"


def invite_expiry(settings: Settings, now: datetime | None = None) -> datetime:
    return (now or datetime.now(UTC)) + timedelta(days=settings.rack_invite_days)


async def ensure_owner(session: AsyncSession, settings: Settings) -> None:
    """Create the owner from RACK_PASSWORD_HASH if there are no accounts yet.

    Keeps the single-user session epoch, so "log out everywhere" history carries over (cookies
    from before v2.1 carry no user id and stop working anyway: one more login)."""
    if await session.scalar(select(func.count()).select_from(UserRow)):
        return
    if not settings.rack_password_hash.startswith("$argon2"):
        return  # nobody can log in until it is set (config_problems logs why)
    try:
        username = check_username(settings.rack_owner_username)
    except AccountError:
        username = "owner"
    try:  # the name as written ("Outis"); the username is its lowercase form
        display = check_display_name(settings.rack_owner_username, username)
    except AccountError:
        display = username
    epoch = int((await get_state(session, "auth")).get("epoch", 0))
    session.add(
        UserRow(
            username=username,
            display_name=display,
            password_hash=settings.rack_password_hash,
            role="owner",
            session_epoch=epoch,
        )
    )
    try:
        await session.commit()
    except IntegrityError:  # another request created it first
        await session.rollback()
