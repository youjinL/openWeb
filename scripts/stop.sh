#!/usr/bin/env bash
cd "$(dirname "$0")/.."
PIDFILE=.server.pid
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null
    echo "stopped server (PID $PID)"
  else
    echo "no running server (stale pidfile)"
  fi
  rm -f "$PIDFILE"
else
  echo "no pidfile found"
fi