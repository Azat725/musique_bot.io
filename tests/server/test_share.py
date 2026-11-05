"""Playlists shared by a link: only the owner opens and closes a link, anyone with it can look and take a copy,
a closed or deleted playlist's link stops working, and the importer understands our own links."""
import re
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from server import api, config, db, importer, weblogin


def track(n: int, artist: str = "Artist") -> dict:
    return {"id": f"track{n:06d}", "title": f"Song {n}", "artist": artist, "duration": 100 + n, "cover": f"https://c/{n}"}


class ShareTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.patch = patch.object(config, "DB_PATH", self.dir / "t.db")
        self.patch.start()
        db._queue_ids.clear()
        await db.init()
        self.pid = await db.create_playlist(1, "Road trip")
        for n in range(3):
            await db.add_to_playlist(1, self.pid, track(n))

    async def asyncTearDown(self):
        await db.close()
        self.patch.stop()
        shutil.rmtree(self.dir, ignore_errors=True)
        api._buckets.clear()

    async def test_only_the_owner_makes_a_link_and_it_is_the_same_each_time(self):
        self.assertIsNone(await db.share_playlist(2, self.pid, "stranger0001"))
        token = await db.share_playlist(1, self.pid, "firsttoken01")
        self.assertEqual(token, "firsttoken01")
        self.assertEqual(await db.share_playlist(1, self.pid, "secondtoken2"), "firsttoken01", "one playlist, one link")

    async def test_the_link_shows_the_playlist_and_a_copy_goes_to_the_library_of_the_one_who_takes_it(self):
        token = await db.share_playlist(1, self.pid, "firsttoken01")
        shared = await db.shared(token)
        self.assertEqual((shared["name"], [t["id"] for t in shared["tracks"]]), ("Road trip", ["track000000", "track000001", "track000002"]))
        done = await db.import_shared(2, token)
        self.assertEqual((done["name"], done["added"]), ("Road trip", 3))
        mine = await db.playlist(2, done["id"])
        self.assertEqual([t["id"] for t in mine["tracks"]], ["track000000", "track000001", "track000002"], "same songs, same order")
        await db.add_to_playlist(1, self.pid, track(9))
        self.assertEqual(len((await db.playlist(2, done["id"]))["tracks"]), 3, "a copy: later changes of the original do not follow")
        self.assertEqual(await db.playlist(1, done["id"]), None, "and it is not the owner's playlist")

    async def test_closing_or_deleting_stops_the_link(self):
        token = await db.share_playlist(1, self.pid, "firsttoken01")
        self.assertFalse(await db.unshare_playlist(2, self.pid), "somebody else cannot close it")
        self.assertIsNotNone(await db.shared(token))
        self.assertTrue(await db.unshare_playlist(1, self.pid))
        self.assertIsNone(await db.shared(token))
        self.assertIsNone(await db.import_shared(2, token))
        token = await db.share_playlist(1, self.pid, "againtoken01")
        await db.delete_playlist(1, self.pid)
        self.assertIsNone(await db.shared(token), "a deleted playlist has no link left")

    async def test_the_links_move_with_the_playlists_into_an_account(self):
        token = await db.share_playlist(1, self.pid, "firsttoken01")
        await db.merge_user(1, 50)
        self.assertEqual((await db.shared(token))["name"], "Road trip")
        self.assertTrue(await db.unshare_playlist(50, self.pid), "now the account's to close")

    async def test_one_person_keeps_a_limited_number_of_links(self):
        with patch.object(db, "MAX_SHARES", 2):
            for n in range(2):
                p = await db.create_playlist(1, f"List {n}")
                self.assertTrue(await db.share_playlist(1, p, f"sharetoken{n:02d}"))
            extra = await db.create_playlist(1, "One more")
            self.assertEqual(await db.share_playlist(1, extra, "sharetoken99"), "")
            self.assertEqual(await db.share_playlist(1, self.pid, "sharetoken98"), "", "the third playlist is over the limit too")

    async def test_the_importer_takes_our_own_links(self):
        token = await db.share_playlist(1, self.pid, "firsttoken01")
        for source in (f"https://t.me/musique_bot?start=pl_{token}", f"https://example.org/app/?v=1&pl={token}", f"look {token} here ?pl={token}"):
            name, tracks, missing, total = await importer._collect(source)
            self.assertEqual((name, len(tracks), missing, total), ("Road trip", 3, [], 3), source)
        done = await importer.run(2, f"https://t.me/musique_bot?start=pl_{token}", "ru")
        self.assertEqual((done["name"], done["added"]), ("Road trip", 3))
        with self.assertRaises(importer.ImportFailed):
            await importer._collect("https://t.me/musique_bot?start=pl_nosuchtoken1")

    async def test_the_routes_check_the_token_and_the_owner_and_the_rate(self):
        me, other = {"id": 1}, {"id": 2}
        out = await api.share_playlist(self.pid, user=me)
        self.assertEqual(len(out["token"]), 16)
        self.assertTrue(re.fullmatch(api.SHARE_RE, out["token"]))
        with patch.object(weblogin, "bot_username", "musique_bot"):
            self.assertEqual(api.share_link(out["token"]), f"https://t.me/musique_bot?start=pl_{out['token']}")
        with patch.object(weblogin, "bot_username", ""):
            self.assertEqual(api.share_link(out["token"]), "")
        with self.assertRaises(HTTPException) as ctx:
            await api.share_playlist(self.pid, user=other)
        self.assertEqual(ctx.exception.status_code, 404)
        seen = await api.get_shared(out["token"], user=other)
        self.assertEqual((seen["name"], seen["count"], seen["covers"]), ("Road trip", 3, ["https://c/0", "https://c/1", "https://c/2"]))
        self.assertEqual(seen["titles"][0], "Artist — Song 0")
        taken = await api.import_shared(out["token"], user=other)
        self.assertEqual(taken["added"], 3)
        with self.assertRaises(HTTPException) as ctx:
            await api.get_shared("nosuchtoken123", user=other)
        self.assertEqual(ctx.exception.status_code, 404)
        await api.unshare_playlist(self.pid, user=me)
        with self.assertRaises(HTTPException) as ctx:
            await api.import_shared(out["token"], user=other)
        self.assertEqual(ctx.exception.status_code, 404)
        for _ in range(api.LIMITS["shared"][1] + 1):
            try:
                await api.get_shared("nosuchtoken123", user={"id": 77})
            except HTTPException as e:
                last = e.status_code
        self.assertEqual(last, 429, "a script guessing links is slowed down")

    def test_a_bad_token_never_reaches_the_database(self):
        for bad in ("short", "x" * 41, "has space1234", "semi;colon1234", "../../etc/passwd"):
            self.assertIsNone(re.fullmatch(api.SHARE_RE, bad), bad)
