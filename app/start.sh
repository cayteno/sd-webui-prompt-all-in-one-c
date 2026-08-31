#!/bin/bash
# 宝塔部署启动脚本
cd $(dirname $0)
exec python3 app.py
