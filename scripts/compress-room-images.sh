#!/usr/bin/env bash
# G1~G4 객실 JPEG → 웹용 200~500KB (최대 변 1920px)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN_KB=200
MAX_KB=500
DIMS=(1920 1600 1400 1200)
QUALITIES=(85 80 75 70 65 60 55 50 45 40 35)

total=0
ok=0
warn=0
orig_bytes=0
out_bytes=0

compress_one() {
  local input="$1"
  local output="$2"
  local name
  name="$(basename "$input")"

  local best_q=-1 best_dim=-1 best_kb=-1

  for dim in "${DIMS[@]}"; do
    for q in "${QUALITIES[@]}"; do
      local tmp
      tmp="$(mktemp "${TMPDIR:-/tmp}/grafford-img.XXXXXX")"
      sips -Z "$dim" -s format jpeg -s formatOptions "$q" "$input" --out "$tmp" >/dev/null 2>&1
      local kb=$(( $(stat -f%z "$tmp") / 1024 ))
      rm -f "$tmp"

      if (( kb >= MIN_KB && kb <= MAX_KB )); then
        best_q=$q
        best_dim=$dim
        best_kb=$kb
        sips -Z "$dim" -s format jpeg -s formatOptions "$q" "$input" --out "$output" >/dev/null 2>&1
        echo "  OK  $name  ${dim}px q${q}  ${kb}KB"
        return 0
      fi

      if (( kb <= MAX_KB && kb > best_kb )); then
        best_q=$q
        best_dim=$dim
        best_kb=$kb
      fi
    done
  done

  if (( best_q >= 0 )); then
    sips -Z "$best_dim" -s format jpeg -s formatOptions "$best_q" "$input" --out "$output" >/dev/null 2>&1
    echo "  WARN $name  ${best_dim}px q${best_q}  ${best_kb}KB (below ${MIN_KB}KB target)"
    return 1
  fi

  sips -Z 1200 -s format jpeg -s formatOptions 35 "$input" --out "$output" >/dev/null 2>&1
  best_kb=$(( $(stat -f%z "$output") / 1024 ))
  echo "  WARN $name  fallback 1200px q35  ${best_kb}KB (above ${MAX_KB}KB target)"
  return 1
}

echo "Compressing room images in ${ROOT}/images/G{1,2,3,4} ..."
echo "Target: ${MIN_KB}~${MAX_KB}KB"
echo

for room in G1 G2 G3 G4; do
  dir="${ROOT}/images/${room}"
  [[ -d "$dir" ]] || continue
  count=$(find "$dir" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) | wc -l | tr -d ' ')
  echo "=== ${room} (${count} files) ==="

  while IFS= read -r -d '' file; do
    total=$(( total + 1 ))
    orig_bytes=$(( orig_bytes + $(stat -f%z "$file") ))
    tmp_out="$(mktemp "${TMPDIR:-/tmp}/grafford-out.XXXXXX").jpg"

    if compress_one "$file" "$tmp_out"; then
      ok=$(( ok + 1 ))
    else
      warn=$(( warn + 1 ))
    fi

    mv -f "$tmp_out" "$file"
    out_bytes=$(( out_bytes + $(stat -f%z "$file") ))
  done < <(find "$dir" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) -print0 | sort -z)
  echo
done

orig_mb=$(( orig_bytes / 1024 / 1024 ))
out_mb=$(( out_bytes / 1024 / 1024 ))
saved_mb=$(( orig_mb - out_mb ))
pct=0
if (( orig_bytes > 0 )); then
  pct=$(( (orig_bytes - out_bytes) * 100 / orig_bytes ))
fi

echo "========== SUMMARY =========="
echo "Files processed : ${total}"
echo "Within target   : ${ok}"
echo "Out of range    : ${warn}"
echo "Original size   : ${orig_mb} MB"
echo "Compressed size : ${out_mb} MB"
echo "Saved           : ${saved_mb} MB (${pct}%)"
echo "============================="
