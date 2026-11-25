#!/usr/bin/env bash
# Throwaway SaveTether setups for the Game Mode harness (qam-check.mjs), run on the Deck as `deck`.
# Everything lives under ~/sttest/decky; the real setup is never touched (SaveTether's
# docs/testing/hardware-testing.md, "Rules").
#
#   deck-scenarios.sh setup        build homes a, b, c and d
#   deck-scenarios.sh showcase     build home s, for the README's screenshot
#   deck-scenarios.sh use <a|b|c|d|s> point the plugin at that home (its settings.json)
#   deck-scenarios.sh real         point the plugin back at the real setup (removes settings.json)
#   deck-scenarios.sh cleanup      the same, unmount d, and remove ~/sttest/decky
set -uo pipefail

cli=$HOME/.local/bin/savetether
root=$HOME/sttest/decky
settings=$HOME/homebrew/settings/SaveTether/settings.json

# Runs the CLI against one scenario's home, refusing any home outside ~/sttest.
st() {
  local home="$root/$1/home"; shift
  case "$home" in "$HOME"/sttest/*) ;; *) echo "home $home is not under ~/sttest" >&2; exit 1;; esac
  SAVETETHER_HOME="$home" "$cli" "$@" > /dev/null || { echo "savetether $* failed" >&2; exit 1; }
}

# Two linked mappings, each with one save file, on the sync folder $2.
linked() {
  local s="$1" sync="$2" saves="$root/$1/saves"
  mkdir -p "$sync" "$saves/ppsspp/GAME1" "$saves/dolphin/GC"
  echo one > "$saves/ppsspp/GAME1/save.bin"
  echo two > "$saves/dolphin/GC/card.raw"
  st "$s" init --sync-root "$sync" --device decky-test --create-root --backup-root "$root/$s/backups"
  st "$s" map add ppsspp.savedata --target ppsspp/SAVEDATA --source "$saves/ppsspp"
  st "$s" map add dolphin.gc --target dolphin/GC --source "$saves/dolphin/GC"
  st "$s" apply ppsspp.savedata --copy --assume-closed
  st "$s" apply dolphin.gc --copy --assume-closed
}

setup() {
  [ -e "$root/a" ] && { echo "$root/a exists: run cleanup first" >&2; exit 1; }
  # (a) all linked
  linked a "$root/a/sync"
  # (b) the save folder holds files again: the link replaced by a real folder
  linked b "$root/b/sync"
  rm "$root/b/saves/ppsspp" && mkdir -p "$root/b/saves/ppsspp" && echo local > "$root/b/saves/ppsspp/new.bin"
  # (c) the shared folder deleted
  linked c "$root/c/sync"
  rm -rf "$root/c/sync/savetether/dolphin"
  # (d) the sync folder on a fuse-overlayfs mount that stopped answering. Started as a user unit: a FUSE
  # process started from SSH is stopped with the session. Killed, the mount says "Transport endpoint is
  # not connected".
  mkdir -p "$root/d/lower" "$root/d/upper" "$root/d/work" "$root/d/mnt"
  systemd-run --user --unit=st-decky-d --collect fuse-overlayfs -f \
    -o "lowerdir=$root/d/lower,upperdir=$root/d/upper,workdir=$root/d/work" "$root/d/mnt" > /dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do mountpoint -q "$root/d/mnt" && break; sleep 0.5; done
  mountpoint -q "$root/d/mnt" || { echo "the overlay did not mount" >&2; exit 1; }
  linked d "$root/d/mnt/sync"
  pkill -9 -x fuse-overlayfs  # shortcut: kills every fuse-overlayfs of `deck`; none other runs on the Deck
  echo "built a, b, c, d in $root"
}

# Several emulators with saves of different sizes, one needing attention: the README's screenshot.
showcase() {
  [ -e "$root/s" ] && { echo "$root/s exists: run cleanup first" >&2; exit 1; }
  local saves="$root/s/saves" sync="$root/s/sync" id kib
  mkdir -p "$sync"
  st s init --sync-root "$sync" --device steamdeck --create-root --backup-root "$root/s/backups"
  for spec in pcsx2.memcards:16384 dolphin.gc:2048 dolphin.wii:6144 duckstation.memcards:256 \
      ppsspp.savedata:3072 ryujinx.saves:9216; do
    id=${spec%%:*} kib=${spec##*:}
    mkdir -p "$saves/$id"
    for n in 1 2 3; do head -c $((kib * 1024 / 3)) /dev/urandom > "$saves/$id/save$n.bin"; done
    st s map add "$id" --target "${id/./\/}" --source "$saves/$id"
    st s apply "$id" --copy --assume-closed
  done
  # PPSSPP's link replaced by a real folder again: one card needing attention.
  rm "$saves/ppsspp.savedata" && mkdir "$saves/ppsspp.savedata" && echo local > "$saves/ppsspp.savedata/new.bin"
  echo "built s in $root"
}

use() {
  case "${1:-}" in a|b|c|d|s) ;; *) echo "use a, b, c, d or s" >&2; exit 1;; esac
  mkdir -p "$(dirname "$settings")"
  printf '{"savetether_home": "%s"}\n' "$root/$1/home" > "$settings"
}

real() { rm -f "$settings"; }

cleanup() {
  real
  fusermount3 -u "$root/d/mnt" 2> /dev/null
  rm -rf "$root"
}

case "${1:-}" in
  setup) setup ;;
  showcase) showcase ;;
  use) use "${2:-}" ;;
  real) real ;;
  cleanup) cleanup ;;
  *) sed -n '5,10p' "$0"; exit 1 ;;
esac
