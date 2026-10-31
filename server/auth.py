"""Who is asking: the Telegram Mini App signature (initData), or a session for the site in an ordinary browser
(a guest, or a Telegram account signed in through the bot). Plus short-lived stream tokens."""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request

from . import config, db

INIT_DATA_MAX_AGE = 7 * 24 * 3600
TOKEN_TTL = 24 * 3600
SESSION_TTL = 365 * 24 * 3600

_secret = hmac.new(b"WebAppData", config.BOT_TOKEN.encode(), hashlib.sha256).digest()
_token_key = hashlib.sha256(b"stream:" + config.BOT_TOKEN.encode()).digest()
_session_key = hashlib.sha256(b"session:" + config.BOT_TOKEN.encode()).digest()
_profiles: dict[int, dict] = {}  # account id -> profile, so a session does not cost a database read per request


def validate_init_data(init_data: str) -> dict | None:
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    received = pairs.pop("hash", None)
    if not received:
        return None
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    expected = hmac.new(_secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    if time.time() - int(pairs.get("auth_date", "0")) > INIT_DATA_MAX_AGE:
        return None
    try:
        return json.loads(pairs.get("user", "{}")) or None
    except json.JSONDecodeError:
        return None


def _sign(payload: str, key: bytes) -> str:
    return hmac.new(key, payload.encode(), hashlib.sha256).hexdigest()[:32]


def make_session(user_id: int) -> str:
    """A year-long session for the site: s1.<id>.<expiry>.<signature>; the browser keeps it."""
    payload = f"s1.{user_id}.{int(time.time()) + SESSION_TTL}"
    return f"{payload}.{_sign(payload, _session_key)}"


def session_user_id(token: str) -> int | None:
    try:
        version, user_id, exp, sig = token.split(".")
        payload = f"{version}.{user_id}.{exp}"
        if version != "s1" or not hmac.compare_digest(_sign(payload, _session_key), sig) or int(exp) < time.time():
            return None
        return int(user_id)
    except (ValueError, TypeError):
        return None


def forget_profile(user_id: int) -> None:
    _profiles.pop(user_id, None)


async def current_user(request: Request) -> dict:
    """The Mini App signs every request with Telegram's initData; the site sends its session instead."""
    init_data = request.headers.get("X-Init-Data", "")
    user = validate_init_data(init_data) if init_data else None
    if user and "id" in user:
        return {**user, "kind": "telegram"}
    bearer = request.headers.get("Authorization", "")
    if bearer.startswith("Bearer "):
        user_id = session_user_id(bearer[7:].strip())
        if user_id is not None:
            if user_id not in _profiles:
                account = await db.get_account(user_id)
                if account:
                    _profiles[user_id] = account
                    if len(_profiles) > 5000:
                        _profiles.pop(next(iter(_profiles)))
            if user_id in _profiles:
                return dict(_profiles[user_id])
    if config.DEBUG:
        return {"id": 1, "first_name": "Debug", "language_code": "ru", "kind": "telegram"}
    raise HTTPException(401, "unauthorized")


def make_stream_token(user_id: int) -> str:
    exp = int(time.time()) + TOKEN_TTL
    payload = f"{user_id}.{exp}"
    return f"{payload}.{_sign(payload, _token_key)}"


def check_stream_token(token: str) -> bool:
    if config.DEBUG:
        return True
    try:
        user_id, exp, sig = token.rsplit(".", 2)  # guest ids are negative: "-123.<exp>.<sig>"
        return hmac.compare_digest(_sign(f"{user_id}.{exp}", _token_key), sig) and int(exp) > time.time()
    except ValueError:
        return False
