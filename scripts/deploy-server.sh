#!/usr/bin/env bash
set -Eeuo pipefail
release=${1:?Pass the exact release commit}
directory=${2:?Pass the absolute repository path}
[[ "$release" =~ ^[0-9a-f]{40}$ ]] && [[ "$directory" == /* ]]
cd "$directory"
test -z "$(git status --porcelain --untracked-files=no)" || { echo 'Tracked files have local changes; deployment stopped.'; exit 1; }
git fetch origin main
git merge-base --is-ancestor "$release" origin/main
previous=$(git rev-parse HEAD)
compose=(docker compose --env-file server/.env)
container=$("${compose[@]}" ps -q musique)
rollback_image=''
if [[ -n "$container" ]]; then
  old_image=$(docker inspect --format '{{.Image}}' "$container")
  rollback_image="musique-api:rollback-${previous:0:12}"
  docker tag "$old_image" "$rollback_image"
  "${compose[@]}" exec -T musique python -c 'import sqlite3,time; from pathlib import Path; p=Path("/data/backups"); p.mkdir(exist_ok=True); src=sqlite3.connect("/data/musique.db"); dst=sqlite3.connect(p/("predeploy-"+str(int(time.time()))+".db")); src.backup(dst); dst.close(); src.close()'
fi
rollback() {
  trap - ERR
  echo 'Release failed; restoring previous code and image.'
  git checkout --detach "$previous"
  if [[ -n "$rollback_image" ]]; then MUSIQUE_IMAGE="$rollback_image" "${compose[@]}" up -d --no-build musique; fi
  exit 1
}
trap rollback ERR
git checkout --detach "$release"
export MUSIQUE_IMAGE="musique-api:${release:0:12}"
"${compose[@]}" build musique
"${compose[@]}" up -d --no-build musique
healthy=false
for attempt in $(seq 1 30); do
  if "${compose[@]}" exec -T musique python -c 'import urllib.request; assert urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=3).status == 200'; then healthy=true; break; fi
  sleep 2
done
[[ "$healthy" == true ]]
echo "Healthy release: $release"
