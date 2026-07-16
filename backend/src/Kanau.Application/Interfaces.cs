using Kanau.Domain;

namespace Kanau.Application;

/// <summary>AI 统一网关：按任务类型路由到 DeepSeek / 混元，带降级。</summary>
public interface IAiGateway
{
    /// <summary>通用 chat 补全。taskType 决定路由；返回文本与用量已记入 AiTask。</summary>
    Task<AiResult> ChatAsync(AiTaskType taskType, Guid userId, string systemPrompt, string userPrompt,
        bool forceStrong = false, CancellationToken ct = default);

    /// <summary>要求 JSON 输出的任务：反序列化校验失败自动重试一次。</summary>
    Task<T?> ChatJsonAsync<T>(AiTaskType taskType, Guid userId, string systemPrompt, string userPrompt,
        bool forceStrong = false, CancellationToken ct = default) where T : class;

    Task<float[]?> EmbedAsync(Guid userId, string text, CancellationToken ct = default);
}

public record AiResult(string? Text, string Model, bool Degraded, int PromptTokens, int CompletionTokens);

/// <summary>COS 直传凭证与预签名 URL。</summary>
public interface ICosService
{
    /// <summary>签发限定 objectKey 前缀的 STS 临时密钥（前端直传）。</summary>
    Task<CosStsCredential> GetUploadCredentialAsync(Guid userId, string ext, CancellationToken ct = default);

    /// <summary>下载用预签名 URL（原件回看）。</summary>
    string GetPresignedUrl(string objectKey, TimeSpan expires);

    /// <summary>后端自用：下载对象到本地临时文件（ffmpeg 处理用）。</summary>
    Task DownloadAsync(string objectKey, string localPath, CancellationToken ct = default);

    /// <summary>后端自用：上传本地文件（关键帧等）。</summary>
    Task UploadAsync(string objectKey, string localPath, CancellationToken ct = default);
}

public record CosStsCredential(
    string TmpSecretId, string TmpSecretKey, string SessionToken,
    long ExpiredTime, string Bucket, string Region, string ObjectKey);

public interface IAsrService
{
    /// <summary>一句话识别（≤60s 音频，同步）。urlOrKey 为 COS 对象的可访问 URL。</summary>
    Task<string?> RecognizeShortAsync(string audioUrl, string format, CancellationToken ct = default);

    /// <summary>录音文件识别（异步）：创建任务，返回腾讯云 TaskId。</summary>
    Task<ulong> CreateLongRecognitionAsync(string audioUrl, CancellationToken ct = default);

    /// <summary>轮询录音文件识别结果。返回 null 表示仍在处理。</summary>
    Task<AsrLongResult?> PollLongRecognitionAsync(ulong taskId, CancellationToken ct = default);
}

public record AsrLongResult(bool Success, string? Text, string? Error);

public interface IOcrService
{
    Task<string?> ExtractTextAsync(string imageUrl, CancellationToken ct = default);
}

public interface ILbsService
{
    /// <summary>逆地址解析。</summary>
    Task<string?> ReverseGeocodeAsync(double lat, double lng, CancellationToken ct = default);
}

/// <summary>捕获管线：Hangfire 任务入口。</summary>
public interface ICapturePipeline
{
    /// <summary>处理一条 CaptureItem：提取文本 → AI 修正 → 打标/向量化 → SignalR 推送。</summary>
    Task ProcessAsync(Guid captureId);

    /// <summary>轮询长音频 ASR 任务结果。</summary>
    Task PollAsrTaskAsync(Guid captureId, ulong asrTaskId, int attempt);
}

/// <summary>SignalR 推送抽象（Infrastructure 不引用 Api）。</summary>
public interface ICaptureNotifier
{
    Task NotifyStatusAsync(Guid userId, Guid captureId, CaptureStatus status, string? failReason = null);
}

/// <summary>周期回顾生成（Hangfire 定时任务）。</summary>
public interface IReviewGenerator
{
    Task GenerateWeeklyReviewsAsync();
    Task GenerateMonthlyReviewsAsync();
    Task GenerateForUserAsync(Guid userId, PeriodType periodType, DateOnly periodStart);
}

/// <summary>每日事项顺延（Hangfire 定时任务）。</summary>
public interface ITodoRolloverService
{
    Task RolloverAsync();
}
