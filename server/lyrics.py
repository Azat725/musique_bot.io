"""Song lyrics: YouTube Music first (for its own tracks), then LRCLIB, an open lyrics database. Cached in SQLite."""
import asyncio
import logging
import re
import time

import httpx

from . import db, music

log = logging.getLogger("musique.lyrics")

RETRY_MISSING = 3 * 24 * 3600  # a track without lyrics is looked up again after three days
LRCLIB = "https://lrclib.net/api"
HEADERS = {"User-Agent": "Musique (https://github.com/Azat725/musique_bot.io)"}
_BRACKETS_RE = re.compile(r"\s*[(\[][^)\]]*[)\]]")  # "(feat. …)", "[Remastered 2011]", "(Live)"
_FEAT_RE = re.compile(r"\s+(?:feat\.?|ft\.?|featuring)\s+.*$", re.I)
_locks: dict[str, asyncio.Lock] = {}


async def find(track_id: str, title: str = "", artist: str = "", duration: int = 0) -> dict | None:
    """{"text", "source"} or None. Never raises: a source that fails is just skipped."""
    cached = await db.get_lyrics(track_id)
    if cached and (cached["text"] or time.time() - cached["fetched"] < RETRY_MISSING):
        return {"text": cached["text"], "source": cached["source"]} if cached["text"] else None
    lock = _locks.setdefault(track_id, asyncio.Lock())  # two requests for one track look it up once
    try:
        async with lock:
            cached = await db.get_lyrics(track_id)
            if cached and (cached["text"] or time.time() - cached["fetched"] < RETRY_MISSING):
                return {"text": cached["text"], "source": cached["source"]} if cached["text"] else None
            meta = await music.track_meta(track_id) or {}
            title = meta.get("title") or title
            artist = meta.get("artist") or artist
            duration = meta.get("duration") or duration
            found = None
            if music.YT_ID_RE.match(track_id):
                found = await _youtube(track_id)
            if not found and title:
                found = await _lrclib(title, artist, duration)
            await db.save_lyrics(track_id, found["text"] if found else None, found["source"] if found else "")
            return found
    finally:
        if not lock.locked():
            _locks.pop(track_id, None)


async def _youtube(video_id: str) -> dict | None:
    def lookup():
        browse_id = music._yt.get_watch_playlist(video_id, limit=1).get("lyrics")
        return music._yt.get_lyrics(browse_id) if browse_id else None
    try:
        data = await asyncio.to_thread(lookup)
    except Exception as e:
        log.info("YouTube Music lyrics failed for %s: %s", video_id, str(e)[:120])
        return None
    text = _tidy((data or {}).get("lyrics") or "")
    if not text:
        return None
    source = re.sub(r"^\s*(?:Source|Источник)\s*:\s*", "", (data.get("source") or "").strip(), flags=re.I)
    return {"text": text, "source": source or "YouTube Music"}


async def _lrclib(title: str, artist: str, duration: int) -> dict | None:
    artist = artist.split(",")[0].strip() if artist and artist != "—" else ""
    plain_title = _FEAT_RE.sub("", _BRACKETS_RE.sub("", title)).strip() or title
    try:
        async with httpx.AsyncClient(timeout=8, headers=HEADERS) as client:
            # an exact match first (LRCLIB allows a couple of seconds of difference in duration)
            if artist:
                params = {"track_name": plain_title, "artist_name": artist}
                if duration:
                    params["duration"] = duration
                r = await client.get(f"{LRCLIB}/get", params=params)
                if r.status_code == 200:
                    text = _tidy(r.json().get("plainLyrics") or "")
                    if text:
                        return {"text": text, "source": "LRCLIB"}
            # then a search, preferring a result close in length
            params = {"track_name": plain_title, **({"artist_name": artist} if artist else {})}
            r = await client.get(f"{LRCLIB}/search", params=params)
            if r.status_code != 200:
                return None
            items = [i for i in r.json() if i.get("plainLyrics") and not i.get("instrumental")]
            if duration:  # a different length is most likely a different song with the same name
                items.sort(key=lambda i: abs((i.get("duration") or 0) - duration))
                items = [i for i in items if abs((i.get("duration") or 0) - duration) <= 15]
            if items:
                return {"text": _tidy(items[0]["plainLyrics"]), "source": "LRCLIB"}
    except (httpx.HTTPError, ValueError) as e:
        log.info("LRCLIB lyrics failed for %s — %s: %s", artist, title, str(e)[:120])
    return None


def _tidy(text: str) -> str:
    """Trim the ends and collapse runs of blank lines; the verse breaks themselves stay."""
    text = text.replace("\r\n", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", text)
