"""Single-user auth: argon2 password hash from env, signed session cookie, login rate limits.

Sessions carry a server-side generation ("epoch") and a fingerprint of the password hash, so
"log out all devices" and changing the password both invalidate every outstanding cookie.
"""

import asyncio
import hashlib
import socket
import time
from collections import defaultdict, deque
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from rack.config import Settings, get_settings
from rack.db import get_session
from rack.store import get_state, set_state

COOKIE = "rack_session"
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "rack"
MAX_ATTEMPTS = 5  # per client IP per window
GLOBAL_MAX_ATTEMPTS = 30  # across all IPs per window: can't be dodged by changing IP
WINDOW_SECONDS = 15 * 60
MAX_TRACKED_IPS = 10_000
MIN_SECRET_LENGTH = 32
EPOCH_CACHE_SECONDS = 5.0

router = APIRouter(prefix="/api/auth", tags=["auth"])
_hasher = PasswordHasher()


class LoginAttempts:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._all: deque[float] = deque()

    @staticmethod
    def _prune(q: deque[float], now: float) -> deque[float]:
        while q and now - q[0] > WINDOW_SECONDS:
            q.popleft()
        return q

    def blocked(self, ip: str, now: float | None = None) -> bool:
        now = now or time.time()
        if len(self._prune(self._all, now)) >= GLOBAL_MAX_ATTEMPTS:
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


attempts = LoginAttempts()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash.startswith("$argon2"):
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    secret = settings.rack_session_secret
    if len(secret) < MIN_SECRET_LENGTH:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"RACK_SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters",
        )
    return URLSafeTimedSerializer(secret, salt="rack-session")


def password_fingerprint(password_hash: str) -> str:
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


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

_epoch_cache: tuple[float, int] = (0.0, -1)


def reset_caches() -> None:
    global _epoch_cache, _trusted
    _epoch_cache = (0.0, -1)
    _trusted = (0.0, frozenset())


async def current_epoch(session: AsyncSession) -> int:
    global _epoch_cache
    at, epoch = _epoch_cache
    if epoch < 0 or time.monotonic() - at > EPOCH_CACHE_SECONDS:
        epoch = int((await get_state(session, "auth")).get("epoch", 0))
        _epoch_cache = (time.monotonic(), epoch)
    return epoch


async def require_session(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    try:
        data = _serializer(settings).loads(token, max_age=settings.rack_session_days * 86400)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired") from exc
    if (
        not isinstance(data, dict)
        or data.get("e") != await current_epoch(session)
        or data.get("p") != password_fingerprint(settings.rack_password_hash)
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended")
    if request.method not in ("GET", "HEAD", "OPTIONS") and (
        request.headers.get(CSRF_HEADER) != CSRF_VALUE
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")


class LoginBody(BaseModel):
    password: str


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(
    body: LoginBody,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> None:
    ip = client_ip(request, await trusted_proxy_ips(settings))
    if attempts.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    ok = await asyncio.to_thread(verify_password, body.password, settings.rack_password_hash)
    if not ok:
        attempts.fail(ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    attempts.reset(ip)
    token = _serializer(settings).dumps(
        {"e": await current_epoch(session), "p": password_fingerprint(settings.rack_password_hash)}
    )
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.rack_session_days * 86400,
        httponly=True,
        secure=settings.rack_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


@router.post(
    "/logout-all", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_session)]
)
async def logout_all(
    response: Response, session: Annotated[AsyncSession, Depends(get_session)]
) -> None:
    """End every session on every device (including this one)."""
    global _epoch_cache
    state = await get_state(session, "auth")
    epoch = int(state.get("epoch", 0)) + 1
    await set_state(session, "auth", {**state, "epoch": epoch})
    await session.commit()
    _epoch_cache = (time.monotonic(), epoch)
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", dependencies=[Depends(require_session)])
def me() -> dict[str, bool]:
    return {"authenticated": True}
