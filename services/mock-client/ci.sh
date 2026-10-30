#!/bin/sh
set -eu
cd "$(dirname "$0")"
npm ci --ignore-scripts
mkdir -p reports
node --test --test-reporter=junit > reports/tests.xml
node src/cli.js --demo --report reports/smoke.json
# 真实后端回归：在CI环境中准备专用机器人、启动Java服务后另行调用 backend-smoke.json。
