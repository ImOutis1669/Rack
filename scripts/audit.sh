#!/usr/bin/env sh
# Dependency audit: run before releases. Sends package names/versions to public advisory DBs.
set -e
cd "$(dirname "$0")/.."
(cd backend && uv export --frozen --no-dev --no-hashes --format requirements-txt | grep -v '^-e' > /tmp/rack-reqs.txt \
  && uvx pip-audit --no-deps --disable-pip -r /tmp/rack-reqs.txt)
(cd frontend && npm audit)
