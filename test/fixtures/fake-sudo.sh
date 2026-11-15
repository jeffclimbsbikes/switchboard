#!/bin/sh
[ -n "$FAKE_SUDO_LOG" ] && echo "$*" >> "$FAKE_SUDO_LOG"
while [ $# -gt 0 ]; do
  case "$1" in
    -n|-H) shift ;;
    -u) shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
