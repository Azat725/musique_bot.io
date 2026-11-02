# Checks and releases

Work happens in `dev`. Publishing to `main` remains a separate, explicitly approved release.

## Local checks

Node 24 and Python 3.12+:

```sh
npm ci
npm run check
npm test
python -m unittest discover -s tests/server -v
python -m compileall -q server
npx playwright install chromium
npm run build
npm run test:e2e
```

Browser tests use an isolated profile, a mocked API, blocked external requests and a replaced media `play()` method. They never play music. To use an installed Chrome instead of downloading Chromium, set `PW_CHANNEL=chrome`. To test the exact static artifact locally, set `TEST_DIST=1` before `npm run test:e2e`.

`scripts/check.mjs` checks syntax, local module imports, import-map coverage and the no-gradients rule. `scripts/version.mjs 64` refreshes source module URLs for a future source release. CI replaces asset versions in its artifact with the exact commit hash. Source URLs remain useful for local development.

## GitHub Pages: one-time setup

In repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The workflow preserves `/docs/` and the root redirect. Branch-based publication should be disabled so it cannot bypass checks. In **Settings → Rules → Rulesets**, require the `frontend` and `backend` checks before merging into `main`; this setting is not controlled by workflow YAML.

`Check and publish` runs on pushes to `dev`/`main` and on pull requests. It runs browser and unit tests, validates Python, tests radio request sharing, imports the API and builds the Docker image. Only a successful `main` run can publish Pages. Reports and static artifacts are kept for seven days. Neither production API keys nor SSH credentials are needed by CI.

References: [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Playwright web server](https://playwright.dev/docs/test-webserver).

## VPS: one-time setup

Create a GitHub environment named `production`, restrict its deployment branches to `main` and configure required reviewers if the account plan supports them. Add these environment secrets:

| Secret / variable | Value |
| --- | --- |
| `DEPLOY_HOST` (secret) | VPS hostname or IP |
| `DEPLOY_USER` (secret) | SSH deployment user with access to the checkout and Docker |
| `DEPLOY_KEY` (secret) | Dedicated SSH private key for that user |
| `DEPLOY_KNOWN_HOSTS` (secret) | The server's SSH host key, verified against the hosting console |
| `DEPLOY_DIR` (environment variable) | Absolute checkout path, for example `/root/musique` |

Keep the bot token, cookies and other application secrets in `server/.env` on the VPS. Never paste them into a workflow or commit them. The server must be able to fetch the repository, and have Docker Compose installed. The deploy user's Docker access is privileged; use a dedicated key.

After a successful `main` CI run, use **Actions → Deploy VPS → Run workflow → main**. The workflow refuses a commit without a successful CI run. It verifies the SSH host key, backs up SQLite, builds a uniquely tagged image, restarts only the API/bot service and checks `/api/health`. On failure it restores the previous checkout and image. Playback connections can briefly reconnect during the restart. Caddy and persistent data volumes are retained.

The checkout ends at a detached release commit for reproducibility. Future updates should use this deployment workflow (or `bash scripts/deploy-server.sh <full-main-commit> <absolute-checkout-path>`), rather than `git pull`. The script refuses tracked local modifications. It does not automatically restore the database: restoring a database would discard newer user data. Future destructive schema changes need a separate migration/rollback plan.

Existing `release.ps1` can still merge/push an approved release. Use the GitHub deployment action for the VPS after checks pass.

## Radio data and load limits

Radio is a local playback style, not an external live broadcast. Its normal audio stream uses the existing download/cache gates. Speed and reverb are bypassed. Antenna hiss is generated on the device.

Era selections are resolved from the fixed title/artist/year catalogue in `server/radio.json`. Candidates must match both title and artist; unavailable matches are skipped. Years refer to original songs/recordings, while providers can return reissues. USSR selections after 1991 include Russian artists; this is a continuity category, not a claim that the USSR existed in the 2000s. Japanese title transliteration can reduce matching coverage.

The selection cache is shared for six hours, negative results for 90 seconds; simultaneous requests share one task. At most two radio searches run at once. Tests simulate 300 listeners requesting the same selection and prove single-flight resolution, plus cancellation isolation. They do not prove the production network can stream audio to 300 listeners. Real capacity depends on provider limits, cache hits and VPS bandwidth.

Visual references for original, simplified illustrations: [Sony TR-55 history](https://www.sony.com/en/SonyInfo/CorporateInfo/History/capsule/17/), [SFO Museum radio gallery](https://www.sfomuseum.org/exhibitions/radio/gallery), [Grundig Satellit history](https://www.radiomuseum.org/forum/grundig_satellit_short_history.html), [Toyota AE86 lineage](https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60009032/), [Volkswagen Golf IV](https://www.volkswagen-newsroom.com/en/golf-4-19972003-19476). These are stylisations, not exact manufacturer replicas.
