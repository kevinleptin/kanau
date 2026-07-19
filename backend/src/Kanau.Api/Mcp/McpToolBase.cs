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
