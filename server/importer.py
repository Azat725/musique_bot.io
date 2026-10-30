"""Playlist import: a link from YouTube Music, Spotify or Yandex Music, or a pasted list of tracks.
YouTube playlists are taken as they are; for the others every track is looked up in YouTube Music."""
import asyncio
import json
import logging
import re
import time

import httpx

from . import db, music

log = logging.getLogger("musique.importer")

MAX_TRACKS = 200
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126 Safari/537.36", "Accept-Language": "ru,en;q=0.8"}
_YT_LIST_RE = re.compile(r"(?:youtube\.com|youtu\.be)/\S*[?&]list=([A-Za-z0-9_-]{10,64})")
_SPOTIFY_RE = re.compile(r"open\.spotify\.com/(?:intl-[a-z-]+/)?(playlist|album)/([A-Za-z0-9]{10,40})")
_SPOTIFY_SHORT_RE = re.compile(r"https?://(?:spotify\.link|spotify\.app\.link)/[A-Za-z0-9]+")
_YANDEX_HOST = r"music\.yandex\.(?:ru|com|kz|by|uz)"
_YANDEX_USER_RE = re.compile(_YANDEX_HOST + r"/users/([\w.-]{1,64})/playlists/(\d{1,12})")
_YANDEX_UUID_RE = re.compile(_YANDEX_HOST + r"/playlists?/((?:[a-z]{2}\.)?[0-9a-f-]{36})")
_YANDEX_ALBUM_RE = re.compile(_YANDEX_HOST + r"/album/(\d{1,12})(?!/track)")
_NUMBER_RE = re.compile(r"^\s*(?:\d{1,4}\s*[.)\]:-]|\d{1,4}\s+(?=\D))\s*")
_TIME_RE = re.compile(r"\s*[\[(]?\b\d{1,2}:\d{2}(?::\d{2})?\b[\])]?\s*$")
_DASH_RE = re.compile(r"\s+[-–—]\s+")


class ImportFailed(Exception):
    """code: unrecognized | youtube | spotify | yandex | empty; the Mini App shows a matching message."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


async def run(user_id: int, source: str, lang: str = "en") -> dict:
    """Import into a new playlist: {"id", "name", "added", "total", "missing": [up to 20 lines]}."""
    source = source.strip()
    name, tracks, missing, total = await _collect(source)
    if not tracks:
        raise ImportFailed("empty")
    name = (name or "").strip()[:64] or ("Импорт " if lang.startswith("ru") else "Import ") + time.strftime("%d.%m")
    playlist_id = await db.create_playlist(user_id, name)
    await db.fill_playlist(playlist_id, tracks)
    for t in tracks:
        music.remember(t)
    return {"id": playlist_id, "name": name, "added": len(tracks), "total": total, "missing": missing[:20]}


async def _collect(source: str) -> tuple[str, list[dict], list[str], int]:
    """(name, found tracks, lines not found, how many there were)."""
    if m := _YT_LIST_RE.search(source):
        name, tracks = await _youtube(m.group(1))
        return name, tracks, [], len(tracks)
    if m := _SPOTIFY_SHORT_RE.search(source):
        source = await _expand(m.group(0))
    if m := _SPOTIFY_RE.search(source):
        name, wanted = await _spotify(m.group(1), m.group(2))
    elif m := _YANDEX_USER_RE.search(source):
        name, wanted = await _yandex(f"/users/{m.group(1)}/playlists/{m.group(2)}")
    elif m := _YANDEX_UUID_RE.search(source):
        name, wanted = await _yandex(f"/playlist/{m.group(1)}")
    elif m := _YANDEX_ALBUM_RE.search(source):
        name, wanted = await _yandex(f"/albums/{m.group(1)}/with-tracks")
    elif re.search(r"https?://", source) and len(source.splitlines()) == 1:
        raise ImportFailed("unrecognized")
    else:
        name, wanted = "", parse_text(source)
    if not wanted:
        raise ImportFailed("empty" if name else "unrecognized")
    wanted = wanted[:MAX_TRACKS]
    tracks, missing = await _match(wanted)
    return name, tracks, missing, len(wanted)


# ---------- sources ----------

async def _youtube(list_id: str) -> tuple[str, list[dict]]:
    try:
        data = await asyncio.to_thread(music._yt.get_playlist, list_id, limit=MAX_TRACKS)
    except Exception as e:
        log.info("YouTube playlist %s failed: %s", list_id, str(e)[:160])
        raise ImportFailed("youtube") from e
    tracks, seen = [], set()
    for r in data.get("tracks") or []:
        t = music.normalize(r)
        if t and t["id"] not in seen:
            seen.add(t["id"])
            tracks.append(t)
    return data.get("title") or "", tracks[:MAX_TRACKS]


async def _expand(url: str) -> str:
    """Short spotify.link URLs redirect to open.spotify.com."""
    try:
        async with httpx.AsyncClient(timeout=15, headers=UA, follow_redirects=True) as client:
            r = await client.get(url)
        return str(r.url) + " " + r.text[:20000]  # some short links land on a page that links the playlist
    except httpx.HTTPError as e:
        raise ImportFailed("spotify") from e


async def _spotify(kind: str, item_id: str) -> tuple[str, list[dict]]:
    """The embed page carries the list (up to 100 tracks) in its __NEXT_DATA__ JSON; no key needed."""
    try:
        async with httpx.AsyncClient(timeout=20, headers=UA, follow_redirects=True) as client:
            r = await client.get(f"https://open.spotify.com/embed/{kind}/{item_id}")
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', r.text, re.S)
        entity = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
    except (httpx.HTTPError, AttributeError, KeyError, TypeError, ValueError) as e:
        log.info("Spotify %s %s failed: %s", kind, item_id, str(e)[:160])
        raise ImportFailed("spotify") from e
    wanted = [{"artist": (i.get("subtitle") or "").replace("\xa0", " "), "title": i.get("title") or "",
               "duration": int((i.get("duration") or 0) / 1000)}
              for i in entity.get("trackList") or [] if i.get("title")]
    return entity.get("name") or entity.get("title") or "", wanted


async def _yandex(path: str) -> tuple[str, list[dict]]:
    """Yandex Music's own API answers public playlists without a key (it may refuse some countries)."""
    try:
        async with httpx.AsyncClient(timeout=20, headers=UA, follow_redirects=True) as client:
            r = await client.get("https://api.music.yandex.net" + path)
        r.raise_for_status()
        res = r.json()["result"]
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as e:
        log.info("Yandex Music %s failed: %s", path, str(e)[:160])
        raise ImportFailed("yandex") from e
    items = [i.get("track") for i in res.get("tracks") or []]
    items += [t for volume in res.get("volumes") or [] for t in volume]  # an album
    wanted = []
    for t in items:
        if not t or not t.get("title") or t.get("available") is False and not t.get("artists"):
            continue
        title = t["title"] + (f" ({t['version']})" if t.get("version") else "")
        wanted.append({"artist": ", ".join(a.get("name", "") for a in t.get("artists") or [] if a.get("name")),
                       "title": title, "duration": int((t.get("durationMs") or 0) / 1000)})
    return res.get("title") or "", wanted


def parse_text(text: str) -> list[dict]:
    """'Artist — Title', 'Artist - Title' or just a title, one per line; numbers and times are dropped."""
    out = []
    for line in text.replace("\r\n", "\n").split("\n"):
        line = _TIME_RE.sub("", _NUMBER_RE.sub("", line.strip(" \t•·*–—-"))).strip()
        if len(line) < 2 or re.fullmatch(r"[\W\d_]+", line):
            continue
        parts = _DASH_RE.split(line, maxsplit=1)
        artist, title = (parts[0], parts[1]) if len(parts) == 2 else ("", line)
        out.append({"artist": artist.strip()[:200], "title": title.strip()[:200], "duration": 0})
    return out[:MAX_TRACKS]


# ---------- matching ----------

async def _match(wanted: list[dict]) -> tuple[list[dict], list[str]]:
    """The first song YouTube Music finds for each line (a close one in length when the length is known)."""
    slots = asyncio.Semaphore(6)

    async def one(w: dict) -> dict | None:
        query = f"{w['artist']} {w['title']}".strip()
        async with slots:
            try:
                found = await music.search(query, limit=5, videos=False)
            except Exception as e:
                log.info("import search failed for %s: %s", query, str(e)[:120])
                return None
        if w["duration"]:
            close = [t for t in found if abs(t["duration"] - w["duration"]) <= 20]
            found = close or found
        return found[0] if found else None

    results = await asyncio.gather(*(one(w) for w in wanted))
    tracks, missing, seen = [], [], set()
    for w, t in zip(wanted, results):
        if not t:
            missing.append(f"{w['artist']} — {w['title']}" if w["artist"] else w["title"])
        elif t["id"] not in seen:
            seen.add(t["id"])
            tracks.append(t)
    return tracks, missing
