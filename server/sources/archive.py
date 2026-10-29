"""Internet Archive: free and public-domain music (netlabels, live concerts, old records)."""
import asyncio
import hashlib
from pathlib import Path
from urllib.parse import quote

import httpx

PREFIX, NAME = "ia", "Archive"
# music collections only: the "audio" media type is mostly podcasts and audiobooks
COLLECTIONS = "collection:(netlabels OR audio_music OR etree OR 78rpm OR georgeblood OR opensource_audio_music)"


def enabled() -> bool:
    return True


def _duration(value) -> int:
    try:
        if isinstance(value, str) and ":" in value:
            secs = 0
            for part in value.split(":"):
                secs = secs * 60 + int(float(part))
            return secs
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _first(value) -> str:
    return (value[0] if isinstance(value, list) and value else value) or ""


async def _item_tracks(client: httpx.AsyncClient, doc: dict, words: set[str]) -> list[tuple[dict, str]]:
    ident = doc["identifier"]
    r = await client.get(f"https://archive.org/metadata/{ident}")
    r.raise_for_status()
    data = r.json()
    creator = _first(doc.get("creator")) or _first(data.get("metadata", {}).get("creator")) or "—"
    files = [f for f in data.get("files") or [] if f.get("name", "").lower().endswith(".mp3") and f.get("source") == "original"]
    files = files or [f for f in data.get("files") or [] if f.get("name", "").lower().endswith(".mp3")]
    # prefer the files whose title matches the query; otherwise the first tracks of the item
    matching = [f for f in files if words & set((f.get("title") or f["name"]).lower().split())]
    out = []
    for f in matching or files:
        if len(out) >= 3:
            break
        title = f.get("title") or f["name"].rsplit(".", 1)[0]
        duration = _duration(f.get("length"))
        if title.isdigit() or (duration and not 30 <= duration <= 1200):  # no names, or whole concerts
            continue
        ref = f"{ident}/{f['name']}"
        key = hashlib.sha1(ref.encode()).hexdigest()[:16]
        out.append(({
            "id": f"{PREFIX}.{key}",
            "title": title,
            "artist": _first(f.get("creator")) or _first(f.get("artist")) or creator,
            "duration": duration,
            "cover": f"https://archive.org/services/img/{ident}",
            "artist_id": "",
        }, ref))
    return out


async def search(client: httpx.AsyncClient, query: str) -> list[tuple[dict, str]]:
    r = await client.get("https://archive.org/advancedsearch.php", params={
        "q": f"({query}) AND mediatype:audio AND {COLLECTIONS}",
        "fl[]": ["identifier", "title", "creator"], "rows": 3, "output": "json", "sort[]": "downloads desc"})
    r.raise_for_status()
    docs = (r.json().get("response") or {}).get("docs") or []
    words = {w for w in query.lower().split() if len(w) > 2}
    batches = await asyncio.gather(*(_item_tracks(client, d, words) for d in docs), return_exceptions=True)
    return [t for b in batches if not isinstance(b, BaseException) for t in b][:6]


def download(ref: str, dest_base: Path) -> Path:
    from . import stream_to
    return stream_to(f"https://archive.org/download/{quote(ref)}", dest_base.with_name(dest_base.name + ".mp3"))
