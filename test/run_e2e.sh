#!/bin/bash
cd "$(dirname "$0")/.."
pkill -f "node test/server.js" 2>/dev/null; sleep 0.5
STATIC="$STATIC" FAKE_AI=1 node test/server.js > /tmp/gas_server.log 2>&1 &
sleep 1.5
if [ -n "$STATIC" ]; then pkill -f "http.server 8091"; (cd docs; python3 -m http.server 8091 >/dev/null 2>&1 &); sleep 0.5; fi
timeout 300 python3 test/e2e.py "${1:-/tmp/img2/}"
