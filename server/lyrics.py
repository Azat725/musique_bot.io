"""Song lyrics: YouTube Music first (for its own tracks), then LRCLIB, an open lyrics database. Cached in SQLite.
Where a source has them, lyrics come with timed lines too, so the Mini App can follow the song line by line."""
import asyncio
import json
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
_LRC_TAG_RE = re.compile(r"\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]")
_locks: dict[str, asyncio.Lock] = {}


class SourceDown(Exception):
    """A lyrics source failed (timeout, 5xx, blocked): its silence must not be cached as "no lyrics"."""


def _answer(text: str | None, source: str, synced: list | None) -> dict | None:
    return {"text": text, "source": source, "synced": synced} if text else None


def _from_cache(cached: dict | None) -> tuple[bool, dict | None]:
    """(usable, answer). Lyrics cached before timed lines existed are looked up once more."""
    if not cached:
        return False, None
    if not cached["text"]:
        return time.time() - cached["fetched"] < RETRY_MISSING, None
    if cached["synced"] is None:
        return False, None
    synced = json.loads(cached["synced"]) if cached["synced"] else None
    return True, _answer(cached["text"], cached["source"], synced)


async def find(track_id: str, title: str = "", artist: str = "", duration: int = 0) -> dict | None:
    """{"text", "source", "synced": [[ms, line], …] | None} or None. Never raises: a source that fails is skipped."""
    usable, answer = _from_cache(await db.get_lyrics(track_id))
    if usable:
        return answer
    lock = _locks.setdefault(track_id, asyncio.Lock())  # two requests for one track look it up once
    try:
        async with lock:
            usable, answer = _from_cache(await db.get_lyrics(track_id))
            if usable:
                return answer
            meta = await music.track_meta(track_id) or {}
            title = meta.get("title") or title
            artist = meta.get("artist") or artist
            duration = meta.get("duration") or duration
            found, down = None, False
            if music.YT_ID_RE.match(track_id):
                try:
                    found = await _youtube(track_id)
                except SourceDown:
                    down = True
            # no lyrics yet, or lyrics without timing: LRCLIB may have the timed version
            synced_down = False
            if (not found or not found["synced"]) and title:
                try:
                    other = await _lrclib(title, artist, duration)
                    if other and (not found or other["synced"]):
                        found = other
                except SourceDown:
                    down = synced_down = True
            if not found:
                if not down:  # every source answered "none": remember that for a few days
                    await db.save_lyrics(track_id, None, "")
                return None
            # synced None = look for timed lines again next time (the source that has them was down)
            synced = json.dumps(found["synced"], ensure_ascii=False) if found["synced"] else (None if synced_down else "")
            await db.save_lyrics(track_id, found["text"], found["source"], synced)
            return found
    finally:
        if not lock.locked():
            _locks.pop(track_id, None)


async def _youtube(video_id: str) -> dict | None:
    def lookup():
        browse_id = music._yt.get_watch_playlist(video_id, limit=1).get("lyrics")
        return music._yt.get_lyrics(browse_id, timestamps=True) if browse_id else None
    try:
        data = await asyncio.to_thread(lookup)
    except Exception as e:
        log.info("YouTube Music lyrics failed for %s: %s", video_id, str(e)[:120])
        raise SourceDown from e
    if not data:
        return None
    source = re.sub(r"^\s*(?:Source|Источник)\s*:\s*", "", (data.get("source") or "").strip(), flags=re.I) or "YouTube Music"
    if data.get("hasTimestamps"):
        lines = [(int(line.start_time), (line.text or "").strip()) for line in data.get("lyrics") or []]
        synced = _tidy_synced(lines)
        text = _tidy("\n".join(t for _, t in lines))
        return _answer(text, source, synced)
    return _answer(_tidy(data.get("lyrics") or ""), source, None)


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
                if r.status_code >= 500:
                    raise SourceDown(f"LRCLIB {r.status_code}")
                if r.status_code == 200:
                    found = _from_lrclib(r.json())
                    if found:
                        return found
            # then a search, preferring a result close in length
            params = {"track_name": plain_title, **({"artist_name": artist} if artist else {})}
            r = await client.get(f"{LRCLIB}/search", params=params)
            if r.status_code >= 500:
                raise SourceDown(f"LRCLIB {r.status_code}")
            if r.status_code != 200:
                return None
            items = [i for i in r.json() if i.get("plainLyrics") and not i.get("instrumental")]
            if duration:  # a different length is most likely a different song with the same name
                items.sort(key=lambda i: abs((i.get("duration") or 0) - duration))
                items = [i for i in items if abs((i.get("duration") or 0) - duration) <= 15]
            # among close matches, one with timed lines is better
            items.sort(key=lambda i: not i.get("syncedLyrics"))
            if items:
                return _from_lrclib(items[0])
    except (httpx.HTTPError, ValueError) as e:
        log.info("LRCLIB lyrics failed for %s — %s: %s", artist, title, str(e)[:120])
        raise SourceDown from e
    return None


def _from_lrclib(item: dict) -> dict | None:
    if item.get("instrumental"):
        return None
    synced = parse_lrc(item.get("syncedLyrics") or "")
    text = _tidy(item.get("plainLyrics") or "") or _tidy("\n".join(t for _, t in synced or []))
    return _answer(text, "LRCLIB", synced)


def parse_lrc(lrc: str) -> list | None:
    """'[01:02.34]line' (also several tags on one line) -> [[62340, 'line'], …] sorted by time, or None."""
    lines = []
    for raw in lrc.replace("\r\n", "\n").split("\n"):
        tags = list(_LRC_TAG_RE.finditer(raw))
        if not tags:
            continue
        text = raw[tags[-1].end():].strip()
        for tag in tags:
            sec = float(tag.group(2).replace(":", "."))
            lines.append((int(round((int(tag.group(1)) * 60 + sec) * 1000)), text))
    return _tidy_synced(lines)


def _tidy_synced(lines: list) -> list | None:
    """Sort by time and drop repeated blank lines; fewer than three timed lines is not worth following."""
    out = []
    for ms, text in sorted(lines, key=lambda x: x[0]):
        if not text and (not out or not out[-1][1]):
            continue
        out.append([ms, text])
    while out and not out[-1][1]:
        out.pop()
    return out if sum(1 for _, t in out if t) >= 3 else None


def _tidy(text: str) -> str:
    """Trim the ends and collapse runs of blank lines; the verse breaks themselves stay."""
    text = text.replace("\r\n", "\n").strip()
    return re.sub(r"\n{3,}", "\n\n", text)
