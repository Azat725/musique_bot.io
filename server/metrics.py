"""What the owner can see of the server's health: counters kept in memory only (nothing is written to disk, nothing
identifies a person), and the rules that decide when to raise an alarm. No imports from the rest of the server, so it is
easy to test. Every container here is bounded."""
import time
from collections import deque

MINUTES = 60          # the request counters look back this far
ONLINE_WINDOW = 300   # "online" = seen in the last five minutes
ONLINE_MAX = 20000    # people remembered at once (the oldest are forgotten first)

started = time.time()
_ring: list[list[int]] = [[-1, 0, 0, 0, 0] for _ in range(MINUTES)]  # [minute, requests, 5xx, 503, 429]
_seen: dict[int, float] = {}
_errors: deque[tuple[float, str]] = deque(maxlen=20)


def hit(status: int, now: float | None = None) -> None:
    """One answered request (only its status counts: no path, no body, nobody)."""
    minute = int((now if now is not None else time.time()) // 60)
    cell = _ring[minute % MINUTES]
    if cell[0] != minute:
        cell[:] = [minute, 0, 0, 0, 0]
    cell[1] += 1
    if status >= 500:
        cell[2] += 1
        if status == 503:
            cell[3] += 1
    elif status == 429:
        cell[4] += 1


def seen(user_id: int, now: float | None = None) -> None:
    now = now if now is not None else time.time()
    _seen.pop(user_id, None)  # put back at the end: the front holds the longest silent
    _seen[user_id] = now
    while len(_seen) > ONLINE_MAX:
        _seen.pop(next(iter(_seen)))


def error(text: str, now: float | None = None) -> None:
    """A short note about something that failed (never a token, an address or a stack trace)."""
    _errors.append((now if now is not None else time.time(), str(text)[:200]))


def window(minutes: int, now: float | None = None) -> dict:
    """Requests in the last `minutes` minutes: { requests, errors (5xx), busy (503), limited (429) }."""
    now_min = int((now if now is not None else time.time()) // 60)
    total = [0, 0, 0, 0]
    for cell in _ring:
        if 0 <= now_min - cell[0] < minutes:
            for i in range(4):
                total[i] += cell[i + 1]
    return dict(zip(("requests", "errors", "busy", "limited"), total))


def snapshot(now: float | None = None) -> dict:
    now = now if now is not None else time.time()
    online = 0
    for t in reversed(_seen.values()):  # newest first: stop at the first one that is too old
        if now - t > ONLINE_WINDOW:
            break
        online += 1
    return {"uptime": now - started, "online": online, "hour": window(MINUTES, now), "ten": window(10, now),
            "errors": [text for _, text in list(_errors)[-5:]]}


class Alarms:
    """Raises a warning when a condition has been bad for `hold` seconds, repeats it at most once per `repeat` seconds,
    and says so once when it is fine again. `check` takes { name: (bad, text, hold) } and returns the messages to send."""

    def __init__(self, repeat: float = 3600):
        self.repeat = repeat
        self._since: dict[str, float] = {}
        self._sent: dict[str, float] = {}

    def check(self, conditions: dict[str, tuple[bool, str, float]], now: float) -> list[str]:
        out = []
        for name, (bad, text, hold) in conditions.items():
            if bad:
                since = self._since.setdefault(name, now)
                if now - since >= hold and now - self._sent.get(name, -1e18) >= self.repeat:
                    self._sent[name] = now
                    out.append(f"⚠️ {text}")
            else:
                self._since.pop(name, None)
                if self._sent.pop(name, None) is not None:
                    out.append(f"✅ {name}: ok")
        return out


_TEXT = {
    "ru": {"title": "Состояние сервера", "up": "Работает", "online": "Онлайн за 5 минут", "req": "Запросов за час", "err": "из них ошибок",
           "busy": "«занято» (503)", "limited": "слишком часто (429)", "dl": "Загрузки", "slots": "заняты", "wait": "ждут",
           "yt": "YouTube", "yt_ok": "работает", "yt_pause": "пауза ещё {n} мин", "cache": "Кэш", "files": "файлов", "disk": "Диск свободно",
           "db": "База", "backup": "Резервная копия", "ago": "{n} ч назад", "none": "ещё не было", "errors": "Последние ошибки", "d": "д", "h": "ч", "m": "мин"},
    "en": {"title": "Server status", "up": "Up", "online": "Online in 5 minutes", "req": "Requests in the last hour", "err": "of them errors",
           "busy": "busy (503)", "limited": "too often (429)", "dl": "Downloads", "slots": "busy", "wait": "waiting",
           "yt": "YouTube", "yt_ok": "working", "yt_pause": "paused for {n} more min", "cache": "Cache", "files": "files", "disk": "Disk free",
           "db": "Database", "backup": "Last backup", "ago": "{n} h ago", "none": "none yet", "errors": "Latest errors", "d": "d", "h": "h", "m": "min"},
}


def status_text(lang: str, snap: dict, state: dict) -> str:
    """The owner's status message. `state` = { slots, slots_total, waiting, yt_pause (s), files, cache_bytes, disk_free,
    disk_total, db_bytes, backup_age (s or None) }."""
    t = _TEXT["ru" if lang == "ru" else "en"]
    up = int(snap["uptime"])
    days, hours, mins = up // 86400, up % 86400 // 3600, up % 3600 // 60
    hour = snap["hour"]
    gb = 1024 ** 3
    lines = [
        f"<b>{t['title']}</b>",
        f"{t['up']}: {days} {t['d']} {hours} {t['h']} {mins} {t['m']}",
        f"{t['online']}: {snap['online']}",
        f"{t['req']}: {hour['requests']}, {t['err']}: {hour['errors']}; {t['busy']}: {hour['busy']}; {t['limited']}: {hour['limited']}",
        f"{t['dl']}: {state['slots']}/{state['slots_total']} {t['slots']}, {state['waiting']} {t['wait']}",
        f"{t['yt']}: " + (t["yt_ok"] if state["yt_pause"] <= 0 else t["yt_pause"].format(n=int(state["yt_pause"] // 60) + 1)),
        f"{t['cache']}: {state['files']} {t['files']}, {state['cache_bytes'] / gb:.1f} GB",
        f"{t['disk']}: {state['disk_free'] / gb:.1f} GB ({100 * state['disk_free'] / max(1, state['disk_total']):.0f}%)",
        f"{t['db']}: {state['db_bytes'] / 1048576:.0f} MB",
        f"{t['backup']}: " + (t["none"] if state["backup_age"] is None else t["ago"].format(n=int(state["backup_age"] // 3600))),
    ]
    if snap["errors"]:
        lines.append(f"{t['errors']}:")
        lines += [f"• {e}" for e in snap["errors"]]
    return "\n".join(lines)


def alarm_conditions(snap: dict, state: dict, lang: str = "ru") -> dict:
    """The things worth waking the owner for, as { name: (bad, text, hold seconds) } for Alarms.check."""
    ru = lang == "ru"
    ten = snap["ten"]
    free_pct = 100 * state["disk_free"] / max(1, state["disk_total"])
    return {
        "youtube": (state["yt_pause"] > 0, "YouTube заблокировал загрузки, новые треки не качаются" if ru else "YouTube is refusing downloads, new tracks cannot be fetched", 0),
        "queue": (state["waiting"] > 100, "Очередь загрузок забита (ждут больше 100)" if ru else "The download queue is jammed (over 100 waiting)", 120),
        "disk": (free_pct < 10, f"На диске осталось {free_pct:.0f}%" if ru else f"Only {free_pct:.0f}% of the disk is free", 0),
        "errors": (ten["requests"] >= 50 and ten["errors"] / ten["requests"] > 0.05, "Больше 5% запросов заканчиваются ошибкой сервера" if ru else "Over 5% of requests end in a server error", 0),
        "backup": (state["backup_age"] is not None and state["backup_age"] > 36 * 3600, "Резервной копии базы не было больше 36 часов" if ru else "No database backup for over 36 hours", 0),
    }
