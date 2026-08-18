#!/bin/sh
# Official libsodium 1.0.20-RELEASE (same C family as libsodium-wrappers 0.8.x).
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
VERSION="1.0.20"
TARBALL="libsodium-${VERSION}.tar.gz"
URL="https://github.com/jedisct1/libsodium/releases/download/${VERSION}-RELEASE/${TARBALL}"
SHA256="ebb65ef6ca439333c2bb41a0c1990587288da07f6c7fd07cb3a18cc18d30ce19"
DEST="$VENDOR/libsodium"

if [ -f "$DEST/src/libsodium/include/sodium.h" ]; then
  exit 0
fi

mkdir -p "$VENDOR"
TMP="$VENDOR/${TARBALL}"
if [ ! -f "$TMP" ]; then
  curl -fsSL -o "$TMP" "$URL"
fi

ACTUAL="$(shasum -a 256 "$TMP" | awk '{print $1}')"
if [ "$ACTUAL" != "$SHA256" ]; then
  echo "libsodium tarball sha256 mismatch: $ACTUAL" >&2
  exit 1
fi

rm -rf "$DEST" "$VENDOR/libsodium-${VERSION}"
tar -xzf "$TMP" -C "$VENDOR"
mv "$VENDOR/libsodium-${VERSION}" "$DEST"
echo "Fetched official libsodium ${VERSION} to $DEST"
