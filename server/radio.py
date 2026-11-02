"""Shared, bounded resolution of dated radio selections. Audio uses the ordinary stream/cache."""
import asyncio
import json
import re
import time
import unicodedata
from pathlib import Path

CATALOGUE = json.loads(Path(__file__).with_name('radio.json').read_text(encoding='utf-8'))
COUNTRIES = frozenset(CATALOGUE)
DECADES = frozenset(range(1940, 2010, 10))
_cache = {}
_inflight = {}
_slots = asyncio.Semaphore(2)
_searching = set()


def words(text):
    plain = ''.join(char for char in unicodedata.normalize('NFKD', text) if unicodedata.category(char) != 'Mn')
    return set(re.findall(r'\w+', plain.casefold().replace('ё', 'е')))


def match(seed, candidates):
    title, artist = words(seed['title']), words(seed['artist'])
    ranked = []
    for track in candidates:
        title_share = len(title & words(track.get('title', ''))) / max(1, len(title))
        artist_share = len(artist & words(track.get('artist', ''))) / max(1, len(artist))
        # Never silently substitute a cover or an unrelated first result.
        if title_share >= .7 and artist_share >= .5:
            ranked.append((title_share + artist_share, track))
    return max(ranked, key=lambda pair: pair[0])[1] if ranked else None


async def resolve(seed):
    from . import music
    try:
        await asyncio.wait_for(_slots.acquire(), 2)
    except asyncio.TimeoutError:
        return None
    # Cancelling an asyncio.to_thread() search doesn't stop its HTTP thread. Retain its slot until it really ends.
    task = asyncio.create_task(music.search(f"{seed['artist']} {seed['title']}", limit=5, videos=False))
    _searching.add(task)
    def done(finished):
        _searching.discard(finished)
        _slots.release()
        if not finished.cancelled():
            finished.exception()
    task.add_done_callback(done)
    try:
        return match(seed, await asyncio.wait_for(asyncio.shield(task), 14))
    except Exception:
        return None


async def _load(country, decade):
    seeds = [item for item in CATALOGUE[country] if (item['year'] <= 1949 if decade == 1940 else decade <= item['year'] <= decade + 9)]
    results = await asyncio.gather(*(resolve(seed) for seed in seeds))
    tracks = list({track['id']: track for track in results if track}.values())
    _cache[country, decade] = (time.monotonic() + (21600 if tracks else 90), tracks)
    return tracks


async def station(country, decade):
    if country not in COUNTRIES or decade not in DECADES:
        raise ValueError('Unknown radio selection')
    key = (country, decade)
    if key in _cache and _cache[key][0] > time.monotonic():
        return _cache[key][1]
    if key not in _inflight:
        task = asyncio.create_task(_load(*key))
        _inflight[key] = task
        def done(finished):
            _inflight.pop(key, None)
            if not finished.cancelled():
                finished.exception()  # retrieve errors even when every waiting client disconnected
        task.add_done_callback(done)
    return await asyncio.shield(_inflight[key])
