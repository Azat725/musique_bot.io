import glob
import os
import shutil
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://azat725.github.io/musique_bot.io/docs/")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "").rstrip("/")
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "127.0.0.1")  # 0.0.0.0 inside Docker
DEBUG = os.getenv("DEBUG", "0") == "1"
# "ssh" — open a localhost.run tunnel from the server itself (start.ps1 sets it); "none" — PUBLIC_API_URL is given
TUNNEL = os.getenv("TUNNEL", "none")
# Bitrate the Mini App stream is re-encoded to (free tunnels are slow); "0" streams the original file
STREAM_BITRATE = os.getenv("STREAM_BITRATE", "64k")

DATA_DIR = Path(os.getenv("DATA_DIR", ROOT))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "musique.db"
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


def webapp_url() -> str:
    if not PUBLIC_API_URL:
        return WEBAPP_URL
    sep = "&" if "?" in WEBAPP_URL else "?"
    return f"{WEBAPP_URL}{sep}api={quote(PUBLIC_API_URL, safe='')}"
