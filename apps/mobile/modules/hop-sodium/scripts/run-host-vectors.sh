#!/bin/sh
# Compile official libsodium 1.0.20 (portable C) + hop_sodium.c and run NaCl box vectors.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
sh "$ROOT/scripts/fetch-libsodium.sh"

SODIUM_SRC="$ROOT/vendor/libsodium/src/libsodium"
OUT="${TMPDIR:-/tmp}/hop-sodium-host-vectors"
SOURCES="$(mktemp)"
trap 'rm -f "$SOURCES"' EXIT

find "$SODIUM_SRC" -name '*.c' \
  | grep -v -E '/(aesni|avx2|avx512f|sse2|sse41|ssse3|xmm6|xmm6int|dolbeau|sandy2x|armcrypto|randombytes/internal)/' \
  | grep -v -E '(aesni|armcrypto|avx2|ssse3|sse41|avx512f)\.c$' \
  > "$SOURCES"

# macOS cc needs -DHAVE_SAFE_ARC4RANDOM; Linux uses getrandom/urandom.
EXTRA_DEFS="-DHAVE_PTHREAD=1 -DHAVE_POSIX_MEMALIGN=1 -DHAVE_WEAK_SYMBOLS=1 -DHAVE_INLINE_ASM=1 -DHAVE_NANOSLEEP=1 -DHAVE_SYS_MMAN_H=1 -DHAVE_MMAP=1 -DHAVE_MPROTECT=1 -DHAVE_SYSCONF=1 -DHAVE_RAISE=1"
if [ "$(uname -s)" = "Darwin" ]; then
  EXTRA_DEFS="$EXTRA_DEFS -DHAVE_SAFE_ARC4RANDOM=1 -DHAVE_MEMSET_S=1"
else
  EXTRA_DEFS="$EXTRA_DEFS -DHAVE_GETRANDOM=1 -DHAVE_SYS_RANDOM_H=1"
fi

# shellcheck disable=SC2086
cc -std=c99 -O2 -pthread \
  -DCONFIGURED=1 -DSODIUM_STATIC=1 -DNATIVE_LITTLE_ENDIAN=1 \
  $EXTRA_DEFS \
  -I "$ROOT/include" \
  -I "$ROOT/include/sodium" \
  -I "$ROOT/cpp" \
  -I "$SODIUM_SRC/include" \
  -I "$SODIUM_SRC/include/sodium" \
  -o "$OUT" \
  "$ROOT/cpp/hop_sodium.c" \
  "$ROOT/tests/host_vectors.c" \
  $(cat "$SOURCES")
"$OUT"
