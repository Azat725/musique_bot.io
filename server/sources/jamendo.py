"""Jamendo: independent music under Creative Commons. Needs a free JAMENDO_CLIENT_ID (devportal.jamendo.com)."""
from pathlib import Path

import httpx

from .. import config

PREFIX, NAME = "jm", "Jamendo"


def enabled() -> bool:
    return bool(config.JAMENDO_CLIENT_ID)


async def search(client: httpx.AsyncClient, query: str) -> list[tuple[dict, str]]:
    r = await client.get("https://api.jamendo.com/v3.0/tracks/", params={
        "client_id": config.JAMENDO_CLIENT_ID, "format": "json", "limit": 8, "search": query,
        "audioformat": "mp32", "imagesize": 300})
    r.raise_for_status()
    out = []
    for t in r.json().get("results") or []:
        if not t.get("id") or not t.get("audio"):
            continue
        out.append(({
            "id": f"{PREFIX}.{t['id']}",
            "title": t.get("name") or "—",
            "artist": t.get("artist_name") or "—",
            "duration": int(t.get("duration") or 0),
            "cover": t.get("image") or t.get("album_image") or "",
            "artist_id": "",
        }, t["audio"]))
    return out


def download(ref: str, dest_base: Path) -> Path:
    from . import stream_to
    return stream_to(ref, dest_base.with_name(dest_base.name + ".mp3"))
