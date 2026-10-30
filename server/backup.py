"""Backup of the SQLite database (favourites, playlists, history): a consistent snapshot, gzipped, the last
BACKUP_KEEP of them kept in DATA_DIR/backups (the Docker volume, so rebuilds do not touch them) and sent to the
owner in Telegram: a copy on the same server would not survive losing the server."""
import asyncio
import gzip
import logging
import shutil
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Awaitable, Callable

from . import config

log = logging.getLogger("musique.backup")

INTERVAL = 24 * 3600
FIRST_DELAY = 120  # after a start, let the server settle first
SEND_LIMIT = 45 * 1024 * 1024  # bots may upload up to 50 MB


def _snapshot(dest: Path) -> None:
    """A consistent copy of the live database through SQLite's own backup API (a plain file copy could catch a write)."""
    src = sqlite3.connect(f"file:{config.DB_PATH}?mode=ro", uri=True, timeout=30)
    try:
        dst = sqlite3.connect(dest)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def create() -> Path:
    """Make a backup now; returns the new .db.gz file. Old copies beyond BACKUP_KEEP are removed."""
    if not config.DB_PATH.exists():
        raise FileNotFoundError(f"no database at {config.DB_PATH}")
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    name = datetime.now().strftime("musique-%Y-%m-%d-%H%M%S")
    raw = config.BACKUP_DIR / f"{name}.db"
    packed = config.BACKUP_DIR / f"{name}.db.gz"
    try:
        _snapshot(raw)
        with raw.open("rb") as f, gzip.open(packed, "wb", compresslevel=6) as g:
            shutil.copyfileobj(f, g)
    finally:
        raw.unlink(missing_ok=True)
    for old in sorted(config.BACKUP_DIR.glob("musique-*.db.gz"))[:-max(1, config.BACKUP_KEEP)]:
        old.unlink(missing_ok=True)
    log.info("backup made: %s (%d KB)", packed.name, packed.stat().st_size // 1024)
    return packed


def latest() -> Path | None:
    files = sorted(config.BACKUP_DIR.glob("musique-*.db.gz")) if config.BACKUP_DIR.exists() else []
    return files[-1] if files else None


async def run_daily(send: Callable[[Path], Awaitable[None]]) -> None:
    """Back up once a day, however often the server restarts: the next one is due a day after the newest copy."""
    while True:
        last = latest()
        due = (last.stat().st_mtime + INTERVAL) if last else 0
        await asyncio.sleep(max(FIRST_DELAY, due - time.time()))
        try:
            path = await asyncio.to_thread(create)
            await send(path)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("daily backup failed")
            await asyncio.sleep(3600)  # try again in an hour rather than hammering a broken disk
