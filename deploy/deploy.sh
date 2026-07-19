#!/bin/bash
# 一键部署：发布后端 + 构建前端 + 同步密钥 + 重启服务
set -euo pipefail

REPO=/git/repo/kanau
API_DIR=/www/wwwroot/kanau-api
WEB_DIR=/www/wwwroot/kanau.apps02.pixiantong.com
DOTNET=/www/server/dotnet/10.0.100/dotnet
export PATH="/root/.nvm/versions/node/v24.16.0/bin:$PATH"
export DOTNET_CLI_TELEMETRY_OPTOUT=1

echo "== 发布后端 =="
cd "$REPO/backend"
"$DOTNET" publish src/Kanau.Api -c Release -o /tmp/kanau-api-publish
mkdir -p "$API_DIR"
rsync -a --delete --exclude appsettings.Production.json /tmp/kanau-api-publish/ "$API_DIR/"
rm -rf /tmp/kanau-api-publish

echo "== 同步密钥 =="
bash "$REPO/deploy/sync-secrets.sh" "$API_DIR"

echo "== 构建前端 =="
cd "$REPO/frontend"
npx ng build --configuration production
rsync -a --delete --exclude .user.ini dist/frontend/browser/ "$WEB_DIR/"

echo "== 安装/重启服务 =="
cp "$REPO/deploy/kanau.service" /etc/systemd/system/kanau.service
systemctl daemon-reload
systemctl enable kanau >/dev/null 2>&1 || true
systemctl restart kanau

sleep 3
systemctl is-active kanau && curl -s --noproxy '*' http://127.0.0.1:5100/api/health && echo && echo "== 部署完成 =="
