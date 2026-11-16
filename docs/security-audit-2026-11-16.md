# Rack security audit (2026-11-16)

Run against commit `e242a1b` using `docs/security-audit-prompt.md`. The fixes below are **proposed,
not applied**.

## Phase 0: scope and threat model
The prompt asks scoping questions first. They were already answered while building Rack, so here
they are as assumptions:

| Question | Answer |
|---|---|
| Languages / frameworks | Python 3.12 (FastAPI, SQLAlchemy 2 async, asyncpg, APScheduler), React 18 + Vite PWA, Postgres 16 + pgvector |
| Purpose / sensitivity | Single-user personal app. Holds API keys (eBay, Grailed, Apify, Anthropic, Telegram, VAPID, Cloudflare tunnel), taste data and uploaded wardrobe photos. No payments, no other users. |
| Critical dependencies | FastAPI/Starlette, itsdangerous, argon2-cffi, httpx, Pillow, pywebpush, anthropic, open_clip/torch |
| Deployment | Docker Desktop on the owner's Windows PC; public over HTTPS via Cloudflare Tunnel (plus Cloudflare Access, recommended); optional LAN mode (`RACK_BIND=0.0.0.0`) |
| Code access | Full repository |

**Threats prioritised:**
1. Internet attackers reaching the login page through the tunnel, or LAN devices in LAN mode.
2. Hostile content from marketplaces: listing titles, URLs and images written by sellers or third
   parties (Vinted, Grailed, eBay, the Apify actor output).
3. A stolen session cookie (shared device, malware, a phone left unlocked).
4. Supply chain: Python and npm dependencies.

**What was checked:**
- Every API route was tested for authentication: all 44 routes were called without a cookie.
- The two highest findings were reproduced with live requests.
- Dependencies were checked with `pip-audit` (Python) and `npm audit` (frontend).
- The rest was manual review of authentication, sessions, CSRF, SSRF, uploads, rendering of
  untrusted data, secrets, Docker and logging.

## Summary
| ID | Finding | Severity | Exploitable by |
|---|---|---|---|
| RACK-01 | Login rate limit bypassed by spoofing `CF-Connecting-IP` / `X-Forwarded-For` | **High** in LAN mode, **Medium** behind Cloudflare | Anyone who can reach the login page |
| RACK-02 | Sessions can't be revoked: logout and password change leave old cookies valid for 30 days | **Medium** | Whoever holds a copied cookie |
| RACK-03 | Blind SSRF: the worker downloads marketplace-supplied image URLs with no host checks and follows redirects | **Medium** | Whoever controls listing data (sellers, the Apify actor) |
| RACK-04 | No security headers (CSP, frame-ancestors, nosniff, Referrer-Policy, HSTS) | **Low** | Defence in depth |
| RACK-05 | Listing URLs aren't checked to be http(s) before use as links | **Low** | Defence in depth |
| RACK-06 | Plaintext dev password in a comment in `.env` | **Low** | Anyone who can read `.env` |
| RACK-07 | Every container gets every secret | **Low** | After compromise of one container |
| RACK-08 | No upload size limit before multipart parsing | **Low** | Logged-in user only |
| RACK-09 | DNS rebinding window in the pasted-URL image fetch | **Low** | Logged-in user only |
| RACK-10 | Session secret strength not enforced at startup | **Low** | Misconfiguration |
| RACK-11 | Vulnerable dev/test npm packages; `react-router` advisories | **Low** (not in the shipped app) | Local development only |

**Checked and found sound:**
- All 44 API routes reject requests without a session cookie, except four that are public by design:
  - `login`
  - `logout`, which only clears the cookie
  - `/api/health`
  - the static app files
- CSRF: mutating requests need a custom header, and the cookie is `SameSite=Lax`.
- Sessions:
  - The cookie is `HttpOnly`, and `Secure` is on by default.
  - Passwords are hashed with argon2id.
  - A missing session secret gives a 500 instead of allowing forged cookies.
- Injection and rendering:
  - No SQL injection: everything goes through bound parameters.
  - No `dangerouslySetInnerHTML`.
  - The static file handler blocks path traversal.
- Uploads are re-encoded, stripped of EXIF data and stored under random names.
- Pasted URLs are checked against private addresses on every redirect hop.
- Notifications are escaped for Telegram HTML.
- Token handling:
  - The Telegram token is kept out of errors and logs.
  - The Apify token is sent in a header.
- The containers run as non-root, the database isn't published, and the API binds to localhost
  by default.
- Python dependencies: no known vulnerabilities. The torch CPU wheels couldn't be checked by
  `pip-audit`.

---

## RACK-01: login rate limit bypass (CWE-307, CWE-348) - High / Medium
**Where:** `backend/rack/api/auth.py:67-72` and `Dockerfile:23`.
```python
def client_ip(request: Request) -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or (request.client.host if request.client else None)
        or "unknown"
    )
```
```dockerfile
uvicorn ... --proxy-headers --forwarded-allow-ips='*'
```
**Risk:**
- The 5-attempts-per-15-minutes limit is keyed on a header any client can set. With
  `--forwarded-allow-ips='*'`, even `request.client` comes from a client-controlled
  `X-Forwarded-For`.
- An attacker sends a new fake IP with each attempt and gets unlimited password guesses, slowed
  only by argon2's cost.
- The attempt store also grows without bound, one entry per fake IP.
- Through Cloudflare, the edge overwrites `CF-Connecting-IP`, so the bypass needs direct access:
  LAN mode, or anything else that reaches port 8000. That is why it's High in LAN mode and Medium
  behind the tunnel.
- Cloudflare Access in front of the tunnel mitigates it fully.

**Evidence (reproduced):**
```
same client, no header : [401, 401, 401, 401, 401, 429]
rotating CF-Connecting-IP: [401, 401, 401, 401, 401, 401, 401, 401, 401, 401]
```

**Proposed fix:**
- Trust forwarding headers only from the tunnel's own container, set by `RACK_TRUSTED_PROXIES`.
  The default is `cloudflared`, resolved to its IP on the Docker network.
- Add a global limiter that can't be dodged: at most 30 failures per 15 minutes across all IPs.
  After that, login is closed for a few minutes.
- Cap the attempt store's size.
```python
# after
def client_ip(request: Request, trusted: set[str]) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer in trusted:  # only the tunnel container may tell us the real client IP
        return request.headers.get("CF-Connecting-IP") or peer
    return peer
```
```dockerfile
# after: no blanket trust of X-Forwarded-*
uvicorn rack.api.main:app --host 0.0.0.0 --port 8000
```
Plus `if attempts.global_blocked(): raise 429` before verifying the password, and
`attempts.fail_global()` on every failure.

**Why this fixes it:** a client can no longer choose the key it's counted under, and the global
cap bounds total guesses even across real distinct IPs.

**Alternatives:** relying on Cloudflare Access alone. That's good, but only if it's always on.
fail2ban-style blocking: heavier.

**Side effects:** `request.client.host` behind the tunnel becomes the cloudflared container's IP.
That's intended, since the trusted header then carries the real client IP. A determined attacker
could lock you out for a few minutes; Cloudflare Access prevents that.

**Verify:** a test that rotates `CF-Connecting-IP` from an untrusted peer must hit 429 on the 6th
try. A test that exceeds the global cap from many trusted-proxy IPs must hit 429.

## RACK-02: sessions can't be revoked (CWE-613) - Medium
**Where:** `backend/rack/api/auth.py:75-82, 107, 119-121`. The token is
`_serializer.dumps({"u": "me"})`, and logout only deletes the cookie in that browser.

**Risk:**
- A copied cookie stays valid for 30 days. That includes a cookie from a shared device, a backup,
  or a device you've lost.
- Logging out doesn't invalidate it.
- Changing the password doesn't invalidate it either: the only way is to rotate
  `RACK_SESSION_SECRET`, which isn't documented.

**Evidence (reproduced):** after logout, the original browser gets 401, but a copy of the same
cookie still gets **200** on `/api/auth/me`.

**Proposed fix:** put a session generation (an "epoch") in the token. It's stored in `app_state`
together with a fingerprint of the password hash, and checked on every request.
- **Log out everywhere** (a new button) bumps the epoch.
- Changing `RACK_PASSWORD_HASH` invalidates every session automatically.
- Optionally, add an idle timeout of 7 days without use, with a sliding refresh.
```python
# after (sketch)
token = _serializer(s).dumps({"e": epoch, "p": sha256(s.rack_password_hash)[:16]})
data = _serializer(s).loads(token, max_age=...)
if data.get("e") != current_epoch or data.get("p") != sha256(s.rack_password_hash)[:16]:
    raise HTTPException(401, "Session ended")
```

**Why this fixes it:** the server can now invalidate every outstanding token with one write, and
a password change does it implicitly.

**Side effects:** one cheap database read per request; you could cache the epoch for a few
seconds. Every existing session is logged out once when this ships.

**Verify:** log in, copy the cookie, press "log out everywhere", and the copy must get 401.
Change the hash and every old cookie must get 401.

## RACK-03: blind SSRF from listing image URLs (CWE-918) - Medium
**Where:** `backend/rack/worker/main.py:231-240` (`EmbedAndScore.fetch`) and
`backend/rack/sources/http.py:41` (`follow_redirects=True`).

**Risk:**
- The worker downloads the first photo of every listing from whatever URL the marketplace data
  holds. That data comes from third parties: sellers, Grailed's index, Vinted's page, and the
  Apify actor's output.
- Nothing checks the scheme or host, and redirects are followed. A crafted listing could make
  the worker send GET requests to:
  - your LAN, such as router admin pages
  - Docker services (`http://api:8000`, `http://db:5432`)
  - `localhost` on the host
- It's blind, because the response only becomes an embedding. But GET requests with side effects
  on old LAN devices, and internal port scanning by timing, are possible.

**Attack scenario:** a Vestiaire row from the actor carries
`main_image_url: "http://192.168.1.1/apply.cgi?..."`. When the worker embeds it, the request
comes from your PC inside your network.

**Proposed fix:**
- Only fetch `https` images from the known CDN hosts of each source: `i.ebayimg.com`,
  `images1.vinted.net`, `media-assets.grailed.com`, `images.vestiairecollective.com`.
- Reuse `assert_public_url` on every redirect hop, as the pasted-URL fetch already does.
- Disable automatic redirects for image fetches.
```python
# after (sketch)
IMAGE_HOSTS = {"i.ebayimg.com", "images1.vinted.net", "media-assets.grailed.com",
               "images.vestiairecollective.com"}

async def fetch(self, url: str) -> bytes:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in IMAGE_HOSTS:
        raise ImageError(f"refusing image host {parts.hostname}")
    await assert_public_url(url)
    resp = await self.images[parts.hostname].get(url, follow_redirects=False)
    ...
```

**Why this fixes it:** requests can only go to public marketplace CDNs.

**Alternatives:** the private-address check without the allowlist. It's more permissive but
still blocks internal targets.

**Side effects:** a source that changes its CDN host stops getting embeddings until the list is
updated. That shows up in the logs as refused hosts.

**Verify:** unit tests that `http://192.168.1.1/x.jpg`, `http://api:8000/` and a `https` redirect
to a private address are all refused, and that a normal CDN URL is accepted.

## RACK-04: missing security headers (CWE-693, CWE-1021) - Low
**Where:** `backend/rack/api/main.py`, where there's no header middleware.

**Risk:** there's no Content-Security-Policy to limit the damage if an XSS bug ever appears.
There's no `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy` or HSTS either.
Clickjacking is largely blunted already, because `SameSite=Lax` cookies aren't sent in
cross-site frames, so a framed Rack shows the login page.

**Proposed fix:** one middleware.
```python
CSP = ("default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; "
       "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
       "form-action 'self'")
@app.middleware("http")
async def security_headers(request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if settings.rack_cookie_secure:
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp
```
**Side effects:** the CSP must allow `https:` images, because marketplace photos are hotlinked.
Check that the app, the service worker and the gallery still work.

**Verify:** a test that asserts the headers are present; then a manual browser pass with the
console open to catch CSP violations.

## RACK-05: listing URLs not scheme-checked (CWE-79, defence in depth) - Low
**Where:** `frontend/src/components/ListingCard.tsx:199,213`, `Gallery.tsx:162` and
`Notifications.tsx:91` render `href={url}` from listing data.
`backend/rack/sources/ebay.py:101` takes `itemWebUrl` as is.

**Risk:**
- React 18 still renders `javascript:` URLs. A listing whose URL were `javascript:...` would run
  script when clicked, which could drive the API with your session.
- The current adapters build or prefix most URLs, so no source can produce one today:
  - Vinted and Grailed URLs are built by Rack.
  - Vestiaire URLs get `https://www.vestiairecollective.com` put in front unless they already
    start with `http`.
  - eBay URLs come straight from the official API.
- It's a single line of defence that a future adapter could break.

**Proposed fix:** validate in the `Listing` model, and add a frontend guard.
```python
@field_validator("url")
@classmethod
def _http_only(cls, v: str) -> str:
    if urlsplit(v).scheme not in ("http", "https"):
        raise ValueError("listing URL must be http(s)")
    return v
```
```ts
export const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);
```

## RACK-06: plaintext password in `.env` (CWE-256) - Low
**Where:** the first line of `.env`: `# LOCAL DEV ONLY. Dev login password ...: <password>`. This
was intentional during development.

**Risk:** anyone who can read `.env` already has every API key. But the plaintext password is
the one secret that might be reused elsewhere, and it shouldn't survive into a public deployment.

**Fix:** delete the comment, then set a new password with `rack hash-password` before going public.

## RACK-07: every container gets every secret (CWE-250) - Low
**Where:** `docker-compose.yml:6` uses `env_file: .env` for both `api` and `worker`.

**Risk:**
- The internet-facing `api` container holds the Apify, Anthropic, Grailed and eBay keys, which
  only the worker needs.
- The worker holds the password hash and session secret, which only the api needs.
- If either is compromised, every secret is exposed.

**Fix:** split into `.env.api` and `.env.worker`, or list per-service `environment:` keys. Keep
shared values, such as the database URL, in both.

## RACK-08: uploads not size-limited before parsing (CWE-400) - Low
**Where:** `backend/rack/api/taste.py:104-108`. The 10 MB check happens after Starlette has
already spooled the whole multipart body to disk. The 20-file check also runs after parsing.

**Risk:** a logged-in user, or a stolen session, can fill the disk with one huge request.

**Fix:**
- Reject requests whose `Content-Length` is above 25 × 10 MB in a small middleware on
  `/api/taste/upload`.
- Add a `client_max_body_size`-style limit at Cloudflare. Cloudflare's free plan already caps
  request bodies at 100 MB.

## RACK-09: DNS rebinding in pasted-URL fetch (CWE-367) - Low
**Where:** `backend/rack/embeddings/images.py:69,82`. The hostname is resolved and checked, then
httpx resolves it again when it connects.

**Risk:** a hostile DNS server answers with a public IP for the check and a private one for the
connection. Only a logged-in user can trigger this fetch.

**Fix:** connect to the IP address that was checked, using an httpx transport bound to the
resolved IP with an SNI and Host override. Or run the fetch through an egress proxy that denies
private ranges.

## RACK-10: session secret strength not enforced (CWE-521) - Low
**Where:** `backend/rack/config.py` / `api/auth.py:61-64`. An empty secret is rejected, but a
short one such as `"x"` is accepted, and a weak secret makes cookies forgeable.

**Fix:** refuse to start if `RACK_SESSION_SECRET` is under 32 characters, or if
`RACK_PASSWORD_HASH` isn't an argon2 hash. Also log a warning at startup when
`RACK_COOKIE_SECURE=false` and `RACK_PUBLIC_URL` starts with `https`.

## RACK-11: dependency advisories - Low
**`npm audit` findings:**
- `vitest` 3.2.7 and its `tinypool` and `@vitest/mocker` packages: 2 critical advisories (prototype
  pollution leading to remote code execution in worker options) and 2 moderate ones (file read and
  code injection in the mock server).
- `react-router-dom` 6.30.6: 2 moderate advisories (an open redirect via backslash in
  `<Link>`/`useNavigate`, and server-rendering hydration).

**Exposure:**
- The vitest packages are **dev/test only** and are never in the shipped image: the Docker
  runtime contains only the built static files.
- Rack's router links and navigations use fixed internal paths and no server rendering, so the
  router advisories aren't reachable today.

**`pip-audit`:** no known vulnerabilities. torch and torchvision are CPU builds from PyTorch's own
package index, so `pip-audit` couldn't check them.

**Fix:**
- Upgrade `vitest` to ≥ 4.1.12. This is a major-version bump; check that the vite 6 config still works.
- Plan `react-router-dom` 7 (also a major bump).
- Add `npm audit --omit=dev` and `pip-audit` to a pre-release checklist.
- Pin Docker base images by digest: `python:3.12-slim`, `node:22-alpine` and
  `pgvector/pgvector:pg16` are floating tags.

## Informational
- **Prompt injection into the optional LLM re-rank:** seller-written titles reach Claude. The
  output is constrained by a JSON schema, used only as a score nudge of at most ±0.15, and shown
  as text, so the worst case is a listing being ranked a little higher. Acceptable.
- **`GET /api/listings/{id}/gallery` has side effects:** it makes one Vinted fetch and database
  writes. A cross-site top-level link could trigger one fetch with your cookie (`SameSite=Lax`).
  Negligible.
- **Push subscriptions accept any `https` endpoint:** a logged-in user can make the server send
  web-push POSTs there. This is by design for a single-user app.
- **Logging:** the worker silences httpx request logs. The API process relies on uvicorn's default
  log levels for the same effect; set `logging.getLogger("httpx").setLevel(WARNING)` there too.

## Recommended order
1. **Before going public:** RACK-01, RACK-02, RACK-06, RACK-10, and turn on Cloudflare Access.
2. **Soon:** RACK-03, RACK-04, RACK-05.
3. **When convenient:** RACK-07, RACK-08, RACK-09, RACK-11.

None of the proposed changes need a database migration, apart from storing the session epoch in
the existing `app_state` table (RACK-02).
