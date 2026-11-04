import asyncio
import unittest
from unittest.mock import patch

from server import music, radio


class RadioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        radio._found.clear()
        radio._flights.clear()
        radio._slots = asyncio.Semaphore(3)  # bound to this test's loop

    async def test_listeners_share_one_lookup_and_it_is_kept(self):
        calls = 0

        async def search(q, limit=8, videos=False):
            nonlocal calls
            calls += 1
            n = calls
            await asyncio.sleep(.01)
            return [{"id": f"{n:011d}", "title": q, "artist": q, "duration": 200, "cover": ""}]

        seeds = radio.SEEDS["it"]["1960"]
        with patch.object(music, "search", search), patch.object(radio, "_save", lambda: None):
            answers = await asyncio.gather(*(radio.station("it", 1960) for _ in range(300)))
            self.assertEqual(calls, len(seeds))  # each song looked up once for all 300
            await radio.station("it", 1960)
            self.assertEqual(calls, len(seeds))  # and never again
        self.assertEqual({len(a) for a in answers}, {len(seeds)})
        self.assertEqual(answers[0][0]["year"] // 10 * 10, 1960)

    async def test_unknown_station(self):
        with self.assertRaises(ValueError):
            await radio.station("xx", 1960)

    def test_every_station_has_songs_of_its_decade(self):
        for country, decades in radio.SEEDS.items():
            self.assertEqual(set(decades), {str(d) for d in radio.DECADES}, country)
            for d, seeds in decades.items():
                self.assertGreaterEqual(len(seeds), 10, (country, d))
                self.assertTrue(all(int(d) <= s[2] <= int(d) + 9 for s in seeds), (country, d))

    def test_match_rejects_covers_and_strangers(self):
        seed = ["Mina", "Se telefonando", 1966]
        self.assertIsNone(radio.match(seed, [{"id": "x", "title": "Other song", "artist": "Mina", "duration": 200}]))
        got = radio.match(seed, [{"id": "a", "title": "Se telefonando (karaoke)", "artist": "Mina", "duration": 200},
                                 {"id": "b", "title": "Se telefonando", "artist": "Mina", "duration": 190}])
        self.assertEqual(got["id"], "b")


if __name__ == "__main__":
    unittest.main()
