# 圆梦笔记 (kanau) — 项目说明

基于熊谷正寿《记事本圆梦计划》方法论的私人家庭 App：梦想笔记本 / 行动笔记本 / 思考笔记本三合一 + AI 教练（拆解、回顾、修正）。仅供开发者本人及孩子使用。

## 架构
- `backend/` — ASP.NET Core Web API（net10.0，运行于 /www/server/dotnet/10.0.100），分层：Api / Application / Domain / Infrastructure
  - EF Core 9 + Pomelo 9（MySQL 5.7，ServerVersion 显式 5.7.44，禁用 8.0 特性，索引字符串列 ≤191）
  - Identity + JWT（账号密码，无第三方登录）；Hangfire（MySQL 存储，表前缀 hangfire_）；SignalR `/hubs/capture`
  - 统一捕获管线 `CapturePipeline`：text/audio/image/video → COS 直传 → ASR/OCR 提取 → LLM 修正 → 打标/Embedding → ready（SignalR 推送）
  - `IAiGateway` 路由：修正/打标/Embedding→混元(腾讯云 SDK)；SMART 化/拆解/回顾→DeepSeek（失败降级混元，标记 degraded）；prompt 在 `Infrastructure/Ai/Prompts/`
- `frontend/` — Angular 21 PWA（standalone + signals），ng-zorro-antd 21、ngx-echarts、@microsoft/signalr、cos-js-sdk-v5；移动端底部 Tab 布局
- `deploy/` — `deploy.sh`（一键发布）、`sync-secrets.sh`（从 /root/cubby-secrets.env + 宝塔面板库生成 appsettings.Production.json）、`kanau.service`（systemd）

## 部署（本机生产）
- 域名 `kanau.apps03.pixiantong.com`，Nginx vhost `/www/server/panel/vhost/nginx/kanau.apps03.pixiantong.com.conf`
  - 静态前端根 `/www/wwwroot/kanau.apps03.pixiantong.com`；`/api/`、`/hubs/`（WebSocket）反代 `127.0.0.1:5100`
  - PWA 关键文件（ngsw-worker.js/ngsw.json/manifest/index.html）no-cache
- 后端 systemd 服务 `kanau`，发布目录 `/www/wwwroot/kanau-api`，端口 **5100**
- MySQL 库 `kanau`/用户 `kanau`（宝塔管理，密码在面板 data/db/database.db）；JWT 密钥 `/root/.kanau-jwt-key`
- SSL：Let's Encrypt (acme.sh)，证书在 `/www/server/panel/vhost/cert/<域名>/`，由全局 `renew-bt-ssl.sh` 每日自动续签
- 全量部署：`bash deploy/deploy.sh`

## 常用命令
- 后端构建：`cd backend && /www/server/dotnet/10.0.100/dotnet build Kanau.slnx`
- EF 迁移：`dotnet ef migrations add <Name> -p src/Kanau.Infrastructure -s src/Kanau.Api`（需 DOTNET_ROLL_FORWARD=LatestMajor + ConnectionStrings__MySql 环境变量；启动时自动 Migrate）
- 前端构建：`cd frontend && npx ng build`（node 在 /root/.nvm/versions/node/v24.16.0/bin）
- 服务日志：`journalctl -u kanau -f`

## 注意
- 密钥不入 git：appsettings.json 只留空占位，生产配置由 sync-secrets.sh 生成（gitignored）
- LBS key（TENCENT_LBS_KEY）目前未配置：逆地址解析/地图功能自动降级为不可用，不影响其它功能
- 孩子账号（IsChild）：AI prompt 用鼓励式简单语言；位置功能默认关闭
