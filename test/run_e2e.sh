#!/bin/bash
cd "$(dirname "$0")/.."
pkill -f "node test/server.js" 2>/dev/null; sleep 0.5
FAKE_AI=1 node test/server.js > /tmp/gas_server.log 2>&1 &
sleep 1.5
timeout 300 python3 test/e2e.py "${1:-/tmp/img2/}"
