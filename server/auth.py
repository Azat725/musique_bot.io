"""Telegram Mini App initData validation and short-lived stream tokens."""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from fastapi import HTTPException, Request

from . import config

INIT_DATA_MAX_AGE = 7 * 24 * 3600
TOKEN_TTL = 24 * 3600

_secret = hmac.new(b"WebAppData", config.BOT_TOKEN.encode(), hashlib.sha256).digest()
_token_key = hashlib.sha256(b"stream:" + config.BOT_TOKEN.encode()).digest()


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


def current_user(request: Request) -> dict:
    init_data = request.headers.get("X-Init-Data", "")
    user = validate_init_data(init_data) if init_data else None
    if user and "id" in user:
        return user
    if config.DEBUG:
        return {"id": 1, "first_name": "Debug", "language_code": "ru"}
    raise HTTPException(401, "unauthorized")


def make_stream_token(user_id: int) -> str:
    exp = int(time.time()) + TOKEN_TTL
    payload = f"{user_id}.{exp}"
    sig = hmac.new(_token_key, payload.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{payload}.{sig}"


def check_stream_token(token: str) -> bool:
    if config.DEBUG:
        return True
    try:
        user_id, exp, sig = token.split(".")
    except ValueError:
        return False
    expected = hmac.new(_token_key, f"{user_id}.{exp}".encode(), hashlib.sha256).hexdigest()[:32]
    return hmac.compare_digest(expected, sig) and int(exp) > time.time()
