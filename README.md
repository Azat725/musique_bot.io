# Musique

Telegram-бот с Mini App для прослушивания музыки. Поиск по YouTube Music, воспроизведение с YouTube
(с автоматическим фолбэком на SoundCloud), избранное, плейлисты, история и полноэкранный плеер-винил.

- **Mini App** — `docs/`, статический сайт на GitHub Pages: https://azat725.github.io/musique_bot.io/docs/
- **Сервер** — `server/`: бот (aiogram) + API (FastAPI) в одном процессе, запускается на вашем ПК
  и публикуется наружу через бесплатный Cloudflare Tunnel.

## Запуск

1. Скопируйте `server/.env.example` в `server/.env` и впишите `BOT_TOKEN`.
2. Дважды кликните `start.bat` (или `powershell -File start.ps1`).

Скрипт сам создаст виртуальное окружение (Python 3.12), поставит зависимости, `cloudflared` и `ffmpeg`,
поднимет туннель и обновит кнопку меню бота на адрес с новым туннелем. Пока окно открыто — бот работает.

> Адрес quick-туннеля меняется при каждом запуске. Кнопка меню бота обновляется автоматически;
> кнопки в старых сообщениях ведут на старый адрес — откройте приложение через меню или отправьте `/start`.

## YouTube и cookies

YouTube иногда требует «подтвердить, что вы не бот». Тогда трек берётся с SoundCloud (дольше стартует,
подходит не для всех треков). Чтобы YouTube работал стабильно, положите `server/cookies.txt`
(формат Netscape, экспорт из браузера расширением вроде «Get cookies.txt LOCALLY»). Лучше использовать
отдельный аккаунт Google — cookies дают доступ к аккаунту, не публикуйте этот файл (он в `.gitignore`).

## Структура

```
server/   config, auth (проверка initData), music (поиск/источники), api, bot, db (SQLite)
docs/     index.html, css/, js/ (app, player, vinyl, views/), assets/sfx/
```

Звуки пластинки — Mixkit (Mixkit Sound Effects Free License).
