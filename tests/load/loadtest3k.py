"""3000 listeners against the real API in another process, then a burst of 1000 brand-new tracks at once.
The clients use aiohttp (httpx's pool itself gets slow with thousands of connections and would measure itself)."""
import asyncio
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

os.environ.setdefault("BOT_TOKEN", "123456:TEST")
sys.path.insert(0, os.getcwd())
import aiohttp  # noqa: E402

LISTENERS = int(os.environ.get("LT_USERS", "3000"))
RUN_FOR = float(os.environ.get("LT_SECONDS", "60"))
BURST = int(os.environ.get("LT_BURST", "1000"))
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"
results = []


def check(name, cond, extra=""):
    results.append(bool(cond))
    print(("ok  " if cond else "BAD ") + name + (f"  [{extra}]" if extra else ""), flush=True)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0


tmp = Path(tempfile.mkdtemp())
cache = tmp / "cache"
cache.mkdir()
ffmpeg = shutil.which("ffmpeg") or next(Path(os.environ["LOCALAPPDATA"], "Microsoft/WinGet/Packages").glob("Gyan.FFmpeg*/*/bin/ffmpeg.exe"))
subprocess.run([str(ffmpeg), "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=440:d=20", "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart", str(tmp / "src.m4a")], check=True)
CACHED = [f"c{i:010d}" for i in range(300)]
for v in CACHED:
    shutil.copy(tmp / "src.m4a", cache / f"{v}.m4a")

os.environ["DATA_DIR"] = str(tmp)
from server import auth  # noqa: E402  (same BOT_TOKEN: sessions and stream tokens the server accepts)

proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name("lt_server.py")), str(tmp), str(LISTENERS), str(PORT)],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
assert proc.stdout.readline().strip() == "ready", "server did not start"


def track(v):
    return {"id": v, "title": "Song " + v, "artist": "Artist", "duration": 20, "cover": ""}


async def main():
    # like Caddy in front of the API: listeners share a pool of kept-alive connections to it (and Windows refuses
    # thousands of fresh connections a second at one listening socket, which Caddy never asks of it)
    conn = aiohttp.TCPConnector(limit=1200, limit_per_host=1200, force_close=False)
    timeout = aiohttp.ClientTimeout(total=120)
    async with aiohttp.ClientSession(BASE, connector=conn, timeout=timeout) as c:
        health, errors, calls, streams, spent, refused = [], {}, [0], [0], {}, [0]
        stop = asyncio.Event()

        async def ping():
            while not stop.is_set():
                t0 = time.perf_counter()
                try:
                    async with c.get("/api/health") as r:
                        await r.read()
                except (aiohttp.ServerDisconnectedError, aiohttp.ClientOSError):
                    await asyncio.sleep(0.1)
                    continue
                health.append(time.perf_counter() - t0)
                await asyncio.sleep(0.1)

        async def call(method, url, **kw):
            t0 = time.perf_counter()
            for attempt in range(20):
                try:
                    async with c.request(method, url, **kw) as r:
                        body = await r.read()
                        status = r.status
                    break
                except (aiohttp.ClientOSError, aiohttp.ServerDisconnectedError):
                    # Windows refuses a connection outright when its accept queue (~200) is full; Linux lets the
                    # client retry its SYN instead. Retried here as Linux clients would
                    refused[0] += 1
                    await asyncio.sleep(0.2)
            name = method + " " + "/".join(url.split("?")[0].split("/")[:3])
            spent.setdefault(name, []).append(time.perf_counter() - t0)
            calls[0] += 1
            if status >= 400:
                errors[(name, status)] = errors.get((name, status), 0) + 1
            return status, body

        async def listener(uid):
            await asyncio.sleep(random.random() * 10)  # people arrive over ten seconds
            h = {"Authorization": "Bearer " + auth.make_session(uid)}
            import json
            status, body = await call("GET", "/api/me", headers=h)
            tok = json.loads(body)["token"]
            await call("GET", "/api/state", headers=h)
            await call("GET", "/api/home", headers=h)
            queue = [track(random.choice(CACHED)) for _ in range(30)]
            await call("PUT", "/api/state/queue", headers=h, json={"tracks": queue, "index": 0, "time": 0})
            i, end = 0, time.time() + RUN_FOR
            while time.time() < end:
                tr = queue[i % len(queue)]
                status, _ = await call("GET", f"/api/stream/{tr['id']}?t={tok}")
                streams[0] += status == 200
                await call("POST", "/api/history", headers=h, json={"track": tr})
                for k in (1, 2, 3):
                    await call("POST", "/api/prefetch", headers=h, json={"track": queue[(i + k) % len(queue)], "ahead": k})
                await asyncio.sleep(random.uniform(15, 25))  # listening
                await call("PATCH", "/api/state/queue", headers=h, json={"id": tr["id"], "index": i % len(queue), "time": 18})
                i += 1

        pinger = asyncio.create_task(ping())
        t0 = time.time()
        await asyncio.gather(*(listener(u) for u in range(1, LISTENERS + 1)))
        took = time.time() - t0
        stop.set()
        await pinger
        for name, v in sorted(spent.items()):
            print(f"    {name:22s} n={len(v):6d} p50={pct(v, .5) * 1000:6.0f} ms p95={pct(v, .95) * 1000:6.0f} ms max={max(v) * 1000:6.0f} ms")
        check(f"{LISTENERS} listeners for {RUN_FOR:.0f} s: no errors", not errors, errors)
        check("every listener got their tracks", streams[0] >= LISTENERS, f"{streams[0]} streams, {calls[0]} requests in {took:.0f} s "
              f"({calls[0] / took:.0f}/s), {refused[0]} connection retries")
        check("health p95 under 200 ms meanwhile", pct(health, .95) < 0.2,
              f"p50 {pct(health, .5) * 1000:.0f} ms, p95 {pct(health, .95) * 1000:.0f} ms, max {max(health) * 1000:.0f} ms")

        # ---------- a burst: many people press play on different new tracks at the same moment ----------
        health.clear()
        stop.clear()
        pinger = asyncio.create_task(ping())
        tok = auth.make_stream_token(1)
        times = {}

        async def press(i):
            t0 = time.perf_counter()
            try:
                async with c.get(f"/api/stream/n{i:010d}?t={tok}") as r:
                    await r.read()
                    code = r.status
            except Exception as e:
                code = type(e).__name__
            times.setdefault(code, []).append(time.perf_counter() - t0)

        t0 = time.time()
        await asyncio.gather(*(press(i) for i in range(BURST)))
        took = time.time() - t0
        stop.set()
        await pinger
        summary = {code: (len(v), f"p50 {pct(v, .5):.1f}s max {max(v):.1f}s") for code, v in times.items()}
        check(f"burst of {BURST}: nothing hangs (all answered within 60 s)", took < 60, f"{took:.0f} s {summary}")
        check("burst: as many as the line allows are played", len(times.get(200, [])) >= 150, summary)
        check("burst: the rest hear 'busy' (503), not a timeout", set(times) <= {200, 503}, summary)
        quick = [t for t in times.get(503, []) if t < 3]  # opening 1000 sockets from one client takes a moment itself
        check("burst: a full line says so at once", len(quick) >= len(times.get(503, [])) * 0.5, f"{len(quick)} answered in < 3 s")
        check("burst: health p95 under 200 ms meanwhile", pct(health, .95) < 0.2,
              f"p95 {pct(health, .95) * 1000:.0f} ms, max {max(health) * 1000:.0f} ms")

        # ---------- people who leave while waiting leave the line ----------
        async def leave(i):
            async with c.get(f"/api/stream/g{i:010d}?t={tok}") as r:
                await r.read()
        tasks = [asyncio.create_task(leave(i)) for i in range(150)]
        await asyncio.sleep(1.5)
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.sleep(4)  # they are noticed within a second; the six running ones finish
        t0 = time.perf_counter()
        async with c.get(f"/api/stream/z0000000001?t={tok}") as r:
            await r.read()
            code = r.status
        check("after 150 listeners left, a new play starts at once", code == 200 and time.perf_counter() - t0 < 3,
              f"{code} in {time.perf_counter() - t0:.1f} s")


try:
    asyncio.run(main())
finally:
    proc.terminate()
    try:
        out = proc.communicate(timeout=10)[0]
    except subprocess.TimeoutExpired:
        proc.kill()
        out = ""
    if os.environ.get("LT_WATCH"):
        print((out or "")[:6000])
    shutil.rmtree(tmp, ignore_errors=True)
print(f"\n{sum(results)}/{len(results)} passed")
