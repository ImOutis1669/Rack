#!/usr/bin/env bash
# Rack server backup (docs/server-setup.md section 10). Run nightly from cron.
# Database every run; photos (the rack_data volume, without the CLIP model) on Sundays.
# Keeps 14 days in ~/rack/backups.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p backups
stamp=$(date +%F)

docker compose exec -T db pg_dump -U "${POSTGRES_USER:-rack}" -Fc "${POSTGRES_DB:-rack}" > "backups/rack-$stamp.dump.part"
mv "backups/rack-$stamp.dump.part" "backups/rack-$stamp.dump"
echo "$(date '+%F %T') database: backups/rack-$stamp.dump ($(du -h "backups/rack-$stamp.dump" | cut -f1))"

if [ "$(date +%u)" = 7 ] || [ "${1:-}" = "--photos" ]; then
  docker run --rm -v rack_rack_data:/data:ro -v "$PWD/backups:/backup" alpine \
    tar czf "/backup/rack-data-$stamp.tgz" --exclude=./hf -C /data .
  echo "$(date '+%F %T') photos: backups/rack-data-$stamp.tgz"
fi

find backups -maxdepth 1 \( -name 'rack-*.dump' -o -name 'rack-data-*.tgz' \) -mtime +14 -delete
