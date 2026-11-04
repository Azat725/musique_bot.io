import os
import unittest

os.environ.setdefault("BOT_TOKEN", "123:TEST")

from server import metrics  # noqa: E402


def fresh():
    for cell in metrics._ring:
        cell[:] = [-1, 0, 0, 0, 0]
    metrics._seen.clear()
    metrics._errors.clear()


class Counters(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_requests_are_counted_by_kind_and_old_minutes_fall_out(self):
        base = 1_000_000 * 60
        for status in (200, 200, 500, 503, 429, 404):
            metrics.hit(status, base)
        w = metrics.window(60, base)
        self.assertEqual(w, {"requests": 6, "errors": 2, "busy": 1, "limited": 1})
        later = base + 61 * 60  # an hour later the minute has fallen out of the ring
        self.assertEqual(metrics.window(60, later)["requests"], 0)
        metrics.hit(200, later)  # and its cell is reused cleanly
        self.assertEqual(metrics.window(60, later)["requests"], 1)
        self.assertEqual(len(metrics._ring), metrics.MINUTES)

    def test_online_counts_the_recent_and_is_bounded(self):
        for i in range(metrics.ONLINE_MAX + 50):
            metrics.seen(i, 1000.0)
        self.assertLessEqual(len(metrics._seen), metrics.ONLINE_MAX)
        metrics.seen(1, 1000.0 + 400)  # one came back later, the others are older than five minutes
        snap = metrics.snapshot(1000.0 + 400)
        self.assertEqual(snap["online"], 1)
        self.assertNotIn("users", snap)

    def test_errors_are_short_and_few(self):
        for i in range(40):
            metrics.error("x" * 500)
        self.assertEqual(len(metrics._errors), 20)
        self.assertTrue(all(len(text) <= 200 for _, text in metrics._errors))
        self.assertEqual(len(metrics.snapshot()["errors"]), 5)


class AlarmRules(unittest.TestCase):
    def test_warns_after_the_hold_once_an_hour_and_says_when_fine(self):
        a = metrics.Alarms(repeat=3600)
        bad = {"queue": (True, "jam", 120)}
        self.assertEqual(a.check(bad, 0), [])  # not long enough yet
        self.assertEqual(a.check(bad, 130), ["⚠️ jam"])
        self.assertEqual(a.check(bad, 400), [])  # not again within the hour
        self.assertEqual(a.check(bad, 130 + 3601), ["⚠️ jam"])
        self.assertEqual(a.check({"queue": (False, "jam", 120)}, 5000), ["✅ queue: ok"])
        self.assertEqual(a.check({"queue": (False, "jam", 120)}, 5100), [])

    def test_a_blip_shorter_than_the_hold_is_never_reported(self):
        a = metrics.Alarms()
        self.assertEqual(a.check({"q": (True, "jam", 120)}, 0), [])
        self.assertEqual(a.check({"q": (False, "jam", 120)}, 60), [])
        self.assertEqual(a.check({"q": (True, "jam", 120)}, 100), [])
        self.assertEqual(a.check({"q": (True, "jam", 120)}, 200), [])  # the clock started again at 100

    def test_conditions_and_the_status_text(self):
        gb = 1024 ** 3
        state = {"slots": 2, "slots_total": 6, "waiting": 150, "yt_pause": 300, "files": 100, "cache_bytes": 5 * gb, "disk_free": gb,
                 "disk_total": 20 * gb, "db_bytes": 10 * 1048576, "backup_age": 40 * 3600}
        fresh()
        for _ in range(60):
            metrics.hit(500)
        snap = metrics.snapshot()
        bad = {k for k, v in metrics.alarm_conditions(snap, state).items() if v[0]}
        self.assertEqual(bad, {"youtube", "queue", "disk", "errors", "backup"})
        healthy = {**state, "waiting": 0, "yt_pause": 0, "disk_free": 10 * gb, "backup_age": 3600}
        fresh()
        self.assertFalse(any(v[0] for v in metrics.alarm_conditions(metrics.snapshot(), healthy).values()))
        for lang in ("ru", "en"):
            text = metrics.status_text(lang, metrics.snapshot(), state)
            self.assertIn("YouTube", text)
            self.assertNotIn("{", text)


if __name__ == "__main__":
    unittest.main()
