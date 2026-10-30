import glob
import os
import shutil
import time
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
# ENV_FILE lets dev.ps1 load a separate env (test bot token) without touching the production .env
load_dotenv(os.getenv("ENV_FILE") or ROOT / ".env")

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://azat725.github.io/musique_bot.io/docs/")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "").rstrip("/")
# 1 - serve ../docs at /app (dev only: test the branch's frontend without GitHub Pages)
SERVE_DOCS = os.getenv("SERVE_DOCS", "0") == "1"
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "127.0.0.1")  # 0.0.0.0 inside Docker
DEBUG = os.getenv("DEBUG", "0") == "1"
# "ssh" — open a localhost.run tunnel from the server itself (start.ps1 sets it); "none" — PUBLIC_API_URL is given
TUNNEL = os.getenv("TUNNEL", "none")
# Bitrate the Mini App stream is re-encoded to (free tunnels are slow); "0" streams the original file
STREAM_BITRATE = os.getenv("STREAM_BITRATE", "64k")
# music beyond YouTube Music, searched in parallel (server/sources); remove a name to switch it off
SOURCES = os.getenv("SOURCES", "zaycev,bandcamp,jamendo,archive,rutube").lower()
JAMENDO_CLIENT_ID = os.getenv("JAMENDO_CLIENT_ID", "")  # free key from devportal.jamendo.com; empty = Jamendo off

DATA_DIR = Path(os.getenv("DATA_DIR", ROOT))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "musique.db"
# Telegram id of the owner: the daily database backup is sent there, and only this user may ask for /backup.
# Not set: the bot answers /backup with your id so it can be put here.
ADMIN_ID = int(os.getenv("ADMIN_ID") or 0)
# A payment link (a bank transfer to the author) offered next to Telegram Stars in "Support the author", for
# Russian-speaking users. Kept in server/.env, never in the repository: it is public. Empty: no such button.
SUPPORT_URL = (os.getenv("SUPPORT_URL") or "").strip()
BACKUP_DIR = DATA_DIR / "backups"
BACKUP_KEEP = int(os.getenv("BACKUP_KEEP", "14"))  # how many daily copies stay on the server
CACHE_DIR = DATA_DIR / "cache"
CACHE_LIMIT_BYTES = int(os.getenv("CACHE_LIMIT_MB", "1500")) * 1024 * 1024
# Netscape cookies.txt from a YouTube account — optional, makes YouTube far more reliable
COOKIES_FILE = ROOT / "cookies.txt"

CACHE_DIR.mkdir(exist_ok=True)


def _find_ffmpeg() -> str | None:
    found = os.getenv("FFMPEG") or shutil.which("ffmpeg")
    if found:
        return found
    pattern = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\*\bin\ffmpeg.exe")
    matches = glob.glob(pattern)
    return matches[0] if matches else None


FFMPEG = _find_ffmpeg()


_STARTED = int(time.time())


def webapp_url() -> str:
    base = f"{PUBLIC_API_URL}/app/" if SERVE_DOCS and PUBLIC_API_URL else WEBAPP_URL
    # v= changes on every start so iOS WebViews can't keep serving a stale cached index.html
    sep = "&" if "?" in base else "?"
    if not PUBLIC_API_URL:
        return f"{base}{sep}v={_STARTED}"
    return f"{base}{sep}api={quote(PUBLIC_API_URL, safe='')}&v={_STARTED}"
