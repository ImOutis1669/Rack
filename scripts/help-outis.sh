#!/usr/bin/env bash
# help-outis: the server command reference (docs/server-commands.md), formatted for the terminal.
#   help-outis            everything (scroll with the arrow keys or space, q to quit)
#   help-outis backups    only the sections whose title contains "backups"
#   help-outis --list     the section titles
set -uo pipefail
doc="$(dirname "$0")/../docs/server-commands.md"
[[ -f $doc ]] || { echo "Can't find $doc (is ~/rack up to date? git pull)"; exit 1; }

topic=${1:-}
if [[ $topic == --list || $topic == -l ]]; then
  grep '^## ' "$doc" | sed 's/^## /  /'
  exit 0
fi

render() {
  awk -v topic="$(printf '%s' "$topic" | tr '[:upper:]' '[:lower:]')" '
    BEGIN {
      B = "\033[1m"; D = "\033[2m"; C = "\033[36m"; Y = "\033[33m"; G = "\033[32m"; N = "\033[0m"
      show = (topic == ""); intro = 1
    }
    function inline(s) {
      gsub(/\\\|/, "|", s)
      while (match(s, /`[^`]+`/)) s = substr(s, 1, RSTART - 1) Y substr(s, RSTART + 1, RLENGTH - 2) N substr(s, RSTART + RLENGTH)
      while (match(s, /\*\*[^*]+\*\*/)) s = substr(s, 1, RSTART - 1) B substr(s, RSTART + 2, RLENGTH - 4) N substr(s, RSTART + RLENGTH)
      return s
    }
    /^# / { if (topic == "") { print B substr($0, 3) N; print "" } next }
    /^## / {
      intro = 0
      t = substr($0, 4)
      show = (topic == "" || index(tolower(t), topic) > 0)
      if (show) { print ""; print B C "━━ " t " ━━" N }
      next
    }
    !show { next }
    intro && topic != "" { next }
    /^---$/ { next }
    /^### / { print B substr($0, 5) N; next }
    /^```/ { fence = !fence; next }
    fence { print "    " G $0 N; next }
    /^\|[-| ]+\|$/ { next }                                   # table divider
    /^\|/ {
      row = $0; gsub(/\\\|/, "\001", row)                       # keep escaped pipes inside cells
      n = split(row, cell, "|")
      a = cell[2]; c = cell[3]; gsub(/^ +| +$/, "", a); gsub(/^ +| +$/, "", c)
      gsub(/\001/, "\\|", a); gsub(/\001/, "\\|", c)
      if (a == "Do this" || a == "Symptom") next                 # table header
      print "  " inline(a)
      print "      " inline(c)
      next
    }
    { print inline($0) }
  ' "$doc" | cat -s
}

if [[ -t 1 ]]; then
  render | less -RFX
else
  render
fi
