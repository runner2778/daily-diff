#!/usr/bin/env bash
# 每日信息差 · 启动
# key 放在同目录的 .env 里（这个文件不会被打包发布）
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi
python3 serve.py
