"""Zaycev.net through the JSON endpoints its own site uses (no official API: may break without notice)."""
import re
from pathlib import Path

import httpx

PREFIX, NAME = "zc", "Zaycev"
API = "https://zaycev.net/api/external"


def enabled() -> bool:
    return True


def _seconds(text: str) -> int:
    secs = 0
    for part in (text or "").split(":"):
        if part.isdigit():
            secs = secs * 60 + int(part)
    return secs


def _tracks(data: dict, words: set[str] = frozenset()) -> list[tuple[dict, str]]:
    info = data.get("tracksInfo") or {}
    out = []
    for tid in data.get("trackIds") or []:
        t = info.get(str(tid)) or {}
        if not t.get("playbackEnabled"):
            continue
        if words and not words & set(re.findall(r"\w+", f"{t.get('artistName')} {t.get('track')}".lower())):
            continue
        out.append(({
            "id": f"{PREFIX}.{tid}",
            "title": t.get("track") or "—",
            "artist": t.get("artistName") or "—",
            "duration": _seconds(t.get("duration")),
            "cover": (t.get("imageJpg") or "").replace("square100", "square250"),
            "artist_id": "",
        }, str(tid)))
    return out


async def search(client: httpx.AsyncClient, query: str) -> list[tuple[dict, str]]:
    r = await client.get(f"{API}/pages/search/tracks", params={"q": query, "page": 1, "limit": 10})
    r.raise_for_status()
    data = r.json()
    if (data.get("pagesCount") or 0) >= 1000:  # the query was not understood: these are just popular tracks
        return []
    # its search is loose with several words: keep only tracks that share a word with the query
    return _tracks(data, {w for w in re.findall(r"\w+", query.lower()) if len(w) > 2})


async def popular(client: httpx.AsyncClient, limit: int = 30) -> list[tuple[dict, str]]:
    r = await client.get(f"{API}/pages/index/recommended", params={"limit": limit})
    r.raise_for_status()
    return _tracks(r.json())


def download(ref: str, dest_base: Path) -> Path:
    from . import HEADERS, stream_to
    with httpx.Client(headers=HEADERS, timeout=20, follow_redirects=True) as c:
        meta = c.post(f"{API}/track/filezmeta", json={"trackIds": [int(ref)], "subscription": False}).raise_for_status().json()
        stream_hash = meta["tracks"][0]["streaming"]
        url = c.get(f"{API}/track/play/{stream_hash}").raise_for_status().json()["url"]
    return stream_to(url, dest_base.with_name(dest_base.name + ".mp3"))
