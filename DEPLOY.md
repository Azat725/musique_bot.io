# Запуск Musique на VPS (Docker)

Бот, API и ngrok работают в контейнерах и сами стартуют после перезагрузки сервера. Адрес остаётся
тем же (`NGROK_DOMAIN`), мини-апп на GitHub Pages менять не нужно.

## Что нужно
- VPS с Linux (Ubuntu 22.04/24.04), 1 ГБ ОЗУ и 10 ГБ диска достаточно. Подойдёт любой хостинг.
- Docker: `curl -fsSL https://get.docker.com | sh`

## Шаги
1. **Остановите бота на ноутбуке** (закройте окно `start.bat`). Один и тот же ngrok-домен нельзя
   запустить в двух местах, а два экземпляра бота будут конфликтовать за обновления Telegram.
2. Скопируйте проект на сервер: `git clone https://github.com/Azat725/musique_bot.io.git musique && cd musique`
3. Создайте `server/.env`:
   ```
   BOT_TOKEN=...
   NGROK_AUTHTOKEN=...
   NGROK_DOMAIN=recliner-elated-humility.ngrok-free.dev
   STREAM_BITRATE=64k
   ```
   Сохраняйте файл с переводами строк LF (на Windows в Блокноте/VS Code выберите LF), иначе к значениям
   добавится невидимый символ `\r`.
4. Запуск: `docker compose --env-file server/.env up -d --build`
5. Проверка: `docker compose logs -f musique` — должно быть «Start polling», и откройте
   `https://<NGROK_DOMAIN>/api/health` (ответ `{"ok":true}`; ngrok может показать страницу
   предупреждения — нажмите Visit Site).

## Обслуживание
- Логи: `docker compose logs -f`
- Перезапуск: `docker compose restart`
- Обновление кода: `git pull && docker compose --env-file server/.env up -d --build`
- Базу (избранное, плейлисты) хранит том `musique-data` (`/data/musique.db`). Копия:
  `docker compose cp musique:/data/musique.db ./musique-backup.db`
- Перенос данных с ноутбука: скопируйте `server/musique.db` на сервер и положите в том командой
  `docker compose cp ./musique.db musique:/data/musique.db` (при остановленном контейнере: `docker compose stop musique`).
- SDK Telegram лежит локально в `docs/vendor/telegram-web-app.js` (telegram.org недоступен в части сетей).
  Обновить раз в несколько месяцев: `curl -o docs/vendor/telegram-web-app.js https://telegram.org/js/telegram-web-app.js`,
  затем повысить `?v=` у этого скрипта в `docs/index.html`.

## YouTube на сервере
IP дата-центров YouTube часто блокирует («подтвердите, что вы не бот»). Тогда звук идёт с SoundCloud,
как сейчас. Чтобы попробовать YouTube с cookies: положите `server/cookies.txt` и раскомментируйте
строку с `cookies.txt` в `docker-compose.yml`. Если у хостинга IP «чистый», YouTube заработает сам.

## Без ngrok
Если есть свой домен: поставьте перед контейнером Caddy/nginx с HTTPS, задайте `PUBLIC_API_URL=https://ваш.домен`
и `STREAM_BITRATE=0` (быстрый канал, перекодировать не нужно), а сервис `ngrok` из compose удалите.
