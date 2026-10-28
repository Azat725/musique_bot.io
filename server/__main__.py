import asyncio
import logging

import uvicorn
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties

from . import api, bot, config, db, tunnel


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not config.FFMPEG:
        logging.warning("ffmpeg not found — SoundCloud fallback may fail for HLS tracks")

    await db.init()
    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=config.PORT, log_level="warning"))
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
    api.send_track = bot.send_track
    polling = asyncio.create_task(bot.dp.start_polling(tg, handle_signals=False))
    tasks.add(polling)
    logging.info("API on http://127.0.0.1:%s  public: %s", config.PORT, config.PUBLIC_API_URL or "-")
    try:
        await asyncio.wait({web, polling}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        await bot.dp.stop_polling()
        for task in tasks:
            task.cancel()
        await tg.session.close()
        await db.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
