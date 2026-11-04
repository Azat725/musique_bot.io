"""SQLite storage: tracks, likes, playlists, history and Telegram file_id cache.

One connection, used by one thread of its own, in WAL mode. Every operation (all its statements, and any JSON it
reads or writes) runs there in one go: one hop between threads per request, not one per statement, and the event
loop never waits on the disk. Writes do not each wait for the disk either: they go into one open transaction that is
committed a quarter of a second later together with whatever else came meanwhile, so thousands of listeners saving
their place cost a few disk syncs a second, not hundreds. Each write runs inside a savepoint: a failing one is undone
alone, and since the thread runs one thing at a time a commit never lands in the middle of another."""
import asyncio
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration INTEGER, cover TEXT, artist_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER, track_id TEXT, created REAL, PRIMARY KEY (user_id, track_id)
);
CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER, track_id TEXT, created REAL, PRIMARY KEY (playlist_id, track_id)
);
CREATE TABLE IF NOT EXISTS history (
    user_id INTEGER, track_id TEXT, played REAL, PRIMARY KEY (user_id, track_id)
);
CREATE TABLE IF NOT EXISTS tg_files (
    track_id TEXT PRIMARY KEY, file_id TEXT
);
CREATE TABLE IF NOT EXISTS fav_artists (
    user_id INTEGER, artist_id TEXT, name TEXT, cover TEXT, created REAL, PRIMARY KEY (user_id, artist_id)
);
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, ref TEXT
);
CREATE TABLE IF NOT EXISTS lyrics (
    track_id TEXT PRIMARY KEY, text TEXT, source TEXT, fetched REAL, synced TEXT
);
CREATE TABLE IF NOT EXISTS user_state (
    user_id INTEGER, key TEXT, value TEXT, updated REAL, PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, kind TEXT, first_name TEXT, username TEXT, language_code TEXT, created REAL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, played);
CREATE INDEX IF NOT EXISTS idx_likes_user ON likes(user_id, created);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks ON playlist_tracks(playlist_id, created);
CREATE INDEX IF NOT EXISTS idx_fav_artists_user ON fav_artists(user_id, created);
"""

_conn: sqlite3.Connection | None = None
_thread: ThreadPoolExecutor | None = None
_open = False  # a transaction with writes in it, waiting for its commit (only the database thread touches it)
_commit_task: asyncio.Task | None = None
COMMIT_AFTER = 0.25  # seconds: how long a write may wait to share a commit with others
commits = 0  # how many commits were made (tests count them)


def _q(sql: str, args=()) -> list[sqlite3.Row]:
    return _conn.execute(sql, args).fetchall()


def _one(sql: str, args=()) -> sqlite3.Row | None:
    return _conn.execute(sql, args).fetchone()


def _init() -> None:
    global _conn
    # transactions are opened here, explicitly (isolation_level None); the connection only ever lives in our thread
    _conn = sqlite3.connect(config.DB_PATH, isolation_level=None, check_same_thread=False)
    _conn.row_factory = sqlite3.Row
    for pragma in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=5000", "cache_size=-32000", "temp_store=MEMORY"):
        _conn.execute("PRAGMA " + pragma)
    _conn.executescript(SCHEMA)
    # databases created before the artist card have no artist_id column yet
    if "artist_id" not in {r["name"] for r in _q("PRAGMA table_info(tracks)")}:
        _conn.execute("ALTER TABLE tracks ADD COLUMN artist_id TEXT DEFAULT ''")
    # lyrics cached before timed lines: synced NULL means "not looked for yet", '' means "there are none"
    if "synced" not in {r["name"] for r in _q("PRAGMA table_info(lyrics)")}:
        _conn.execute("ALTER TABLE lyrics ADD COLUMN synced TEXT")


async def init() -> None:
    global _thread
    _thread = ThreadPoolExecutor(1, thread_name_prefix="db")
    await _run(_init)


async def close() -> None:
    global _thread, _conn
    if _thread:
        await flush()
        await _run(_conn.close)
        _thread.shutdown(wait=True)
        _thread, _conn = None, None


async def _run(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(_thread, fn, *args)


def _commit() -> None:
    global _open, commits
    if _open:
        _conn.execute("COMMIT")
        _open = False
        commits += 1


def _in_transaction(fn, args, now: bool):
    global _open
    if not _open:
        _conn.execute("BEGIN")
        _open = True
    _conn.execute("SAVEPOINT w")
    try:
        result = fn(*args)
    except BaseException:
        _conn.execute("ROLLBACK TO w")
        _conn.execute("RELEASE w")
        raise
    _conn.execute("RELEASE w")
    if now:
        _commit()
    return result


async def _write(fn, *args, now: bool = False):
    """One write (any number of statements): all of it or none of it, committed soon (now=True: before returning)."""
    result = await _run(_in_transaction, fn, args, now)
    if not now:
        _commit_soon()
    return result


def _commit_soon() -> None:
    global _commit_task
    if _commit_task is None or _commit_task.done():
        _commit_task = asyncio.create_task(_commit_later())


async def _commit_later() -> None:
    await asyncio.sleep(COMMIT_AFTER)
    await flush()


async def flush() -> None:
    """Commit what is waiting (also on shutdown)."""
    await _run(_commit)


def _track(row) -> dict:
    return {"id": row["id"], "title": row["title"], "artist": row["artist"],
            "duration": row["duration"], "cover": row["cover"], "artist_id": row["artist_id"] or ""}


def _save_track(t: dict) -> None:
    # the first description of a track stays: a client cannot rename a song for everyone else (only gaps are filled)
    _conn.execute(
        "INSERT INTO tracks (id, title, artist, duration, cover, artist_id) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET duration=COALESCE(NULLIF(tracks.duration, 0), excluded.duration), "
        "cover=COALESCE(NULLIF(tracks.cover, ''), excluded.cover), "
        "artist_id=COALESCE(NULLIF(tracks.artist_id, ''), excluded.artist_id)",
        (t["id"], t["title"], t["artist"], t["duration"], t["cover"], t.get("artist_id") or ""),
    )


async def save_track(t: dict) -> None:
    await _write(_save_track, t)


async def get_track(track_id: str) -> dict | None:
    row = await _run(_one, "SELECT * FROM tracks WHERE id = ?", (track_id,))
    return _track(row) if row else None


async def save_sources(rows: list[tuple[str, str]]) -> None:
    """Where tracks from other sources live (a URL or an item path), keyed by their track id."""
    await _write(lambda: _conn.executemany(
        "INSERT INTO sources (id, ref) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ref = excluded.ref", rows))


async def source_ref(track_id: str) -> str | None:
    row = await _run(_one, "SELECT ref FROM sources WHERE id = ?", (track_id,))
    return row["ref"] if row else None


# ---------- lyrics ----------

async def get_lyrics(track_id: str) -> dict | None:
    """Cached lyrics lookup: {"text": str | None, "source": str, "fetched": float, "synced": str | None}.
    text None means none was found; synced is JSON of timed lines, '' when there are none, None if never looked for."""
    row = await _run(_one, "SELECT text, source, fetched, synced FROM lyrics WHERE track_id = ?", (track_id,))
    return {"text": row["text"], "source": row["source"] or "", "fetched": row["fetched"], "synced": row["synced"]} if row else None


async def save_lyrics(track_id: str, text: str | None, source: str = "", synced: str | None = "") -> None:
    await _write(lambda: _conn.execute(
        "INSERT INTO lyrics (track_id, text, source, fetched, synced) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(track_id) DO UPDATE SET text = excluded.text, source = excluded.source, "
        "fetched = excluded.fetched, synced = excluded.synced",
        (track_id, text, source, time.time(), synced)))


# ---------- accounts of the site (guests have negative ids, Telegram accounts their Telegram id) ----------

def _account(row) -> dict:
    return {"id": row["id"], "kind": row["kind"], "first_name": row["first_name"] or "",
            "username": row["username"] or "", "language_code": row["language_code"] or ""}


async def get_account(user_id: int) -> dict | None:
    row = await _run(_one, "SELECT * FROM accounts WHERE id = ?", (user_id,))
    return _account(row) if row else None


async def save_account(user_id: int, kind: str, first_name: str = "", username: str = "", language_code: str = "") -> None:
    await _write(lambda: _conn.execute(  # a new session is handed out right after: it must survive a restart
        "INSERT INTO accounts (id, kind, first_name, username, language_code, created) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, first_name = excluded.first_name, "
        "username = excluded.username, language_code = excluded.language_code",
        (user_id, kind, first_name, username, language_code, time.time())), now=True)


# ---------- what follows the account from device to device: the look (settings) and the queue ----------

# the place in the queue is sent every 20 s by everyone listening: it is a row of its own ("queue_pos"), so saving it
# never rewrites the queue (up to 500 tracks). The track ids of each stored queue are kept here to check it against.
_queue_ids: dict[int, list[str]] = {}
QUEUE_IDS_KEPT = 5000


def _remember_queue(user_id: int, value: dict) -> None:
    _queue_ids.pop(user_id, None)
    _queue_ids[user_id] = [t.get("id") for t in value.get("tracks") or []]
    while len(_queue_ids) > QUEUE_IDS_KEPT:
        _queue_ids.pop(next(iter(_queue_ids)))


def _get_states(user_id: int) -> dict[str, dict]:
    rows = _q("SELECT key, value, updated FROM user_state WHERE user_id = ?", (user_id,))
    states = {r["key"]: {"value": json.loads(r["value"]), "updated": r["updated"]} for r in rows}
    pos, queue = states.pop("queue_pos", None), states.get("queue")
    if queue:
        _remember_queue(user_id, queue["value"])
        tracks = queue["value"].get("tracks") or []
        if pos and pos["updated"] > queue["updated"]:
            p = pos["value"]
            if 0 <= p.get("index", -1) < len(tracks) and tracks[p["index"]].get("id") == p.get("id"):
                queue["value"]["index"], queue["value"]["time"] = p["index"], p.get("time", 0)
                queue["updated"] = pos["updated"]
    return states


async def get_states(user_id: int) -> dict[str, dict]:
    """{ key: {"value": object, "updated": server time} } for the settings and the queue."""
    return await _run(_get_states, user_id)


def _put_state(user_id: int, key: str, text: str) -> float:
    partner = {"queue": "queue_pos", "queue_pos": "queue"}.get(key, key)
    row = _one("SELECT MAX(updated) AS u FROM user_state WHERE user_id = ? AND key IN (?, ?)", (user_id, key, partner))
    now = max(time.time(), (row["u"] + 0.001) if row and row["u"] else 0)  # strictly newer than the previous write
    _conn.execute(
        "INSERT INTO user_state (user_id, key, value, updated) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
        (user_id, key, text, now))
    return now


def _set_state(user_id: int, key: str, value: dict) -> float:
    now = _put_state(user_id, key, json.dumps(value, ensure_ascii=False))
    if key == "queue":
        _conn.execute("DELETE FROM user_state WHERE user_id = ? AND key = 'queue_pos'", (user_id,))
        _remember_queue(user_id, value)
    return now


async def set_state(user_id: int, key: str, value: dict) -> float:
    """Store it (the last write wins) and return the server time of the write: devices compare against it."""
    return await _write(_set_state, user_id, key, value)


async def move_queue_position(user_id: int, track_id: str, index: int, seconds: float) -> float | None:
    """Only where the listener is in the stored queue (a small write): None when that queue is not the one in use."""
    ids = _queue_ids.get(user_id)
    if ids is None:
        if not (await get_states(user_id)).get("queue"):
            return None
        ids = _queue_ids.get(user_id) or []
    if not 0 <= index < len(ids) or ids[index] != track_id:
        return None
    return await _write(_put_state, user_id, "queue_pos", json.dumps({"id": track_id, "index": index, "time": seconds}))


def _merge_user(src: int, dst: int) -> None:
    e = _conn.execute
    e("INSERT OR IGNORE INTO likes SELECT ?, track_id, created FROM likes WHERE user_id = ?", (dst, src))
    e("DELETE FROM likes WHERE user_id = ?", (src,))
    e("UPDATE playlists SET user_id = ? WHERE user_id = ?", (dst, src))
    e("INSERT INTO history SELECT ?, track_id, played FROM history WHERE user_id = ? AND true "
      "ON CONFLICT(user_id, track_id) DO UPDATE SET played = MAX(history.played, excluded.played)", (dst, src))
    e("DELETE FROM history WHERE user_id = ?", (src,))
    e("INSERT OR IGNORE INTO fav_artists SELECT ?, artist_id, name, cover, created FROM fav_artists WHERE user_id = ?", (dst, src))
    e("DELETE FROM fav_artists WHERE user_id = ?", (src,))
    # the account keeps its own look and queue; a guest's move in only where the account has none yet
    e("INSERT OR IGNORE INTO user_state SELECT ?, key, value, updated FROM user_state WHERE user_id = ?", (dst, src))
    e("DELETE FROM user_state WHERE user_id = ?", (src,))
    e("DELETE FROM accounts WHERE id = ?", (src,))
    _queue_ids.pop(src, None)
    _queue_ids.pop(dst, None)


async def merge_user(src: int, dst: int) -> None:
    """Move a guest's library into an account: likes, playlists, history and artists (no duplicates;
    a track in both histories keeps the later time), then forget the guest."""
    if src != dst:
        await _write(_merge_user, src, dst, now=True)


# ---------- favourite artists ----------

async def fav_artists(user_id: int) -> list[dict]:
    rows = await _run(_q, "SELECT artist_id, name, cover FROM fav_artists WHERE user_id = ? ORDER BY created DESC", (user_id,))
    return [{"id": r["artist_id"], "name": r["name"], "cover": r["cover"]} for r in rows]


async def add_fav_artist(user_id: int, a: dict) -> None:
    await _write(lambda: _conn.execute(
        "INSERT INTO fav_artists VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, artist_id) DO UPDATE SET "
        "name = excluded.name, cover = COALESCE(NULLIF(excluded.cover, ''), fav_artists.cover)",
        (user_id, a["id"], a["name"], a["cover"], time.time())))


async def remove_fav_artist(user_id: int, artist_id: str) -> None:
    await _write(lambda: _conn.execute("DELETE FROM fav_artists WHERE user_id = ? AND artist_id = ?", (user_id, artist_id)))


# ---------- likes ----------

async def likes(user_id: int) -> list[dict]:
    rows = await _run(_q, "SELECT t.* FROM likes l JOIN tracks t ON t.id = l.track_id WHERE l.user_id = ? "
                          "ORDER BY l.created DESC", (user_id,))
    return [_track(r) for r in rows]


def _like(user_id: int, t: dict) -> None:
    _save_track(t)
    _conn.execute("INSERT OR IGNORE INTO likes VALUES (?, ?, ?)", (user_id, t["id"], time.time()))


async def like(user_id: int, t: dict) -> None:
    await _write(_like, user_id, t)


async def unlike(user_id: int, track_id: str) -> None:
    await _write(lambda: _conn.execute("DELETE FROM likes WHERE user_id = ? AND track_id = ?", (user_id, track_id)))


# ---------- playlists ----------

def _playlists(user_id: int) -> list[dict]:
    rows = _q("SELECT p.id, p.name, COUNT(pt.track_id) AS count FROM playlists p "
              "LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? "
              "GROUP BY p.id ORDER BY p.created DESC", (user_id,))
    return [{"id": r["id"], "name": r["name"], "count": r["count"],
             "covers": [c["cover"] for c in _q("SELECT t.cover FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
                                               "WHERE pt.playlist_id = ? ORDER BY pt.created DESC LIMIT 4", (r["id"],))]}
            for r in rows]


async def playlists(user_id: int) -> list[dict]:
    return await _run(_playlists, user_id)


def _owns(user_id: int, playlist_id: int) -> bool:
    return _one("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id)) is not None


async def create_playlist(user_id: int, name: str) -> int:
    return await _write(lambda: _conn.execute("INSERT INTO playlists (user_id, name, created) VALUES (?, ?, ?)",
                                              (user_id, name, time.time())).lastrowid)


async def rename_playlist(user_id: int, playlist_id: int, name: str) -> bool:
    return await _write(lambda: _conn.execute("UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?",
                                              (name, playlist_id, user_id)).rowcount > 0)


def _delete_playlist(user_id: int, playlist_id: int) -> bool:
    if not _owns(user_id, playlist_id):
        return False
    _conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    _conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    return True


async def delete_playlist(user_id: int, playlist_id: int) -> bool:
    return await _write(_delete_playlist, user_id, playlist_id)


def _playlist(user_id: int, playlist_id: int) -> dict | None:
    p = _one("SELECT id, name FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id))
    if not p:
        return None
    tracks = [_track(r) for r in _q("SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
                                    "WHERE pt.playlist_id = ? ORDER BY pt.created ASC", (playlist_id,))]
    return {"id": p["id"], "name": p["name"], "tracks": tracks}


async def playlist(user_id: int, playlist_id: int) -> dict | None:
    return await _run(_playlist, user_id, playlist_id)


def _add_to_playlist(user_id: int, playlist_id: int, t: dict) -> bool:
    if not _owns(user_id, playlist_id):
        return False
    _save_track(t)
    _conn.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)", (playlist_id, t["id"], time.time()))
    return True


async def add_to_playlist(user_id: int, playlist_id: int, t: dict) -> bool:
    return await _write(_add_to_playlist, user_id, playlist_id, t)


def _fill_playlist(playlist_id: int, tracks: list[dict]) -> None:
    now = time.time()
    for i, t in enumerate(tracks):
        _save_track(t)
        _conn.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)", (playlist_id, t["id"], now + i / 1000))


async def fill_playlist(playlist_id: int, tracks: list[dict]) -> None:
    """Many tracks at once, in order (an import); the caller has just created the playlist."""
    await _write(_fill_playlist, playlist_id, tracks)


def _remove_from_playlist(user_id: int, playlist_id: int, track_id: str) -> bool:
    if not _owns(user_id, playlist_id):
        return False
    _conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
    return True


async def remove_from_playlist(user_id: int, playlist_id: int, track_id: str) -> bool:
    return await _write(_remove_from_playlist, user_id, playlist_id, track_id)


# ---------- history ----------

def _add_history(user_id: int, t: dict) -> None:
    _save_track(t)
    _conn.execute("INSERT INTO history VALUES (?, ?, ?) ON CONFLICT(user_id, track_id) DO UPDATE SET played = excluded.played",
                  (user_id, t["id"], time.time()))


async def add_history(user_id: int, t: dict) -> None:
    await _write(_add_history, user_id, t)


async def history(user_id: int, limit: int = 50) -> list[dict]:
    rows = await _run(_q, "SELECT t.* FROM history h JOIN tracks t ON t.id = h.track_id WHERE h.user_id = ? "
                          "ORDER BY h.played DESC LIMIT ?", (user_id, limit))
    return [_track(r) for r in rows]


async def history_ids(user_id: int) -> list[str]:
    """Every track the user has ever played (each once): the Mini App unsleeves only the new ones."""
    return [r["track_id"] for r in await _run(_q, "SELECT track_id FROM history WHERE user_id = ?", (user_id,))]


async def clear_history(user_id: int) -> None:
    await _write(lambda: _conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,)))


# ---------- telegram file cache ----------

async def tg_file(track_id: str) -> str | None:
    row = await _run(_one, "SELECT file_id FROM tg_files WHERE track_id = ?", (track_id,))
    return row["file_id"] if row else None


async def save_tg_file(track_id: str, file_id: str) -> None:
    await _write(lambda: _conn.execute("INSERT OR REPLACE INTO tg_files VALUES (?, ?)", (track_id, file_id)))
