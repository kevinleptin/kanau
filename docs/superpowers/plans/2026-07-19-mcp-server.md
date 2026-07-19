# kanau MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Kanau.Api 内集成 MCP server（Streamable HTTP + OAuth 2.1/PKCE/DCR），供 claude.ai Connectors 连接读写用户数据，token 一年有效。

**Architecture:** 官方 MCP C# SDK（`ModelContextProtocol.AspNetCore` 1.4.1）挂 `/mcp`，Stateless 模式；SDK 自带 `AddMcp` 认证方案提供 `/.well-known/oauth-protected-resource` 与 401 challenge；自写 4 端点最小 OAuth AS（metadata/register/authorize/token），复用现有 Identity + JWT。规格见 `docs/superpowers/specs/2026-07-19-mcp-server-design.md`。

**Tech Stack:** ASP.NET Core (net10.0) / EF Core 9 + Pomelo (MySQL 5.7) / ModelContextProtocol.AspNetCore 1.4.1 / Nginx

## Global Constraints

- 生产服务器直接开发部署，破坏性操作谨慎；服务端口 **5101**（本机 5100 已被 kit-api 占用）
- MySQL 5.7：索引字符串列 ≤191；dotnet 用绝对路径 `/www/server/dotnet/10.0.100/dotnet`
- 公网地址 `https://kanau.apps02.pixiantong.com`；MCP 端点 `/mcp`
- MCP token 有效期 365 天；授权码 10 分钟一次性；PKCE 仅 S256；redirect_uri 仅 claude.ai / claude.com 域
- 本仓库无测试项目：验证方式为 `dotnet build` + 部署后 curl 端到端脚本（按仓库现有惯例）
- 所有工具按 JWT 内 UserId 隔离数据；工具描述用中文
- EF 迁移命令需要 `DOTNET_ROLL_FORWARD=LatestMajor` + `ConnectionStrings__MySql`（值从 `/www/wwwroot/kanau-api/appsettings.Production.json` 读）

---

### Task 1: 修复端口迁移遗留（5100 → 5101）

apps02 上 kanau 实跑 5101（`systemctl cat kanau` 已是 5101，nginx 反代 5101），但仓库文件仍写 5100。不修则 `deploy.sh` 会把 service 覆盖回 5100，与 kit-api 冲突且 nginx 指错。

**Files:**
- Modify: `deploy/kanau.service`（`ASPNETCORE_URLS` 行）
- Modify: `deploy/deploy.sh`（末行健康检查 URL）
- Modify: `CLAUDE.md`（端口描述两处：架构注释与部署节）

- [ ] **Step 1:** `deploy/kanau.service` 中 `Environment=ASPNETCORE_URLS=http://127.0.0.1:5100` 改为 `http://127.0.0.1:5101`
- [ ] **Step 2:** `deploy/deploy.sh` 中 `curl -s --noproxy '*' http://127.0.0.1:5100/api/health` 改为 `5101`
- [ ] **Step 3:** `CLAUDE.md` 中所有 `5100` 改为 `5101`，并在部署节注明「5100 已被 kit-api 占用」
- [ ] **Step 4:** `grep -rn 5100 deploy/ CLAUDE.md` 确认无残留
- [ ] **Step 5:** Commit: `git add -A && git commit -m "修复迁移遗留：kanau 在 apps02 实际端口为 5101"`

---

### Task 2: NuGet 依赖 + McpOAuthClient 实体 + EF 迁移

**Files:**
- Modify: `backend/src/Kanau.Api/Kanau.Api.csproj`
- Modify: `backend/src/Kanau.Domain/Entities.cs`（文件末尾追加实体）
- Modify: `backend/src/Kanau.Infrastructure/Data/KanauDbContext.cs`（DbSet + OnModelCreating）
- Create: `backend/src/Kanau.Infrastructure/Migrations/*_AddMcpOAuthClient.cs`（ef 生成）

**Interfaces:**
- Produces: 实体 `Kanau.Domain.McpOAuthClient { Guid Id; string ClientId; string? ClientName; string RedirectUrisJson; DateTime CreatedAt }`，`db.McpOAuthClients`

- [ ] **Step 1:** csproj `<ItemGroup>` 加包引用：

```xml
<PackageReference Include="ModelContextProtocol.AspNetCore" Version="1.4.1" />
```

- [ ] **Step 2:** `Entities.cs` 末尾追加：

```csharp
/// <summary>claude.ai Connectors 经动态客户端注册（RFC 7591）登记的 OAuth 客户端。</summary>
public class McpOAuthClient
{
    public Guid Id { get; set; }
    public string ClientId { get; set; } = "";
    public string? ClientName { get; set; }
    /// <summary>注册的回调地址，JSON 字符串数组。</summary>
    public string RedirectUrisJson { get; set; } = "[]";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
```

- [ ] **Step 3:** `KanauDbContext.cs`：DbSet 区加 `public DbSet<McpOAuthClient> McpOAuthClients => Set<McpOAuthClient>();`；`OnModelCreating` 末尾（其它 `b.Entity<>` 块之后）加：

```csharp
b.Entity<McpOAuthClient>(e =>
{
    e.HasIndex(x => x.ClientId).IsUnique();
    e.Property(x => x.ClientId).HasMaxLength(64);
    e.Property(x => x.ClientName).HasMaxLength(191);
    e.Property(x => x.RedirectUrisJson).HasColumnType("text");
});
```

- [ ] **Step 4:** 构建：`cd /git/repo/kanau/backend && /www/server/dotnet/10.0.100/dotnet build Kanau.slnx`，Expected: `Build succeeded`
- [ ] **Step 5:** 生成迁移（连接串从生产配置取）：

```bash
CONN=$(python3 -c "import json;print(json.load(open('/www/wwwroot/kanau-api/appsettings.Production.json'))['ConnectionStrings']['MySql'])")
cd /git/repo/kanau/backend
DOTNET_ROLL_FORWARD=LatestMajor ConnectionStrings__MySql="$CONN" \
  /www/server/dotnet/10.0.100/dotnet ef migrations add AddMcpOAuthClient \
  -p src/Kanau.Infrastructure -s src/Kanau.Api
```

Expected: Migrations 目录出现 `*_AddMcpOAuthClient.cs`，内容只建 `McpOAuthClients` 一张表（若混入其它变更则停下检查）。注：`dotnet ef` 若未安装，先 `/www/server/dotnet/10.0.100/dotnet tool install -g dotnet-ef` 并用 `~/.dotnet/tools/dotnet-ef`。
- [ ] **Step 6:** 再构建一次确认迁移代码可编译；Commit: `feat: MCP OAuth 客户端实体与迁移`

---

### Task 3: 最小 OAuth 授权服务器（4 端点）

**Files:**
- Modify: `backend/src/Kanau.Application/Options.cs`（追加 McpOptions）
- Create: `backend/src/Kanau.Api/OAuth/McpOAuthController.cs`
- Modify: `backend/src/Kanau.Api/appsettings.json`（追加 `"Mcp"` 节）
- Modify: `backend/src/Kanau.Api/Program.cs`（注册 McpOptions + AddMemoryCache）

**Interfaces:**
- Consumes: `McpOAuthClient` / `db.McpOAuthClients`（Task 2）、`JwtOptions`、`UserManager<AppUser>`
- Produces: 端点 `GET /.well-known/oauth-authorization-server`、`POST /oauth/register`、`GET|POST /oauth/authorize`、`POST /oauth/token`；静态方法 `McpOAuthController.IssueMcpToken(AppUser, JwtOptions) : string`（365 天 JWT，Task 6 测试用）

- [ ] **Step 1:** `Options.cs` 末尾追加：

```csharp
public class McpOptions
{
    /// <summary>对外公网基址（OAuth metadata / resource metadata 用），不含尾斜杠。</summary>
    public string PublicBaseUrl { get; set; } = "https://kanau.apps02.pixiantong.com";
}
```

- [ ] **Step 2:** `appsettings.json` 根级追加（逗号注意）：

```json
"Mcp": { "PublicBaseUrl": "https://kanau.apps02.pixiantong.com" }
```

- [ ] **Step 3:** `Program.cs` 在 `builder.Services.AddControllers();` 附近追加：

```csharp
builder.Services.Configure<McpOptions>(builder.Configuration.GetSection("Mcp"));
builder.Services.AddMemoryCache();
```

（`McpOptions` 在 `Kanau.Application` 命名空间，已 using。）

- [ ] **Step 4:** 创建 `backend/src/Kanau.Api/OAuth/McpOAuthController.cs`，完整内容：

```csharp
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Kanau.Api.OAuth;

/// <summary>面向 claude.ai Connectors 的最小 OAuth 2.1 授权服务器：
/// RFC 8414 metadata + RFC 7591 动态注册 + authorization_code(PKCE S256) + 365 天 JWT。</summary>
[ApiController]
public class McpOAuthController(KanauDbContext db, UserManager<AppUser> userManager,
    IMemoryCache cache, IOptions<JwtOptions> jwtOpt, IOptions<McpOptions> mcpOpt) : ControllerBase
{
    private string BaseUrl => mcpOpt.Value.PublicBaseUrl.TrimEnd('/');

    private sealed record AuthCodeData(Guid UserId, string ClientId, string RedirectUri,
        string CodeChallenge, string? Scope);

    // ---------- RFC 8414 授权服务器元数据 ----------
    [HttpGet("/.well-known/oauth-authorization-server")]
    [HttpGet("/.well-known/oauth-authorization-server/mcp")]
    public IActionResult Metadata() => Ok(new
    {
        issuer = BaseUrl,
        authorization_endpoint = $"{BaseUrl}/oauth/authorize",
        token_endpoint = $"{BaseUrl}/oauth/token",
        registration_endpoint = $"{BaseUrl}/oauth/register",
        response_types_supported = new[] { "code" },
        grant_types_supported = new[] { "authorization_code" },
        code_challenge_methods_supported = new[] { "S256" },
        token_endpoint_auth_methods_supported = new[] { "none" },
        scopes_supported = new[] { "kanau:mcp" }
    });

    // ---------- RFC 7591 动态客户端注册 ----------
    public record DcrRequest(string[]? redirect_uris, string? client_name);

    [HttpPost("/oauth/register")]
    public async Task<IActionResult> Register([FromBody] DcrRequest req)
    {
        if (req.redirect_uris is not { Length: > 0 })
            return BadRequest(new { error = "invalid_client_metadata", error_description = "redirect_uris 必填" });
        foreach (var uri in req.redirect_uris)
            if (!IsAllowedRedirect(uri))
                return BadRequest(new { error = "invalid_redirect_uri", error_description = $"不允许的回调地址: {uri}" });

        var client = new McpOAuthClient
        {
            Id = Guid.NewGuid(),
            ClientId = Guid.NewGuid().ToString("N"),
            ClientName = req.client_name?.Length > 191 ? req.client_name[..191] : req.client_name,
            RedirectUrisJson = JsonSerializer.Serialize(req.redirect_uris)
        };
        db.McpOAuthClients.Add(client);
        await db.SaveChangesAsync();
        return StatusCode(201, new
        {
            client_id = client.ClientId,
            client_id_issued_at = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            client_name = client.ClientName,
            redirect_uris = req.redirect_uris,
            token_endpoint_auth_method = "none",
            grant_types = new[] { "authorization_code" },
            response_types = new[] { "code" }
        });
    }

    /// <summary>回调地址白名单：仅 https 的 claude.ai / claude.com（含子域）。</summary>
    private static bool IsAllowedRedirect(string uri)
    {
        if (!Uri.TryCreate(uri, UriKind.Absolute, out var u) || u.Scheme != "https") return false;
        var h = u.Host;
        return h is "claude.ai" or "claude.com" || h.EndsWith(".claude.ai") || h.EndsWith(".claude.com");
    }

    // ---------- 授权页 ----------
    [HttpGet("/oauth/authorize")]
    public async Task<IActionResult> AuthorizePage(string? response_type, string? client_id,
        string? redirect_uri, string? state, string? code_challenge, string? code_challenge_method,
        string? scope)
    {
        var err = await ValidateAuthorizeParams(response_type, client_id, redirect_uri,
            code_challenge, code_challenge_method);
        if (err != null) return BadRequest(new { error = "invalid_request", error_description = err });
        return LoginPage(client_id!, redirect_uri!, state, code_challenge!, scope, null);
    }

    [HttpPost("/oauth/authorize")]
    public async Task<IActionResult> AuthorizeSubmit([FromForm] string? client_id,
        [FromForm] string? redirect_uri, [FromForm] string? state, [FromForm] string? code_challenge,
        [FromForm] string? scope, [FromForm] string? username, [FromForm] string? password)
    {
        // 隐藏域可被篡改，POST 时重新校验 client 与回调
        var err = await ValidateAuthorizeParams("code", client_id, redirect_uri, code_challenge, "S256");
        if (err != null) return BadRequest(new { error = "invalid_request", error_description = err });

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrEmpty(password))
            return LoginPage(client_id!, redirect_uri!, state, code_challenge!, scope, "请输入用户名和密码");

        var user = await userManager.FindByNameAsync(username.Trim());
        if (user == null)
            return LoginPage(client_id!, redirect_uri!, state, code_challenge!, scope, "用户名或密码错误");
        if (await userManager.IsLockedOutAsync(user))
            return LoginPage(client_id!, redirect_uri!, state, code_challenge!, scope, "账号已锁定，请稍后再试");
        if (!await userManager.CheckPasswordAsync(user, password))
        {
            await userManager.AccessFailedAsync(user);
            return LoginPage(client_id!, redirect_uri!, state, code_challenge!, scope, "用户名或密码错误");
        }
        await userManager.ResetAccessFailedCountAsync(user);

        var code = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        cache.Set($"mcp_oauth_code:{code}",
            new AuthCodeData(user.Id, client_id!, redirect_uri!, code_challenge!, scope),
            TimeSpan.FromMinutes(10));

        var sep = redirect_uri!.Contains('?') ? '&' : '?';
        var target = $"{redirect_uri}{sep}code={code}" +
                     (state != null ? $"&state={Uri.EscapeDataString(state)}" : "");
        return Redirect(target);
    }

    private async Task<string?> ValidateAuthorizeParams(string? responseType, string? clientId,
        string? redirectUri, string? codeChallenge, string? method)
    {
        if (responseType != "code") return "response_type 必须为 code";
        if (string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(redirectUri)) return "缺少 client_id 或 redirect_uri";
        if (string.IsNullOrEmpty(codeChallenge)) return "缺少 code_challenge（要求 PKCE）";
        if (method != "S256") return "code_challenge_method 仅支持 S256";
        var client = await db.McpOAuthClients.AsNoTracking().FirstOrDefaultAsync(c => c.ClientId == clientId);
        if (client == null) return "client_id 未注册";
        var uris = JsonSerializer.Deserialize<string[]>(client.RedirectUrisJson) ?? [];
        if (!uris.Contains(redirectUri)) return "redirect_uri 与注册值不符";
        return null;
    }

    private ContentResult LoginPage(string clientId, string redirectUri, string? state,
        string codeChallenge, string? scope, string? error)
    {
        string E(string? s) => WebUtility.HtmlEncode(s ?? "");
        var html = $$"""
<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>圆梦笔记 · 授权 Claude</title>
<style>
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  background:#fff7ef;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:32px;width:320px}
h1{font-size:18px;margin:0 0 4px;color:#d97706}
p{font-size:13px;color:#666;margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:12px;border:1px solid #ddd;
  border-radius:8px;font-size:14px}
button{width:100%;padding:10px;background:#f59e0b;color:#fff;border:none;border-radius:8px;
  font-size:15px;cursor:pointer}
.err{color:#dc2626;font-size:13px;margin-bottom:12px}
</style></head><body><div class="card">
<h1>圆梦笔记</h1>
<p>Claude 请求访问你的梦想 / 待办 / 笔记数据。登录以授权（有效期一年）。</p>
{{(error != null ? $"<div class=\"err\">{E(error)}</div>" : "")}}
<form method="post" action="/oauth/authorize">
<input type="hidden" name="client_id" value="{{E(clientId)}}">
<input type="hidden" name="redirect_uri" value="{{E(redirectUri)}}">
<input type="hidden" name="state" value="{{E(state)}}">
<input type="hidden" name="code_challenge" value="{{E(codeChallenge)}}">
<input type="hidden" name="scope" value="{{E(scope)}}">
<input name="username" placeholder="用户名" autocomplete="username" required>
<input name="password" type="password" placeholder="密码" autocomplete="current-password" required>
<button type="submit">登录并授权</button>
</form></div></body></html>
""";
        return new ContentResult { Content = html, ContentType = "text/html; charset=utf-8" };
    }

    // ---------- token 端点 ----------
    [HttpPost("/oauth/token")]
    public async Task<IActionResult> Token([FromForm] string? grant_type, [FromForm] string? code,
        [FromForm] string? redirect_uri, [FromForm] string? client_id, [FromForm] string? code_verifier)
    {
        if (grant_type != "authorization_code")
            return BadRequest(new { error = "unsupported_grant_type" });
        if (code == null || !cache.TryGetValue($"mcp_oauth_code:{code}", out AuthCodeData? data) || data == null)
            return BadRequest(new { error = "invalid_grant", error_description = "授权码无效或已过期" });
        cache.Remove($"mcp_oauth_code:{code}"); // 一次性使用

        if (data.ClientId != client_id || data.RedirectUri != redirect_uri)
            return BadRequest(new { error = "invalid_grant", error_description = "client_id 或 redirect_uri 不匹配" });
        if (string.IsNullOrEmpty(code_verifier) ||
            Base64UrlEncoder.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(code_verifier))) != data.CodeChallenge)
            return BadRequest(new { error = "invalid_grant", error_description = "PKCE 校验失败" });

        var user = await userManager.FindByIdAsync(data.UserId.ToString());
        if (user == null) return BadRequest(new { error = "invalid_grant" });

        return Ok(new
        {
            access_token = IssueMcpToken(user, jwtOpt.Value),
            token_type = "Bearer",
            expires_in = 365 * 24 * 3600,
            scope = data.Scope ?? "kanau:mcp"
        });
    }

    /// <summary>签发 365 天 MCP JWT：与 App token 同 key/issuer/audience，现有 JwtBearer 直接可验。</summary>
    internal static string IssueMcpToken(AppUser user, JwtOptions o)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("name", user.UserName ?? ""),
            new Claim("isChild", user.IsChild ? "1" : "0"),
            new Claim("isAdmin", user.IsAdmin ? "1" : "0"),
            new Claim("mcp", "1")
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key));
        var token = new JwtSecurityToken(issuer: o.Issuer, audience: o.Audience, claims: claims,
            expires: DateTime.UtcNow.AddDays(365),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
```

- [ ] **Step 5:** 构建，Expected: `Build succeeded`（0 Error；`$$"""` raw string 内 `{{ }}` 插值注意保持原样）
- [ ] **Step 6:** Commit: `feat: MCP 最小 OAuth 授权服务器（metadata/DCR/authorize/token, PKCE S256, 365 天 JWT）`

---

### Task 4: MCP server 接入 + 工具集

**Files:**
- Create: `backend/src/Kanau.Api/Mcp/McpToolBase.cs`（基类 + JSON 序列化助手）
- Create: `backend/src/Kanau.Api/Mcp/DreamTools.cs`
- Create: `backend/src/Kanau.Api/Mcp/PlanTools.cs`
- Create: `backend/src/Kanau.Api/Mcp/TodoTools.cs`
- Create: `backend/src/Kanau.Api/Mcp/NoteTools.cs`
- Create: `backend/src/Kanau.Api/Mcp/CaptureTools.cs`
- Create: `backend/src/Kanau.Api/Mcp/ReviewTools.cs`
- Modify: `backend/src/Kanau.Api/Program.cs`

**Interfaces:**
- Consumes: `KanauDbContext`、`IBackgroundJobClient`（Hangfire）、`ICapturePipeline`、Task 3 的 McpOptions
- Produces: `/mcp` Streamable HTTP 端点（JWT 认证），18 个工具

- [ ] **Step 1:** 创建 `Mcp/McpToolBase.cs`：

```csharp
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Kanau.Api.Mcp;

/// <summary>MCP 工具基类：从 JWT 取当前用户；统一 JSON 输出（枚举转字符串，中文不转义）。</summary>
public abstract class McpToolBase(IHttpContextAccessor http)
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        Converters = { new JsonStringEnumConverter() }
    };

    protected Guid UserId
    {
        get
        {
            var id = http.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            return id != null ? Guid.Parse(id) : throw new InvalidOperationException("未认证");
        }
    }

    protected static string Json(object o) => JsonSerializer.Serialize(o, JsonOpts);

    /// <summary>解析 Guid 参数；失败返回 null。</summary>
    protected static Guid? ParseId(string? s) => Guid.TryParse(s, out var g) ? g : null;

    /// <summary>北京时间今天。</summary>
    protected static DateOnly TodayCn() => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Shanghai")));
}
```

- [ ] **Step 2:** 创建 `Mcp/DreamTools.cs`（5 个工具）：

```csharp
using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class DreamTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    private object Dto(Dream d) => new
    {
        d.Id, d.Title, d.QuantifiedText, d.PyramidArea, d.TargetDate,
        d.Status, d.AchievedAt, d.CreatedAt
    };

    [McpServerTool(Name = "list_dreams"), Description("列出当前用户的梦想。可按状态过滤：Draft(草稿)/Active(进行中)/Achieved(已实现)/Archived(已归档)，不传则返回全部。")]
    public async Task<string> ListDreams(
        [Description("状态过滤，可选：Draft/Active/Achieved/Archived")] string? status = null)
    {
        var q = db.Dreams.AsNoTracking().Where(d => d.UserId == UserId);
        if (Enum.TryParse<DreamStatus>(status, true, out var st)) q = q.Where(d => d.Status == st);
        var list = await q.OrderByDescending(d => d.CreatedAt).ToListAsync();
        return Json(list.Select(Dto));
    }

    [McpServerTool(Name = "get_dream"), Description("查看一个梦想的详情，含其行动计划（年/月/周）。")]
    public async Task<string> GetDream([Description("梦想 ID")] string dreamId)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null
            : await db.Dreams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        var plans = await db.ActionPlans.AsNoTracking()
            .Where(p => p.DreamId == d.Id && p.UserId == UserId)
            .OrderBy(p => p.Level).ThenBy(p => p.Period).ThenBy(p => p.SortOrder).ToListAsync();
        return Json(new
        {
            dream = Dto(d),
            plans = plans.Select(p => new { p.Id, p.Level, p.Period, p.Content, p.Source })
        });
    }

    [McpServerTool(Name = "create_dream"), Description("创建一个新梦想（状态为 Active）。人生金字塔六领域：Health(健康)/Knowledge(修养知识)/Mind(心灵精神)为基础层，Work(社会工作)/Family(私人家庭)为实现层，Wealth(经济物质)为结果层。")]
    public async Task<string> CreateDream(
        [Description("梦想标题")] string title,
        [Description("所属领域：Health/Knowledge/Mind/Work/Family/Wealth")] string pyramidArea,
        [Description("SMART 量化描述，可选")] string? quantifiedText = null,
        [Description("目标日期 yyyy-MM-dd，可选")] string? targetDate = null)
    {
        if (string.IsNullOrWhiteSpace(title)) return "标题不能为空";
        if (!Enum.TryParse<PyramidArea>(pyramidArea, true, out var area))
            return "pyramidArea 无效，可选值：Health/Knowledge/Mind/Work/Family/Wealth";
        DateTime? target = DateTime.TryParse(targetDate, out var t) ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : null;
        var d = new Dream
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = title.Trim(),
            QuantifiedText = quantifiedText, PyramidArea = area, TargetDate = target,
            Status = DreamStatus.Active
        };
        db.Dreams.Add(d);
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }

    [McpServerTool(Name = "update_dream"), Description("更新梦想。只传需要修改的字段，未传字段保持不变。")]
    public async Task<string> UpdateDream(
        [Description("梦想 ID")] string dreamId,
        [Description("新标题，可选")] string? title = null,
        [Description("新的 SMART 量化描述，可选")] string? quantifiedText = null,
        [Description("新领域：Health/Knowledge/Mind/Work/Family/Wealth，可选")] string? pyramidArea = null,
        [Description("新目标日期 yyyy-MM-dd，可选")] string? targetDate = null)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null : await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        if (!string.IsNullOrWhiteSpace(title)) d.Title = title.Trim();
        if (quantifiedText != null) d.QuantifiedText = quantifiedText;
        if (pyramidArea != null)
        {
            if (!Enum.TryParse<PyramidArea>(pyramidArea, true, out var area))
                return "pyramidArea 无效，可选值：Health/Knowledge/Mind/Work/Family/Wealth";
            d.PyramidArea = area;
        }
        if (targetDate != null && DateTime.TryParse(targetDate, out var t))
            d.TargetDate = DateTime.SpecifyKind(t, DateTimeKind.Utc);
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }

    [McpServerTool(Name = "set_dream_status"), Description("修改梦想状态：Active(进行中)/Achieved(已实现)/Archived(归档)。标记 Achieved 会记录实现时间。")]
    public async Task<string> SetDreamStatus(
        [Description("梦想 ID")] string dreamId,
        [Description("新状态：Draft/Active/Achieved/Archived")] string status)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null : await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        if (!Enum.TryParse<DreamStatus>(status, true, out var st))
            return "status 无效，可选值：Draft/Active/Achieved/Archived";
        d.Status = st;
        if (st == DreamStatus.Achieved) d.AchievedAt = DateTime.UtcNow;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }
}
```

- [ ] **Step 3:** 创建 `Mcp/PlanTools.cs`（3 个工具）：

```csharp
using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class PlanTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    [McpServerTool(Name = "list_plans"), Description("列出行动计划。可按梦想或周期过滤。层级：Year(年)/Month(月)/Week(周)；周期格式如 2026 / 2026-08 / 2026-W31。")]
    public async Task<string> ListPlans(
        [Description("梦想 ID，可选")] string? dreamId = null,
        [Description("周期过滤，如 2026-08，可选")] string? period = null)
    {
        var q = db.ActionPlans.AsNoTracking().Where(p => p.UserId == UserId);
        var did = ParseId(dreamId);
        if (did != null) q = q.Where(p => p.DreamId == did);
        if (!string.IsNullOrEmpty(period)) q = q.Where(p => p.Period == period);
        var list = await q.OrderBy(p => p.DreamId).ThenBy(p => p.Level)
            .ThenBy(p => p.Period).ThenBy(p => p.SortOrder).ToListAsync();
        return Json(list.Select(p => new { p.Id, p.DreamId, p.Level, p.Period, p.Content, p.Source }));
    }

    [McpServerTool(Name = "create_plan"), Description("为某个梦想创建一条行动计划。")]
    public async Task<string> CreatePlan(
        [Description("梦想 ID")] string dreamId,
        [Description("层级：Year/Month/Week")] string level,
        [Description("计划内容")] string content,
        [Description("所属周期，如 2026 / 2026-08 / 2026-W31，可选")] string? period = null)
    {
        var did = ParseId(dreamId);
        var dream = did == null ? null
            : await db.Dreams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == did && x.UserId == UserId);
        if (dream == null) return "未找到该梦想";
        if (!Enum.TryParse<PlanLevel>(level, true, out var lv)) return "level 无效，可选值：Year/Month/Week";
        if (string.IsNullOrWhiteSpace(content)) return "内容不能为空";
        var maxSort = await db.ActionPlans
            .Where(p => p.DreamId == dream.Id && p.Level == lv && p.Period == period)
            .Select(p => (int?)p.SortOrder).MaxAsync() ?? 0;
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), UserId = UserId, DreamId = dream.Id, Level = lv,
            Content = content.Trim(), Period = period, SortOrder = maxSort + 1, Source = PlanSource.Manual
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return Json(new { plan.Id, plan.DreamId, plan.Level, plan.Period, plan.Content });
    }

    [McpServerTool(Name = "delete_plan"), Description("删除一条行动计划。")]
    public async Task<string> DeletePlan([Description("计划 ID")] string planId)
    {
        var id = ParseId(planId);
        var p = id == null ? null : await db.ActionPlans.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (p == null) return "未找到该计划";
        db.ActionPlans.Remove(p);
        await db.SaveChangesAsync();
        return "已删除";
    }
}
```

- [ ] **Step 4:** 创建 `Mcp/TodoTools.cs`（5 个工具）：

```csharp
using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class TodoTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    private static object Dto(TodoItem t) => new
    {
        t.Id, t.Date, t.Title, t.Status, t.PostponeCount, t.DreamId, t.PlanId, t.DoneAt
    };

    [McpServerTool(Name = "list_todos"), Description("列出某天的待办事项（默认今天，北京时间）。状态：Pending(待办)/Done(完成)/Postponed(顺延)/Cancelled(取消)。")]
    public async Task<string> ListTodos(
        [Description("日期 yyyy-MM-dd，可选，默认今天")] string? date = null)
    {
        var day = DateOnly.TryParse(date, out var d) ? d : TodayCn();
        var list = await db.TodoItems.AsNoTracking()
            .Where(t => t.UserId == UserId && t.Date == day)
            .OrderBy(t => t.Status).ThenBy(t => t.CreatedAt).ToListAsync();
        return Json(new { date = day, todos = list.Select(Dto) });
    }

    [McpServerTool(Name = "create_todo"), Description("创建待办事项。可关联梦想或行动计划（体现「今天做的事与梦想相连」）。")]
    public async Task<string> CreateTodo(
        [Description("待办标题")] string title,
        [Description("日期 yyyy-MM-dd，可选，默认今天")] string? date = null,
        [Description("关联的梦想 ID，可选")] string? dreamId = null,
        [Description("关联的行动计划 ID，可选")] string? planId = null)
    {
        if (string.IsNullOrWhiteSpace(title)) return "标题不能为空";
        var t = new TodoItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = title.Trim(),
            Date = DateOnly.TryParse(date, out var d) ? d : TodayCn(),
            DreamId = ParseId(dreamId), PlanId = ParseId(planId)
        };
        db.TodoItems.Add(t);
        await db.SaveChangesAsync();
        return Json(Dto(t));
    }

    [McpServerTool(Name = "toggle_todo"), Description("切换待办完成状态（未完成→完成，完成→未完成）。")]
    public async Task<string> ToggleTodo([Description("待办 ID")] string todoId)
    {
        var id = ParseId(todoId);
        var t = id == null ? null : await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return "未找到该待办";
        t.Status = t.Status == TodoStatus.Done ? TodoStatus.Pending : TodoStatus.Done;
        t.DoneAt = t.Status == TodoStatus.Done ? DateTime.UtcNow : null;
        await db.SaveChangesAsync();
        return Json(Dto(t));
    }

    [McpServerTool(Name = "delete_todo"), Description("删除一条待办事项。")]
    public async Task<string> DeleteTodo([Description("待办 ID")] string todoId)
    {
        var id = ParseId(todoId);
        var t = id == null ? null : await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return "未找到该待办";
        db.TodoItems.Remove(t);
        await db.SaveChangesAsync();
        return "已删除";
    }

    [McpServerTool(Name = "today_brief"), Description("今日速览：今天的待办完成情况 + 进行中的梦想数。适合作为每日回顾/规划的起点。")]
    public async Task<string> TodayBrief()
    {
        var today = TodayCn();
        var todos = await db.TodoItems.AsNoTracking()
            .Where(t => t.UserId == UserId && t.Date == today).ToListAsync();
        var activeDreams = await db.Dreams.AsNoTracking()
            .CountAsync(d => d.UserId == UserId && d.Status == DreamStatus.Active);
        return Json(new
        {
            date = today,
            total = todos.Count,
            done = todos.Count(t => t.Status == TodoStatus.Done),
            pending = todos.Count(t => t.Status == TodoStatus.Pending),
            postponed = todos.Count(t => t.Status == TodoStatus.Postponed),
            activeDreams,
            todos = todos.Select(Dto)
        });
    }
}
```

- [ ] **Step 5:** 创建 `Mcp/NoteTools.cs`（2 个工具，笔记正文在关联 CaptureItem 上）：

```csharp
using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class NoteTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    [McpServerTool(Name = "list_notes"), Description("列出笔记（分页，每页 20 条，按时间倒序）。类型：Inspiration(灵感)/Reading(读书)/Meeting(会议)/Emotion(情绪)/Diary(日常)/Other(其他)。返回含正文与标签。")]
    public async Task<string> ListNotes(
        [Description("类型过滤：Inspiration/Reading/Meeting/Emotion/Diary/Other，可选")] string? noteType = null,
        [Description("页码，从 1 开始")] int page = 1)
    {
        var q = db.Notes.AsNoTracking().Where(n => n.UserId == UserId);
        if (Enum.TryParse<NoteType>(noteType, true, out var nt)) q = q.Where(n => n.NoteType == nt);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(n => n.CreatedAt)
            .Skip((Math.Max(page, 1) - 1) * 20).Take(20)
            .Join(db.CaptureItems, n => n.CaptureId, c => c.Id,
                (n, c) => new { n.Id, n.NoteType, n.Tags, n.CreatedAt, Text = c.CorrectedText ?? c.RawText })
            .ToListAsync();
        return Json(new { total, page, items });
    }

    [McpServerTool(Name = "search_notes"), Description("按关键词全文搜索笔记正文，返回最多 20 条匹配。")]
    public async Task<string> SearchNotes([Description("搜索关键词")] string keyword)
    {
        if (string.IsNullOrWhiteSpace(keyword)) return "关键词不能为空";
        var kw = keyword.Trim();
        var items = await db.Notes.AsNoTracking().Where(n => n.UserId == UserId)
            .Join(db.CaptureItems, n => n.CaptureId, c => c.Id,
                (n, c) => new { n.Id, n.NoteType, n.Tags, n.CreatedAt, Text = c.CorrectedText ?? c.RawText })
            .Where(x => x.Text != null && x.Text.Contains(kw))
            .OrderByDescending(x => x.CreatedAt).Take(20).ToListAsync();
        return Json(new { keyword = kw, count = items.Count, items });
    }
}
```

- [ ] **Step 6:** 创建 `Mcp/CaptureTools.cs`（2 个工具）：

```csharp
using System.ComponentModel;
using Hangfire;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class CaptureTools(KanauDbContext db, IBackgroundJobClient jobs, IHttpContextAccessor http)
    : McpToolBase(http)
{
    [McpServerTool(Name = "capture_text"), Description("文本快捕：把一段想法/灵感/记录写入捕获管线，AI 会自动修正文本、打标分类为笔记并向量化。这是往圆梦笔记里「记一笔」的入口。")]
    public async Task<string> CaptureText([Description("要记录的文本内容")] string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "内容不能为空";
        var item = new CaptureItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Type = CaptureType.Text,
            RawText = text.Trim(), Status = CaptureStatus.Uploaded
        };
        db.CaptureItems.Add(item);
        await db.SaveChangesAsync();
        jobs.Enqueue<ICapturePipeline>(p => p.ProcessAsync(item.Id));
        return Json(new { item.Id, item.Status, message = "已记录，AI 正在后台整理打标" });
    }

    [McpServerTool(Name = "list_captures"), Description("列出捕获记录（分页，每页 20 条，按时间倒序）。状态 Ready 表示 AI 已整理完成。")]
    public async Task<string> ListCaptures([Description("页码，从 1 开始")] int page = 1)
    {
        var q = db.CaptureItems.AsNoTracking().Where(c => c.UserId == UserId);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(c => c.CreatedAt)
            .Skip((Math.Max(page, 1) - 1) * 20).Take(20)
            .Select(c => new { c.Id, c.Type, c.Status, Text = c.CorrectedText ?? c.RawText, c.CreatedAt })
            .ToListAsync();
        return Json(new { total, page, items });
    }
}
```

- [ ] **Step 7:** 创建 `Mcp/ReviewTools.cs`（2 个工具）：

```csharp
using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class ReviewTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    [McpServerTool(Name = "list_reviews"), Description("列出周期回顾（周报/月报，系统自动生成）。周期类型：Week/Month。")]
    public async Task<string> ListReviews(
        [Description("周期类型过滤：Week/Month，可选")] string? periodType = null)
    {
        var q = db.Reviews.AsNoTracking().Where(r => r.UserId == UserId);
        if (Enum.TryParse<PeriodType>(periodType, true, out var pt)) q = q.Where(r => r.PeriodType == pt);
        var list = await q.OrderByDescending(r => r.PeriodStart).Take(50)
            .Select(r => new { r.Id, r.PeriodType, r.PeriodStart, r.CreatedAt })
            .ToListAsync();
        return Json(list);
    }

    [McpServerTool(Name = "get_review"), Description("查看一份回顾详情：统计快照 + AI 点评。")]
    public async Task<string> GetReview([Description("回顾 ID")] string reviewId)
    {
        var id = ParseId(reviewId);
        var r = id == null ? null
            : await db.Reviews.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (r == null) return "未找到该回顾";
        return Json(new { r.Id, r.PeriodType, r.PeriodStart, r.StatsSnapshot, r.AiComment, r.CreatedAt });
    }
}
```

- [ ] **Step 8:** 修改 `Program.cs`：

8a. 顶部 using 增加：

```csharp
using Kanau.Api.Mcp;
using Microsoft.AspNetCore.HttpOverrides;
using ModelContextProtocol.AspNetCore.Authentication;
```

8b. 现有 `builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)` 改为（AddJwtBearer 内容不动，链尾追加 `.AddMcp`）：

```csharp
builder.Services.AddAuthentication(opt =>
    {
        opt.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
        opt.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        // MCP challenge：401 时带 WWW-Authenticate resource_metadata，claude.ai 据此发现授权服务器。
        // 对现有 /api 客户端仅多一个响应头，状态码行为不变。
        opt.DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme;
    })
    .AddJwtBearer(opt => { /* ……保持现有内容不变…… */ })
    .AddMcp(opt =>
    {
        opt.ResourceMetadata = new()
        {
            AuthorizationServers = { new Uri(builder.Configuration["Mcp:PublicBaseUrl"] ?? "https://kanau.apps02.pixiantong.com") },
            ScopesSupported = ["kanau:mcp"],
        };
    });
```

（若编译报 `AuthorizationServers` 集合元素类型为 string，则去掉 `new Uri(...)` 直接放字符串——以编译器为准。）

8c. `builder.Services.AddSignalR();` 附近追加：

```csharp
builder.Services.AddHttpContextAccessor();
builder.Services.AddMcpServer(o => o.ServerInfo = new() { Name = "圆梦笔记 kanau", Version = "1.0.0" })
    .WithHttpTransport(o => o.Stateless = true)
    .WithTools<DreamTools>().WithTools<PlanTools>().WithTools<TodoTools>()
    .WithTools<NoteTools>().WithTools<CaptureTools>().WithTools<ReviewTools>();
```

（`ServerInfo` 类型不符时按编译器提示改为 `Implementation` 对象或直接删掉该 lambda 用默认值。）

8d. 管道：`var app = builder.Build();` 之后、其它中间件之前插入（nginx 走 https，转发头让 SDK 生成正确的 https 元数据 URL）：

```csharp
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedFor
});
```

8e. `app.MapHub<CaptureHub>(...)` 附近追加：

```csharp
app.MapMcp("/mcp").RequireAuthorization();
```

- [ ] **Step 9:** 构建，Expected: `Build succeeded`
- [ ] **Step 10:** Commit: `feat: MCP server（/mcp Streamable HTTP，18 个工具，JWT 认证）`

---

### Task 5: Nginx 反代 + 部署

**Files:**
- Modify: `/www/server/panel/vhost/nginx/kanau.apps02.pixiantong.com.conf`（服务器文件，不入 git）

- [ ] **Step 1:** 备份：`cp /www/server/panel/vhost/nginx/kanau.apps02.pixiantong.com.conf /tmp/claude-0/-git-repo-kanau/*/scratchpad/kanau-vhost.bak 2>/dev/null || cp ... /root/kanau-vhost.bak`
- [ ] **Step 2:** 在 443 server 块 `location /api/` 之前插入：

```nginx
    location /mcp {
        proxy_pass http://127.0.0.1:5101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /oauth/ {
        proxy_pass http://127.0.0.1:5101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/oauth-authorization-server {
        proxy_pass http://127.0.0.1:5101;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /.well-known/oauth-protected-resource {
        proxy_pass http://127.0.0.1:5101;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

- [ ] **Step 3:** `/www/server/nginx/sbin/nginx -t` Expected: `syntax is ok`；然后 `/www/server/nginx/sbin/nginx -s reload`
- [ ] **Step 4:** 部署：`bash /git/repo/kanau/deploy/deploy.sh`，Expected: 末尾 `active` + health JSON + `== 部署完成 ==`（迁移在启动时自动执行）
- [ ] **Step 5:** `journalctl -u kanau -n 30 --no-pager` 无错误；`mysql` 确认 `McpOAuthClients` 表已建（用宝塔 default.db 里的库凭据或 appsettings.Production.json 连接串）

---

### Task 6: 端到端验证（curl 模拟 claude.ai 全流程）

用一个临时测试用户走完整 OAuth + MCP 流程，完成后清理。工作目录用 scratchpad。

- [ ] **Step 1:** 元数据与 401 challenge：

```bash
curl -s https://kanau.apps02.pixiantong.com/.well-known/oauth-authorization-server | python3 -m json.tool
curl -s https://kanau.apps02.pixiantong.com/.well-known/oauth-protected-resource | python3 -m json.tool
curl -si -X POST https://kanau.apps02.pixiantong.com/mcp -H 'Content-Type: application/json' -d '{}' | head -5
```

Expected: 前两个返回合法 JSON（authorization_servers 指向本站）；第三个 `401` 且含 `WWW-Authenticate:` 带 `resource_metadata=`。

- [ ] **Step 2:** DCR 注册：

```bash
curl -s -X POST https://kanau.apps02.pixiantong.com/oauth/register -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"client_name":"claude.ai test"}'
```

Expected: 201 + `client_id`。记为 `$CLIENT_ID`。另验证非法域被拒：`"redirect_uris":["https://evil.com/cb"]` → 400。

- [ ] **Step 3:** 造测试用户（Identity V3 hash 可由 python 生成，格式 `0x01|prf|iter|saltLen|salt|subkey`，校验端自适应参数）：

```bash
python3 - <<'EOF'
import hashlib, os, base64, struct
pw = "McpTest#2026"
salt = os.urandom(16)
subkey = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000, 32)
h = b'\x01' + struct.pack('>III', 1, 100000, 16) + salt + subkey
print(base64.b64encode(h).decode())
EOF
```

用输出的 hash 执行 SQL（连接串信息取自 appsettings.Production.json）：

```sql
INSERT INTO AspNetUsers (Id, UserName, NormalizedUserName, PasswordHash, SecurityStamp,
  ConcurrencyStamp, PhoneNumberConfirmed, TwoFactorEnabled, LockoutEnabled, AccessFailedCount,
  EmailConfirmed, TimeZone, IsChild, IsAdmin, LocationEnabled, TotalPromptTokens,
  TotalCompletionTokens, CreatedAt, Nickname)
VALUES (UUID(), 'mcptest', 'MCPTEST', '<hash>', REPLACE(UUID(),'-',''), UUID(),
  0, 0, 1, 0, 0, 'Asia/Shanghai', 0, 0, 0, 0, 0, UTC_TIMESTAMP(6), 'MCP测试');
```

验证：`curl -s -X POST https://kanau.apps02.pixiantong.com/api/auth/login -H 'Content-Type: application/json' -d '{"userName":"mcptest","password":"McpTest#2026"}'` 返回 token。

- [ ] **Step 4:** PKCE + 授权 + 换 token：

```bash
VERIFIER=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
CHALLENGE=$(python3 -c "import hashlib,base64,sys;print(base64.urlsafe_b64encode(hashlib.sha256('$VERIFIER'.encode()).digest()).rstrip(b'=').decode())")
# 授权页渲染
curl -s "https://kanau.apps02.pixiantong.com/oauth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=xyz&code_challenge=$CHALLENGE&code_challenge_method=S256&scope=kanau:mcp" | grep -o '<title>[^<]*'
# 表单提交拿 code（从 302 Location 提取）
CODE=$(curl -si -X POST https://kanau.apps02.pixiantong.com/oauth/authorize \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "state=xyz" --data-urlencode "code_challenge=$CHALLENGE" \
  --data-urlencode "scope=kanau:mcp" \
  --data-urlencode "username=mcptest" --data-urlencode "password=McpTest#2026" \
  | grep -i '^location:' | grep -o 'code=[a-f0-9]*' | cut -d= -f2)
# 换 token
TOKEN=$(curl -s -X POST https://kanau.apps02.pixiantong.com/oauth/token \
  --data-urlencode "grant_type=authorization_code" --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=https://claude.ai/api/mcp/auth_callback" \
  --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "code_verifier=$VERIFIER" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
```

Expected: 授权页含标题「圆梦笔记」；`$CODE` 非空；`$TOKEN` 非空且 `expires_in=31536000`。附加负例：错误 code_verifier → `invalid_grant`；code 复用 → `invalid_grant`。

- [ ] **Step 5:** MCP 协议流程（Stateless，每请求独立 POST；响应可能是 SSE 格式需截取 `data:` 行）：

```bash
MCP=https://kanau.apps02.pixiantong.com/mcp
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream')
# initialize
curl -s "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
# tools/list
curl -s "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
# tools/call：create_todo → list_todos → today_brief → capture_text
curl -s "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_todo","arguments":{"title":"MCP 验证待办"}}}'
curl -s "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_todos","arguments":{}}}'
curl -s "${H[@]}" $MCP -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"capture_text","arguments":{"text":"MCP 端到端验证记录"}}}'
```

Expected: initialize 返回 serverInfo；tools/list 返回 18 个工具；create_todo 返回 todo JSON；list_todos 能看到它；capture_text 返回「已记录」。

- [ ] **Step 6:** 清理测试数据（SQL：删 mcptest 用户及其 TodoItems/CaptureItems/Notes/AiTasks；删测试注册的 McpOAuthClients 行）；再跑一遍 `curl /api/health` 确认服务正常。

---

### Task 7: 文档 + 提交 + push

- [ ] **Step 1:** `CLAUDE.md` 架构节补一行 MCP 说明（/mcp 端点、OAuth 端点、365 天 token、`Mcp:PublicBaseUrl` 配置、nginx 需反代 /mcp /oauth /.well-known/oauth-*）
- [ ] **Step 2:** 勾选本计划所有完成项，`git add -A && git commit`（信息：`feat: MCP server 上线（claude.ai Connectors 可连接）`）
- [ ] **Step 3:** `git push origin main`（若 ssh 22 被墙则改用 `ssh.github.com:443` 或提示用户）
- [ ] **Step 4:** 最终报告：给出 claude.ai 添加 Connector 的操作步骤（Settings → Connectors → Add custom connector → URL `https://kanau.apps02.pixiantong.com/mcp`）
