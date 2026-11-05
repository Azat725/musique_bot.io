"""HTTP API for the Mini App."""
import asyncio
import hashlib
import json
import logging
import secrets
import time
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, Path, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, config, db, importer, lyrics, metrics, music, radio, sources, weblogin

log = logging.getLogger("musique.api")

app = FastAPI(title="Musique API", docs_url=None, redoc_url=None)
class _Count:
    """Counts the status of every answered request for the owner's /status (nothing else about it is kept)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        status = 500

        async def counted(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, counted)
        finally:
            metrics.hit(status)


app.add_middleware(_Count)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
)

_background: set[asyncio.Task] = set()
send_track = None  # set by __main__: async (chat_id, track_id, lang) -> None


# ---------- fair use: nobody can keep the server busy for everyone else ----------

# (requests per second, burst): far above what a person does in the app, far below what a script would
LIMITS = {"search": (3, 20), "suggest": (8, 40), "prefetch": (2, 20), "lyrics": (3, 20), "import": (1 / 60, 3),
          "send": (0.2, 6), "share": (0.5, 10), "shared": (1, 10)}
_buckets: dict[tuple[int, str], tuple[float, float]] = {}


def _limit(user: dict, kind: str) -> None:
    """A token bucket per person and kind of request; 429 once it is empty (the app simply tries a bit later)."""
    rate, burst = LIMITS[kind]
    key, now = (user["id"], kind), time.monotonic()
    tokens, at = _buckets.pop(key, (burst, now))
    tokens = min(burst, tokens + (now - at) * rate)
    if tokens < 1:
        _buckets[key] = (tokens, now)
        raise HTTPException(429, "slow down")
    _buckets[key] = (tokens - 1, now)  # popped and put back: the oldest untouched buckets are at the front
    while len(_buckets) > 50000:
        _buckets.pop(next(iter(_buckets)))


PREFETCH_PER_USER = 6  # tracks one person may have the server preparing at a time
_prefetching: dict[int, int] = {}


class TrackIn(BaseModel):
    id: str = Field(pattern=r"^(?:[A-Za-z0-9_-]{11}|[a-z]{2}\.[A-Za-z0-9_-]{1,40})$")  # music.ID_RE
    title: str = Field(max_length=300)
    artist: str = Field(max_length=300)
    duration: int = Field(ge=0, le=36000)
    cover: str = Field(default="", max_length=1000)
    artist_id: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")


class TrackBody(BaseModel):
    track: TrackIn


class PrefetchBody(TrackBody):
    fx: str = Field(default="", max_length=16)  # music.FX_RE, e.g. "slow-hall"
    ahead: int = Field(default=1, ge=1, le=3)  # how many places ahead in the queue (1 = the very next)


class SettingsIn(BaseModel):
    value: dict


class QueueIn(BaseModel):
    tracks: list[TrackIn] = Field(max_length=500)
    index: int = Field(ge=0, le=499)
    time: float = Field(default=0, ge=0, le=36000)  # where in the current track, in the song's own seconds
    shuffle: bool = False
    repeat: str = Field(default="off", pattern="^(off|all|one)$")


class PositionIn(BaseModel):
    id: str = Field(max_length=16)
    index: int = Field(ge=0, le=499)
    time: float = Field(default=0, ge=0, le=36000)


class ArtistIn(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{10,64}$")  # music.ARTIST_ID_RE
    name: str = Field(max_length=200)
    cover: str = Field(default="", max_length=1000)


class ArtistBody(BaseModel):
    artist: ArtistIn


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)


async def _user(request: Request) -> dict:
    user = await auth.current_user(request)
    metrics.seen(user["id"])
    return user


User = Depends(_user)


def _track(body: TrackBody) -> dict:
    t = body.track.model_dump()
    music.remember(t)
    return t


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/radio")
async def radio_station(country: str = "us", decade: int = 1960, user=User):
    """A station: the songs of one country and decade (year included), in a fresh order. Answered from memory."""
    try:
        return {"tracks": await radio.station(country, decade)}
    except ValueError:
        raise HTTPException(400, "Unknown radio selection")


@app.get("/api/me")
async def me(user=User):
    return {"user": {**{k: user.get(k) for k in ("id", "first_name", "username", "language_code")}, "kind": user.get("kind", "telegram")},
            "token": auth.make_stream_token(user["id"])}


# ---------- one look and one queue for one account, whatever the device ----------

SETTINGS_MAX_BYTES = 20_000


@app.get("/api/state")
async def get_state(user=User):
    """{ settings: {value, updated} | null, queue: {value, updated} | null }; `updated` is server time."""
    states = await db.get_states(user["id"])
    return {"settings": states.get("settings"), "queue": states.get("queue")}


@app.put("/api/state/settings")
async def put_settings(body: SettingsIn, user=User):
    if len(json.dumps(body.value)) > SETTINGS_MAX_BYTES:
        raise HTTPException(413, "settings too large")
    return {"updated": await db.set_state(user["id"], "settings", body.value)}


@app.put("/api/state/queue")
async def put_queue(body: QueueIn, user=User):
    if body.tracks and body.index >= len(body.tracks):
        raise HTTPException(422, "index outside the queue")
    return {"updated": await db.set_state(user["id"], "queue", body.model_dump())}


@app.patch("/api/state/queue")
async def patch_queue(body: PositionIn, user=User):
    """Just the place in the queue and in the track: small, sent often. 409 when the stored queue is another one."""
    updated = await db.move_queue_position(user["id"], body.id, body.index, body.time)
    if updated is None:
        raise HTTPException(409, "not the stored queue")
    return {"updated": updated}


# ---------- the site in an ordinary browser: guests, and signing in with Telegram through the bot ----------

GUESTS_PER_HOUR = 20  # from one address: enough for a family behind one router, not for a script
_guest_log: dict[str, list[float]] = {}


def _client_ip(request: Request) -> str:
    # behind Caddy the visitor's address comes in X-Forwarded-For (its first entry)
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "")


@app.post("/api/guest")
async def new_guest(request: Request):
    """A guest account for this browser: the library is kept on the server under a negative id."""
    ip, now = _client_ip(request), time.time()
    recent = [t for t in _guest_log.get(ip, []) if now - t < 3600]
    if len(recent) >= GUESTS_PER_HOUR:
        raise HTTPException(429, "too many guests")
    _guest_log[ip] = recent + [now]
    if len(_guest_log) > 10000:
        _guest_log.pop(next(iter(_guest_log)))
    lang = (request.headers.get("accept-language") or "en")[:2].lower()
    guest_id = -secrets.randbelow(2 ** 52) - 1
    await db.save_account(guest_id, "guest", "", "", lang)
    return {"session": auth.make_session(guest_id)}


@app.post("/api/login/start")
async def login_start(user=User):
    """A one-time code and the bot link that confirms it."""
    if user.get("kind") != "guest":
        raise HTTPException(400, "already signed in")
    code = weblogin.start(user["id"])
    url = weblogin.link(code)
    if not url:
        raise HTTPException(503, "bot not ready")
    return {"code": code, "url": url}


@app.get("/api/login/{code}")
async def login_poll(code: str, user=User):
    """wait | expired | ok (with a session for the Telegram account; the guest's library is moved into it)."""
    if user.get("kind") != "guest":
        raise HTTPException(400, "not a guest")
    status, tg_user = weblogin.poll(code[:64], user["id"])
    if status != "ok":
        return {"status": status}
    tg_id = int(tg_user["id"])
    await db.save_account(tg_id, "telegram", tg_user.get("first_name") or "", tg_user.get("username") or "",
                          tg_user.get("language_code") or "")
    await db.merge_user(user["id"], tg_id)
    auth.forget_profile(user["id"])
    auth.forget_profile(tg_id)
    return {"status": "ok", "session": auth.make_session(tg_id),
            "user": {"first_name": tg_user.get("first_name") or "", "username": tg_user.get("username") or ""}}


@app.get("/api/home")
async def home(user=User):
    data = await music.home()
    return {**data, "recent": await db.history(user["id"], 12)}


# ---------- the phonograph's shelf: 50 cylinders and early records, 1897–1925 (public domain, archive.org) ----------

_PHONO: list[dict] = []
_phono_lock = asyncio.Lock()


async def _phonograph() -> list[dict]:
    """The shelf, read once; the archive.org files are registered as sources (ia.<key>) so they play like any track."""
    if not _PHONO:
        rows = json.loads((config.ROOT / "phonograph.json").read_text(encoding="utf-8"))
        refs = []
        for r in rows:
            tid = "ia." + hashlib.sha1(r["ref"].encode()).hexdigest()[:16]
            refs.append((tid, r["ref"]))
            _PHONO.append({**r, "id": tid})
        await db.save_sources(refs)
        sources.remember_refs(refs)
    return _PHONO


@app.get("/api/phonograph")
async def phonograph(user=User):
    lang = "ru" if (user.get("language_code") or "").startswith(("ru", "uk", "be", "kk")) else "en"
    async with _phono_lock:  # the first callers wait for the shelf to be registered, not get ids that do not play yet
        shelf = await _phonograph()
    return {"tracks": [{"id": r["id"], "title": r["title"], "artist": r["artist"], "duration": r["duration"], "cover": r["cover"],
                        "artist_id": "", "year": r["year"], "country": r["country"][lang], "genre": r["genre"][lang]}
                       for r in shelf]}


@app.get("/api/recommend")
async def recommend(user=User):
    return {"tracks": await music.recommend(await db.history(user["id"], 10))}


@app.get("/api/search")
async def search(q: str = "", type: str = "all", user=User):
    """type: all (artists, tracks and clips, other sources) | tracks (songs, other sources) | artists."""
    _limit(user, "search")
    if type == "artists":
        return {"tracks": [], "more": [], "artists": await music.search_artists(q)}
    jobs = [music.search(q, videos=type != "tracks"), music.search_more(q)]
    if type == "all":
        jobs.append(music.search_artists(q))
    results = await asyncio.gather(*jobs)
    return {"tracks": results[0], "more": results[1], "artists": results[2][:4] if type == "all" else []}


@app.get("/api/why/{vid}")
async def why(vid: str, user=User):
    """Why a track just failed to play: region | removed | age | youtube | notfound | '' (unknown)."""
    if not music.ID_RE.match(vid):
        raise HTTPException(400, "bad id")
    return {"reason": music.failure(vid)}


@app.get("/api/suggest")
async def suggest(q: str = "", user=User):
    """Search-box completions, as the user types."""
    _limit(user, "suggest")
    return {"suggestions": await music.suggestions(q[:100])}


@app.get("/api/collection/{playlist_id}")
async def collection(playlist_id: str, user=User):
    return {"tracks": await music.collection(playlist_id)}


@app.get("/api/artists")
async def fav_artists(user=User):
    return {"artists": await db.fav_artists(user["id"])}


@app.post("/api/artists")
async def add_fav_artist(body: ArtistBody, user=User):
    await db.add_fav_artist(user["id"], body.artist.model_dump())
    return {"ok": True}


@app.delete("/api/artists/{artist_id}")
async def remove_fav_artist(artist_id: str, user=User):
    await db.remove_fav_artist(user["id"], artist_id)
    return {"ok": True}


@app.get("/api/artist")
async def find_artist(name: str = "", user=User):
    """Artist id by name, for tracks saved before artist ids were kept."""
    artist_id = await music.find_artist(name)
    if not artist_id:
        raise HTTPException(404, "artist not found")
    return {"id": artist_id}


@app.get("/api/artist/{artist_id}")
async def artist(artist_id: str, user=User):
    data = await music.artist(artist_id)
    if not data:
        raise HTTPException(404, "artist not found")
    return data


@app.get("/api/album/{browse_id}")
async def album(browse_id: str, user=User):
    data = await music.album(browse_id)
    if not data:
        raise HTTPException(404, "album not found")
    return data


# ---------- library ----------

@app.get("/api/likes")
async def likes(user=User):
    return {"tracks": await db.likes(user["id"])}


@app.post("/api/likes")
async def like(body: TrackBody, user=User):
    await db.like(user["id"], _track(body))
    return {"ok": True}


@app.delete("/api/likes/{track_id}")
async def unlike(track_id: str, user=User):
    await db.unlike(user["id"], track_id)
    return {"ok": True}


@app.get("/api/playlists")
async def playlists(user=User):
    return {"playlists": await db.playlists(user["id"])}


@app.post("/api/playlists")
async def create_playlist(body: NameBody, user=User):
    return {"id": await db.create_playlist(user["id"], body.name.strip())}


class ImportBody(BaseModel):
    source: str = Field(min_length=1, max_length=20000)


@app.post("/api/import")
async def import_playlist(body: ImportBody, user=User):
    """A playlist from another app (a link) or a pasted list of tracks, into a new playlist."""
    _limit(user, "import")
    try:
        return await importer.run(user["id"], body.source, user.get("language_code") or "en")
    except importer.ImportFailed as e:
        raise HTTPException(422, e.code)


@app.get("/api/playlists/{pid}")
async def get_playlist(pid: int, user=User):
    p = await db.playlist(user["id"], pid)
    if not p:
        raise HTTPException(404)
    return p


@app.patch("/api/playlists/{pid}")
async def rename_playlist(pid: int, body: NameBody, user=User):
    if not await db.rename_playlist(user["id"], pid, body.name.strip()):
        raise HTTPException(404)
    return {"ok": True}


@app.delete("/api/playlists/{pid}")
async def delete_playlist(pid: int, user=User):
    if not await db.delete_playlist(user["id"], pid):
        raise HTTPException(404)
    return {"ok": True}


@app.post("/api/playlists/{pid}/tracks")
async def add_to_playlist(pid: int, body: TrackBody, user=User):
    if not await db.add_to_playlist(user["id"], pid, _track(body)):
        raise HTTPException(404)
    return {"ok": True}


@app.delete("/api/playlists/{pid}/tracks/{track_id}")
async def remove_from_playlist(pid: int, track_id: str, user=User):
    if not await db.remove_from_playlist(user["id"], pid, track_id):
        raise HTTPException(404)
    return {"ok": True}


SHARE_RE = r"^[A-Za-z0-9_-]{8,40}$"  # what secrets.token_urlsafe(12) makes: 16 characters


def share_link(token: str) -> str:
    """The bot's link that opens a shared playlist ('' until the bot has started and knows its name)."""
    return f"https://t.me/{weblogin.bot_username}?start=pl_{token}" if weblogin.bot_username else ""


@app.post("/api/playlists/{pid}/share")
async def share_playlist(pid: int, user=User):
    """Open a link to this playlist (the same link each time); anyone who has it can add a copy to their own library."""
    _limit(user, "share")
    token = await db.share_playlist(user["id"], pid, secrets.token_urlsafe(12))
    if token is None:
        raise HTTPException(404)
    if not token:
        raise HTTPException(409, "too many links")
    return {"token": token, "url": share_link(token)}


@app.delete("/api/playlists/{pid}/share")
async def unshare_playlist(pid: int, user=User):
    """Close the link: it stops working at once."""
    _limit(user, "share")
    if not await db.unshare_playlist(user["id"], pid):
        raise HTTPException(404)
    return {"ok": True}


@app.get("/api/shared/{token}")
async def get_shared(token: str = Path(pattern=SHARE_RE), user=User):
    """What a link leads to, for the question 'add this playlist?': the name, the number of tracks, a few covers."""
    _limit(user, "shared")
    s = await db.shared(token)
    if not s:
        raise HTTPException(404)
    return {"name": s["name"], "count": len(s["tracks"]), "covers": [t["cover"] for t in s["tracks"] if t["cover"]][:4],
            "titles": [f"{t['artist']} — {t['title']}" if t["artist"] else t["title"] for t in s["tracks"][:3]]}


@app.post("/api/shared/{token}/import")
async def import_shared(token: str = Path(pattern=SHARE_RE), user=User):
    _limit(user, "shared")
    done = await db.import_shared(user["id"], token)
    if not done:
        raise HTTPException(404)
    return done


@app.get("/api/history")
async def history(user=User):
    return {"tracks": await db.history(user["id"])}


@app.get("/api/history/ids")
async def history_ids(user=User):
    """Ids of every track ever played, so the Mini App knows which one is heard for the first time."""
    return {"ids": await db.history_ids(user["id"])}


@app.post("/api/history")
async def add_history(body: TrackBody, user=User):
    await db.add_history(user["id"], _track(body))
    return {"ok": True}


@app.delete("/api/history")
async def clear_history(user=User):
    await db.clear_history(user["id"])
    return {"ok": True}


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


@app.post("/api/send")
async def send(body: TrackBody, user=User):
    if user.get("kind") == "guest":
        raise HTTPException(403, "telegram only")  # the bot has no chat to send a guest the file to
    if send_track is None:  # the first seconds after a start: the bot is still being set up
        raise HTTPException(503, "bot not ready")
    _limit(user, "send")
    t = _track(body)
    await db.save_track(t)
    _spawn(send_track(user["id"], t["id"], user.get("language_code") or "en"))
    return {"ok": True}


@app.post("/api/prefetch")
async def prefetch(body: PrefetchBody, user=User):
    _limit(user, "prefetch")
    uid = user["id"]
    if _prefetching.get(uid, 0) >= PREFETCH_PER_USER:  # enough is being prepared for this person already
        return {"ok": False}
    _prefetching[uid] = _prefetching.get(uid, 0) + 1

    async def run() -> None:
        try:
            await music.prefetch(_track(body)["id"], body.fx if music.FX_RE.match(body.fx) else "", body.ahead)
        finally:
            left = _prefetching.get(uid, 1) - 1
            if left > 0:
                _prefetching[uid] = left
            else:
                _prefetching.pop(uid, None)
    _spawn(run())
    return {"ok": True}


@app.get("/api/lyrics/{track_id}")
async def track_lyrics(track_id: str, title: str = "", artist: str = "", duration: int = 0, user=User):
    """Lyrics of a track, or null: the Mini App shows its Lyrics button only when there are some."""
    if not music.ID_RE.match(track_id):
        raise HTTPException(400, "bad id")
    _limit(user, "lyrics")
    found = await lyrics.find(track_id, title[:300], artist[:300], max(0, min(duration, 36000)))
    return {"lyrics": found["text"] if found else None, "source": found["source"] if found else "",
            "synced": found["synced"] if found else None}


# ---------- audio ----------

# the file for a track (and an effect) never changes: a phone replaying or seeking in it need not fetch it again
_STREAM_HEADERS = {"Cache-Control": "private, max-age=86400"}


async def _while_connected(request: Request, coro):
    """Run the work while the listener is still there: uvicorn does not stop a handler whose client went away, and a
    download nobody waits for any more must leave the line for those who do."""
    task = asyncio.ensure_future(coro)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=1)
            if done:
                return task.result()
            if await request.is_disconnected():
                return None
    finally:
        if not task.done():
            task.cancel()


def _send_file(path):
    mime = music.mime_for(path.suffix.lstrip("."))
    if config.STREAM_ACCEL:  # Caddy sends the file itself (see Caddyfile): ranges, sendfile, no Python in the way
        rel = path.relative_to(config.DATA_DIR).as_posix()
        return Response(headers={"X-Accel-Redirect": "/" + quote(rel), "Content-Type": mime, **_STREAM_HEADERS})
    return FileResponse(path, media_type=mime, headers=_STREAM_HEADERS)


@app.get("/api/stream/{vid}")
async def stream(vid: str, request: Request, t: str = "", fx: str = "", q: str = ""):
    """q=save: a compact file the Mini App keeps for listening offline."""
    if not music.ID_RE.match(vid):
        raise HTTPException(404)
    if not auth.check_stream_token(t):
        raise HTTPException(403)
    if fx and not music.FX_RE.match(fx):
        raise HTTPException(400, "bad fx")
    if q not in ("", "save"):
        raise HTTPException(400, "bad q")
    try:
        if q == "save":
            work = music.save_file(vid)
        elif fx and fx != "normal-off":  # slowed / sped up / reverb / an old radio: a file rendered by ffmpeg
            work = music.fx_file(vid, fx)
        else:
            work = music.play_file(vid)
        path = await _while_connected(request, work)
        if path is None:
            return Response(status_code=499)  # nobody to send it to
        return _send_file(path)
    except music.Busy:  # too many new tracks asked for at once: the app says so and asks again shortly
        music.note_busy(vid)
        raise HTTPException(503, "busy", headers={"Retry-After": "5"})
    except Exception as e:
        log.warning("stream failed for %s: %s", vid, str(e)[:200])
        music.note_failure(vid, e)
        if music.failure(vid) in ("removed", "region", "age"):
            radio.unplayable(vid)  # a station never offers it again
        raise HTTPException(404, "track unavailable")


# Keep last: a mount at /app must not shadow API routes
if config.SERVE_DOCS:
    app.mount("/app", StaticFiles(directory=config.ROOT.parent / "docs", html=True), name="docs")
