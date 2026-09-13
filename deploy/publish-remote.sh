#!/usr/bin/env bash
# 在本地 WSL 运行的一键发布(2026-09-13 迁移到 bt.apps.pixiantong.com 起,服务器不再编译):
#   本机 dotnet publish + ng build → rsync 到服务器 → 重启 systemd 服务 → 健康检查。
# 服务器上的 appsettings.Production.json 不会被覆盖。
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
HOST=${DEPLOY_SSH_HOST:-root@bt.apps.pixiantong.com}
API_DIR=/www/wwwroot/kanau-api
WEB_DIR=/www/wwwroot/kanau.apps02.pixiantong.com
OUT=$REPO/deploy/.publish-remote
export DOTNET_CLI_TELEMETRY_OPTOUT=1

echo "== backend publish(本机)=="
rm -rf "$OUT/api"
dotnet publish "$REPO/backend/src/Kanau.Api" -c Release -o "$OUT/api" --nologo -v q
rm -f "$OUT"/api/appsettings.Production.json "$OUT"/api/appsettings.Development.json

echo "== frontend build(本机)=="
(cd "$REPO/frontend" && npx ng build --configuration production)
DIST=$(ls -d "$REPO/frontend"/dist/*/browser | head -1)
[ -f "$DIST/index.html" ] || { echo "前端产物不完整($DIST)" >&2; exit 1; }

echo "== rsync → $HOST =="
rsync -az --delete --exclude=appsettings.Production.json "$OUT/api/" "$HOST:$API_DIR/"
rsync -az --delete --exclude=.user.ini "$DIST/" "$HOST:$WEB_DIR/"

echo "== restart =="
ssh "$HOST" 'systemctl restart kanau.service && sleep 3 && systemctl is-active kanau.service && curl -s -o /dev/null -w "api http://127.0.0.1:5106/api/health → %{http_code}\n" http://127.0.0.1:5106/api/health'
