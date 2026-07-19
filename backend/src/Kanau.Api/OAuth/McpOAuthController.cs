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
