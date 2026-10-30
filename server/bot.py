"""Telegram bot: /start with the Mini App button, in-chat search, sending tracks as audio."""
import asyncio
import logging

import httpx
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import (BotCommand, BufferedInputFile, CallbackQuery, FSInputFile, InlineKeyboardButton,
                           InlineKeyboardMarkup, LabeledPrice, MenuButtonWebApp, Message, PreCheckoutQuery, WebAppInfo)

from . import backup, config, db, music

log = logging.getLogger("musique.bot")

TEXTS = {
    "ru": {
        "start": "Привет! Это Musique — ламповое приложение для музыки 🎶\n\n"
                 "Здесь играет винил, а любимые песни всегда рядом. Жми кнопку ниже и доставай пластинку. "
                 "А если хочется чего-то конкретного — напиши название или исполнителя, и трек придёт сюда.\n\n"
                 "Здесь точно кайф ✨",
        "open": "Открыть Musique",
        "searching": "Ищу…",
        "nothing": "Ничего не нашлось. Попробуй иначе сформулировать запрос.",
        "results": "Результаты по запросу «{q}»:",
        "loading": "Загружаю трек…",
        "failed": "Не удалось загрузить этот трек. Попробуй другой вариант.",
        "description": "Слушай любую музыку прямо в Telegram: поиск, плейлисты, избранное и виниловый плеер.",
        "short": "Вся музыка в Telegram. Поиск, плейлисты, винил.",
        "support": "⭐ Поддержать автора",
        "support_cmd": "Поддержать автора",
        "support_prompt": "Автор Musique работает на энтузиазме и чае ☕\n\n"
                          "Если приложение скрасило вам вечер, можно угостить чашечкой: любая сумма.",
        "support_tbank": "☕ Угостить чаем в Т-Банке",
        "support_custom": "Своя сумма",
        "support_ask": "Напишите, сколько звёзд отправить — целое число от 1 до {max}.",
        "support_bad": "Нужно целое число от 1 до {max}. Попробуйте ещё раз или нажмите «Отмена».",
        "support_cancel": "Отмена",
        "support_cancelled": "Хорошо, в другой раз 🙂",
        "support_title": "Чай для автора Musique",
        "support_desc": "Добровольная поддержка автора — {n} ⭐. Спасибо!",
        "support_label": "Поддержка автора",
        "support_thanks": "Спасибо за чай! {n} ⭐ — это очень тепло 🤍",
        "backup_noadmin": "Владелец бота ещё не указан. Ваш Telegram id: <code>{id}</code>. Добавьте строку "
                          "<code>ADMIN_ID={id}</code> в server/.env и перезапустите бота: резервные копии базы будут приходить сюда.",
        "backup_making": "Делаю резервную копию…",
        "backup_failed": "Не удалось сделать резервную копию, подробности в логах сервера.",
    },
    "en": {
        "start": "Hi! This is Musique — a cosy little app for music 🎶\n\n"
                 "A vinyl record plays here, and your favourite songs are always close. Tap the button below and take out a record. "
                 "Or if you want something specific, just send me a song or artist name and the track will arrive right here.\n\n"
                 "It just feels good here ✨",
        "open": "Open Musique",
        "searching": "Searching…",
        "nothing": "Nothing found. Try rephrasing your query.",
        "results": "Results for “{q}”:",
        "loading": "Loading the track…",
        "failed": "Couldn't load this track. Try another one.",
        "description": "Listen to any music right in Telegram: search, playlists, favourites and a vinyl player.",
        "short": "All music in Telegram. Search, playlists, vinyl.",
        "support": "⭐ Support the author",
        "support_cmd": "Support the author",
        "support_prompt": "The author of Musique runs on enthusiasm and tea ☕\n\n"
                          "If the app brightened your evening, you can treat them to a cup: any amount.",
        "support_tbank": "☕ Treat to tea (T-Bank)",
        "support_custom": "Other amount",
        "support_ask": "Send me the number of Stars — a whole number from 1 to {max}.",
        "support_bad": "That needs to be a whole number from 1 to {max}. Try again or tap “Cancel”.",
        "support_cancel": "Cancel",
        "support_cancelled": "No problem, maybe another time 🙂",
        "support_title": "Tea for the author of Musique",
        "support_desc": "A voluntary tip for the author — {n} ⭐. Thank you!",
        "support_label": "Support the author",
        "support_thanks": "Thanks for the tea! {n} ⭐ means a lot, it's really warm 🤍",
        "backup_noadmin": "The bot's owner is not set yet. Your Telegram id: <code>{id}</code>. Add the line "
                          "<code>ADMIN_ID={id}</code> to server/.env and restart the bot: database backups will arrive here.",
        "backup_making": "Making a backup…",
        "backup_failed": "The backup failed, see the server logs.",
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
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=_t(code, "open"), web_app=WebAppInfo(url=config.webapp_url()))],
        [InlineKeyboardButton(text=_t(code, "support"), callback_data="support")],
    ])


@router.message(CommandStart())
async def start(message: Message):
    _awaiting_amount.discard(message.from_user.id)
    await message.answer(_t(message.from_user.language_code, "start"),
                         reply_markup=_open_keyboard(message.from_user.language_code))


# ---------- support the author with Telegram Stars (bot only: the Mini App never takes payments) ----------

SUPPORT_PRESETS = (50, 100, 250, 500)
SUPPORT_MAX = 10_000
_awaiting_amount: set[int] = set()  # users asked to type their own amount; kept in memory, a restart just forgets it


def _support_keyboard(code: str | None) -> InlineKeyboardMarkup:
    stars = [InlineKeyboardButton(text=f"{n} ⭐", callback_data=f"stars:{n}") for n in SUPPORT_PRESETS]
    rows = [stars[:2], stars[2:], [InlineKeyboardButton(text=_t(code, "support_custom"), callback_data="stars:custom")]]
    # a transfer to the author's bank account: only for those whose Telegram language is Russian (a Russian bank
    # is of no use to anyone else); everybody keeps the Stars
    if config.SUPPORT_URL and (code or "").lower().startswith("ru"):
        rows.append([InlineKeyboardButton(text=_t(code, "support_tbank"), url=config.SUPPORT_URL)])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def _cancel_keyboard(code: str | None) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=_t(code, "support_cancel"), callback_data="stars:cancel")]])


async def _send_support_invoice(chat_id: int, code: str | None, amount: int) -> None:
    await _bot.send_invoice(
        chat_id=chat_id,
        title=_t(code, "support_title"),
        description=_t(code, "support_desc").format(n=amount),
        payload=f"support:{amount}",
        currency="XTR",  # Telegram Stars: no payment provider, the amount is a number of Stars
        prices=[LabeledPrice(label=_t(code, "support_label"), amount=amount)],
        provider_token="",
    )


@router.message(Command("support"))
async def support_command(message: Message):
    code = message.from_user.language_code
    await message.answer(_t(code, "support_prompt"), reply_markup=_support_keyboard(code))


@router.callback_query(F.data == "support")
async def support_button(cb: CallbackQuery):
    await cb.answer()
    code = cb.from_user.language_code
    await _bot.send_message(cb.from_user.id, _t(code, "support_prompt"), reply_markup=_support_keyboard(code))


@router.callback_query(F.data.startswith("stars:"))
async def support_amount(cb: CallbackQuery):
    await cb.answer()
    code, choice = cb.from_user.language_code, cb.data.split(":", 1)[1]
    if choice == "cancel":
        _awaiting_amount.discard(cb.from_user.id)
        await _bot.send_message(cb.from_user.id, _t(code, "support_cancelled"))
    elif choice == "custom":
        _awaiting_amount.add(cb.from_user.id)
        await _bot.send_message(cb.from_user.id, _t(code, "support_ask").format(max=SUPPORT_MAX), reply_markup=_cancel_keyboard(code))
    elif choice.isdigit() and int(choice) in SUPPORT_PRESETS:
        _awaiting_amount.discard(cb.from_user.id)
        await _send_support_invoice(cb.from_user.id, code, int(choice))


# registered before text_search: while an amount is awaited, the next message is that amount, not a search
@router.message(F.text, lambda m: m.from_user and m.from_user.id in _awaiting_amount)
async def support_custom_amount(message: Message):
    code = message.from_user.language_code
    text = message.text.strip().replace(" ", "").rstrip("⭐")
    if text.startswith("/"):  # a command: stop waiting and let it through next time
        _awaiting_amount.discard(message.from_user.id)
        return
    if not text.isdigit() or not 1 <= int(text) <= SUPPORT_MAX:
        await message.answer(_t(code, "support_bad").format(max=SUPPORT_MAX), reply_markup=_cancel_keyboard(code))
        return
    _awaiting_amount.discard(message.from_user.id)
    await _send_support_invoice(message.chat.id, code, int(text))


# ---------- database backup (owner only; not in the public command list) ----------

async def send_backup(path, silent: bool = True) -> None:
    """Send a backup file to the owner. No owner configured, or a file too big for Telegram: only logged."""
    if not config.ADMIN_ID:
        log.info("backup %s kept on the server only: ADMIN_ID is not set", path.name)
        return
    size = path.stat().st_size
    if size > backup.SEND_LIMIT:
        await _bot.send_message(config.ADMIN_ID, f"Backup {path.name} is {size // 1048576} MB: too big to send, it stays on the server.")
        return
    await _bot.send_document(
        config.ADMIN_ID, FSInputFile(path), disable_notification=silent,
        caption=f"Musique · {path.name.removeprefix('musique-').removesuffix('.db.gz')} · {max(1, size // 1024)} KB",
    )


@router.message(Command("backup"))
async def backup_command(message: Message):
    code = message.from_user.language_code
    if not config.ADMIN_ID:  # the owner has not been named yet: tell whoever asks their own id, to put into .env
        await message.answer(_t(code, "backup_noadmin").format(id=message.from_user.id))
        return
    if message.from_user.id != config.ADMIN_ID:
        return  # nobody else needs to know the command exists
    await message.answer(_t(code, "backup_making"))
    try:
        path = await asyncio.to_thread(backup.create)
        await send_backup(path, silent=False)
    except Exception:
        log.exception("manual backup failed")
        await message.answer(_t(code, "backup_failed"))


@router.pre_checkout_query()
async def support_precheckout(query: PreCheckoutQuery):
    ok = query.currency == "XTR" and query.invoice_payload.startswith("support:")
    await query.answer(ok=ok, error_message=None if ok else "Unknown payment")


@router.message(F.successful_payment)
async def support_paid(message: Message):
    pay = message.successful_payment
    log.info("support received: %s XTR from %s (charge %s)", pay.total_amount, message.from_user.id, pay.telegram_payment_charge_id)
    await message.answer(_t(message.from_user.language_code, "support_thanks").format(n=pay.total_amount))


@router.message(F.text & ~F.text.startswith("/"))
async def text_search(message: Message):
    code = message.from_user.language_code
    status = await message.answer(_t(code, "searching"))
    try:
        tracks = (await music.search(message.text))[:8]
    except Exception:
        log.exception("search failed")
        tracks = []
    if not tracks:  # nothing on YouTube Music: try the other sources
        try:
            tracks = (await music.search_more(message.text))[:8]
        except Exception:
            log.exception("search on other sources failed")
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


async def update_menu_button() -> None:
    """Point the bot's menu button at the Mini App with the current public API address."""
    await _bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Musique", web_app=WebAppInfo(url=config.webapp_url())))
    log.info("Mini App URL: %s", config.webapp_url())


async def setup(bot: Bot) -> None:
    global _bot
    _bot = bot
    await update_menu_button()
    for code in ("ru", "en"):
        lang = None if code == "en" else code
        try:
            await bot.set_my_commands([BotCommand(command="start", description=TEXTS[code]["open"]),
                                       BotCommand(command="support", description=TEXTS[code]["support_cmd"])], language_code=lang)
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
