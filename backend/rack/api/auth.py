"""Accounts auth (v2.1): username + argon2 password per user, login rate limits, two kinds of
credential.

- Web app: a signed HttpOnly session cookie, plus the `X-Requested-With` CSRF header on writes.
- iOS app: a signed bearer token from `POST /api/auth/token`, sent as `Authorization: Bearer`
  and kept in the phone's Keychain. Browsers never attach that header on their own, so bearer
  requests need no CSRF header. Tokens use a different salt from cookies, so neither value works
  as the other. Logging out on the phone just deletes the token there (user's choice, iOS step 1),
  the same as the cookie's logout.

Both carry the user id, that user's server-side generation ("epoch") and a fingerprint of their
password hash, so "log out all devices" and changing the password invalidate every cookie and
token of that user (and nobody else's). Disabling or deleting a user ends their sessions too.
"""

import asyncio
import hashlib
import socket
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from rack.accounts import (
    MAX_PASSWORD,
    AccountError,
    check_display_name,
    check_password,
    check_username,
    ensure_owner,
    invite_hash,
    invite_status,
    normalize_username,
)
from rack.config import Settings, get_settings
from rack.db import get_session
from rack.models import InviteRow, UserRow

COOKIE = "rack_session"
APP_TOKEN_SALT = "rack-app-token"  # never "rack-session": a cookie must not work as a token
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "rack"
MAX_ATTEMPTS = 5  # per client IP, and per username, per window
GLOBAL_MAX_ATTEMPTS = 60  # across all IPs per window: can't be dodged by changing IP
WINDOW_SECONDS = 15 * 60
MAX_TRACKED_IPS = 10_000
MIN_SECRET_LENGTH = 32
USER_CACHE_SECONDS = 5.0
ACTIVE_EVERY = timedelta(hours=1)  # how often last_active_at is written
FAILED = "Wrong username or password"

router = APIRouter(prefix="/api/auth", tags=["auth"])
_hasher = PasswordHasher()


class LoginAttempts:
    """Failures per key (client IP, or username) in a sliding window, plus an optional cap on
    all failures together."""

    def __init__(self, global_cap: int | None = GLOBAL_MAX_ATTEMPTS) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()
        self._global_cap = global_cap

    @staticmethod
    def _prune(q: deque[float], now: float) -> deque[float]:
        while q and now - q[0] > WINDOW_SECONDS:
            q.popleft()
        return q

    def blocked(self, ip: str, now: float | None = None) -> bool:
        now = now or time.time()
        if self._global_cap is not None and len(self._prune(self._all, now)) >= self._global_cap:
            return True
        if ip not in self._hits:
            return False
        return len(self._prune(self._hits[ip], now)) >= MAX_ATTEMPTS

    def fail(self, ip: str, now: float | None = None) -> None:
        now = now or time.time()
        if ip not in self._hits and len(self._hits) >= MAX_TRACKED_IPS:
            # bounded memory: forget per-IP history; the global cap still applies
            self._hits.clear()
        self._hits[ip].append(now)
        self._all.append(now)

    def reset(self, ip: str) -> None:
        self._hits.pop(ip, None)

    def clear(self) -> None:
        self._hits.clear()
        self._all.clear()


attempts = LoginAttempts()  # per client IP + the global cap
user_attempts = LoginAttempts(global_cap=None)  # per username (also unknown ones: no oracle)
signup_attempts = LoginAttempts(global_cap=20)  # bad invite codes per IP, and in total


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("$argon2"):
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _serializer(settings: Settings, salt: str = "rack-session") -> URLSafeTimedSerializer:
    secret = settings.rack_session_secret
    if len(secret) < MIN_SECRET_LENGTH:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"RACK_SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters",
        )
    return URLSafeTimedSerializer(secret, salt=salt)


def password_fingerprint(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


# Unknown usernames are checked against this, so they take as long as real ones.
_DUMMY_HASH = _hasher.hash("rack-no-such-user-" + hashlib.sha256(b"rack").hexdigest())


# --- trusted proxy (the cloudflared container) ---

_trusted: tuple[float, frozenset[str]] = (0.0, frozenset())


def _resolve(names: list[str]) -> frozenset[str]:
    ips: set[str] = set()
    for name in names:
        try:
            for info in socket.getaddrinfo(name, None):
                ips.add(str(info[4][0]))
        except OSError:
            continue  # e.g. tunnel profile not running
    return frozenset(ips)


async def trusted_proxy_ips(settings: Settings) -> frozenset[str]:
    """IPs of the tunnel container. Re-resolved every minute; a failed lookup (tunnel not
    running) is remembered for 10 minutes and never delays a login by more than a second."""
    global _trusted
    at, ips = _trusted
    ttl = 60 if ips else 600
    if at == 0.0 or time.monotonic() - at > ttl:
        names = [n.strip() for n in settings.rack_trusted_proxies.split(",") if n.strip()]
        try:
            ips = await asyncio.wait_for(asyncio.to_thread(_resolve, names), timeout=1.0)
        except TimeoutError:
            ips = frozenset()
        _trusted = (time.monotonic(), ips)
    return ips


def client_ip(request: Request, trusted: frozenset[str]) -> str:
    """The TCP peer, unless the peer is our own tunnel, which reports the real client IP."""
    peer = request.client.host if request.client else "unknown"
    if peer in trusted:
        return request.headers.get("CF-Connecting-IP") or peer
    return peer


# --- session generation ---


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    display_name: str
    role: str
    epoch: int
    fingerprint: str
    active: bool
    last_active_at: datetime | None

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"


_user_cache: dict[int, tuple[float, CurrentUser | None]] = {}


def reset_caches() -> None:
    global _trusted
    _user_cache.clear()
    _trusted = (0.0, frozenset())


def forget_user(user_id: int) -> None:
    """Call after changing a user's epoch, password, role or disabled state."""
    _user_cache.pop(user_id, None)


def _current(row: UserRow) -> CurrentUser:
    return CurrentUser(
        id=row.id,
        username=row.username,
        display_name=row.display_name,
        role=row.role,
        epoch=row.session_epoch,
        fingerprint=password_fingerprint(row.password_hash),
        active=row.disabled_at is None,
        last_active_at=row.last_active_at,
    )


async def load_user(session: AsyncSession, user_id: int) -> CurrentUser | None:
    at, user = _user_cache.get(user_id, (0.0, None))
    if at == 0.0 or time.monotonic() - at > USER_CACHE_SECONDS:
        row = await session.get(UserRow, user_id, populate_existing=True)
        user = _current(row) if row is not None else None
        if len(_user_cache) > 1000:
            _user_cache.clear()
        _user_cache[user_id] = (time.monotonic(), user)
    return user


def _claims(user: CurrentUser) -> dict[str, object]:
    return {"u": user.id, "e": user.epoch, "p": user.fingerprint}


async def _check_claims(
    value: str, salt: str, settings: Settings, session: AsyncSession
) -> CurrentUser:
    """A cookie or bearer value must be signed with `salt`, unexpired, and match its user's
    current epoch and password, and the user must exist and be enabled."""
    try:
        data = _serializer(settings, salt).loads(value, max_age=settings.rack_session_days * 86400)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired") from exc
    uid = data.get("u") if isinstance(data, dict) else None
    if not isinstance(uid, int) or isinstance(uid, bool):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended")
    user = await load_user(session, uid)
    if (
        user is None
        or not user.active
        or data.get("e") != user.epoch
        or data.get("p") != user.fingerprint
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended")
    return user


async def _touch(session: AsyncSession, user: CurrentUser) -> None:
    now = datetime.now(UTC)
    if user.last_active_at is not None and now - user.last_active_at < ACTIVE_EVERY:
        return
    await session.execute(update(UserRow).where(UserRow.id == user.id).values(last_active_at=now))
    await session.commit()
    forget_user(user.id)


async def require_user(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CurrentUser:
    authorization = request.headers.get("Authorization")
    if authorization is not None:
        # iOS app. If the header is there, only the header counts (no falling back to a cookie).
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() != "bearer" or not value.strip():
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
        user = await _check_claims(value.strip(), APP_TOKEN_SALT, settings, session)
        await _touch(session, user)
        return user  # no CSRF check: a browser never sends this header by itself
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    user = await _check_claims(token, "rack-session", settings, session)
    if request.method not in ("GET", "HEAD", "OPTIONS") and (
        request.headers.get(CSRF_HEADER) != CSRF_VALUE
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")
    await _touch(session, user)
    return user


# Older name: routers mount it as a dependency. Step 2 makes every query take the user.
require_session = require_user
User = Annotated[CurrentUser, Depends(require_user)]


async def require_owner(user: User) -> CurrentUser:
    if not user.is_owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can do that")
    return user


def _require_csrf(request: Request) -> None:
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")


class LoginBody(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=MAX_PASSWORD * 4)


async def _verify_login(
    body: LoginBody, request: Request, settings: Settings, session: AsyncSession
) -> CurrentUser:
    """Checks username + password under the shared rate limits. Unknown, disabled and wrong
    all look the same from outside (message, status and timing)."""
    ip = client_ip(request, await trusted_proxy_ips(settings))
    name = normalize_username(body.username)[:32]
    if attempts.blocked(ip) or user_attempts.blocked(name):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    await ensure_owner(session, settings)
    row = await session.scalar(select(UserRow).where(UserRow.username == name))
    ok = await asyncio.to_thread(
        verify_password, body.password, row.password_hash if row else _DUMMY_HASH
    )
    if not ok or row is None or row.disabled_at is not None:
        attempts.fail(ip)
        user_attempts.fail(name)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, FAILED)
    attempts.reset(ip)
    user_attempts.reset(name)
    forget_user(row.id)
    return _current(row)


def _set_cookie(response: Response, settings: Settings, user: CurrentUser) -> None:
    response.set_cookie(
        COOKIE,
        _serializer(settings).dumps(_claims(user)),
        max_age=settings.rack_session_days * 86400,
        httponly=True,
        secure=settings.rack_cookie_secure,
        samesite="lax",
        path="/",
    )


def _app_token(settings: Settings, user: CurrentUser) -> str:
    return _serializer(settings, APP_TOKEN_SALT).dumps(_claims(user))


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    # Login CSRF (audit 2026-11-17, RACK-22): a cross-site form must not be able to sign a
    # browser into someone else's account. The web app always sends this header.
    _require_csrf(request)
    _set_cookie(response, settings, await _verify_login(body, request, settings, session))


class AppToken(BaseModel):
    token: str
    expires_in: int  # seconds


@router.post("/token")
async def app_token(
    body: LoginBody,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AppToken:
    """Login for the iOS app: same accounts and rate limits as /login, but returns a bearer
    token for the Keychain instead of setting a cookie."""
    user = await _verify_login(body, request, settings, session)
    response.headers["Cache-Control"] = "no-store"
    return AppToken(token=_app_token(settings, user), expires_in=settings.rack_session_days * 86400)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT)
async def logout_all(
    user: User, response: Response, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    """End every one of your sessions on every device (including this one). Other users'
    sessions are untouched."""
    await session.execute(
        update(UserRow).where(UserRow.id == user.id).values(session_epoch=UserRow.session_epoch + 1)
    )
    await session.commit()
    forget_user(user.id)
    response.delete_cookie(COOKIE, path="/")


class MeOut(BaseModel):
    authenticated: bool = True
    id: int
    username: str
    display_name: str
    role: str


@router.get("/me")
def me(user: User) -> MeOut:
    return MeOut(id=user.id, username=user.username, display_name=user.display_name, role=user.role)


class PasswordBody(BaseModel):
    current_password: str = Field(max_length=MAX_PASSWORD * 4)
    new_password: str = Field(max_length=MAX_PASSWORD * 4)


class PasswordOut(BaseModel):
    token: str | None = None  # a fresh app token when you changed it from the app


@router.post("/password")
async def change_password(
    body: PasswordBody,
    user: User,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PasswordOut:
    """Change your password. Every session of yours ends, except this one, which gets a new
    cookie (web) or token (app)."""
    ip = client_ip(request, await trusted_proxy_ips(settings))
    if attempts.blocked(ip) or user_attempts.blocked(user.username):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    row = await session.get(UserRow, user.id)
    assert row is not None  # require_user just loaded it
    if not await asyncio.to_thread(verify_password, body.current_password, row.password_hash):
        attempts.fail(ip)
        user_attempts.fail(user.username)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is wrong")
    try:
        check_password(body.new_password, user.username)
    except AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    row.password_hash = await asyncio.to_thread(hash_password, body.new_password)
    await session.commit()
    forget_user(user.id)
    fresh = _current(row)
    response.headers["Cache-Control"] = "no-store"
    if request.headers.get("Authorization") is not None:
        return PasswordOut(token=_app_token(settings, fresh))
    _set_cookie(response, settings, fresh)
    return PasswordOut()


class SignupBody(BaseModel):
    invite: str = Field(max_length=100)
    username: str = Field(max_length=64)
    password: str = Field(max_length=MAX_PASSWORD * 4)
    display_name: str | None = Field(default=None, max_length=200)


@router.post("/signup", status_code=status.HTTP_204_NO_CONTENT)
async def signup(
    body: SignupBody,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    """Create a friend account with a single-use invite, then log in (web cookie). Every bad,
    used, revoked or expired code gets the same answer, and bad codes are rate limited."""
    _require_csrf(request)  # a cross-site form must not sign a browser into someone's account
    ip = client_ip(request, await trusted_proxy_ips(settings))
    if signup_attempts.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    invite = await session.scalar(
        select(InviteRow).where(InviteRow.code_hash == invite_hash(body.invite)).with_for_update()
    )
    if invite is None or invite_status(invite) != "open":
        signup_attempts.fail(ip)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invite link doesn't work any more")
    try:
        username = check_username(body.username)
        check_password(body.password, username)
        display = check_display_name(body.display_name, username)
    except AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    if await session.scalar(select(UserRow.id).where(UserRow.username == username)):
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken")
    row = UserRow(
        username=username,
        display_name=display,
        password_hash=await asyncio.to_thread(hash_password, body.password),
        role="friend",
    )
    session.add(row)
    await session.flush()
    invite.used_at = datetime.now(UTC)
    invite.used_by = row.id
    try:
        await session.commit()
    except Exception as exc:  # e.g. the same username in a parallel request
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is taken") from exc
    signup_attempts.reset(ip)
    _set_cookie(response, settings, _current(row))
