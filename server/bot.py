"""Telegram bot: /start with the Mini App button, in-chat search, sending tracks as audio."""
import logging

import httpx
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import CommandStart
from aiogram.types import (BotCommand, BufferedInputFile, CallbackQuery, FSInputFile, InlineKeyboardButton,
                           InlineKeyboardMarkup, MenuButtonWebApp, Message, WebAppInfo)

from . import config, db, music

log = logging.getLogger("musique.bot")

TEXTS = {
    "ru": {
        "start": "<b>Musique</b>\n\nВся музыка в одном месте. Открой плеер кнопкой ниже "
                 "или просто напиши название трека или исполнителя — пришлю аудио прямо сюда.",
        "open": "Открыть Musique",
        "searching": "Ищу…",
        "nothing": "Ничего не нашлось. Попробуй иначе сформулировать запрос.",
        "results": "Результаты по запросу «{q}»:",
        "loading": "Загружаю трек…",
        "failed": "Не удалось загрузить этот трек. Попробуй другой вариант.",
        "description": "Слушай любую музыку прямо в Telegram: поиск, плейлисты, избранное и виниловый плеер.",
        "short": "Вся музыка в Telegram. Поиск, плейлисты, винил.",
    },
    "en": {
        "start": "<b>Musique</b>\n\nAll your music in one place. Open the player with the button below "
                 "or just send me a track or artist name — I'll reply with the audio.",
        "open": "Open Musique",
        "searching": "Searching…",
        "nothing": "Nothing found. Try rephrasing your query.",
        "results": "Results for “{q}”:",
        "loading": "Loading the track…",
        "failed": "Couldn't load this track. Try another one.",
        "description": "Listen to any music right in Telegram: search, playlists, favourites and a vinyl player.",
        "short": "All music in Telegram. Search, playlists, vinyl.",
    },
}

router = Router()
dp = Dispatcher()
dp.include_router(router)
_bot: Bot | None = None


def _lang(code: str | None) -> str:
    return "ru" if (code or "").lower().startswith(("ru", "uk", "be", "kk")) else "en"


def _t(code: str | None, key: str) -> str:
    return TEXTS[_lang(code)][key]


def _fmt(sec: int) -> str:
    return f"{sec // 60}:{sec % 60:02d}"


def _open_keyboard(code: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text=_t(code, "open"), web_app=WebAppInfo(url=config.webapp_url()))
    ]])


@router.message(CommandStart())
async def start(message: Message):
    await message.answer(_t(message.from_user.language_code, "start"),
                         reply_markup=_open_keyboard(message.from_user.language_code))


@router.message(F.text & ~F.text.startswith("/"))
async def text_search(message: Message):
    code = message.from_user.language_code
    status = await message.answer(_t(code, "searching"))
    try:
        tracks = (await music.search(message.text))[:8]
    except Exception:
        log.exception("search failed")
        tracks = []
    if not tracks:
        await status.edit_text(_t(code, "nothing"))
        return
    rows = []
    for tr in tracks:
        label = f"{tr['artist']} — {tr['title']}"
        if len(label) > 52:
            label = label[:51] + "…"
        rows.append([InlineKeyboardButton(text=f"{label} · {_fmt(tr['duration'])}", callback_data=f"dl:{tr['id']}")])
    rows.append([InlineKeyboardButton(text=_t(code, "open"), web_app=WebAppInfo(url=config.webapp_url()))])
    query = message.text[:60].replace("<", "").replace(">", "")
    await status.edit_text(_t(code, "results").format(q=query), reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))


@router.callback_query(F.data.startswith("dl:"))
async def download(cb: CallbackQuery):
    await cb.answer(_t(cb.from_user.language_code, "loading"))
    await send_track(cb.from_user.id, cb.data[3:], cb.from_user.language_code)


async def _thumbnail(url: str) -> BufferedInputFile | None:
    if not url:
        return None
    if "googleusercontent.com" in url:
        url = url.split("=w")[0] + "=w320-h320-l90-rj"
    elif "i.ytimg.com" in url:
        url = url.replace("/hq720.jpg", "/mqdefault.jpg")
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url)
        if r.status_code == 200 and len(r.content) < 200_000:
            return BufferedInputFile(r.content, "cover.jpg")
    except httpx.HTTPError:
        pass
    return None


async def send_track(chat_id: int, track_id: str, lang: str | None) -> None:
    """Send the track to the user's chat as an audio file (reusing Telegram's file_id when possible)."""
    if not music.ID_RE.match(track_id):
        return
    meta = await music.track_meta(track_id) or {"title": track_id, "artist": "", "duration": 0, "cover": ""}
    file_id = await db.tg_file(track_id)
    try:
        if file_id:
            await _bot.send_audio(chat_id, file_id)
            return
        await _bot.send_chat_action(chat_id, "upload_document")
        path = await music.ensure_file(track_id)
        msg = await _bot.send_audio(
            chat_id,
            FSInputFile(path, filename=f"{meta['artist']} - {meta['title']}{path.suffix}"[:120]),
            title=meta["title"], performer=meta["artist"], duration=meta["duration"] or None,
            thumbnail=await _thumbnail(meta.get("cover", "")),
        )
        if msg.audio:
            await db.save_tg_file(track_id, msg.audio.file_id)
    except Exception:
        log.exception("send_track failed for %s", track_id)
        await _bot.send_message(chat_id, _t(lang, "failed"))


async def setup(bot: Bot) -> None:
    global _bot
    _bot = bot
    await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Musique", web_app=WebAppInfo(url=config.webapp_url())))
    for code in ("ru", "en"):
        lang = None if code == "en" else code
        try:
            await bot.set_my_commands([BotCommand(command="start", description=TEXTS[code]["open"])], language_code=lang)
            await bot.set_my_description(TEXTS[code]["description"], language_code=lang)
            await bot.set_my_short_description(TEXTS[code]["short"], language_code=lang)
        except Exception as e:
            log.warning("bot profile update skipped: %s", e)
    try:
        me = await bot.get_me()
        if me.first_name != "Musique":
            await bot.set_my_name("Musique")
    except Exception as e:
        log.warning("set_my_name skipped: %s", e)
    log.info("Mini App URL: %s", config.webapp_url())
