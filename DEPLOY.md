# Запуск Musique на VPS (Docker)

Бот, API и Caddy (HTTPS) работают в контейнерах и сами стартуют после перезагрузки сервера. Мини-апп на GitHub
Pages менять не нужно: бот сам прописывает адрес сервера в кнопке меню.

## Что нужно
- VPS с Linux (Ubuntu 22.04/24.04), 1 ГБ ОЗУ и 10 ГБ диска достаточно. Подойдёт любой хостинг.
- Docker: `curl -fsSL https://get.docker.com | sh`

## Шаги
1. **Остановите бота на ноутбуке** (закройте окно `start.bat`): два экземпляра бота будут конфликтовать
   за обновления Telegram.
2. Скопируйте проект на сервер: `git clone https://github.com/Azat725/musique_bot.io.git musique && cd musique`
3. Создайте `server/.env`:
   ```
   BOT_TOKEN=...
   API_DOMAIN=109-66-243-195.sslip.io
   STREAM_BITRATE=64k
   ```
   `API_DOMAIN` — адрес вашего сервера. Свой домен покупать не нужно: у сервиса sslip.io имя из IP
   (точки заменены дефисами) уже указывает на этот IP, например для `109.66.243.195` это
   `109-66-243-195.sslip.io`. Есть свой домен — впишите его (A-запись на IP сервера).
   **Откройте порты 80 и 443** в файрволе хостинга (панель → «Сеть»): через них Caddy получает сертификат.
   Сохраняйте файл с переводами строк LF (на Windows в Блокноте/VS Code выберите LF), иначе к значениям
   добавится невидимый символ `\r`.
4. Запуск: `docker compose --env-file server/.env up -d --build`
5. Проверка: `docker compose logs -f musique` — должно быть «Start polling»; `docker compose logs caddy` —
   «certificate obtained successfully»; и откройте `https://<API_DOMAIN>/api/health` (ответ `{"ok":true}`).

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

## Поддержка автора
Команда `/support` и кнопка «⭐ Поддержать автора» в боте предлагают Звёзды Telegram (суммы и своя сумма). Русскоязычным пользователям рядом показывается ещё кнопка «☕ Угостить чаем в Т-Банке» со ссылкой на перевод. Ссылка личная, поэтому хранится только в `server/.env` на сервере (`SUPPORT_URL=…`), в репозиторий её не кладут; без неё кнопки просто нет. Переводы по ссылке бот не видит, благодарности за них не будет. Звёзды приходят на баланс бота.

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

## Про ngrok
Раньше сервер был за ngrok. На бесплатном тарифе у него есть месячный лимит трафика (ошибка `ERR_NGROK_725`,
«Сервер недоступен» у всех), а музыка — это много трафика, поэтому теперь HTTPS даёт Caddy прямо на сервере.
ngrok остался запасным: `docker compose --env-file server/.env --profile ngrok up -d` (нужны `NGROK_AUTHTOKEN` и
`NGROK_DOMAIN` в `.env`; адрес сервера тогда — `https://<NGROK_DOMAIN>`, если не задан `API_DOMAIN`).

**Переход с ngrok на Caddy:** впишите `API_DOMAIN` в `server/.env`, откройте порты 80 и 443, затем
`git pull && docker compose --env-file server/.env up -d --build` и уберите старый контейнер ngrok:
`docker rm -f musique-ngrok-1`. Кнопка «Открыть Musique» в старых сообщениях бота хранит прежний адрес и перестанет
работать, пользуйтесь кнопкой меню слева от поля ввода (бот обновляет её сам). Звук с вашего домена идёт напрямую,
без скачивания трека целиком.

## Сайт в обычном браузере

Musique открывается и без Telegram: https://azat725.github.io/musique_bot.io/docs/ — сразу как гость (медиатека
хранится в этом браузере). В Настройках → «Аккаунт» → «Войти через Telegram» бот присылает подтверждение, и после
«Войти» на сайте открывается та же медиатека, что в мини-приложении (гостевая переносится в неё).

### Сайт на своём домене
1. Купите домен у любого регистратора.
2. В DNS домена добавьте **A-запись** `@` (или поддомен, например `music`) → `109.66.243.195`. Ждите, пока она
   разойдётся (обычно минуты, иногда до часа): `ping ваш-домен` должен показать этот IP.
3. На сервере допишите домен в `server/.env`:
   ```
   SITE_DOMAIN=ваш-домен
   ```
4. Перезапустите: `cd ~/musique && git pull && docker compose --env-file server/.env up -d`
   Caddy сам получит сертификат, и сайт откроется по `https://ваш-домен` — файлы сайта и API с одного адреса.
5. По желанию: чтобы и мини-приложение открывалось с домена, добавьте в `server/.env`
   `WEBAPP_URL=https://ваш-домен/` и перезапустите — бот сам обновит кнопку меню.

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
