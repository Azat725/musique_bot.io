"""Music outside YouTube Music: Rutube, Bandcamp, Internet Archive, Jamendo, Zaycev.net.

Every provider module has PREFIX, enabled(), async search(client, query) -> [(track, ref)] and
download(ref, dest_base) -> Path (blocking, run in a thread). Track ids are "<prefix>.<key>";
the provider's own reference (a URL, an item path) is kept in the `sources` table.
"""
import asyncio
import logging
import re
from difflib import SequenceMatcher
from pathlib import Path

import httpx

from .. import config, db
from . import archive, bandcamp, jamendo, rutube, zaycev

log = logging.getLogger("musique.sources")

# order = priority when the same song comes from several places (audio sites before video sites)
PROVIDERS = {p.PREFIX: p for p in (zaycev, bandcamp, jamendo, archive, rutube)}
NAMES = {p.PREFIX: p.NAME for p in PROVIDERS.values()}
ID_RE = re.compile(r"^(?:%s)\.[A-Za-z0-9_-]{1,40}$" % "|".join(PROVIDERS))
SEARCH_TIMEOUT = 5
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

_refs: dict[str, str] = {}


def is_external(track_id: str) -> bool:
    return bool(ID_RE.match(track_id))


def active() -> list:
    wanted = {s.strip() for s in config.SOURCES.split(",") if s.strip()}
    return [p for p in PROVIDERS.values() if p.NAME.lower() in wanted and p.enabled()]


def _key(track: dict) -> str:
    return re.sub(r"[^\w]+", " ", f"{track['artist']} {track['title']}".lower()).strip()


async def search(query: str) -> list[dict]:
    """All enabled providers in parallel; a slow or broken one is simply left out."""
    providers = active()
    if not providers:
        return []
    async with httpx.AsyncClient(headers=HEADERS, timeout=SEARCH_TIMEOUT, follow_redirects=True) as client:
        batches = await asyncio.gather(
            *(asyncio.wait_for(p.search(client, query), SEARCH_TIMEOUT + 1) for p in providers), return_exceptions=True)
    out, seen, refs = [], set(), []
    for p, batch in zip(providers, batches):
        if isinstance(batch, BaseException):
            log.info("%s search failed: %s", p.NAME, str(batch)[:120] or type(batch).__name__)
            continue
        for track, ref in batch:
            key = _key(track)
            if key in seen:
                continue
            seen.add(key)
            _refs[track["id"]] = ref
            refs.append((track["id"], ref))
            out.append(track)
    if refs:
        await db.save_sources(refs)
    if len(_refs) > 5000:
        for k in list(_refs)[:1000]:
            del _refs[k]
    return out


async def download(track_id: str, cache_dir: Path) -> Path:
    provider = PROVIDERS[track_id.split(".", 1)[0]]
    ref = _refs.get(track_id) or await db.source_ref(track_id)
    if not ref:
        raise LookupError("unknown track")
    return await asyncio.to_thread(provider.download, ref, cache_dir / track_id)


async def find_audio(meta: dict, cache_dir: Path, vid: str) -> Path:
    """Last resort for a YouTube track nothing else could play: the same song on an audio site."""
    query = f"{meta['artist']} {meta['title']}" if meta["artist"] != "—" else meta["title"]
    wanted = _key(meta)
    target = meta.get("duration") or 0
    async with httpx.AsyncClient(headers=HEADERS, timeout=SEARCH_TIMEOUT, follow_redirects=True) as client:
        for p in (zaycev, rutube):
            if p not in active():
                continue
            try:
                found = await asyncio.wait_for(p.search(client, query), SEARCH_TIMEOUT + 1)
            except Exception as e:
                log.info("%s fallback search failed: %s", p.NAME, str(e)[:120])
                continue
            scored = []
            for track, ref in found:
                score = SequenceMatcher(None, wanted, _key(track)).ratio()
                if target and track["duration"]:
                    score -= abs(track["duration"] - target) / max(target, 60)
                scored.append((score, ref))
            for score, ref in sorted(scored, reverse=True)[:2]:
                if score < 0.55:
                    break
                try:
                    return await asyncio.to_thread(p.download, ref, cache_dir / vid)
                except Exception as e:
                    log.info("%s fallback download failed: %s", p.NAME, str(e)[:120])
    raise LookupError("no match on other sources")


def stream_to(url: str, dest: Path, headers: dict | None = None) -> Path:
    """Download a plain audio URL to dest (via a .part file, so a broken download never looks cached)."""
    tmp = dest.with_name(dest.name + ".part")
    with httpx.stream("GET", url, headers={**HEADERS, **(headers or {})}, timeout=30, follow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(65536):
                f.write(chunk)
    if tmp.stat().st_size < 10_000:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("audio too small")
    tmp.replace(dest)
    return dest
