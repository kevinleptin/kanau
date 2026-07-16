#!/bin/bash
# 从 /root/cubby-secrets.env + 宝塔面板数据库生成 appsettings.Production.json
# 用法: ./sync-secrets.sh [目标目录，默认 /www/wwwroot/kanau-api]
set -euo pipefail

TARGET_DIR="${1:-/www/wwwroot/kanau-api}"
SECRETS=/root/cubby-secrets.env
JWT_KEY_FILE=/root/.kanau-jwt-key

[ -f "$SECRETS" ] || { echo "缺少 $SECRETS"; exit 1; }
set -a; source "$SECRETS"; set +a

# 数据库密码（宝塔面板库内为加密存储，明文保存在 cubby-secrets.env）
DB_PASS="${KANAU_DB_PASSWORD:-}"
[ -n "$DB_PASS" ] || { echo "cubby-secrets.env 缺少 KANAU_DB_PASSWORD"; exit 1; }

# JWT 签名密钥：首次生成后持久化
if [ ! -f "$JWT_KEY_FILE" ]; then
  umask 077
  openssl rand -hex 32 > "$JWT_KEY_FILE"
fi
JWT_KEY=$(cat "$JWT_KEY_FILE")

mkdir -p "$TARGET_DIR"
umask 027
cat > "$TARGET_DIR/appsettings.Production.json" <<EOF
{
  "ConnectionStrings": {
    "MySql": "Server=127.0.0.1;Port=3306;Database=kanau;User=kanau;Password=${DB_PASS};CharSet=utf8mb4",
    "Hangfire": "Server=127.0.0.1;Port=3306;Database=kanau;User=kanau;Password=${DB_PASS};CharSet=utf8mb4;Allow User Variables=True"
  },
  "Jwt": {
    "Issuer": "kanau",
    "Audience": "kanau",
    "Key": "${JWT_KEY}",
    "ExpireMinutes": 43200
  },
  "Tencent": {
    "SecretId": "${TENCENT_SECRET_ID}",
    "SecretKey": "${TENCENT_SECRET_KEY}"
  },
  "Cos": {
    "Bucket": "${TENCENT_COS_BUCKET_NAME}",
    "Region": "${TENCENT_COS_REGION}",
    "StsDurationSeconds": 1800
  },
  "Asr": { "Region": "ap-guangzhou", "CallbackUrl": "" },
  "Ocr": { "Region": "ap-guangzhou" },
  "Hunyuan": {
    "Endpoint": "https://tokenhub.tencentmaas.com/v1",
    "ApiKey": "${TOKENHUB_API_KEY}",
    "ModelLite": "hy3-preview",
    "ModelEmbedding": "hunyuan-embedding"
  },
  "DeepSeek": {
    "Endpoint": "https://api.deepseek.com/v1",
    "ApiKey": "${DEEPSEEK_API_KEY}",
    "ModelChat": "deepseek-chat",
    "ModelReasoner": "deepseek-reasoner"
  },
  "Lbs": { "Key": "${TENCENT_LBS_KEY:-}", "SecretKey": "${TENCENT_LBS_SK:-}" },
  "Admin": { "InitialPassword": "${KANAU_ADMIN_PASSWORD:-}" }
}
EOF
chmod 640 "$TARGET_DIR/appsettings.Production.json"
echo "已生成 $TARGET_DIR/appsettings.Production.json"
