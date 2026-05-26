#!/usr/bin/env bash
# Fetches full store lists from Hammerson centres via their /api/search POST
# endpoint, writes to /tmp/centre-NN.txt. The locale is centre-scoped — we
# query /api/config first to discover it.

set -u

fetch_centre() {
  local idx="$1" name="$2" host="$3"
  local padded
  printf -v padded "%02d" "$idx"

  local locale total page=1 out
  locale=$(curl -sL -A "Mozilla/5.0" "https://$host/api/config" | grep -oE '"locale":"[^"]+"' | head -1 | cut -d'"' -f4)
  if [ -z "$locale" ]; then
    echo "[$idx $name] no locale for $host"
    return 1
  fi
  out="/tmp/centre-${padded}.txt"
  echo "# $name (Hammerson)" > "$out"
  echo "# source: https://$host/api/search (locale=$locale)" >> "$out"
  local all=""
  while :; do
    local resp
    resp=$(curl -s -A "Mozilla/5.0" -X POST -H "Content-Type: application/json" \
      -d "{\"page\":$page,\"type\":\"shop\",\"per_page\":100,\"locale\":\"$locale\"}" \
      "https://$host/api/search")
    if [ -z "$resp" ] || echo "$resp" | grep -q '"isError":true'; then
      echo "[$idx $name] page $page failed"
      break
    fi
    local names
    names=$(echo "$resp" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for h in d.get('hits', []):
    n = h.get('document', {}).get('name')
    if n: print(n)
")
    if [ -z "$names" ]; then break; fi
    all="${all}${names}"$'\n'
    total=$(echo "$resp" | grep -oE '"total_pages":[0-9]+' | head -1 | cut -d: -f2)
    if [ -z "$total" ] || [ "$page" -ge "$total" ]; then break; fi
    page=$((page+1))
  done
  local count
  echo "$all" | sed '/^$/d' | sort -u > "/tmp/_names_${padded}"
  count=$(wc -l < "/tmp/_names_${padded}")
  echo "# count: $count" >> "$out"
  cat "/tmp/_names_${padded}" >> "$out"
  rm -f "/tmp/_names_${padded}"
  echo "[$idx $name] $count names"
}

# Hammerson centres (idx, name, host)
fetch_centre 1  "Westquay"      "www.westquay.co.uk"
fetch_centre 8  "Bullring"      "www.bullring.co.uk"
fetch_centre 12 "Cabot Circus"  "www.cabotcircus.co.uk"
fetch_centre 14 "Brent Cross"   "www.brentcross.co.uk"
fetch_centre 17 "The Oracle"    "www.theoracle.com"
