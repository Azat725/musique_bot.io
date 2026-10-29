"""HTTP API for the Mini App."""
import asyncio
import logging

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from . import auth, config, db, music

log = logging.getLogger("musique.api")

app = FastAPI(title="Musique API", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
)

_http = httpx.AsyncClient(timeout=httpx.Timeout(20, read=60), follow_redirects=True)
_background: set[asyncio.Task] = set()
send_track = None  # set by __main__: async (chat_id, track_id, lang) -> None


class TrackIn(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    title: str = Field(max_length=300)
    artist: str = Field(max_length=300)
    duration: int = Field(ge=0, le=36000)
    cover: str = Field(default="", max_length=1000)
    artist_id: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")


class TrackBody(BaseModel):
    track: TrackIn


class NameBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)


User = Depends(auth.current_user)


def _track(body: TrackBody) -> dict:
    t = body.track.model_dump()
    music.remember(t)
    return t


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/me")
async def me(user=User):
    return {"user": {k: user.get(k) for k in ("id", "first_name", "username", "language_code")},
            "token": auth.make_stream_token(user["id"])}


@app.get("/api/home")
async def home(user=User):
    data = await music.home()
    return {**data, "recent": await db.history(user["id"], 12)}


@app.get("/api/search")
async def search(q: str = "", user=User):
    return {"tracks": await music.search(q)}


@app.get("/api/collection/{playlist_id}")
async def collection(playlist_id: str, user=User):
    return {"tracks": await music.collection(playlist_id)}


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


@app.get("/api/history")
async def history(user=User):
    return {"tracks": await db.history(user["id"])}


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
    t = _track(body)
    await db.save_track(t)
    _spawn(send_track(user["id"], t["id"], user.get("language_code") or "en"))
    return {"ok": True}


@app.post("/api/prefetch")
async def prefetch(body: TrackBody, user=User):
    _spawn(music.prefetch(_track(body)["id"]))
    return {"ok": True}


# ---------- audio ----------

def _file_response(src: music.Source) -> FileResponse:
    return FileResponse(src.path, media_type=src.mime)


@app.get("/api/stream/{vid}")
async def stream(vid: str, request: Request, t: str = ""):
    if not music.ID_RE.match(vid):
        raise HTTPException(404)
    if not auth.check_stream_token(t):
        raise HTTPException(403)
    try:
        if music.lite_enabled():
            return FileResponse(await music.stream_file(vid), media_type="audio/mp4")
        for attempt in range(2):
            src = await music.resolve(vid, fresh=attempt > 0)
            if src.kind == "file":
                return _file_response(src)
            headers = {k: v for k, v in (src.headers or {}).items()
                       if k.lower() in ("user-agent", "accept-language", "origin", "referer")}
            if rng := request.headers.get("range"):
                headers["Range"] = rng
            resp = await _http.send(_http.build_request("GET", src.url, headers=headers), stream=True)
            if resp.status_code in (403, 410) or resp.status_code >= 500:
                await resp.aclose()
                music.forget_url(vid)
                continue
            out = {k: resp.headers[k] for k in ("content-length", "content-range") if k in resp.headers}
            out["Accept-Ranges"] = "bytes"
            return StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, media_type=src.mime,
                                     headers=out, background=BackgroundTask(resp.aclose))
        path = await music.ensure_file(vid)
        return _file_response(music.Source("file", music.mime_for(path.suffix.lstrip(".")), path=path))
    except Exception:
        log.exception("stream failed for %s", vid)
        raise HTTPException(404, "track unavailable")


# Keep last: a mount at /app must not shadow API routes
if config.SERVE_DOCS:
    app.mount("/app", StaticFiles(directory=config.ROOT.parent / "docs", html=True), name="docs")
