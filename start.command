#!/bin/bash
# VOID PULSE — 双击启动游戏
cd "$(dirname "$0")"
PORT=8123
if ! lsof -i :$PORT >/dev/null 2>&1; then
  (python3 -m http.server $PORT >/dev/null 2>&1 &)
  sleep 1
fi
open "http://localhost:$PORT/index.html"
