using Kanau.Application;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TencentCloud.Asr.V20190614;
using TencentCloud.Asr.V20190614.Models;
using TencentCloud.Common;

namespace Kanau.Infrastructure.Tencent;

public class AsrService(IOptions<TencentOptions> tc, IOptions<AsrOptions> asrOpt, ILogger<AsrService> logger)
    : IAsrService
{
    private AsrClient CreateClient()
    {
        var cred = new Credential { SecretId = tc.Value.SecretId, SecretKey = tc.Value.SecretKey };
        return new AsrClient(cred, asrOpt.Value.Region);
    }

    public async Task<string?> RecognizeShortAsync(string audioUrl, string format, CancellationToken ct = default)
    {
        var client = CreateClient();
        var req = new SentenceRecognitionRequest
        {
            EngSerViceType = "16k_zh",
            SourceType = 0,          // URL 方式
            Url = audioUrl,
            VoiceFormat = format,    // mp3/wav/m4a/aac...
        };
        var resp = await client.SentenceRecognition(req);
        return resp.Result;
    }

    public async Task<ulong> CreateLongRecognitionAsync(string audioUrl, CancellationToken ct = default)
    {
        var client = CreateClient();
        var req = new CreateRecTaskRequest
        {
            EngineModelType = "16k_zh",
            ChannelNum = 1,
            ResTextFormat = 0,
            SourceType = 0,
            Url = audioUrl
        };
        var resp = await client.CreateRecTask(req);
        return resp.Data?.TaskId ?? throw new InvalidOperationException("ASR CreateRecTask 未返回 TaskId");
    }

    public async Task<AsrLongResult?> PollLongRecognitionAsync(ulong taskId, CancellationToken ct = default)
    {
        var client = CreateClient();
        var req = new DescribeTaskStatusRequest { TaskId = taskId };
        var resp = await client.DescribeTaskStatus(req);
        var status = resp.Data?.StatusStr; // waiting / doing / success / failed
        return status switch
        {
            "success" => new AsrLongResult(true, StripTimestamps(resp.Data?.Result), null),
            "failed" => new AsrLongResult(false, null, resp.Data?.ErrorMsg ?? "ASR 识别失败"),
            _ => null
        };
    }

    /// <summary>录音文件识别结果每行形如 "[0:0.000,0:5.900]  文本"，去掉时间戳合并。</summary>
    internal static string? StripTimestamps(string? result)
    {
        if (string.IsNullOrWhiteSpace(result)) return result;
        var lines = result.Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l =>
            {
                var idx = l.IndexOf(']');
                return idx >= 0 && l.TrimStart().StartsWith('[') ? l[(idx + 1)..].Trim() : l.Trim();
            })
            .Where(l => l.Length > 0);
        return string.Join('\n', lines);
    }
}
