#!/usr/bin/env bash
set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$(dirname "$0")/.."
LOG=/tmp/openweb-server.log
PIDFILE=.server.pid

if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE")
  if kill -0 "$OLD" 2>/dev/null; then
    echo "server already running (PID $OLD)"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

setsid nohup node server/src/index.js > "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
echo "openweb server started (PID $(cat "$PIDFILE"))"
echo "log: $LOG"
sleep 2
tail -5 "$LOG" 2>/dev/null || true