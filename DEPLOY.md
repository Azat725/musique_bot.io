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
- **Резервные копии базы** (избранное, плейлисты, история лежат в томе `musique-data`, `/data/musique.db`) делаются сами:
  раз в сутки бот делает целый снимок базы, сжимает его и хранит 14 последних в `/data/backups` (число меняет `BACKUP_KEEP`).
  Копия на том же сервере не спасёт при его потере, поэтому каждая ещё и приходит вам в Telegram. Для этого:
  1. отправьте боту `/backup`: он ответит вашим Telegram id и готовой строкой;
  2. добавьте её в `server/.env` (`ADMIN_ID=123456789`) и перезапустите: `docker compose --env-file server/.env up -d`;
  3. снова `/backup` (только владельцу) делает копию сразу и присылает файл. Ежедневные приходят без звука.
  Файлы на сервере: `docker compose exec musique ls -lh /data/backups`.
- **Восстановление** из копии `musique-….db.gz` (из Telegram или с сервера):
  ```
  gunzip musique-2026-10-30-040000.db.gz
  docker compose stop musique
  docker compose cp ./musique-2026-10-30-040000.db musique:/data/musique.db
  docker compose start musique
  ```
  Копию с сервера на свой компьютер: `docker compose cp musique:/data/backups/<имя>.db.gz .`
- Перенос данных с ноутбука: скопируйте `server/musique.db` на сервер и положите в том командой
  `docker compose cp ./musique.db musique:/data/musique.db` (при остановленном контейнере: `docker compose stop musique`).
- SDK Telegram лежит локально в `docs/vendor/telegram-web-app.js` (telegram.org недоступен в части сетей).
  Обновить раз в несколько месяцев: `curl -o docs/vendor/telegram-web-app.js https://telegram.org/js/telegram-web-app.js`,
  затем повысить `?v=` у этого скрипта в `docs/index.html`.

## Другие источники музыки
Кроме YouTube Music поиск параллельно идёт по Zaycev.net, Bandcamp, Rutube и Internet Archive (код в `server/sources/`).
Их результаты показываются в поиске отдельным блоком «Другие источники». Если YouTube и SoundCloud не отдали трек,
сервер ищет ту же песню на Zaycev и Rutube.
- Выключить источник: в `server/.env` перечислите нужные в `SOURCES=zaycev,bandcamp,jamendo,archive,rutube`.
- Jamendo (свободная музыка по лицензии CC) включится, если положить бесплатный ключ в `JAMENDO_CLIENT_ID`
  (devportal.jamendo.com → My Apps → Client ID).
- У Zaycev.net нет официального API: если сайт поменяется, этот источник просто перестанет находить треки,
  остальной поиск продолжит работать.

## YouTube на сервере
IP дата-центров YouTube часто блокирует («подтвердите, что вы не бот»). Тогда звук идёт с SoundCloud,
как сейчас. Чтобы попробовать YouTube с cookies: положите `server/cookies.txt` и раскомментируйте
строку с `cookies.txt` в `docker-compose.yml`. Если у хостинга IP «чистый», YouTube заработает сам.

## Без ngrok
Если есть свой домен: поставьте перед контейнером Caddy/nginx с HTTPS, задайте `PUBLIC_API_URL=https://ваш.домен`
и `STREAM_BITRATE=0` (быстрый канал, перекодировать не нужно), а сервис `ngrok` из compose удалите.

## Разработка и релизы (ветки dev / main)
`main` — продакшен (то, что видят друзья), напрямую не правим. Работаем так: функция в ветке `feat/<имя>`
(от `dev`) → влить в `dev` → проверить в тестовом боте → релиз в `main`.

**Один раз:** создайте второго бота в BotFather, скопируйте `server/.env.dev.example` в `server/.env.dev`,
впишите `BOT_TOKEN` тестового бота и `VPS_HOST` (адрес VPS). Файл в `.gitignore`.

**Проверка:** `powershell -File dev.ps1`. Поднимает сервер (порт 8001, отдельная база в `server/dev-data`)
и туннель Cloudflare; сервер сам раздаёт `docs/` текущей ветки по адресу `<туннель>/app/`. Откройте тестового
бота и нажмите кнопку меню. Адрес туннеля меняется при каждом запуске — это нормально.
Не запускайте `start.ps1` с боевым токеном, пока работает VPS.

**Релиз:** `powershell -File release.ps1`. Покажет список изменений, спросит подтверждение, вольёт `dev` в `main`,
запушит (GitHub Pages обновится за 1–2 минуты) и обновит сервер по SSH. Откат: `git revert -m 1 <коммит слияния>`
на `main`, пуш и повторное обновление сервера.

Рекомендуется включить защиту `main` на GitHub (Settings → Branches → Branch protection rule).
