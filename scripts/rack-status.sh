#!/usr/bin/env bash
# Rack at a glance, for the server's terminal (docs/server-setup.md section 12).
# Shown when you log in over SSH, and any time with `rack-status`.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

b=$'\e[1m'; d=$'\e[2m'; g=$'\e[32m'; r=$'\e[31m'; y=$'\e[33m'; n=$'\e[0m'

state() {  # "running" / "healthy" / "missing" for one compose service
  docker compose ps --format '{{.Service}} {{.State}} {{.Health}}' 2>/dev/null |
    awk -v s="$1" '$1 == s { print ($3 != "" ? $3 : $2); f = 1 } END { if (!f) print "missing" }'
}
api=$(state api); worker=$(state worker); db=$(state db)
if [[ $api == healthy && $worker == running && $db == healthy ]]; then
  echo "${b}Rack${n}  ${g}● running${n}  ${d}api $api · worker $worker · db $db${n}"
else
  echo "${b}Rack${n}  ${r}● needs a look${n}  api $api · worker $worker · db $db  ${d}(cd ~/rack && docker compose ps)${n}"
fi
[[ $db == healthy ]] || exit 0

# One query: key|value lines, all times in the server's timezone.
rows=$(docker compose exec -T db psql -U "${POSTGRES_USER:-rack}" -d "${POSTGRES_DB:-rack}" -At -F'|' 2>/dev/null <<'SQL'
SET TIME ZONE 'Europe/London';
WITH owner AS (SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1)
SELECT 'listings', count(*)::text, (count(*) FILTER (WHERE active))::text,
       (count(*) FILTER (WHERE first_seen_at > date_trunc('day', now())))::text,
       (count(*) FILTER (WHERE first_seen_at > now() - interval '1 hour'))::text
  FROM listings
UNION ALL
SELECT 'refresh', to_char((value->>'at')::timestamptz, 'HH24:MI'),
       to_char((value->>'at')::timestamptz + interval '30 minutes', 'HH24:MI'),
       coalesce(value->'results'->>'ebay', '-') || ' eBay · ' || coalesce(value->'results'->>'vinted', '-')
         || ' Vinted · ' || coalesce(value->'results'->>'grailed', '-') || ' Grailed',
       CASE WHEN (value->>'running')::boolean THEN 'searching now' ELSE '' END
  FROM app_state WHERE key = 'refresh'
UNION ALL
SELECT 'source', source,
       CASE WHEN NOT configured THEN 'off' WHEN blocked THEN 'blocked'
            WHEN last_error_at > coalesce(last_success_at, 'epoch') THEN 'error' ELSE 'ok' END,
       coalesce(to_char(last_success_at, 'HH24:MI'), 'never'), left(coalesce(last_error, ''), 70)
  FROM source_health
UNION ALL
SELECT 'feed', coalesce(to_char((s.value->>'at')::timestamptz, 'HH24:MI'), '-'),
       (SELECT count(*) FROM saved, owner WHERE saved.user_id = owner.id)::text,
       (SELECT count(*) FROM feedback, owner WHERE feedback.user_id = owner.id AND value > 0)::text, ''
  FROM owner LEFT JOIN user_state s ON s.user_id = owner.id AND s.key = 'scoring'
UNION ALL
SELECT 'import', coalesce(jsonb_array_length(value->'queue'), 0)::text,
       coalesce(value->>'added', '0'), coalesce(value->>'missing', '0'), coalesce(value->>'error', '')
  FROM user_state WHERE key = 'vinted_import' AND jsonb_array_length(coalesce(value->'queue', '[]')) > 0;
SQL
)
sources=''; problems=''
while IFS='|' read -r kind a c e f; do
  [[ $kind == SET ]] && continue
  case $kind in
    listings) printf '%-10s %s · %s for sale %s· %s new today · %s in the last hour%s\n' \
      "Listings" "$a" "$c" "$d" "$e" "$f" "$n" ;;
    refresh) printf '%-10s last %s %s(%s)%s · next ~%s %s\n' "Searches" "$a" "$d" "$e" "$n" "$c" "${f:+${y}$f${n}}" ;;
    source)
      case $c in ok) mark="${g}✓${n}" ;; off) mark="${d}off${n}" ;; *) mark="${r}✗ $c${n}" ;; esac
      sources+="$a $mark ${d}$e${n}  "
      [[ $c == error || $c == blocked ]] && problems+="           ${r}$a: $f${n}"$'\n' ;;
    feed) printf '%-10s re-ranked %s · %s saved · %s liked\n' "Your feed" "$a" "$c" "$e" ;;
    import) printf '%-10s %s%s still to fetch%s · %s added · %s gone · ~%s min left %s\n' "Vinted" "$y" "$a" "$n" "$c" "$e" \
      "$(( (a * 10 + 59) / 60 ))" "${f:+${r}$f${n}}" ;;
  esac
done <<< "$rows"
[[ -n ${sources:-} ]] && printf '%-10s %s\n' "Sites" "$sources"
printf '%s' "${problems:-}"

last=$(ls -t backups/rack-*.dump 2>/dev/null | grep -v before-update | head -1)
if [[ -n $last ]]; then
  printf '%-10s %s %s(%s, %s)%s · next 03:30\n' "Backup" "$(basename "$last")" "$d" \
    "$(du -h "$last" | cut -f1)" "$(date -r "$last" '+%a %H:%M')" "$n"
else
  printf '%-10s %snone yet%s\n' "Backup" "$y" "$n"
fi
temp=$(cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -n | tail -1)
printf '%-10s %sload %s · memory %s · disk %s%s%s\n' "Server" "$d" \
  "$(cut -d' ' -f1 /proc/loadavg)" "$(free | awk '/Mem:/ {printf "%d%%", $3 / $2 * 100}')" \
  "$(df -h / | awk 'NR == 2 {print $5}')" "${temp:+ · $((temp / 1000))°C}" "$n"
echo "${d}Live activity: rack-live · this summary: rack-status · every command: help-outis${n}"
