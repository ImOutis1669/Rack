#!/usr/bin/env bash
# Rack's activity as it happens (docs/server-setup.md section 12): searches, new listings,
# re-ranking, hunts, imports and errors from the worker and API, minus the noise. Ctrl+C to stop.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
since=${1:-15m}

docker compose logs -f --no-log-prefix --since "$since" worker api 2>&1 | awk '
  BEGIN { b = "\033[1m"; d = "\033[2m"; g = "\033[32m"; c = "\033[36m"; m = "\033[35m"; y = "\033[33m"; r = "\033[31m"; n = "\033[0m" }
  /apscheduler|open_clip|huggingface|HF Hub|httpx|GET \/api\/health|Uvicorn running|Waiting for application|Application startup/ { next }
  /"(GET|HEAD) / && !/" [45][0-9][0-9]/ { next }          # successful page loads: too chatty
  {
    line = $0; t = "        "; lvl = ""
    # "2026-11-19 23:01:16,120 INFO rack.worker.hunts message" -> "23:01:16  message"
    if (line ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9:]+,[0-9]+ [A-Z]+ /) {
      split(line, f, " "); t = substr(f[2], 1, 8); lvl = f[3]
      line = substr(line, length(f[1]) + length(f[2]) + length(f[3]) + length(f[4]) + 5)
    } else if (line ~ /^(INFO|WARNING|ERROR): +/) {
      lvl = line; sub(/:.*/, "", lvl); sub(/^[A-Z]+: +/, "", line)
    }
    col = d
    if (lvl == "ERROR" || lvl == "CRITICAL" || line ~ /Traceback|rror:/) col = r
    else if (lvl == "WARNING") col = y
    else if (line ~ /^refresh|manual refresh|live search/) col = c
    else if (line ~ /rescored|embedded/) col = g
    else if (line ~ /^hunt|price drop|alert/) col = m
    else if (line ~ /vinted import|import/) col = y
    else if (line ~ /" [45][0-9][0-9]/) col = y
    printf "%s%s%s  %s%s%s\n", d, t, n, col, line, n
    fflush()
  }'
