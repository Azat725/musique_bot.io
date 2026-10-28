"""Search (YouTube Music) and audio resolution (YouTube, falling back to SoundCloud)."""
import asyncio
import logging
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import urljoin

import httpx
import yt_dlp
from ytmusicapi import YTMusic

from . import config, db

log = logging.getLogger("musique.music")

ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_NOISE_RE = re.compile(
    r"\s*[\(\[][^\)\]]*(official|video|audio|lyric|lyrics|visualizer|clip|клип|премьера|mv|hd|4k)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)

_yt = YTMusic()
_meta: dict[str, dict] = {}
_search_cache: dict[str, tuple[float, list]] = {}
_home_cache: tuple[float, dict] | None = None
_url_cache: dict[str, tuple[float, "Source"]] = {}
_locks: dict[str, asyncio.Lock] = {}
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

def _cover(thumbs: list, size: int = 544) -> str:
    if not thumbs:
        return ""
    url = thumbs[-1]["url"]
    if "googleusercontent.com" in url:
        return re.sub(r"=w\d+-h\d+.*$", f"=w{size}-h{size}-l90-rj", url)
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
    if not vid or not ID_RE.match(vid):
        return None
    artist = ", ".join(a["name"] for a in (r.get("artists") or []) if a.get("name"))
    title, artist = _clean(r.get("title") or "", artist)
    track = {
        "id": vid,
        "title": title or "—",
        "artist": artist or "—",
        "duration": _duration(r),
        "cover": _cover(r.get("thumbnails") or r.get("thumbnail") or []),
    }
    _meta[vid] = track
    return track


def remember(track: dict) -> None:
    _meta[track["id"]] = track


async def track_meta(vid: str) -> dict | None:
    if vid in _meta:
        return _meta[vid]
    stored = await db.get_track(vid)
    if stored:
        _meta[vid] = stored
        return stored
    try:
        data = await asyncio.to_thread(_yt.get_watch_playlist, vid, limit=1)
        if data.get("tracks"):
            return normalize(data["tracks"][0])
    except Exception:
        log.exception("meta lookup failed for %s", vid)
    return None


# ---------- search & home ----------

async def search(query: str, limit: int = 30) -> list[dict]:
    query = query.strip()[:200]
    if not query:
        return []
    key = query.lower()
    cached = _search_cache.get(key)
    if cached and time.time() - cached[0] < 600:
        return cached[1]

    songs, videos = await asyncio.gather(
        asyncio.to_thread(_yt.search, query, filter="songs", limit=limit),
        asyncio.to_thread(_yt.search, query, filter="videos", limit=15),
        return_exceptions=True,
    )
    out, seen = [], set()
    for batch in (songs, videos):
        if isinstance(batch, Exception):
            log.warning("search batch failed: %s", batch)
            continue
        for r in batch:
            t = normalize(r)
            if t and t["id"] not in seen:
                seen.add(t["id"])
                out.append(t)
    _search_cache[key] = (time.time(), out)
    if len(_search_cache) > 500:
        _search_cache.pop(next(iter(_search_cache)))
    return out


def _chart_playlist(country: str, prefix: str) -> str | None:
    charts = _yt.get_charts(country)
    for item in charts.get("videos", []):
        if item.get("title", "").startswith(prefix):
            return item["playlistId"]
    return None


def _playlist_tracks(playlist_id: str, limit: int = 40) -> list[dict]:
    data = _yt.get_playlist(playlist_id, limit=limit)
    return [t for t in (normalize(r) for r in data.get("tracks", [])) if t]


def _build_home() -> dict:
    sections = []
    for key, country, prefix in (
        ("trending", "RU", "Trending 20"),
        ("top_ru", "RU", "Daily Top Music Videos"),
        ("top_global", "ZZ", "Top 100 Music Videos"),
    ):
        try:
            pid = _chart_playlist(country, prefix)
            if pid:
                sections.append({"key": key, "tracks": _playlist_tracks(pid, 30)})
        except Exception:
            log.exception("chart %s failed", key)

    genres = []
    try:
        us = _yt.get_charts("US")
        for g in us.get("genres", []):
            title = g.get("title", "")
            for key, needle in GENRES.items():
                if needle.lower() in title.lower() and key not in {x["key"] for x in genres}:
                    genres.append({"key": key, "id": g["playlistId"], "cover": _cover(g.get("thumbnails", []))})
    except Exception:
        log.exception("genres failed")
    return {"sections": sections, "genres": genres}


async def home() -> dict:
    global _home_cache
    if _home_cache and time.time() - _home_cache[0] < 3600:
        return _home_cache[1]
    data = await asyncio.to_thread(_build_home)
    if data["sections"]:
        _home_cache = (time.time(), data)
    return data


async def collection(playlist_id: str) -> list[dict]:
    if not re.match(r"^[A-Za-z0-9_-]{10,64}$", playlist_id):
        return []
    return await asyncio.to_thread(_playlist_tracks, playlist_id, 60)


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
                        "-movflags", "+faststart", "-f", "mp4", str(tmp)], check=True,
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
    candidates = _sc_pick(meta)
    with ThreadPoolExecutor(max_workers=4) as pool:  # resolve candidates in parallel, keep score order
        infos = list(pool.map(_sc_info, candidates))
    for info in infos:
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
    files = sorted((p for p in config.CACHE_DIR.rglob("*") if p.is_file()), key=lambda p: p.stat().st_atime)
    total = sum(p.stat().st_size for p in files)
    while files and total > config.CACHE_LIMIT_BYTES:
        p = files.pop(0)
        total -= p.stat().st_size
        p.unlink(missing_ok=True)


def _mark_if_blocked(e: Exception) -> None:
    global _yt_blocked_until
    msg = str(e).lower()
    # 403 on the media itself: the URL is bound to another IP (e.g. a VPN routing youtube.com and
    # googlevideo.com differently) — skip YouTube for a while instead of paying for it on every track
    if "not a bot" in msg or "429" in msg or "sign in" in msg or "403" in msg:
        _yt_blocked_until = time.time() + (600 if config.COOKIES_FILE.exists() else 1800)


def _lock(vid: str) -> asyncio.Lock:
    return _locks.setdefault(vid, asyncio.Lock())


async def ensure_file(vid: str) -> Path:
    """Download the track to the local cache (needed for SoundCloud and for sending to chat)."""
    async with _lock(vid):
        path = _cached_file(vid)
        if path:
            return path
        if time.time() > _yt_blocked_until:
            try:
                path = await asyncio.to_thread(_yt_download, vid)
            except Exception as e:
                log.warning("YouTube download failed for %s: %s", vid, str(e)[:160])
                _mark_if_blocked(e)
        if not path:
            meta = await track_meta(vid)
            if not meta:
                raise LookupError("unknown track")
            path = await asyncio.to_thread(_sc_download, vid, meta)
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
    if time.time() > _yt_blocked_until:
        try:
            src = await asyncio.to_thread(_yt_direct, vid)
            _url_cache[vid] = (time.time(), src)
            return src
        except Exception as e:
            log.warning("YouTube resolve failed for %s: %s", vid, str(e)[:160])
            _mark_if_blocked(e)
    path = await ensure_file(vid)
    return Source("file", mime_for(path.suffix.lstrip(".")), path=path)


def _encode_lite(src: Path, dest: Path) -> None:
    tmp = dest.with_suffix(".part")
    subprocess.run([config.FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-vn", "-c:a", "aac",
                    "-b:a", config.STREAM_BITRATE, "-movflags", "+faststart", "-f", "mp4", str(tmp)], check=True,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    tmp.replace(dest)


def lite_enabled() -> bool:
    return bool(config.FFMPEG) and config.STREAM_BITRATE not in ("", "0")


async def stream_file(vid: str) -> Path:
    """Cached file re-encoded to a low bitrate, so playback keeps up over a slow tunnel."""
    dest = LITE_DIR / f"{vid}.m4a"
    if dest.exists():
        return dest
    src = await ensure_file(vid)
    async with _lock("lite:" + vid):
        if not dest.exists():
            await asyncio.to_thread(_encode_lite, src, dest)
    return dest


async def prefetch(vid: str) -> None:
    """Warm the cache for an upcoming track when playback depends on a local file."""
    try:
        if lite_enabled():
            await stream_file(vid)
        elif not _cached_file(vid) and time.time() < _yt_blocked_until:
            await ensure_file(vid)
    except Exception as e:
        log.info("prefetch failed for %s: %s", vid, str(e)[:120])


def forget_url(vid: str) -> None:
    _url_cache.pop(vid, None)
