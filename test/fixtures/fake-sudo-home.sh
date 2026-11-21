#!/bin/sh
# Like fake-sudo.sh, but gives each target user its own CLAUDE_CONFIG_DIR under $FAKE_HOMES.
user=""
while [ $# -gt 0 ]; do
  case "$1" in
    -n|-H) shift ;;
    -u) user="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
export CLAUDE_CONFIG_DIR="$FAKE_HOMES/$user"
exec "$@"
