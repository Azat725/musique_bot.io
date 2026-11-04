"""The radio's stations: one per country and decade, each a fixed list of well-known recordings of that time
(radio_seeds.json: artist, title, year).

Each song is looked up on YouTube Music once, ever: the answer (its id, or "not found") is kept in DATA_DIR, so after
that a station costs the server nothing however many people tune in. A background job looks the songs up slowly
after a start; the first listener of a station that is not ready yet waits a few seconds while its songs are looked
up right then (once, for everyone asking at that moment). Then the songs are slowly downloaded into the cache, one at
a time and only when the server is idle, so tuning in starts at once. A song that cannot be played here (removed, or
not in this country) is left out."""
import asyncio
import json
import logging
import random
import re
import time
import unicodedata
from pathlib import Path

from . import config

log = logging.getLogger("musique.radio")

SEEDS: dict[str, dict[str, list[list]]] = json.loads(Path(__file__).with_name("radio_seeds.json").read_text(encoding="utf-8"))
COUNTRIES = frozenset(SEEDS)
DECADES = frozenset(range(1930, 2010, 10))
STORE = config.DATA_DIR / "radio_resolved.json"
RETRY_AFTER = 7 * 24 * 3600  # a song not found is looked for again a week later (a new upload may have appeared)
READY = 8  # songs a station needs before it plays without waiting for the rest
FIRST_WAIT = 12  # seconds the first listener of a station not ready yet waits for its songs

_found: dict[str, dict | float] = {}  # seed key -> track, or the time it was not found
_flights: dict[tuple[str, str], asyncio.Task] = {}
_slots = asyncio.Semaphore(3)  # searches at once, background and on demand together
_unplayable: set[str] = set()
_dirty = 0


def _key(seed: list) -> str:
    return f"{seed[0]}|{seed[1]}"


def _load() -> None:
    try:
        _found.update(json.loads(STORE.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass


def _save() -> None:
    global _dirty
    tmp = STORE.with_suffix(".part")
    tmp.write_text(json.dumps(_found, ensure_ascii=False), encoding="utf-8")
    tmp.replace(STORE)
    _dirty = 0


_load()


# ---------- finding a song ----------

def words(text: str) -> set[str]:
    plain = "".join(c for c in unicodedata.normalize("NFKD", text) if unicodedata.category(c) != "Mn")
    plain = plain.casefold().replace("ё", "е").replace("&", " and ")
    return set(re.findall(r"\w+", plain)) - {"the", "and", "a"}


def _share(wanted: str, got: str) -> float:
    w = words(wanted)
    return len(w & words(got)) / max(1, len(w))


BAD = ("karaoke", "cover", "remix", "instrumental", "8d", "slowed", "sped up", "nightcore")


def match(seed: list, candidates: list[dict]) -> dict | None:
    """The candidate that is this song: the title and the artist both match (never a cover or an unrelated first
    result), a real length, no karaoke or remix unless the seed says so."""
    artist, title, year = seed
    ranked = []
    for t in candidates:
        ts, as_ = _share(title, t.get("title", "")), _share(artist, t.get("artist", ""))
        if ts >= .7 and as_ >= .5 and 60 <= (t.get("duration") or 0) <= 900:
            penalty = 1 if any(b in t.get("title", "").lower() and b not in title.lower() for b in BAD) else 0
            ranked.append((ts + as_ - penalty, t))
    return {**max(ranked, key=lambda p: p[0])[1], "year": year} if ranked else None


async def _find(seed: list) -> None:
    global _dirty
    from . import music
    async with _slots:
        try:
            found = match(seed, await music.search(f"{seed[0]} {seed[1]}", limit=8, videos=False))
        except Exception as e:
            log.info("radio lookup failed for %s: %s", _key(seed), str(e)[:120])
            return  # not remembered: asked again next time
    _found[_key(seed)] = found or time.time()
    _dirty += 1
    if _dirty >= 10:
        await asyncio.to_thread(_save)


def _wanted(seed: list) -> bool:
    got = _found.get(_key(seed))
    return got is None or (isinstance(got, float) and time.time() - got > RETRY_AFTER)


def _tracks(country: str, decade: str) -> list[dict]:
    out, seen = [], set()
    for seed in SEEDS[country].get(decade, []):
        t = _found.get(_key(seed))
        if isinstance(t, dict) and t["id"] not in _unplayable and t["id"] not in seen:
            seen.add(t["id"])
            out.append(t)
    return out


async def _resolve_station(country: str, decade: str) -> None:
    await asyncio.gather(*(_find(s) for s in SEEDS[country].get(decade, []) if _wanted(s)))
    if _dirty:
        await asyncio.to_thread(_save)


# ---------- what the API and the server's start use ----------

async def station(country: str, decade: int) -> list[dict]:
    """The station's songs in a fresh order each time (a radio never plays the same running order twice)."""
    if country not in COUNTRIES or decade not in DECADES:
        raise ValueError("Unknown radio selection")
    d = str(decade)
    if len(_tracks(country, d)) < READY and any(_wanted(s) for s in SEEDS[country].get(d, [])):
        job = _flights.get((country, d))
        if job is None:
            job = _flights[(country, d)] = asyncio.create_task(_resolve_station(country, d))
            job.add_done_callback(lambda _t: _flights.pop((country, d), None))
        try:
            await asyncio.wait_for(asyncio.shield(job), FIRST_WAIT)
        except asyncio.TimeoutError:
            pass  # what is ready plays now; the rest joins for the next listeners
    songs = [dict(t) for t in _tracks(country, d)]
    random.shuffle(songs)
    return songs


def unplayable(vid: str) -> None:
    _unplayable.add(vid)


async def warm() -> None:
    """After a start: look up every song not known yet (one at a time), then download the stations into the cache at
    the lowest priority, so tuning in starts at once. Whoever presses play always goes first."""
    from . import music
    await asyncio.sleep(60)  # let the server settle first
    pending = [s for decades in SEEDS.values() for seeds in decades.values() for s in seeds if _wanted(s)]
    for seed in pending:
        if _wanted(seed):
            await _find(seed)
            await asyncio.sleep(1.5)
    if _dirty:
        await asyncio.to_thread(_save)
    ids = [t["id"] for t in _found.values() if isinstance(t, dict)]
    random.shuffle(ids)
    log.info("radio: %d songs known, warming the cache", len(ids))
    for vid in ids:
        if music._cached_file(vid):
            continue
        await music.prefetch(vid, "", ahead=3)  # background work: dropped whenever the line is long
        if not music._cached_file(vid) and music.failure(vid) in ("removed", "region", "age"):
            unplayable(vid)
        await asyncio.sleep(20)
