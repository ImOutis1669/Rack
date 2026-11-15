"""Single-user auth: argon2 password hash from env, signed session cookie, login rate limit."""

import time
from collections import defaultdict, deque
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from rack.config import Settings, get_settings

COOKIE = "rack_session"
CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "rack"
MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60

router = APIRouter(prefix="/api/auth", tags=["auth"])
_hasher = PasswordHasher()


class LoginAttempts:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _prune(self, ip: str, now: float) -> deque[float]:
        q = self._hits[ip]
        while q and now - q[0] > WINDOW_SECONDS:
            q.popleft()
        return q

    def blocked(self, ip: str, now: float | None = None) -> bool:
        return len(self._prune(ip, now or time.time())) >= MAX_ATTEMPTS

    def fail(self, ip: str, now: float | None = None) -> None:
        self._hits[ip].append(now or time.time())

    def reset(self, ip: str) -> None:
        self._hits.pop(ip, None)


attempts = LoginAttempts()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def _serializer(settings: Settings) -> URLSafeTimedSerializer:
    if not settings.rack_session_secret:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "RACK_SESSION_SECRET not set")
    return URLSafeTimedSerializer(settings.rack_session_secret, salt="rack-session")


def client_ip(request: Request) -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or (request.client.host if request.client else None)
        or "unknown"
    )


def require_session(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    try:
        _serializer(settings).loads(token, max_age=settings.rack_session_days * 86400)
    except (BadSignature, SignatureExpired) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired") from exc
    if request.method not in ("GET", "HEAD", "OPTIONS") and (
        request.headers.get(CSRF_HEADER) != CSRF_VALUE
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")


class LoginBody(BaseModel):
    password: str


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
def login(
    body: LoginBody,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    ip = client_ip(request)
    if attempts.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts, try later")
    if not verify_password(body.password, settings.rack_password_hash):
        attempts.fail(ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong password")
    attempts.reset(ip)
    token = _serializer(settings).dumps({"u": "me"})
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


@router.get("/me", dependencies=[Depends(require_session)])
def me() -> dict[str, bool]:
    return {"authenticated": True}
