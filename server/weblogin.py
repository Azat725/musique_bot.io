"""Signing in on the site with a Telegram account, through the bot.

The site (as a guest) asks for a one-time code and opens t.me/<bot>?start=login_<code>. The bot asks the person
to confirm; on "Sign in" the code is bound to their Telegram account. The site, which keeps asking about its code,
then gets a session for that account, and the guest's library is moved into it. Codes live ten minutes, in memory:
a restart simply means trying again."""
import secrets
import time

CODE_TTL = 10 * 60
_codes: dict[str, dict] = {}  # code -> {"guest": id, "created": t, "user": {Telegram profile} | None}
bot_username = ""  # set by the bot at start-up


def _sweep() -> None:
    now = time.time()
    for code in [c for c, v in _codes.items() if now - v["created"] > CODE_TTL]:
        del _codes[code]


def start(guest_id: int) -> str:
    """A fresh code for this guest (an earlier one of theirs is dropped)."""
    _sweep()
    for code in [c for c, v in _codes.items() if v["guest"] == guest_id]:
        del _codes[code]
    code = secrets.token_urlsafe(24)  # 32 characters of [A-Za-z0-9_-]: fits Telegram's start parameter
    _codes[code] = {"guest": guest_id, "created": time.time(), "user": None}
    return code


def link(code: str) -> str:
    return f"https://t.me/{bot_username}?start=login_{code}" if bot_username else ""


def known(code: str) -> bool:
    _sweep()
    return code in _codes


def confirm(code: str, user: dict) -> bool:
    """The person pressed "Sign in" in the bot: bind the code to their Telegram account."""
    _sweep()
    entry = _codes.get(code)
    if not entry or entry["user"]:
        return False
    entry["user"] = user
    return True


def poll(code: str, guest_id: int) -> tuple[str, dict | None]:
    """('wait' | 'expired' | 'ok', the Telegram profile when ok). Only the guest who asked may collect it."""
    _sweep()
    entry = _codes.get(code)
    if not entry or entry["guest"] != guest_id:
        return "expired", None
    if not entry["user"]:
        return "wait", None
    del _codes[code]  # one use
    return "ok", entry["user"]
