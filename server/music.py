"""Search (YouTube Music + other sources) and audio resolution (YouTube, then SoundCloud, then other sources)."""
import array
import asyncio
import logging
import random
import re
import shutil
import subprocess
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin

import httpx
import yt_dlp
from ytmusicapi import YTMusic

from . import config, db, sources

log = logging.getLogger("musique.music")

YT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# any playable track: a YouTube video id or "<source>.<key>" from server/sources
ID_RE = re.compile(r"^(?:[A-Za-z0-9_-]{11}|[a-z]{2}\.[A-Za-z0-9_-]{1,40})$")
_NOISE_RE = re.compile(
    r"\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|visualizer|clip|клип|премьера|mv|hd|4k)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)

_yt = YTMusic()
_meta: dict[str, dict] = {}
_search_cache: dict[str, tuple[float, list]] = {}
_home_cache: tuple[float, dict] | None = None
_url_cache: dict[str, tuple[float, "Source"]] = {}
_collection_cache: dict[str, tuple[float, list]] = {}
_artist_cache: dict[str, tuple[float, dict | None]] = {}  # artists, albums and name lookups
ARTIST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,64}$")
ALBUM_ID_RE = re.compile(r"^MPRE[A-Za-z0-9_-]{5,60}$")
_locks: dict[str, asyncio.Lock] = {}
_home_lock = asyncio.Lock()
# a 2 GB VPS: a burst of prefetches must not run a dozen downloads and encoders at once
_download_slots = asyncio.Semaphore(2)
_ffmpeg_slots = asyncio.Semaphore(1)
# offline copies for phones queue on their own, one at a time for the whole server, at a low CPU priority:
# however many people download at once, playback keeps the encoder and the download slots first
_save_slots = asyncio.Semaphore(1)
# tracks two and three places ahead in someone's queue are prepared the same way: in the background, one at a time
_ahead_slots = asyncio.Semaphore(1)
_NICE = shutil.which("nice")  # Linux (the VPS); elsewhere the encoder simply runs at normal priority
FFMPEG_TIMEOUT = 300
_yt_blocked_until = 0.0

AUDIO_EXTS = {".m4a", ".mp3", ".webm", ".opus", ".ogg"}
LITE_DIR = config.CACHE_DIR / "lite"
LITE_DIR.mkdir(exist_ok=True)

GENRES = {
    "pop": "Pop",
    "hiphop": "Hip Hop",
    "rock": "Rock Music",
    "dance": "Dance & Electronic",
    "latin": "Latin",
    "jazz": "Jazz",
}


@dataclass
class Source:
    kind: str  # "url" (proxy remote) or "file" (serve local file)
    mime: str
    url: str = ""
    headers: dict | None = None
    path: Path | None = None


# ---------- metadata ----------

def _cover(thumbs: list, size: int = 544, crop: bool = False) -> str:
    if not thumbs:
        return ""
    url = thumbs[-1]["url"]
    if "googleusercontent.com" in url:
        # crop: artist photos are wide banners; -p crops them to a square around the subject
        return re.sub(r"=w\d+-h\d+.*$", f"=w{size}-h{size}{'-p' if crop else ''}-l90-rj", url)
    if "i.ytimg.com" in url:
        # hq720 has no letterbox bars (hqdefault does); the client falls back to mqdefault
        return re.sub(r"/[a-z0-9_]+\.jpg.*$", "/hq720.jpg", url)
    return url


def _duration(r: dict) -> int:
    if r.get("duration_seconds"):
        return int(r["duration_seconds"])
    text = r.get("duration") or r.get("length") or ""
    secs = 0
    for part in text.split(":"):
        if part.isdigit():
            secs = secs * 60 + int(part)
    return secs


def _clean(title: str, artist: str) -> tuple[str, str]:
    title = _NOISE_RE.sub("", title).strip()
    title = title.split(" | ")[0].strip()
    parts = re.split(r"\s+[-–—]\s+", title, maxsplit=1)
    if len(parts) == 2:
        left, right = (p.strip() for p in parts)
        a = artist.lower()
        if not a or a in left.lower() or left.lower() in a:
            artist, title = left, right
        elif a in right.lower() or right.lower() in a:  # "Title — Artist"
            title = left
    return title, artist


def normalize(r: dict) -> dict | None:
    vid = r.get("videoId")
    if not vid or not YT_ID_RE.match(vid):
        return None
    artists = [a for a in (r.get("artists") or []) if a.get("name")]
    artist = ", ".join(a["name"] for a in artists)
    title, artist = _clean(r.get("title") or "", artist)
    track = {
        "id": vid,
        "title": title or "—",
        "artist": artist or "—",
        "duration": _duration(r),
        "cover": _cover(r.get("thumbnails") or r.get("thumbnail") or []),
        # the first artist with a channel: the artist card opens from it
        "artist_id": next((a["id"] for a in artists if a.get("id") and ARTIST_ID_RE.match(a["id"])), ""),
    }
    _meta[vid] = track
    _trim(_meta, 5000)
    return track


def _trim(cache: dict, limit: int) -> None:
    """Drop the oldest entries (dicts keep insertion order) so long-running caches stay bounded."""
    try:
        while len(cache) > limit:
            cache.pop(next(iter(cache)))
    except (KeyError, RuntimeError, StopIteration):  # another chart thread trimmed it at the same moment
        pass


def remember(track: dict) -> None:
    _meta[track["id"]] = track
    _trim(_meta, 5000)


async def track_meta(vid: str) -> dict | None:
    if vid in _meta:
        return _meta[vid]
    stored = await db.get_track(vid)
    if stored:
        _meta[vid] = stored
        return stored
    if sources.is_external(vid):
        return None
    try:
        data = await asyncio.to_thread(_yt.get_watch_playlist, vid, limit=1)
        if data.get("tracks"):
            return normalize(data["tracks"][0])
    except Exception:
        log.exception("meta lookup failed for %s", vid)
    return None


# ---------- search & home ----------

async def search(query: str, limit: int = 30, videos: bool = True) -> list[dict]:
    """Songs from YouTube Music, plus music videos unless `videos` is off (the 'Tracks' search mode)."""
    query = query.strip()[:200]
    if not query:
        return []
    key = ("" if videos else "songs:") + query.lower()
    cached = _search_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]

    songs, clips = await asyncio.gather(
        asyncio.to_thread(_yt.search, query, filter="songs", limit=limit),
        asyncio.to_thread(_yt.search, query, filter="videos", limit=15) if videos else asyncio.sleep(0, []),
        return_exceptions=True,
    )
    out, seen = [], set()
    for batch in (songs, clips):
        if isinstance(batch, Exception):
            log.warning("search batch failed: %s", batch)
            continue
        for r in batch:
            t = normalize(r)
            if t and t["id"] not in seen:
                seen.add(t["id"])
                out.append(t)
    _search_cache[key] = (time.time(), out)
    _trim(_search_cache, 500)
    return out


async def suggestions(query: str, limit: int = 8) -> list[str]:
    """What YouTube Music would complete the query with, for the search box as the user types. Never raises."""
    query = query.strip()[:100]
    if not query:
        return []
    key = "suggest:" + query.lower()
    cached = _search_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    try:
        found = await asyncio.to_thread(_yt.get_search_suggestions, query)
    except Exception as e:
        log.info("suggestions failed for %r: %s", query, str(e)[:120])
        return []
    out = [s.strip() for s in found if isinstance(s, str) and s.strip()][:limit]
    _search_cache[key] = (time.time(), out)
    _trim(_search_cache, 500)
    return out


async def search_artists(query: str, limit: int = 12) -> list[dict]:
    query = query.strip()[:200]
    if not query:
        return []
    key = "artists:" + query.lower()
    cached = _search_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    try:
        found = await asyncio.to_thread(_yt.search, query, filter="artists", limit=limit)
    except Exception as e:
        log.warning("artist search failed: %s", str(e)[:160])
        return []
    out = [{"id": r["browseId"], "name": r.get("artist") or r.get("title") or "",
            "cover": _cover(r.get("thumbnails") or [], 300, crop=True), "subscribers": r.get("subscribers") or ""}
           for r in found if r.get("browseId") and ARTIST_ID_RE.match(r["browseId"])]
    _search_cache[key] = (time.time(), out)
    _trim(_search_cache, 500)
    return out


async def search_more(query: str) -> list[dict]:
    """Results from the other sources (Zaycev, Bandcamp, Jamendo, Internet Archive, Rutube)."""
    query = query.strip()[:200]
    if not query:
        return []
    key = "more:" + query.lower()
    cached = _search_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    out = await sources.search(query)
    for t in out:
        _meta[t["id"]] = t
    _search_cache[key] = (time.time(), out)
    _trim(_search_cache, 500)
    return out


def _playlist_tracks(playlist_id: str, limit: int = 40) -> list[dict]:
    data = _yt.get_playlist(playlist_id, limit=limit)
    return [t for t in (normalize(r) for r in data.get("tracks", [])) if t]


def _build_home() -> dict:
    """Genres only: the home screen shows no charts (the user's recent and recommended tracks come from elsewhere)."""
    genres = []
    try:
        us = _yt.get_charts("US")
        for g in us.get("genres", []):
            title = g.get("title", "")
            for key, needle in GENRES.items():
                if needle.lower() in title.lower() and key not in {x["key"] for x in genres}:
                    genres.append({"key": key, "id": g["playlistId"]})
    except Exception:
        log.exception("genres failed")
    return {"sections": [], "genres": genres}


def _safe(fn, *args):
    try:
        return fn(*args)
    except Exception as e:
        log.warning("%s%s failed: %s", fn.__name__, args, str(e)[:160])
        return None


async def recommend(history: list[dict]) -> list[dict]:
    """'For you': YouTube Music radio from the last tracks played, minus what was already heard."""
    seeds = [t["id"] for t in history if YT_ID_RE.match(t["id"])][:3]
    if not seeds:  # nothing played yet: start from the top of the Russian chart
        data = await home()
        first = next((s["tracks"][0] for s in data["sections"] if s.get("country") == "RU" and s["tracks"]), None)
        seeds = [first["id"]] if first else []
    if not seeds:
        return []
    heard = {t["id"] for t in history}

    def build() -> list[dict]:
        out, seen = [], set(heard)
        for vid in seeds:
            try:
                data = _yt.get_watch_playlist(vid, radio=True, limit=25)
            except Exception as e:
                log.info("radio for %s failed: %s", vid, str(e)[:120])
                continue
            for r in data.get("tracks", []):
                t = normalize(r)
                if t and t["id"] not in seen:
                    seen.add(t["id"])
                    out.append(t)
        random.shuffle(out)
        return out[:20]

    return await _cached("rec:" + ",".join(seeds), build) or []


async def home() -> dict:
    global _home_cache
    async with _home_lock:  # simultaneous cold requests build the page once
        if _home_cache and time.time() - _home_cache[0] < 3600:
            return _home_cache[1]
        data = await asyncio.to_thread(_build_home)
        if data["genres"]:  # an unreachable YouTube Music is asked again next time
            _home_cache = (time.time(), data)
        return data


async def collection(playlist_id: str) -> list[dict]:
    if not re.match(r"^[A-Za-z0-9_-]{10,64}$", playlist_id):
        return []
    cached = _collection_cache.get(playlist_id)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    tracks = await asyncio.to_thread(_playlist_tracks, playlist_id, 60)
    _collection_cache[playlist_id] = (time.time(), tracks)
    _trim(_collection_cache, 200)
    return tracks


# ---------- artists & albums ----------

async def _cached(key: str, build, ttl: int = 3600):
    hit = _artist_cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        value = await asyncio.to_thread(build)
    except Exception as e:
        log.warning("%s failed: %s", key, str(e)[:160])
        return None
    _artist_cache[key] = (time.time(), value)
    _trim(_artist_cache, 300)
    return value


def _releases(data: dict, key: str) -> list[dict]:
    return [{"id": x["browseId"], "title": x.get("title") or "", "year": x.get("year") or "",
             "cover": _cover(x.get("thumbnails") or [], 400)}
            for x in (data.get(key) or {}).get("results", []) if x.get("browseId")]


def _build_artist(artist_id: str) -> dict:
    a = _yt.get_artist(artist_id)
    songs = a.get("songs") or {}
    tracks = [t for t in (normalize(r) for r in songs.get("results", [])) if t]
    for t in tracks:
        t["artist_id"] = t["artist_id"] or artist_id
    related = [{"id": x["browseId"], "name": x.get("title") or "", "cover": _cover(x.get("thumbnails") or [], 300, crop=True)}
               for x in (a.get("related") or {}).get("results", []) if x.get("browseId")]
    return {
        "id": artist_id,
        "name": a.get("name") or "",
        "cover": _cover(a.get("thumbnails") or [], 720, crop=True),
        "description": (a.get("description") or "").strip()[:900],
        "listeners": a.get("monthlyListeners") or "",
        "subscribers": a.get("subscribers") or "",
        "songs_id": songs.get("browseId") or "",  # playlist with all of the artist's songs
        "tracks": tracks,
        "albums": _releases(a, "albums"),
        "singles": _releases(a, "singles"),
        "related": related,
    }


async def artist(artist_id: str) -> dict | None:
    if not ARTIST_ID_RE.match(artist_id):
        return None
    return await _cached("artist:" + artist_id, lambda: _build_artist(artist_id))


async def find_artist(name: str) -> str | None:
    name = name.strip()[:120]
    if not name or name == "—":
        return None

    def lookup() -> str | None:
        for r in _yt.search(name, filter="artists", limit=3):
            if r.get("browseId"):
                return r["browseId"]
        return None

    return await _cached("find:" + name.lower(), lookup, ttl=24 * 3600)


def _build_album(browse_id: str) -> dict:
    a = _yt.get_album(browse_id)
    thumbs = a.get("thumbnails") or []
    tracks = []
    for r in a.get("tracks", []):
        if not (r.get("thumbnails") or r.get("thumbnail")):
            r = {**r, "thumbnails": thumbs}  # album tracks come without their own covers
        t = normalize(r)
        if t:
            tracks.append(t)
    return {
        "id": browse_id,
        "title": a.get("title") or "",
        "artist": ", ".join(x["name"] for x in a.get("artists") or [] if x.get("name")),
        "year": a.get("year") or "",
        "cover": _cover(thumbs),
        "tracks": tracks,
    }


async def album(browse_id: str) -> dict | None:
    if not ALBUM_ID_RE.match(browse_id):
        return None
    return await _cached("album:" + browse_id, lambda: _build_album(browse_id))


# ---------- audio resolution ----------

def _ydl_opts(**extra) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "js_runtimes": {"node": {}},
        "socket_timeout": 15,
        "noprogress": True,
        "concurrent_fragment_downloads": 8,
    }
    if config.FFMPEG:
        opts["ffmpeg_location"] = config.FFMPEG
    opts.update(extra)
    return opts


def _yt_opts(**extra) -> dict:
    opts = _ydl_opts(**extra)
    if config.COOKIES_FILE.exists():
        opts["cookiefile"] = str(config.COOKIES_FILE)
    return opts


def mime_for(ext: str) -> str:
    return {"m4a": "audio/mp4", "mp4": "audio/mp4", "mp3": "audio/mpeg", "webm": "audio/webm",
            "opus": "audio/ogg", "ogg": "audio/ogg", "aac": "audio/aac"}.get(ext, "audio/mpeg")


def _cached_file(vid: str) -> Path | None:
    for p in config.CACHE_DIR.glob(f"{vid}.*"):
        if p.suffix in AUDIO_EXTS and p.stat().st_size > 0:
            return p
    return None


def _yt_direct(vid: str) -> Source:
    opts = _yt_opts(skip_download=True, format="140/bestaudio[ext=m4a]/bestaudio")
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
    return Source("url", mime_for(info.get("ext", "m4a")), url=info["url"], headers=info.get("http_headers") or {})


def _yt_download(vid: str) -> Path:
    opts = _yt_opts(format="140/bestaudio[ext=m4a]/bestaudio",
                    outtmpl=str(config.CACHE_DIR / f"{vid}.%(ext)s"))
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([f"https://www.youtube.com/watch?v={vid}"])
    path = _cached_file(vid)
    if not path:
        raise RuntimeError("download produced no file")
    return path


def _sc_pick(meta: dict) -> list[str]:
    query = f"{meta['artist']} {meta['title']}" if meta["artist"] != "—" else meta["title"]
    with yt_dlp.YoutubeDL(_ydl_opts(skip_download=True, extract_flat=True)) as ydl:
        res = ydl.extract_info(f"scsearch10:{query}", download=False)
    target = meta.get("duration") or 0
    wanted = f"{meta['artist']} {meta['title']}".lower()
    scored = []
    for e in res.get("entries") or []:
        dur = e.get("duration") or 0
        if dur and dur <= 31:  # 30-second previews
            continue
        title = (e.get("title") or "").lower()
        uploader = (e.get("uploader") or "").lower()
        sim = max(SequenceMatcher(None, wanted, f"{uploader} {title}").ratio(),
                  SequenceMatcher(None, meta["title"].lower(), title).ratio())
        penalty = abs(dur - target) / max(target, 60) if target and dur else 0.3
        for bad in ("slowed", "reverb", "sped up", "nightcore", "8d", "remix", "cover"):
            if bad in title and bad not in meta["title"].lower():
                penalty += 0.5
        scored.append((sim - penalty, e["url"]))
    scored.sort(reverse=True)
    return [url for _, url in scored[:4]]


def _fetch_hls(playlist_url: str, headers: dict, dest: Path) -> None:
    """Download an fMP4 HLS playlist with parallel segment requests (much faster than sequential)."""
    with httpx.Client(headers=headers, timeout=20, follow_redirects=True) as client:
        lines = client.get(playlist_url).raise_for_status().text.splitlines()
        init = next((re.search(r'URI="([^"]+)"', l).group(1) for l in lines if l.startswith("#EXT-X-MAP")), None)
        segments = [urljoin(playlist_url, l) for l in lines if l and not l.startswith("#")]
        if init:
            segments.insert(0, urljoin(playlist_url, init))
        with ThreadPoolExecutor(max_workers=8) as pool:
            parts = list(pool.map(lambda u: client.get(u).raise_for_status().content, segments))
    raw, tmp = dest.with_suffix(".raw"), dest.with_suffix(".part")
    raw.write_bytes(b"".join(parts))
    if config.FFMPEG:
        # remux to a regular (non-fragmented) m4a so every player can seek in it
        subprocess.run([config.FFMPEG, "-y", "-loglevel", "error", "-i", str(raw), "-c", "copy",
                        "-movflags", "+faststart", "-f", "mp4", str(tmp)], check=True, timeout=FFMPEG_TIMEOUT,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        raw.unlink(missing_ok=True)
        tmp.replace(dest)
    else:
        raw.replace(dest)


def _sc_info(url: str) -> dict | Exception:
    opts = _ydl_opts(skip_download=True, format="hls_aac_160k/hls_aac_96k/http_mp3_128/bestaudio")
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception as e:  # DRM, geo-blocks, etc.
        return e


def _sc_download(vid: str, meta: dict) -> Path:
    last_error: Exception | None = None
    # candidates in score order, resolved one at a time: the best one usually works
    for url in _sc_pick(meta):
        info = _sc_info(url)
        if isinstance(info, Exception):
            last_error = info
            continue
        if (info.get("duration") or 0) <= 31:
            continue
        try:
            headers = info.get("http_headers") or {}
            if info.get("protocol", "").startswith("m3u8"):
                dest = config.CACHE_DIR / f"{vid}.m4a"
                _fetch_hls(info["url"], headers, dest)
            else:
                dest = config.CACHE_DIR / f"{vid}.{info.get('ext', 'mp3')}"
                tmp = dest.with_suffix(".part")
                with httpx.stream("GET", info["url"], headers=headers, timeout=30, follow_redirects=True) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as f:
                        for chunk in r.iter_bytes(65536):
                            f.write(chunk)
                tmp.replace(dest)
            return dest
        except Exception as e:  # DRM, geo-blocks, etc. — try next candidate
            last_error = e
    raise RuntimeError(f"no SoundCloud match: {last_error}")


def _prune_cache() -> None:
    files = []
    for p in config.CACHE_DIR.rglob("*"):
        if p.is_file() and p.suffix not in (".part", ".raw"):  # never delete a download in progress
            st = p.stat()
            files.append((st.st_mtime, st.st_size, p))
    files.sort()
    total = sum(size for _, size, _ in files)
    for _, size, p in files:
        if total <= config.CACHE_LIMIT_BYTES:
            break
        try:
            p.unlink(missing_ok=True)
            total -= size
        except OSError:  # being served right now (Windows locks open files)
            pass


# why a track could not be played, so the Mini App can say it in words (GET /api/why/{id})
_why: dict[str, str] = {}
_WHY_PATTERNS = (
    ("region", ("in your country", "not available in your region", "geo restrict", "geo-restrict")),
    ("removed", ("private video", "video unavailable", "has been removed", "no longer available", "account associated",
                 "terminated", "copyright")),
    ("age", ("confirm your age", "age-restricted", "age restricted", "inappropriate for some users")),
    ("youtube", ("not a bot", "429", "sign in", "403", "too many requests")),
)


def why_reason(e: Exception) -> str:
    """'region' | 'removed' | 'age' | 'youtube' | '' (nothing recognisable in the error)."""
    msg = str(e).lower()
    return next((reason for reason, needles in _WHY_PATTERNS if any(n in msg for n in needles)), "")


def note_failure(vid: str, e: Exception | None = None) -> None:
    """Remember the most telling reason a track failed: a specific one beats a vague one."""
    reason = why_reason(e) if e else ""
    if reason or vid not in _why:
        _why[vid] = reason or ("youtube" if time.time() < _yt_blocked_until else "notfound")
        _trim(_why, 2000)


def failure(vid: str) -> str:
    return _why.get(vid, "")


def _mark_if_blocked(e: Exception) -> None:
    global _yt_blocked_until
    msg = str(e).lower()
    # 403 on the media itself: the URL is bound to another IP (e.g. a VPN routing youtube.com and
    # googlevideo.com differently) — skip YouTube for a while instead of paying for it on every track
    if "not a bot" in msg or "429" in msg or "sign in" in msg or "403" in msg:
        _yt_blocked_until = time.time() + (600 if config.COOKIES_FILE.exists() else 1800)


def _lock(vid: str) -> asyncio.Lock:
    if len(_locks) > 1000:
        for key in [k for k, lock in _locks.items() if not lock.locked()]:
            del _locks[key]
    return _locks.setdefault(vid, asyncio.Lock())


async def ensure_file(vid: str) -> Path:
    """Download the track to the local cache (needed for SoundCloud and for sending to chat)."""
    async with _lock(vid):
        path = _cached_file(vid)
        if path:
            return path
        async with _download_slots:
            if sources.is_external(vid):
                path = await sources.download(vid, config.CACHE_DIR)
                await asyncio.to_thread(_prune_cache)
                return path
            if time.time() > _yt_blocked_until:
                try:
                    path = await asyncio.to_thread(_yt_download, vid)
                except Exception as e:
                    log.warning("YouTube download failed for %s: %s", vid, str(e)[:160])
                    _mark_if_blocked(e)
                    note_failure(vid, e)
            if not path:
                meta = await track_meta(vid)
                if not meta:
                    raise LookupError("unknown track")
                try:
                    path = await asyncio.to_thread(_sc_download, vid, meta)
                except Exception as e:
                    log.warning("SoundCloud failed for %s: %s", vid, str(e)[:160])
                    path = await sources.find_audio(meta, config.CACHE_DIR, vid)
        await asyncio.to_thread(_prune_cache)
        return path


async def resolve(vid: str, fresh: bool = False) -> Source:
    """Fastest playable source: cached file → direct YouTube stream → SoundCloud download."""
    path = _cached_file(vid)
    if path:
        return Source("file", mime_for(path.suffix.lstrip(".")), path=path)
    cached = _url_cache.get(vid)
    if cached and not fresh and time.time() - cached[0] < 4 * 3600:
        return cached[1]
    if time.time() > _yt_blocked_until and not sources.is_external(vid):
        try:
            src = await asyncio.to_thread(_yt_direct, vid)
            _url_cache[vid] = (time.time(), src)
            _trim(_url_cache, 500)
            return src
        except Exception as e:
            log.warning("YouTube resolve failed for %s: %s", vid, str(e)[:160])
            _mark_if_blocked(e)
            note_failure(vid, e)
    path = await ensure_file(vid)
    return Source("file", mime_for(path.suffix.lstrip(".")), path=path)


def _encode_lite(src: Path, dest: Path, bitrate: str = "", background: bool = False) -> None:
    tmp = dest.with_suffix(".part")
    nice = [_NICE, "-n", "15"] if background and _NICE else []
    subprocess.run([*nice, config.FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-vn", "-c:a", "aac",
                    "-b:a", bitrate or config.STREAM_BITRATE, "-movflags", "+faststart", "-f", "mp4", str(tmp)], check=True,
                   timeout=FFMPEG_TIMEOUT, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tmp.replace(dest)


def lite_enabled() -> bool:
    return bool(config.FFMPEG) and config.STREAM_BITRATE not in ("", "0")


async def stream_file(vid: str, background: bool = False) -> Path:
    """Cached file re-encoded to a low bitrate, so playback keeps up over a slow tunnel.
    background: prepared ahead of time, at a low priority, outside the playback encoder slot."""
    dest = LITE_DIR / f"{vid}.m4a"
    if dest.exists():
        return dest
    src = await ensure_file(vid)
    async with _lock("lite:" + vid):
        if not dest.exists():
            if background:
                await asyncio.to_thread(_encode_lite, src, dest, "", True)
            else:
                async with _ffmpeg_slots:
                    await asyncio.to_thread(_encode_lite, src, dest)
    return dest


# ---------- slowed, sped up and reverb: rendered here, so phones play a clean file ----------

FX_RE = re.compile(r"^(slow|normal|fast)-(off|room|hall)$")
SPEEDS = {"slow": 0.85, "normal": 1.0, "fast": 45 / (100 / 3)}  # 45 rpm on a 33⅓ record
# tail length (s), how fast it dies, and how loud the room is next to the dry sound
ROOMS = {"room": (1.3, 2.6, 0.3), "hall": (3.4, 2.1, 0.5)}
FX_DIR = config.CACHE_DIR / "fx"
FX_DIR.mkdir(exist_ok=True)
FX_RATE = 44100


def _impulse(kind: str) -> Path:
    """The sound of an empty room: stereo noise fading away, written once as a WAV."""
    path = config.CACHE_DIR / f"ir_{kind}.wav"
    if path.exists():
        return path
    seconds, decay, _ = ROOMS[kind]
    n = int(FX_RATE * seconds)
    rnd = random.Random(kind)  # the same room every time
    samples = array.array("h", (int(rnd.uniform(-1, 1) * (1 - i // 2 / n) ** decay * 32000) for i in range(n * 2)))
    tmp = path.with_suffix(".part")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(FX_RATE)
        w.writeframes(samples.tobytes())
    tmp.replace(path)
    return path


# the room's loudness is set by normalising the impulse to unit energy: then a hall is about as loud as the song.
# irnorm came with ffmpeg 6; older builds (Debian 12) normalise by RMS instead
_IR_NORMS = ["irnorm=2", "gtype=rms"]


def _fx_filter(fx: str, norm: str = _IR_NORMS[0]) -> tuple[list[str], str]:
    """(extra inputs, filter graph ending in [o]) for an fx key such as 'slow-hall'."""
    speed, reverb = FX_RE.match(fx).groups()
    k = SPEEDS[speed]
    # slowed the way records are: slower and lower at once, resampled by soxr so it stays clean
    chain = f"[0:a]aformat=channel_layouts=stereo,aresample={FX_RATE}"
    if k != 1:
        chain += f",asetrate={FX_RATE * k:.0f},aresample={FX_RATE}:resampler=soxr"
    if reverb == "off":
        return [], chain + ",alimiter=limit=0.97[o]"
    wet = ROOMS[reverb][2]
    return (["-i", str(_impulse(reverb))],
            f"{chain},asplit[d][w];[w][1:a]afir={norm}[r];"
            f"[d][r]amix=inputs=2:weights={1 - wet * 0.45:.2f} {wet:.2f}:normalize=0,alimiter=limit=0.97[o]")


def _render_fx(src: Path, dest: Path, fx: str, background: bool = False) -> None:
    bitrate = config.STREAM_BITRATE if config.STREAM_BITRATE not in ("", "0") else "128k"
    tmp = dest.with_suffix(".part")
    nice = [_NICE, "-n", "15"] if background and _NICE else []
    for i, norm in enumerate(_IR_NORMS):
        extra, graph = _fx_filter(fx, norm)
        try:
            subprocess.run([*nice, config.FFMPEG, "-y", "-loglevel", "error", "-i", str(src), *extra, "-filter_complex", graph,
                            "-map", "[o]", "-vn", "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", "-f", "mp4", str(tmp)],
                           check=True, timeout=FFMPEG_TIMEOUT, capture_output=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            break
        except subprocess.CalledProcessError as e:
            if not extra or i == len(_IR_NORMS) - 1:  # no reverb (nothing to retry), or every option failed
                log.warning("fx render failed for %s: %s", fx, (e.stderr or b"")[-300:].decode(errors="replace"))
                raise
    tmp.replace(dest)


async def fx_file(vid: str, fx: str, background: bool = False) -> Path:
    """The track slowed / sped up / with reverb, rendered once and kept in the cache."""
    if not config.FFMPEG or not FX_RE.match(fx):
        raise LookupError("fx unavailable")
    dest = FX_DIR / f"{vid}.{fx}.m4a"
    if dest.exists():
        return dest
    src = await ensure_file(vid)
    async with _lock(f"fx:{vid}:{fx}"):
        if not dest.exists():
            if background:
                await asyncio.to_thread(_render_fx, src, dest, fx, True)
            else:
                async with _ffmpeg_slots:
                    await asyncio.to_thread(_render_fx, src, dest, fx)
    await asyncio.to_thread(_prune_cache)
    return dest


SAVE_DIR = config.CACHE_DIR / "save"
SAVE_DIR.mkdir(exist_ok=True)
SAVE_BITRATE = "96k"  # what the Mini App keeps on the phone for listening offline: ~3 MB a track


async def save_file(vid: str) -> Path:
    """A compact copy of the track (AAC 96 kbit/s) for the phone to keep and play without a network."""
    if not config.FFMPEG:
        return await ensure_file(vid)  # no encoder here: the original is still playable
    dest = SAVE_DIR / f"{vid}.m4a"
    if dest.exists():
        return dest
    async with _save_slots:  # the download from YouTube and the encode both happen inside this one slot
        async with _lock("save:" + vid):
            if not dest.exists():
                src = await ensure_file(vid)
                await asyncio.to_thread(_encode_lite, src, dest, SAVE_BITRATE, True)
    await asyncio.to_thread(_prune_cache)
    return dest


async def prefetch(vid: str, fx: str = "", ahead: int = 1) -> None:
    """Warm the cache for an upcoming track when playback depends on a local file. The very next track is
    prepared at once; those two or three places ahead wait their turn in the background (one at a time,
    low priority), so they never hold up what someone is about to hear."""
    async def warm(background: bool) -> None:
        if fx and fx != "normal-off":
            await fx_file(vid, fx, background)
        elif lite_enabled():
            await stream_file(vid, background)
        elif not _cached_file(vid) and (time.time() < _yt_blocked_until or sources.is_external(vid)):
            await ensure_file(vid)
    try:
        if ahead <= 1:
            await warm(False)
        else:
            async with _ahead_slots:
                await warm(True)
    except Exception as e:
        log.info("prefetch failed for %s: %s", vid, str(e)[:120])


def forget_url(vid: str) -> None:
    _url_cache.pop(vid, None)
