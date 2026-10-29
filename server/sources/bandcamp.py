"""Bandcamp: the search box's public autocomplete endpoint, audio through yt-dlp."""
from pathlib import Path

import httpx
import yt_dlp

from .. import config

PREFIX, NAME = "bc", "Bandcamp"


def enabled() -> bool:
    return True


async def search(client: httpx.AsyncClient, query: str) -> list[tuple[dict, str]]:
    r = await client.post("https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic",
                          json={"search_text": query, "search_filter": "t", "full_page": False, "fan_id": None})
    r.raise_for_status()
    out = []
    for t in (r.json().get("auto") or {}).get("results") or []:
        if t.get("type") != "t" or not t.get("id") or not t.get("item_url_path"):
            continue
        img = t.get("img") or ""
        out.append(({
            "id": f"{PREFIX}.{t['id']}",
            "title": t.get("name") or "—",
            "artist": t.get("band_name") or "—",
            "duration": 0,  # not in search results; known once the track loads
            "cover": img.replace("_3.jpg", "_2.jpg"),  # 100 px -> 350 px
            "artist_id": "",
        }, t["item_url_path"]))
    return out[:6]


def download(ref: str, dest_base: Path) -> Path:
    opts = {
        "quiet": True, "no_warnings": True, "noplaylist": True, "noprogress": True, "socket_timeout": 15,
        "format": "mp3-128/bestaudio",
        "outtmpl": str(dest_base) + ".%(ext)s",
    }
    if config.FFMPEG:
        opts["ffmpeg_location"] = config.FFMPEG
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(ref, download=True)
    path = dest_base.with_name(f"{dest_base.name}.{info.get('ext') or 'mp3'}")
    if not path.exists():
        raise RuntimeError("bandcamp download produced no file")
    return path
