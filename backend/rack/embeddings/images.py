"""Image validation, sanitising and safe fetching of user-supplied URLs."""

import asyncio
import io
import ipaddress
import re
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000
UPLOAD_MAX_SIDE = 2048
EMBED_MAX_SIDE = 448
Image.MAX_IMAGE_PIXELS = MAX_PIXELS

OG_IMAGE = re.compile(
    r"<meta[^>]+(?:property|name)=[\"']og:image(?::secure_url)?[\"'][^>]*content=[\"']([^\"']+)",
    re.IGNORECASE,
)


class ImageError(ValueError):
    pass


def open_image(data: bytes) -> Image.Image:
    if len(data) > MAX_BYTES:
        raise ImageError("image larger than 10 MB")
    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageError(f"not a valid image: {exc}") from exc
    return img


def sanitize_upload(data: bytes) -> bytes:
    """Re-encode as JPEG: applies EXIF rotation, then drops all metadata (EXIF/GPS)."""
    img = ImageOps.exif_transpose(open_image(data)).convert("RGB")
    img.thumbnail((UPLOAD_MAX_SIDE, UPLOAD_MAX_SIDE))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=88)
    return out.getvalue()


def for_embedding(data: bytes) -> Image.Image:
    img = open_image(data).convert("RGB")
    img.thumbnail((EMBED_MAX_SIDE, EMBED_MAX_SIDE))
    return img


# Marketplace image CDNs. Listing photo URLs come from third-party data, so the worker only
# fetches from these (https, public addresses, no redirects).
IMAGE_HOST_SUFFIXES = ("ebayimg.com", "vinted.net", "grailed.com", "vestiairecollective.com")


def _is_public_ip(addr: str) -> bool:
    ip = ipaddress.ip_address(addr)
    return ip.is_global and not ip.is_multicast


def is_listing_image_host(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and any(
        host == s or host.endswith("." + s) for s in IMAGE_HOST_SUFFIXES
    )


async def resolve_public(url: str) -> str:
    """Resolve the URL's host and return one public IP, or raise if any address is private.

    Callers connect to this exact IP, so DNS can't answer differently between check and connect.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ImageError("only http(s) URLs are allowed")
    try:
        infos = await asyncio.to_thread(
            socket.getaddrinfo,
            parts.hostname,
            parts.port or (443 if parts.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ImageError(f"cannot resolve {parts.hostname}") from exc
    addrs = [str(info[4][0]) for info in infos]
    if not addrs or not all(_is_public_ip(a) for a in addrs):
        raise ImageError("URL points at a private or local address")
    return addrs[0]


async def assert_public_url(url: str) -> None:
    """Reject non-http(s) URLs and hosts that resolve to private/loopback/link-local addresses."""
    await resolve_public(url)


def pinned_request(url: str, ip: str) -> tuple[str, dict[str, str], dict[str, str]]:
    """URL rewritten to the checked IP, plus the Host header and TLS SNI name to keep."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    ip_host = f"[{ip}]" if ":" in ip else ip
    netloc = f"{ip_host}:{parts.port}" if parts.port else ip_host
    pinned = urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))
    host_header = f"{host}:{parts.port}" if parts.port else host
    return pinned, {"Host": host_header}, {"sni_hostname": host}


async def _get_limited(client: httpx.AsyncClient, url: str) -> tuple[bytes, str]:
    """GET with manual redirects (each hop re-checked and pinned) and a body size cap."""
    for _ in range(4):
        ip = await resolve_public(url)
        pinned, headers, ext = pinned_request(url, ip)
        async with client.stream(
            "GET", pinned, headers=headers, extensions=ext, follow_redirects=False
        ) as resp:
            if resp.is_redirect and "location" in resp.headers:
                url = urljoin(url, resp.headers["location"])
                continue
            resp.raise_for_status()
            body = bytearray()
            async for chunk in resp.aiter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise ImageError("download larger than 10 MB")
            return bytes(body), resp.headers.get("content-type", "")
    raise ImageError("too many redirects")


async def fetch_user_image(url: str, client: httpx.AsyncClient) -> bytes:
    """Fetch an image the user pasted. A web page is accepted if it has an og:image."""
    body, ctype = await _get_limited(client, url)
    if "html" in ctype:
        m = OG_IMAGE.search(body.decode("utf-8", "replace"))
        if not m:
            raise ImageError("page has no preview image; upload the photo instead")
        body, _ = await _get_limited(client, urljoin(url, m.group(1)))
    open_image(body)  # validate
    return body
