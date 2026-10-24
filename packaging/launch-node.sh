#!/bin/sh
# Windows resolves this same extensionless path to the adjacent node.exe.
set -eu
runtime_dir=$(CDPATH= cd -P "$(/usr/bin/dirname "$0")" && pwd -P)
if [ "$(/usr/bin/uname -s)" != Darwin ]; then
  printf '%s\n' 'SessionTree supports Windows x64 and macOS arm64/x64.' >&2
  exit 64
fi
case "$(/usr/bin/uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) printf '%s\n' 'Unsupported macOS architecture.' >&2; exit 64 ;;
esac
{
  IFS= read -r archive
  IFS= read -r archive_sha
  IFS= read -r binary_sha
  IFS= read -r prefix
} < "$runtime_dir/darwin-$arch.meta"
: "${PLUGIN_DATA:?The host must provide PLUGIN_DATA}"
cache_root="$PLUGIN_DATA/runtime-cache"
cache="$cache_root/$prefix-$binary_sha"
node="$cache/bin/node"
checksum() {
  result=$(/usr/bin/shasum -a 256 "$1")
  printf '%s' "${result%% *}"
}
ready() { [ -x "$node" ] && [ "$(checksum "$node")" = "$binary_sha" ]; }
if ready; then exec "$node" "$@"; fi
/bin/mkdir -p "$cache_root"
lock="$cache.lock"
attempt=0
until /bin/mkdir "$lock" 2>/dev/null; do
  if ready; then exec "$node" "$@"; fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 240 ]; then
    printf '%s\n' 'Timed out preparing the bundled Node.js runtime.' >&2
    exit 75
  fi
  /bin/sleep .25
done
trap '/bin/rmdir "$lock" 2>/dev/null || :' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
if ! ready; then
  if [ "$(checksum "$runtime_dir/$archive")" != "$archive_sha" ]; then
    printf '%s\n' 'Bundled runtime archive checksum mismatch.' >&2
    exit 65
  fi
  temporary=$(/usr/bin/mktemp -d "$cache_root/.unpack-XXXXXX")
  /usr/bin/tar -xf "$runtime_dir/$archive" -C "$temporary" "$prefix/bin/node" "$prefix/LICENSE"
  if [ "$(checksum "$temporary/$prefix/bin/node")" != "$binary_sha" ]; then
    printf '%s\n' 'Extracted runtime checksum mismatch.' >&2
    exit 65
  fi
  /bin/chmod 755 "$temporary/$prefix/bin/node"
  if [ -e "$cache" ]; then /bin/mv "$cache" "$cache.invalid.$$"; fi
  /bin/mv "$temporary/$prefix" "$cache"
  /bin/rmdir "$temporary"
fi
/bin/rmdir "$lock"
trap - EXIT INT TERM HUP
exec "$node" "$@"
