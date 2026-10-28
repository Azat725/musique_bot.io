import asyncio
import logging

import uvicorn
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties

from . import api, bot, config, db


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not config.FFMPEG:
        logging.warning("ffmpeg not found — SoundCloud fallback may fail for HLS tracks")

    await db.init()
    tg = Bot(config.BOT_TOKEN, default=DefaultBotProperties(parse_mode="HTML"))
    await bot.setup(tg)
    api.send_track = bot.send_track

    server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=config.PORT, log_level="warning"))
    web = asyncio.create_task(server.serve())
    polling = asyncio.create_task(bot.dp.start_polling(tg, handle_signals=False))
    logging.info("API on http://127.0.0.1:%s  public: %s", config.PORT, config.PUBLIC_API_URL or "—")
    try:
        await asyncio.wait({web, polling}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        await bot.dp.stop_polling()
        polling.cancel()
        await tg.session.close()
        await db.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
