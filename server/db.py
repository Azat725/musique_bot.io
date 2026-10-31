"""SQLite storage: tracks, likes, playlists, history and Telegram file_id cache."""
import time

import aiosqlite

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
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, kind TEXT, first_name TEXT, username TEXT, language_code TEXT, created REAL
);
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
"""

_db: aiosqlite.Connection | None = None


async def init() -> None:
    global _db
    _db = await aiosqlite.connect(config.DB_PATH)
    _db.row_factory = aiosqlite.Row
    await _db.executescript(SCHEMA)
    # databases created before the artist card have no artist_id column yet
    async with _db.execute("PRAGMA table_info(tracks)") as cur:
        columns = {r["name"] for r in await cur.fetchall()}
    if "artist_id" not in columns:
        await _db.execute("ALTER TABLE tracks ADD COLUMN artist_id TEXT DEFAULT ''")
    # lyrics cached before timed lines: synced NULL means "not looked for yet", '' means "there are none"
    async with _db.execute("PRAGMA table_info(lyrics)") as cur:
        if "synced" not in {r["name"] for r in await cur.fetchall()}:
            await _db.execute("ALTER TABLE lyrics ADD COLUMN synced TEXT")
    await _db.commit()


async def close() -> None:
    if _db:
        await _db.close()


def _track(row) -> dict:
    return {"id": row["id"], "title": row["title"], "artist": row["artist"],
            "duration": row["duration"], "cover": row["cover"], "artist_id": row["artist_id"] or ""}


async def save_track(t: dict) -> None:
    await _db.execute(
        "INSERT INTO tracks (id, title, artist, duration, cover, artist_id) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET title=excluded.title, artist=excluded.artist, "
        "duration=excluded.duration, cover=COALESCE(NULLIF(excluded.cover, ''), tracks.cover), "
        "artist_id=COALESCE(NULLIF(excluded.artist_id, ''), tracks.artist_id)",
        (t["id"], t["title"], t["artist"], t["duration"], t["cover"], t.get("artist_id") or ""),
    )


async def get_track(track_id: str) -> dict | None:
    async with _db.execute("SELECT * FROM tracks WHERE id = ?", (track_id,)) as cur:
        row = await cur.fetchone()
    return _track(row) if row else None


async def save_sources(rows: list[tuple[str, str]]) -> None:
    """Where tracks from other sources live (a URL or an item path), keyed by their track id."""
    await _db.executemany("INSERT INTO sources (id, ref) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ref = excluded.ref", rows)
    await _db.commit()


async def source_ref(track_id: str) -> str | None:
    async with _db.execute("SELECT ref FROM sources WHERE id = ?", (track_id,)) as cur:
        row = await cur.fetchone()
    return row["ref"] if row else None


# ---------- lyrics ----------

async def get_lyrics(track_id: str) -> dict | None:
    """Cached lyrics lookup: {"text": str | None, "source": str, "fetched": float, "synced": str | None}.
    text None means none was found; synced is JSON of timed lines, '' when there are none, None if never looked for."""
    async with _db.execute("SELECT text, source, fetched, synced FROM lyrics WHERE track_id = ?", (track_id,)) as cur:
        row = await cur.fetchone()
    return {"text": row["text"], "source": row["source"] or "", "fetched": row["fetched"], "synced": row["synced"]} if row else None


async def save_lyrics(track_id: str, text: str | None, source: str = "", synced: str | None = "") -> None:
    await _db.execute(
        "INSERT INTO lyrics (track_id, text, source, fetched, synced) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(track_id) DO UPDATE SET text = excluded.text, source = excluded.source, "
        "fetched = excluded.fetched, synced = excluded.synced",
        (track_id, text, source, time.time(), synced),
    )
    await _db.commit()


# ---------- accounts of the site (guests have negative ids, Telegram accounts their Telegram id) ----------

def _account(row) -> dict:
    return {"id": row["id"], "kind": row["kind"], "first_name": row["first_name"] or "",
            "username": row["username"] or "", "language_code": row["language_code"] or ""}


async def get_account(user_id: int) -> dict | None:
    async with _db.execute("SELECT * FROM accounts WHERE id = ?", (user_id,)) as cur:
        row = await cur.fetchone()
    return _account(row) if row else None


async def save_account(user_id: int, kind: str, first_name: str = "", username: str = "", language_code: str = "") -> None:
    await _db.execute(
        "INSERT INTO accounts (id, kind, first_name, username, language_code, created) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, first_name = excluded.first_name, "
        "username = excluded.username, language_code = excluded.language_code",
        (user_id, kind, first_name, username, language_code, time.time()))
    await _db.commit()


async def merge_user(src: int, dst: int) -> None:
    """Move a guest's library into an account: likes, playlists, history and artists (no duplicates;
    a track in both histories keeps the later time), then forget the guest."""
    if src == dst:
        return
    await _db.execute("INSERT OR IGNORE INTO likes SELECT ?, track_id, created FROM likes WHERE user_id = ?", (dst, src))
    await _db.execute("DELETE FROM likes WHERE user_id = ?", (src,))
    await _db.execute("UPDATE playlists SET user_id = ? WHERE user_id = ?", (dst, src))
    await _db.execute(
        "INSERT INTO history SELECT ?, track_id, played FROM history WHERE user_id = ? AND true "
        "ON CONFLICT(user_id, track_id) DO UPDATE SET played = MAX(history.played, excluded.played)", (dst, src))
    await _db.execute("DELETE FROM history WHERE user_id = ?", (src,))
    await _db.execute("INSERT OR IGNORE INTO fav_artists SELECT ?, artist_id, name, cover, created FROM fav_artists WHERE user_id = ?",
                      (dst, src))
    await _db.execute("DELETE FROM fav_artists WHERE user_id = ?", (src,))
    await _db.execute("DELETE FROM accounts WHERE id = ?", (src,))
    await _db.commit()


# ---------- favourite artists ----------

async def fav_artists(user_id: int) -> list[dict]:
    async with _db.execute("SELECT artist_id, name, cover FROM fav_artists WHERE user_id = ? ORDER BY created DESC",
                           (user_id,)) as cur:
        return [{"id": r["artist_id"], "name": r["name"], "cover": r["cover"]} for r in await cur.fetchall()]


async def add_fav_artist(user_id: int, a: dict) -> None:
    await _db.execute(
        "INSERT INTO fav_artists VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, artist_id) DO UPDATE SET "
        "name = excluded.name, cover = COALESCE(NULLIF(excluded.cover, ''), fav_artists.cover)",
        (user_id, a["id"], a["name"], a["cover"], time.time()))
    await _db.commit()


async def remove_fav_artist(user_id: int, artist_id: str) -> None:
    await _db.execute("DELETE FROM fav_artists WHERE user_id = ? AND artist_id = ?", (user_id, artist_id))
    await _db.commit()


# ---------- likes ----------

async def likes(user_id: int) -> list[dict]:
    async with _db.execute(
        "SELECT t.* FROM likes l JOIN tracks t ON t.id = l.track_id WHERE l.user_id = ? ORDER BY l.created DESC",
        (user_id,),
    ) as cur:
        return [_track(r) for r in await cur.fetchall()]


async def like(user_id: int, t: dict) -> None:
    await save_track(t)
    await _db.execute("INSERT OR IGNORE INTO likes VALUES (?, ?, ?)", (user_id, t["id"], time.time()))
    await _db.commit()


async def unlike(user_id: int, track_id: str) -> None:
    await _db.execute("DELETE FROM likes WHERE user_id = ? AND track_id = ?", (user_id, track_id))
    await _db.commit()


# ---------- playlists ----------

async def playlists(user_id: int) -> list[dict]:
    async with _db.execute(
        "SELECT p.id, p.name, COUNT(pt.track_id) AS count FROM playlists p "
        "LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id WHERE p.user_id = ? "
        "GROUP BY p.id ORDER BY p.created DESC",
        (user_id,),
    ) as cur:
        rows = await cur.fetchall()
    out = []
    for r in rows:
        async with _db.execute(
            "SELECT t.cover FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
            "WHERE pt.playlist_id = ? ORDER BY pt.created DESC LIMIT 4",
            (r["id"],),
        ) as cur:
            covers = [c["cover"] for c in await cur.fetchall()]
        out.append({"id": r["id"], "name": r["name"], "count": r["count"], "covers": covers})
    return out


async def _owns(user_id: int, playlist_id: int) -> bool:
    async with _db.execute("SELECT 1 FROM playlists WHERE id = ? AND user_id = ?", (playlist_id, user_id)) as cur:
        return await cur.fetchone() is not None


async def create_playlist(user_id: int, name: str) -> int:
    cur = await _db.execute("INSERT INTO playlists (user_id, name, created) VALUES (?, ?, ?)",
                            (user_id, name, time.time()))
    await _db.commit()
    return cur.lastrowid


async def rename_playlist(user_id: int, playlist_id: int, name: str) -> bool:
    cur = await _db.execute("UPDATE playlists SET name = ? WHERE id = ? AND user_id = ?", (name, playlist_id, user_id))
    await _db.commit()
    return cur.rowcount > 0


async def delete_playlist(user_id: int, playlist_id: int) -> bool:
    if not await _owns(user_id, playlist_id):
        return False
    await _db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    await _db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    await _db.commit()
    return True


async def playlist(user_id: int, playlist_id: int) -> dict | None:
    async with _db.execute("SELECT id, name FROM playlists WHERE id = ? AND user_id = ?",
                           (playlist_id, user_id)) as cur:
        p = await cur.fetchone()
    if not p:
        return None
    async with _db.execute(
        "SELECT t.* FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id "
        "WHERE pt.playlist_id = ? ORDER BY pt.created ASC",
        (playlist_id,),
    ) as cur:
        tracks = [_track(r) for r in await cur.fetchall()]
    return {"id": p["id"], "name": p["name"], "tracks": tracks}


async def add_to_playlist(user_id: int, playlist_id: int, t: dict) -> bool:
    if not await _owns(user_id, playlist_id):
        return False
    await save_track(t)
    await _db.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)", (playlist_id, t["id"], time.time()))
    await _db.commit()
    return True


async def fill_playlist(playlist_id: int, tracks: list[dict]) -> None:
    """Many tracks at once, in order (an import); the caller has just created the playlist."""
    now = time.time()
    for i, t in enumerate(tracks):
        await save_track(t)
        await _db.execute("INSERT OR IGNORE INTO playlist_tracks VALUES (?, ?, ?)", (playlist_id, t["id"], now + i / 1000))
    await _db.commit()


async def remove_from_playlist(user_id: int, playlist_id: int, track_id: str) -> bool:
    if not await _owns(user_id, playlist_id):
        return False
    await _db.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
    await _db.commit()
    return True


# ---------- history ----------

async def add_history(user_id: int, t: dict) -> None:
    await save_track(t)
    await _db.execute(
        "INSERT INTO history VALUES (?, ?, ?) ON CONFLICT(user_id, track_id) DO UPDATE SET played = excluded.played",
        (user_id, t["id"], time.time()),
    )
    await _db.commit()


async def history(user_id: int, limit: int = 50) -> list[dict]:
    async with _db.execute(
        "SELECT t.* FROM history h JOIN tracks t ON t.id = h.track_id WHERE h.user_id = ? "
        "ORDER BY h.played DESC LIMIT ?",
        (user_id, limit),
    ) as cur:
        return [_track(r) for r in await cur.fetchall()]


async def history_ids(user_id: int) -> list[str]:
    """Every track the user has ever played (each once): the Mini App unsleeves only the new ones."""
    async with _db.execute("SELECT track_id FROM history WHERE user_id = ?", (user_id,)) as cur:
        return [r["track_id"] for r in await cur.fetchall()]


async def clear_history(user_id: int) -> None:
    await _db.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
    await _db.commit()


# ---------- telegram file cache ----------

async def tg_file(track_id: str) -> str | None:
    async with _db.execute("SELECT file_id FROM tg_files WHERE track_id = ?", (track_id,)) as cur:
        row = await cur.fetchone()
    return row["file_id"] if row else None


async def save_tg_file(track_id: str, file_id: str) -> None:
    await _db.execute("INSERT OR REPLACE INTO tg_files VALUES (?, ?)", (track_id, file_id))
    await _db.commit()
