"""The parts that keep the server standing when many people listen at once: the download line, one download shared by
everyone who wants the same track, the database's batched writes, and the stream answer Caddy sends files from."""
import asyncio
import json
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from server import api, auth, config, db, music


class GateTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_waiter_never_eats_a_slot(self):
        gate = music.Gate(1, bg_max=1)
        hold = asyncio.Event()

        async def holder():
            async with gate.take(music.PLAY):
                await hold.wait()

        first = asyncio.create_task(holder())
        await asyncio.sleep(0)
        waiter = asyncio.create_task(self._take(gate))
        await asyncio.sleep(0)
        waiter.cancel()
        hold.set()
        await first
        await asyncio.sleep(0)
        self.assertEqual(gate.free, 1)  # the cancelled one got nothing and holds nothing
        async with gate.take(music.PLAY):
            self.assertEqual(gate.free, 0)

    async def _take(self, gate, priority=music.PLAY):
        async with gate.take(priority):
            await asyncio.sleep(10)

    async def test_long_line_and_long_wait_say_busy(self):
        gate = music.Gate(1, bg_max=1, line_max=2, wait=0.2)
        hold = asyncio.Event()

        async def holder():
            async with gate.take(music.PLAY):
                await hold.wait()

        first = asyncio.create_task(holder())
        await asyncio.sleep(0)
        waiting = [asyncio.create_task(self._take(gate)) for _ in range(2)]
        await asyncio.sleep(0)
        with self.assertRaises(music.Busy):  # the line is full: an answer at once
            async with gate.take(music.PLAY):
                pass
        for w in waiting:  # and those in it give up after `wait` seconds instead of hanging
            with self.assertRaises(music.Busy):
                await w
        hold.set()
        await first
        self.assertEqual(gate.free, 1)
        self.assertEqual(gate.waiting, 0)

    async def test_promoted_ticket_goes_first(self):
        gate = music.Gate(1, bg_max=1)
        order = []
        hold = asyncio.Event()

        async def holder():
            async with gate.take(music.PLAY):
                await hold.wait()

        async def job(name, ticket):
            async with gate.take(ticket):
                order.append(name)

        first = asyncio.create_task(holder())
        await asyncio.sleep(0)
        bg = music.Ticket(music.BG)
        jobs = [asyncio.create_task(job("next", music.Ticket(music.NEXT))), asyncio.create_task(job("bg", bg))]
        await asyncio.sleep(0)
        bg.promote(music.PLAY)  # someone pressed play on the track this prefetch was getting
        hold.set()
        await asyncio.gather(first, *jobs)
        self.assertEqual(order, ["bg", "next"])


class SharedDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.patches = [patch.object(config, "CACHE_DIR", self.dir), patch.object(music, "_indexed", True),
                        patch.object(music, "_files", {}), patch.object(music, "_prune_soon", lambda: None)]
        for p in self.patches:
            p.start()

    async def asyncTearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    async def test_one_download_for_everyone(self):
        calls = 0

        async def fetch(vid):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            path = self.dir / f"{vid}.m4a"
            path.write_bytes(b"x")
            return music._keep(vid, path)

        with patch.object(music, "_fetch", fetch):
            paths = await asyncio.gather(*(music.ensure_file("abcdefghijk") for _ in range(200)))
        self.assertEqual(calls, 1)
        self.assertTrue(all(p == paths[0] for p in paths))
        self.assertEqual(music._cached_file("abcdefghijk"), paths[0])  # known without looking at the folder
        self.assertEqual(music.downloads.free, music.DOWNLOADS)

    async def test_nobody_waiting_leaves_the_line(self):
        gate = music.Gate(1, bg_max=1)
        hold = asyncio.Event()
        started = []

        async def fetch(vid):
            started.append(vid)
            return self.dir / "x.m4a"

        async def holder():
            async with gate.take(music.PLAY):
                await hold.wait()

        with patch.object(music, "downloads", gate), patch.object(music, "_fetch", fetch):
            first = asyncio.create_task(holder())
            await asyncio.sleep(0)
            listener = asyncio.create_task(music.ensure_file("bbbbbbbbbbb"))
            await asyncio.sleep(0.01)
            listener.cancel()  # the listener closed the app while waiting
            await asyncio.sleep(0.01)
            hold.set()
            await first
            await asyncio.sleep(0.01)
        self.assertEqual(started, [])
        self.assertEqual(gate.free, 1)

    def test_one_refusal_does_not_switch_youtube_off(self):
        music._block_hits.clear()
        with patch.object(music, "_yt_blocked_until", 0.0):
            music._mark_if_blocked(RuntimeError("HTTP Error 403: Forbidden"))
            self.assertEqual(music._yt_blocked_until, 0.0)
            music._mark_if_blocked(RuntimeError("HTTP Error 429"))
            music._mark_if_blocked(RuntimeError("Sign in to confirm you're not a bot"))
            self.assertGreater(music._yt_blocked_until, 0.0)


class DatabaseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.patch = patch.object(config, "DB_PATH", self.dir / "t.db")
        self.patch.start()
        db._queue_ids.clear()
        await db.init()

    async def asyncTearDown(self):
        await db.close()
        self.patch.stop()
        shutil.rmtree(self.dir, ignore_errors=True)

    async def test_wal_and_batched_commits(self):
        self.assertEqual((await db._run(db._one, "PRAGMA journal_mode"))[0], "wal")
        track = {"id": "abcdefghijk", "title": "A", "artist": "B", "duration": 100, "cover": ""}
        before = db.commits
        await asyncio.gather(*(db.add_history(uid, track) for uid in range(300)))
        await db.flush()
        self.assertLessEqual(db.commits - before, 2)  # three hundred listeners, one commit
        self.assertEqual(len(await db.history(5)), 1)

    async def test_client_cannot_rename_a_track(self):
        await db.add_history(1, {"id": "abcdefghijk", "title": "Real", "artist": "Artist", "duration": 100, "cover": ""})
        await db.like(2, {"id": "abcdefghijk", "title": "Fake", "artist": "Spam", "duration": 1, "cover": "c"})
        t = await db.get_track("abcdefghijk")
        self.assertEqual((t["title"], t["artist"], t["cover"]), ("Real", "Artist", "c"))

    async def test_position_is_its_own_row(self):
        tracks = [{"id": f"t{i:010d}", "title": "x", "artist": "y", "duration": 1, "cover": ""} for i in range(300)]
        queue = {"tracks": tracks, "index": 0, "time": 0, "shuffle": False, "repeat": "off"}
        q_updated = await db.set_state(7, "queue", queue)
        p_updated = await db.move_queue_position(7, tracks[42]["id"], 42, 12.5)
        self.assertGreater(p_updated, q_updated)
        self.assertIsNone(await db.move_queue_position(7, "someoneelse", 42, 1))  # not the stored queue
        await db.flush()
        stored = json.loads((await db._run(db._one, "SELECT value FROM user_state WHERE user_id = 7 AND key = 'queue'"))[0])
        self.assertEqual(stored["index"], 0)  # the queue itself was not rewritten
        state = (await db.get_states(7))["queue"]
        self.assertEqual((state["value"]["index"], state["value"]["time"], state["updated"]), (42, 12.5, p_updated))
        await db.set_state(7, "queue", {**queue, "index": 3})  # a new queue: the old position goes
        self.assertEqual((await db.get_states(7))["queue"]["value"]["index"], 3)

    async def test_failed_write_is_undone_alone(self):
        await db.add_history(1, {"id": "abcdefghijk", "title": "A", "artist": "B", "duration": 1, "cover": ""})
        def broken():
            db._conn.execute("INSERT INTO likes VALUES (1, 'x', 1)")
            db._conn.execute("INSERT INTO nowhere VALUES (1)")
        with self.assertRaises(Exception):
            await db._write(broken)
        await db.flush()
        self.assertEqual(len(await db.history(1)), 1)  # the other write is kept
        self.assertEqual(await db.likes(1), [])  # the failed one is not half there


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_caddy_is_told_which_file(self):
        path = config.CACHE_DIR / "fx" / "abcdefghijk.slow-hall.m4a"
        with patch.object(config, "STREAM_ACCEL", True):
            r = api._send_file(path)
        self.assertEqual(r.headers["x-accel-redirect"], "/cache/fx/abcdefghijk.slow-hall.m4a")
        self.assertEqual(r.headers["content-type"], "audio/mp4")

    async def test_busy_is_503(self):
        async def busy(vid, *a, **k):
            raise music.Busy

        class Req:
            async def is_disconnected(self):
                return False

        with patch.object(music, "play_file", busy):
            with self.assertRaises(HTTPException) as ctx:
                await api.stream("abcdefghijk", Req(), t=auth.make_stream_token(1))
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(music.failure("abcdefghijk"), "busy")

    def test_stream_token_is_stable_all_day(self):
        self.assertEqual(auth.make_stream_token(5), auth.make_stream_token(5))
        self.assertTrue(auth.check_stream_token(auth.make_stream_token(5)))

    def test_rate_limit(self):
        user = {"id": 99}
        for _ in range(api.LIMITS["search"][1]):
            api._limit(user, "search")
        with self.assertRaises(HTTPException) as ctx:
            api._limit(user, "search")
        self.assertEqual(ctx.exception.status_code, 429)


@unittest.skipUnless(config.FFMPEG, "ffmpeg is needed")
class RadioSoundTests(unittest.TestCase):
    def test_am_is_mono_and_narrow(self):
        d = Path(tempfile.mkdtemp())
        try:
            src, out = d / "in.wav", d / "out.m4a"
            # 300 Hz (kept) and 9 kHz (gone on medium wave), in stereo
            subprocess.run([config.FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=300:d=3",
                            "-f", "lavfi", "-i", "sine=f=9000:d=3", "-filter_complex", "[0][1]amerge=inputs=2[a]",
                            "-map", "[a]", str(src)], check=True)
            music._render_fx(src, out, "am")
            probe = subprocess.run([config.FFMPEG, "-i", str(out), "-af", "bandpass=f=9000:width_type=h:w=800,volumedetect",
                                    "-f", "null", "-"], capture_output=True, text=True)
            high = float(probe.stderr.split("mean_volume:")[1].split("dB")[0])
            probe = subprocess.run([config.FFMPEG, "-i", str(out), "-af", "bandpass=f=300:width_type=h:w=100,volumedetect",
                                    "-f", "null", "-"], capture_output=True, text=True)
            low = float(probe.stderr.split("mean_volume:")[1].split("dB")[0])
            self.assertIn("mono", subprocess.run([config.FFMPEG, "-i", str(out)], capture_output=True, text=True).stderr)
            self.assertGreater(low - high, 20)  # four poles above 4.5 kHz: an octave up is far down
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
