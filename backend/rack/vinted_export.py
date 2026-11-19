"""Read your liked items out of a Vinted personal-data export (Settings > Privacy > Download).

The export is a zip of HTML pages. Only `favourite_items/index.html` is read: the rest (messages,
invoices, addresses, payment details) is never opened, stored or logged. The page lists each
liked item as `<a itemprop="link_to_item" href="https://www.vinted.co.uk/items/<id>">title</a>`
followed by `<span itemprop="created_at">` (when you liked it).
"""

import html
import re
import zipfile
from dataclasses import dataclass
from typing import IO

FAVOURITES_ENTRY = "favourite_items/index.html"
MAX_PAGE_BYTES = 20 * 1024 * 1024  # the real page is ~150 kB for 382 items
MAX_ITEMS = 2000

_ITEM = re.compile(
    r'itemprop="link_to_item"\s+href="https://www\.vinted\.[a-z.]+/items/(\d{1,15})[^"]*"\s*>'
    r"(.*?)</a>"
    r'(?:.{0,200}?itemprop="created_at"\s*>\s*([^<]{0,40}?)\s*<)?',
    re.S,
)


class ExportError(ValueError):
    """The file isn't a Vinted export we can read; the message is shown to the user."""


@dataclass(frozen=True)
class Favourite:
    item_id: str
    title: str
    liked_at: str | None


def parse_favourites(page: str) -> list[Favourite]:
    """Liked items in the page's order, each once, at most MAX_ITEMS."""
    out: dict[str, Favourite] = {}
    for item_id, title, liked in _ITEM.findall(page):
        text = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", title)).split())[:200]
        if item_id not in out:
            out[item_id] = Favourite(item_id, text or f"Vinted item {item_id}", liked or None)
        if len(out) >= MAX_ITEMS:
            break
    return list(out.values())


def read_export(file: IO[bytes], filename: str) -> list[Favourite]:
    """Favourites from the whole export zip, or from its favourite_items/index.html alone."""
    head = file.read(4)
    file.seek(0)
    if head.startswith(b"PK"):
        try:
            with zipfile.ZipFile(file) as z:
                try:
                    info = z.getinfo(FAVOURITES_ENTRY)
                except KeyError:
                    raise ExportError(
                        "That zip has no favourite items page. Is it your Vinted data export?"
                    ) from None
                if info.file_size > MAX_PAGE_BYTES:
                    raise ExportError("The favourite items page in that zip is too large")
                with z.open(info) as f:
                    raw = f.read(MAX_PAGE_BYTES + 1)
        except zipfile.BadZipFile as exc:
            raise ExportError("That zip file is damaged") from exc
    elif filename.lower().endswith((".html", ".htm")):
        raw = file.read(MAX_PAGE_BYTES + 1)
    else:
        raise ExportError("Upload the Vinted export (.zip) or its favourite_items/index.html")
    if len(raw) > MAX_PAGE_BYTES:
        raise ExportError("The favourite items page is too large")
    favourites = parse_favourites(raw.decode("utf-8", "replace"))
    if not favourites:
        raise ExportError("No liked items found in that file")
    return favourites
