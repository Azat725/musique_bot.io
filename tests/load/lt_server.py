"""The real API in its own process for the load test: downloads are faked (1 s, then a file), YouTube Music calls are
stubbed, and N accounts exist so each virtual listener has a session of its own."""
import asyncio
import os
import shutil
import sys
import time
from pathlib import Path

data, users, port = Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
os.environ.update(DATA_DIR=str(data), BOT_TOKEN="123456:TEST", DEBUG="0", ENV_FILE=str(data / "none.env"), STREAM_BITRATE="0")
sys.path.insert(0, os.getcwd())

import uvicorn  # noqa: E402
from server import api, config, db, music  # noqa: E402

SRC = data / "src.m4a"
DL_TIME = float(os.environ.get("LT_DL", "1.0"))


def fake_download(vid):
    time.sleep(DL_TIME)
    dest = config.CACHE_DIR / f"{vid}.m4a"
    shutil.copy(SRC, dest)
    return dest


music._yt_download = fake_download


async def home():
    return {"sections": [], "genres": [{"key": "pop", "id": "x"}]}


async def recommend(history):
    return []


music.home = home
music.recommend = recommend


import threading, traceback
_beat = [time.monotonic()]


def watchdog(main_id):
    dumped = 0
    while True:
        time.sleep(0.25)
        lag = time.monotonic() - _beat[0]
        if lag > 1.0 and dumped < 8 and os.environ.get("LT_WATCH"):
            dumped += 1
            frame = sys._current_frames().get(main_id)
            print(f"STALL {lag:.1f}s " + "".join(traceback.format_stack(frame)[-12:]), flush=True)


async def beat():
    while True:
        _beat[0] = time.monotonic()
        await asyncio.sleep(0.1)


async def main():
    threading.Thread(target=watchdog, args=(threading.get_ident(),), daemon=True).start()
    asyncio.create_task(beat())
    await db.init()
    for uid in range(1, users + 1):
        await db.save_account(uid, "guest", "", "", "en")
    await db.flush()
    await asyncio.to_thread(music.index_cache)
    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=port, log_level="warning", backlog=4096))
    print("ready", flush=True)
    await server.serve()
    await db.close()


asyncio.run(main())
