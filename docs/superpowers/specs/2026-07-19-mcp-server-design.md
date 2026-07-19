# kanau MCP Server 设计（claude.ai Connectors 接入）

日期：2026-07-19
状态：已确认待实现

## 目标

为 kanau 提供一个远程 MCP server，供家庭成员在 claude.ai 的 Connectors 中连接，
让 Claude 能读写各自的圆梦笔记数据（梦想 / 行动计划 / 待办 / 笔记 / 捕获 / 回顾）。
认证走 OAuth（现有 kanau 账号密码授权），登录有效期一年。

## 总体架构

在现有 `Kanau.Api` 进程内集成，无新服务、无新端口：

```
claude.ai Connector
   │  ① OAuth: /.well-known/* → /oauth/register → /oauth/authorize → /oauth/token
   │  ② MCP:  POST https://kanau.apps02.pixiantong.com/mcp  (Streamable HTTP, Bearer JWT)
   ▼
Nginx ──反代──► Kanau.Api :5100
                ├─ MCP endpoint（官方 ModelContextProtocol.AspNetCore SDK，MapMcp("/mcp")，要求 JWT 认证）
                ├─ 最小 OAuth 授权服务器（4 个端点，基于现有 Identity）
                └─ 现有 /api、/hubs 不动
```

- 依赖：NuGet `ModelContextProtocol.AspNetCore`（官方 MCP C# SDK）。
- 传输：Streamable HTTP（claude.ai Connectors 要求的远程传输）。
- 域名：`kanau.apps02.pixiantong.com`（注意：项目已从 apps03 迁移至 apps02）。

## OAuth 最小授权服务器（`Api/OAuth/`）

claude.ai 对远程 MCP server 的授权要求：OAuth 2.1 + PKCE(S256)、
Dynamic Client Registration (RFC 7591)、Authorization Server Metadata
(RFC 8414) / Protected Resource Metadata (RFC 9728)，回调地址为
`https://claude.ai/api/mcp/auth_callback`（含 claude.com 变体）。

| 端点 | 作用 |
|---|---|
| `GET /.well-known/oauth-authorization-server`、`GET /.well-known/oauth-protected-resource` | metadata JSON：issuer、各端点地址、`code_challenge_methods_supported: ["S256"]`、`grant_types_supported: ["authorization_code"]` |
| `POST /oauth/register` | DCR：保存 claude.ai 注册的 client 到新表 `mcp_oauth_clients`；redirect_uri 强制 claude.ai / claude.com 域名白名单 |
| `GET /oauth/authorize` + `POST /oauth/authorize` | 服务器渲染的简单中文登录授权页（账号+密码）。用现有 Identity 验密（含 lockout）。成功后生成 10 分钟一次性授权码（IMemoryCache，绑定 code_challenge / client_id / redirect_uri / userId），302 携 code+state 回调 |
| `POST /oauth/token` | 校验授权码 + PKCE code_verifier → 签发 **365 天有效期** 的 JWT。复用现有 Jwt key/issuer/audience，现有 JwtBearer 中间件直接可验。不做 refresh token（一年后重新授权一次） |

`/mcp` 未认证返回 401 + `WWW-Authenticate: Bearer resource_metadata="https://kanau.apps02.pixiantong.com/.well-known/oauth-protected-resource"`，
claude.ai 据此发现授权服务器。

存储决策：
- DCR client 必须持久化 → MySQL 新表 `mcp_oauth_clients`（一个 EF 迁移）。
- 授权码生命周期 10 分钟 → IMemoryCache 即可，进程重启丢失最多重新授权一次。

## MCP 工具

实现方式：`[McpServerToolType]` 类置于 `Api/Mcp/`，直接注入 `KanauDbContext`
（与现有 Controller 同模式），UserId 从 JWT claims 取。**所有工具按登录用户
UserId 隔离，与 App 内权限一致**（孩子账号各自授权，只见自己数据）。
工具 description 用中文写清用途与参数含义。

| 领域 | 工具 |
|---|---|
| 梦想 | `list_dreams` / `get_dream` / `create_dream` / `update_dream` / `set_dream_status` |
| 行动计划 | `list_plans`（按梦想/周期）/ `create_plan` / `delete_plan` |
| 待办 | `list_todos`（按日期）/ `create_todo` / `toggle_todo` / `delete_todo` / `today_brief` |
| 笔记 | `list_notes`（含捕获正文与标签）/ `search_notes`（关键词，LIKE 匹配 CorrectedText/RawText） |
| 捕获 | `capture_text`（文本快捕，走 CapturePipeline 自动修正打标）/ `list_captures` |
| 回顾 | `list_reviews` / `get_review` |

不暴露：音视频/图片上传（不适合 MCP 场景）、admin 用户管理、位置功能。

## 数据库与部署变更

- EF 迁移 ×1：`mcp_oauth_clients`（client_id、client_name、redirect_uris JSON、created_at；
  字符串索引列 ≤191 约定）。
- Nginx vhost（`kanau.apps02.pixiantong.com.conf`）增加三段 location，反代 `127.0.0.1:5100`：
  - `/mcp` — SSE/流式支持：`proxy_http_version 1.1`、`proxy_buffering off`、长 read timeout
  - `/oauth/`
  - `/.well-known/oauth-authorization-server`、`/.well-known/oauth-protected-resource`
- 无新密钥；`appsettings` 无变更（复用现有 Jwt 配置）。

## 错误处理与安全

- 工具内记录不存在 / 参数非法 → 返回带中文说明的 MCP 错误结果，不抛 500。
- PKCE 强制 S256；授权码一次性使用、过期作废；redirect_uri 精确匹配注册值且域名白名单。
- 登录失败沿用 Identity lockout 策略。
- token 过期或被拒 → 401 → claude.ai 自动引导重新授权。

## 验证

1. `dotnet build` 通过；`systemctl restart kanau` 后服务正常。
2. curl 走通全流程：register → authorize（模拟表单）→ token → `/mcp` 的
   initialize / tools/list / tools/call（带 Bearer token）。
3. 可选：`npx @modelcontextprotocol/inspector` 连接调试。
4. 最终验收：在 claude.ai → Settings → Connectors 添加
   `https://kanau.apps02.pixiantong.com/mcp`，完成 OAuth 授权后实际读写数据。
