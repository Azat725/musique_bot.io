"""Test stub: serves docs/ and a fake /api with tone audio, timed lyrics and import."""
import io, json, math, re, struct, sys, time, wave
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

DOCS = sys.argv[1]

def tone(freq, secs=90, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(1); w.setframerate(rate)
        w.writeframes(bytes(int(128 + 30 * math.sin(2 * math.pi * freq * i / rate)) for i in range(secs * rate)))
    return buf.getvalue()

AUDIO = {}
TRACKS = [{"id": f"stubtrack{i:02d}", "title": f"Песня номер {i}", "artist": f"Исполнитель {i}", "duration": 90,
           "cover": "", "artist_id": ""} for i in range(1, 15)]
SYNCED = [[i * 3000, f"Строка текста номер {i + 1}" if i % 5 != 4 else ""] for i in range(30)]
playlists = {}
LIKED = []
PREFETCHES = []

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()
    def j(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        p = self.path.split("?")[0]
        if not p.startswith("/api/"):
            return super().do_GET()
        if p.startswith("/api/why/"):
            return self.j({"reason": "region" if "bad" in p else ""})
        if p.startswith("/api/stream/bad"):
            return self.j({"detail": "track unavailable"}, 404)
        if p == "/api/suggest":
            q = self.path.split("q=")[-1]
            import urllib.parse
            q = urllib.parse.unquote(q)
            return self.j({"suggestions": [q + " слушать", q + " 2026", q + " live", q]})
        if p == "/api/search":
            return self.j({"tracks": TRACKS, "more": [], "artists": []})
        if p == "/api/me": return self.j({"user": {"id": 1, "first_name": "Test", "language_code": "ru"}, "token": "x"})
        if p == "/api/home": return self.j({"sections": [{"key": "top_global", "tracks": TRACKS}], "genres": [], "recent": TRACKS[:3]})
        if p == "/api/history/ids": return self.j({"ids": [t["id"] for t in TRACKS]})
        if p == "/api/likes": return self.j({"tracks": LIKED})
        if p == "/api/history": return self.j({"tracks": []})
        if p == "/api/artists": return self.j({"artists": []})
        if p == "/api/recommend": return self.j({"tracks": TRACKS})
        if p == "/api/radio":
            import urllib.parse as up
            q = dict(up.parse_qsl(self.path.split("?", 1)[1]))
            d = int(q.get("decade", 1960))
            return self.j({"tracks": [{**t, "title": f"{q.get('country')} {d}s · {t['title']}", "year": d + i % 10} for i, t in enumerate(TRACKS)]})
        if p == "/api/phonograph": return self.j({"tracks": []})
        if p == "/api/playlists": return self.j({"playlists": [{"id": k, "name": v["name"], "count": len(v["tracks"]), "covers": []} for k, v in playlists.items()]})
        if m := re.match(r"/api/playlists/(\d+)$", p):
            v = playlists[int(m.group(1))]; return self.j({"id": int(m.group(1)), **v})
        if p.startswith("/api/lyrics/"):
            return self.j({"lyrics": "\n".join(l for _, l in SYNCED), "source": "LRCLIB", "synced": SYNCED})
        if m := re.match(r"/api/stream/(\w+)", p):
            i = int(m.group(1)[-2:])
            data = AUDIO.setdefault(i, tone(220 + i * 40))
            rng = self.headers.get("Range")
            start, end = 0, len(data) - 1
            if rng and (mm := re.match(r"bytes=(\d+)-(\d*)", rng)):
                start = int(mm.group(1)); end = int(mm.group(2) or end)
                self.send_response(206); self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
            else:
                self.send_response(200)
            self.send_header("Content-Type", "audio/wav"); self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1)); self.end_headers()
            try: self.wfile.write(data[start:end + 1])
            except Exception: pass
            return
        return self.j({"detail": "not found"}, 404)
    def do_POST(self):
        p = self.path.split("?")[0]
        b = self.body()
        if p == "/api/prefetch":
            PREFETCHES.append((b["track"]["id"], b.get("fx"), b.get("ahead")))
            return self.j({"ok": True})
        if p == "/api/prefetch-log":
            return self.j({"log": PREFETCHES})
        if p == "/api/likes":
            t = b["track"]
            if not any(x["id"] == t["id"] for x in LIKED): LIKED.insert(0, t)
            return self.j({"ok": True})
        if p == "/api/import":
            time.sleep(1.5)
            src = b.get("source", "")
            if "bad" in src: return self.j({"detail": "yandex"}, 422)
            pid = len(playlists) + 1
            playlists[pid] = {"name": "Импорт 31.10", "tracks": TRACKS[:5]}
            return self.j({"id": pid, "name": "Импорт 31.10", "added": 5, "total": 7, "missing": ["Кто-то — Что-то", "Неизвестная песня"]})
        return self.j({"ok": True})
    def do_DELETE(self):
        p = self.path.split("?")[0]
        if p.startswith("/api/likes/"):
            tid = p.rsplit("/", 1)[1]
            LIKED[:] = [x for x in LIKED if x["id"] != tid]
        return self.j({"ok": True})
    do_PATCH = do_POST

ThreadingHTTPServer(("127.0.0.1", 5501), partial(H, directory=DOCS)).serve_forever()
