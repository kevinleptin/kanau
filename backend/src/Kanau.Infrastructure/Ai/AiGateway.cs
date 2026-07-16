using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TencentCloud.Common;
using TencentCloud.Hunyuan.V20230901;
using TencentCloud.Hunyuan.V20230901.Models;

namespace Kanau.Infrastructure.Ai;

/// <summary>
/// AI 统一网关。路由规则：
/// correction / tagging / embedding → 混元（轻任务）；
/// smartRewrite / decompose / review / coach → DeepSeek（重推理），失败自动降级混元并标记 degraded。
/// forceStrong=true 时轻任务也走 DeepSeek（用户手动"重新修正"）。
/// </summary>
public class AiGateway(
    IHttpClientFactory httpFactory,
    IOptions<DeepSeekOptions> dsOpt,
    IOptions<HunyuanOptions> hyOpt,
    IOptions<TencentOptions> tcOpt,
    KanauDbContext db,
    ILogger<AiGateway> logger) : IAiGateway
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private static bool IsHeavy(AiTaskType t) => t is AiTaskType.SmartRewrite or AiTaskType.Decompose
        or AiTaskType.Review or AiTaskType.Coach;

    public async Task<AiResult> ChatAsync(AiTaskType taskType, Guid userId, string systemPrompt, string userPrompt,
        bool forceStrong = false, CancellationToken ct = default)
    {
        var useDeepSeek = IsHeavy(taskType) || forceStrong;
        var sw = Stopwatch.StartNew();
        var task = new AiTask { Id = Guid.NewGuid(), UserId = userId, Type = taskType, Status = AiTaskStatus.Running,
            Payload = Truncate(userPrompt, 4000) };
        db.AiTasks.Add(task);
        await db.SaveChangesAsync(ct);

        AiResult result;
        try
        {
            if (useDeepSeek)
            {
                try
                {
                    var model = taskType == AiTaskType.Decompose ? dsOpt.Value.ModelReasoner : dsOpt.Value.ModelChat;
                    result = await CallDeepSeekAsync(model, systemPrompt, userPrompt, ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "DeepSeek 调用失败，降级混元。task={TaskId}", task.Id);
                    var r = await CallHunyuanAsync(systemPrompt, userPrompt, ct);
                    result = r with { Degraded = true };
                }
            }
            else
            {
                result = await CallHunyuanAsync(systemPrompt, userPrompt, ct);
            }

            task.Status = AiTaskStatus.Succeeded;
            task.Model = result.Model;
            task.Degraded = result.Degraded;
            task.PromptTokens = result.PromptTokens;
            task.CompletionTokens = result.CompletionTokens;
            task.Result = Truncate(result.Text, 60000);
        }
        catch (Exception ex)
        {
            task.Status = AiTaskStatus.Failed;
            task.Error = Truncate(ex.Message, 2000);
            await SaveTaskAsync(task, sw, ct);
            throw;
        }

        await SaveTaskAsync(task, sw, ct);

        // 用户 token 累计
        var user = await db.Users.FindAsync([userId], ct);
        if (user != null)
        {
            user.TotalPromptTokens += result.PromptTokens;
            user.TotalCompletionTokens += result.CompletionTokens;
            await db.SaveChangesAsync(ct);
        }
        return result;
    }

    public async Task<T?> ChatJsonAsync<T>(AiTaskType taskType, Guid userId, string systemPrompt, string userPrompt,
        bool forceStrong = false, CancellationToken ct = default) where T : class
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var r = await ChatAsync(taskType, userId,
                systemPrompt + "\n\n务必只输出合法 JSON，不要输出 markdown 代码块以外的任何解释文字。",
                userPrompt, forceStrong, ct);
            var json = ExtractJson(r.Text);
            if (json == null) continue;
            try { return JsonSerializer.Deserialize<T>(json, JsonOpts); }
            catch (JsonException ex)
            {
                logger.LogWarning(ex, "AI JSON 解析失败 attempt={Attempt} type={Type}", attempt, taskType);
            }
        }
        return null;
    }

    public async Task<float[]?> EmbedAsync(Guid userId, string text, CancellationToken ct = default)
    {
        try
        {
            var client = CreateHunyuanClient();
            var req = new GetEmbeddingRequest { Input = Truncate(text, 3000) };
            var resp = await client.GetEmbedding(req);
            var vec = resp.Data?.FirstOrDefault()?.Embedding;
            if (vec == null) return null;
            return vec.Where(v => v.HasValue).Select(v => (float)v!.Value).ToArray();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Embedding 失败 user={UserId}", userId);
            return null;
        }
    }

    // ---------- DeepSeek (OpenAI 兼容) ----------
    private async Task<AiResult> CallDeepSeekAsync(string model, string system, string user, CancellationToken ct)
    {
        var http = httpFactory.CreateClient("deepseek");
        var body = new
        {
            model,
            messages = new object[]
            {
                new { role = "system", content = system },
                new { role = "user", content = user }
            },
            stream = false,
            temperature = 0.7
        };
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{dsOpt.Value.Endpoint.TrimEnd('/')}/chat/completions")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")
        };
        req.Headers.Authorization = new("Bearer", dsOpt.Value.ApiKey);
        using var resp = await http.SendAsync(req, ct);
        var raw = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"DeepSeek HTTP {(int)resp.StatusCode}: {Truncate(raw, 500)}");
        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        var text = root.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
        var usage = root.TryGetProperty("usage", out var u) ? u : default;
        var pt = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("prompt_tokens", out var p) ? p.GetInt32() : 0;
        var ctk = usage.ValueKind == JsonValueKind.Object && usage.TryGetProperty("completion_tokens", out var c) ? c.GetInt32() : 0;
        return new AiResult(text, model, false, pt, ctk);
    }

    // ---------- 混元 (腾讯云 SDK, TC3 签名) ----------
    private HunyuanClient CreateHunyuanClient()
    {
        var cred = new Credential { SecretId = tcOpt.Value.SecretId, SecretKey = tcOpt.Value.SecretKey };
        return new HunyuanClient(cred, "ap-guangzhou");
    }

    private async Task<AiResult> CallHunyuanAsync(string system, string user, CancellationToken ct)
    {
        var client = CreateHunyuanClient();
        var req = new ChatCompletionsRequest
        {
            Model = hyOpt.Value.ModelLite,
            Messages =
            [
                new Message { Role = "system", Content = system },
                new Message { Role = "user", Content = user }
            ],
            Stream = false
        };
        var resp = await client.ChatCompletions(req);
        var text = resp.Choices?.FirstOrDefault()?.Message?.Content;
        return new AiResult(text, hyOpt.Value.ModelLite, false,
            (int)(resp.Usage?.PromptTokens ?? 0), (int)(resp.Usage?.CompletionTokens ?? 0));
    }

    // ---------- helpers ----------
    private async Task SaveTaskAsync(AiTask task, Stopwatch sw, CancellationToken ct)
    {
        task.DurationMs = sw.ElapsedMilliseconds;
        await db.SaveChangesAsync(ct);
    }

    private static string? Truncate(string? s, int max) =>
        s == null ? null : (s.Length <= max ? s : s[..max]);

    /// <summary>从可能带 markdown 代码块的回复中抽取 JSON。</summary>
    internal static string? ExtractJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var t = text.Trim();
        if (t.StartsWith("```"))
        {
            var firstNewline = t.IndexOf('\n');
            var lastFence = t.LastIndexOf("```", StringComparison.Ordinal);
            if (firstNewline > 0 && lastFence > firstNewline)
                t = t[(firstNewline + 1)..lastFence].Trim();
        }
        var objStart = t.IndexOf('{');
        var arrStart = t.IndexOf('[');
        var start = (objStart, arrStart) switch
        {
            (-1, -1) => -1,
            (-1, _) => arrStart,
            (_, -1) => objStart,
            _ => Math.Min(objStart, arrStart)
        };
        if (start < 0) return null;
        var isObj = t[start] == '{';
        var end = t.LastIndexOf(isObj ? '}' : ']');
        return end > start ? t[start..(end + 1)] : null;
    }
}
