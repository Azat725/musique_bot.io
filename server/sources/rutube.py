"""Rutube: public search API, audio taken out of the video with yt-dlp."""
import re
from pathlib import Path

import httpx
import yt_dlp

from .. import config

PREFIX, NAME = "rt", "Rutube"
ID_RE = re.compile(r"^[0-9a-f]{32}$")


def enabled() -> bool:
    return True


async def search(client: httpx.AsyncClient, query: str) -> list[tuple[dict, str]]:
    from ..music import _clean
    r = await client.get("https://rutube.ru/api/search/video/", params={"query": query, "format": "json"})
    r.raise_for_status()
    out = []
    for v in r.json().get("results") or []:
        dur = v.get("duration") or 0
        if not ID_RE.match(v.get("id") or "") or not 60 <= dur <= 1200:  # songs, not films or shorts
            continue
        if v.get("is_adult") or v.get("is_paid") or v.get("is_livestream") or v.get("is_hidden"):
            continue
        author = (v.get("author") or {}).get("name") or ""
        raw = v.get("title") or ""
        # "Artist- Title" / "Artist - Title": the channel is often a re-uploader, so trust the title first
        m = re.match(r"^(.{2,60}?)\s*[-–—]\s+(.+)$", raw)
        title, artist = _clean(m.group(2), m.group(1).strip()) if m else _clean(raw, author)
        out.append(({
            "id": f"{PREFIX}.{v['id']}",
            "title": title or "—",
            "artist": artist or "—",
            "duration": int(dur),
            "cover": v.get("thumbnail_url") or "",
            "artist_id": "",
        }, v["id"]))
        if len(out) >= 8:
            break
    return out


def download(ref: str, dest_base: Path) -> Path:
    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True, "socket_timeout": 15,
        "format": "bestaudio/worst",  # Rutube streams are muxed: take the smallest and keep only the sound
        "outtmpl": str(dest_base) + ".%(ext)s",
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}],
    }
    if config.FFMPEG:
        opts["ffmpeg_location"] = config.FFMPEG
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([f"https://rutube.ru/video/{ref}/"])
    path = dest_base.with_name(dest_base.name + ".m4a")
    if not path.exists():
        raise RuntimeError("rutube download produced no file")
    return path
