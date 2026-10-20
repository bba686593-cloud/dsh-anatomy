#!/usr/bin/env bash
# 用系统浏览器打开统一的三维画板；服务由插件管理并持续运行。
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ $# -gt 0 && "$1" != -* ]]; then
  project="$1"
  shift
  exec python3 -u "$here/app.py" --project "$project" "$@"
fi
exec python3 -u "$here/app.py" "$@"
