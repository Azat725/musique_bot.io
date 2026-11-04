import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

import uvicorn
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties

from . import api, backup, bot, config, db, metrics, music, radio, tunnel


class _Errors(logging.Handler):
    """Keeps the last few error lines (short, no traces) for the owner's /status."""

    def emit(self, record):
        if record.levelno >= logging.ERROR:
            metrics.error(f"{record.name}: {record.getMessage()}")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger().addHandler(_Errors())
    if not config.FFMPEG:
        logging.warning("ffmpeg not found — SoundCloud fallback may fail for HLS tracks")

    # asyncio.to_thread is shared by encoders, lyrics, database backups and the cache tidy-up: room for all of them
    asyncio.get_running_loop().set_default_executor(ThreadPoolExecutor(32))
    music.start_workers()
    await db.init()
    await asyncio.to_thread(music.index_cache)
    server = uvicorn.Server(uvicorn.Config(api.app, host=config.HOST, port=config.PORT, log_level="warning",
                                           backlog=4096, timeout_keep_alive=20))
    web = asyncio.create_task(server.serve())
    tasks = {web}

    tg = Bot(config.BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    ready = asyncio.Event()
    if config.TUNNEL == "ssh":
        async def on_url(url: str) -> None:
            config.PUBLIC_API_URL = url
            if ready.is_set():
                await bot.update_menu_button()
            ready.set()

        tasks.add(asyncio.create_task(tunnel.run(on_url)))
        try:
            await asyncio.wait_for(ready.wait(), 60)
        except TimeoutError:
            logging.error("tunnel did not come up in 60 s — the Mini App will not reach this server yet")
    ready.set()

    await bot.setup(tg)
    api.send_track = bot.send_track  # until here /api/send answers "not ready" (503)
    polling = asyncio.create_task(bot.dp.start_polling(tg, handle_signals=False))
    tasks.add(polling)
    tasks.add(asyncio.create_task(backup.run_daily(bot.send_backup)))
    tasks.add(asyncio.create_task(bot.watch_health()))  # warns the owner (ADMIN_ID) when something goes wrong
    tasks.add(asyncio.create_task(radio.warm()))  # the stations' songs into the cache, slowly, in the background
    logging.info("API on http://127.0.0.1:%s  public: %s", config.PORT, config.PUBLIC_API_URL or "-")
    try:
        await asyncio.wait({web, polling}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        await bot.dp.stop_polling()
        for task in tasks:
            task.cancel()
        await tg.session.close()
        await db.close()
        music.stop_workers()


if __name__ == "__main__":
    try:
        try:
            import uvloop  # Linux (the VPS): a faster event loop; elsewhere the standard one
            uvloop.install()
        except ImportError:
            pass
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
