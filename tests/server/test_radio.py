import asyncio
import unittest
import types
import server
from unittest.mock import patch
from server import radio


class RadioTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        radio._cache.clear()
        radio._inflight.clear()
        radio._slots = asyncio.Semaphore(2)

    async def test_300_listeners_share_one_resolution(self):
        calls = 0
        async def resolve(seed):
            nonlocal calls
            calls += 1
            await asyncio.sleep(.01)
            return {'id': seed['title'], 'title': seed['title'], 'artist': seed['artist']}
        with patch.object(radio, 'resolve', resolve):
            answers = await asyncio.gather(*(radio.station('us', 1960) for _ in range(300)))
            self.assertEqual(calls, 2)
            self.assertTrue(all(answer == answers[0] for answer in answers))
            await radio.station('us', 1960)
            self.assertEqual(calls, 2)

    async def test_disconnected_listener_does_not_cancel_others(self):
        async def resolve(seed):
            await asyncio.sleep(.01)
            return {'id': seed['title']}
        with patch.object(radio, 'resolve', resolve):
            first = asyncio.create_task(radio.station('fr', 1980))
            second = asyncio.create_task(radio.station('fr', 1980))
            await asyncio.sleep(0)
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            self.assertTrue(await second)

    async def test_unknown_channel_rejected_before_work(self):
        with self.assertRaises(ValueError):
            await radio.station('bad', 1960)

    async def test_actual_resolver_has_two_search_slots(self):
        active = peak = 0
        async def search(query, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(.01)
            active -= 1
            self.assertFalse(kwargs['videos'])
            return [{'id': 'test', 'artist': 'Nena', 'title': '99 Luftballons'}]
        with patch.object(server, 'music', types.SimpleNamespace(search=search), create=True):
            result = await asyncio.gather(*(radio.resolve({'artist': 'Nena', 'title': '99 Luftballons'}) for _ in range(20)))
        self.assertEqual(peak, 2)
        self.assertTrue(all(result))

    def test_every_country_has_every_era(self):
        for country, songs in radio.CATALOGUE.items():
            for decade in radio.DECADES:
                self.assertTrue(any((song['year'] <= 1949 if decade == 1940 else decade <= song['year'] <= decade + 9) for song in songs), (country, decade))

    def test_matching_rejects_an_unrelated_result(self):
        seed = {'artist': 'Nena', 'title': '99 Luftballons'}
        self.assertIsNone(radio.match(seed, [{'artist': 'Other', 'title': 'Other'}]))
        self.assertIsNotNone(radio.match(seed, [{'artist': 'Nena', 'title': '99 Luftballons (Remastered)'}]))
