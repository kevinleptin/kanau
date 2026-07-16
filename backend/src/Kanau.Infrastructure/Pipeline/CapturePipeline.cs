using System.Diagnostics;
using System.Text.Json;
using Hangfire;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Ai;
using Kanau.Infrastructure.Ai.Prompts;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kanau.Infrastructure.Pipeline;

/// <summary>
/// 统一捕获管线：uploaded → extracting → correcting → ready / failed。
/// 每步状态变更经 SignalR 推送。由 Hangfire 执行（自带重试）。
/// </summary>
public class CapturePipeline(
    KanauDbContext db,
    ICosService cos,
    IAsrService asr,
    IOcrService ocr,
    ILbsService lbs,
    IAiGateway ai,
    ICaptureNotifier notifier,
    IBackgroundJobClient jobs,
    IOptions<FfmpegOptions> ffmpegOpt,
    ILogger<CapturePipeline> logger) : ICapturePipeline
{
    public async Task ProcessAsync(Guid captureId)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == captureId);
        if (item == null) return;

        try
        {
            // 1) 文本提取
            if (item.RawText == null && item.Type != CaptureType.Text)
            {
                await SetStatusAsync(item, CaptureStatus.Extracting);
                var extracted = await ExtractAsync(item);
                if (extracted == PipelineOutcome.WaitingAsync) return; // 长音频异步，等轮询
                if (extracted == PipelineOutcome.Failed) return;       // 已置 failed
            }

            await CorrectAndFinishAsync(item);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "捕获管线失败 capture={CaptureId}", captureId);
            await FailAsync(item, ex.Message);
            throw; // 让 Hangfire 重试
        }
    }

    private enum PipelineOutcome { Done, WaitingAsync, Failed }

    private async Task<PipelineOutcome> ExtractAsync(CaptureItem item)
    {
        switch (item.Type)
        {
            case CaptureType.Audio:
            {
                var url = cos.GetPresignedUrl(item.CosObjectKey!, TimeSpan.FromHours(2));
                if (item.DurationSec is > 0 and <= 58)
                {
                    var format = GuessAudioFormat(item);
                    item.RawText = await asr.RecognizeShortAsync(url, format) ?? "";
                    return PipelineOutcome.Done;
                }
                var taskId = await asr.CreateLongRecognitionAsync(url);
                jobs.Schedule<ICapturePipeline>(p => p.PollAsrTaskAsync(item.Id, taskId, 0), TimeSpan.FromSeconds(10));
                await db.SaveChangesAsync();
                return PipelineOutcome.WaitingAsync;
            }
            case CaptureType.Image:
            {
                var url = cos.GetPresignedUrl(item.CosObjectKey!, TimeSpan.FromHours(1));
                item.RawText = await ocr.ExtractTextAsync(url) ?? "";
                return PipelineOutcome.Done;
            }
            case CaptureType.Video:
                return await ExtractVideoAsync(item);
            default:
                return PipelineOutcome.Done;
        }
    }

    /// <summary>视频：ffmpeg 抽音轨 → 长音频识别（异步）；同时抽关键帧 → OCR，结果暂存。</summary>
    private async Task<PipelineOutcome> ExtractVideoAsync(CaptureItem item)
    {
        var work = Path.Combine(ffmpegOpt.Value.WorkDir, item.Id.ToString("N"));
        Directory.CreateDirectory(work);
        var localVideo = Path.Combine(work, "video.bin");
        try
        {
            await cos.DownloadAsync(item.CosObjectKey!, localVideo);

            // 抽音轨为 mp3
            var audioPath = Path.Combine(work, "audio.mp3");
            await RunFfmpegAsync($"-y -i \"{localVideo}\" -vn -acodec libmp3lame -ar 16000 -ac 1 \"{audioPath}\"");

            // 抽 3 张关键帧
            var framePattern = Path.Combine(work, "frame_%d.jpg");
            await RunFfmpegAsync($"-y -i \"{localVideo}\" -vf \"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,5)',scale=1280:-1\" -frames:v 3 -vsync vfr \"{framePattern}\"");

            // 关键帧 OCR（上传 COS 再给 OCR URL）
            var ocrTexts = new List<string>();
            for (var i = 1; i <= 3; i++)
            {
                var frame = Path.Combine(work, $"frame_{i}.jpg");
                if (!File.Exists(frame)) continue;
                var frameKey = $"{item.CosObjectKey}.frame{i}.jpg";
                await cos.UploadAsync(frameKey, frame);
                var text = await ocr.ExtractTextAsync(cos.GetPresignedUrl(frameKey, TimeSpan.FromHours(1)));
                if (!string.IsNullOrWhiteSpace(text)) ocrTexts.Add(text!);
            }
            // 音轨上传 COS，走长音频识别
            var audioKey = $"{item.CosObjectKey}.audio.mp3";
            await cos.UploadAsync(audioKey, audioPath);
            var audioUrl = cos.GetPresignedUrl(audioKey, TimeSpan.FromHours(4));
            var taskId = await asr.CreateLongRecognitionAsync(audioUrl);

            // 关键帧 OCR 文本先存 RawText（转写完成后合并）
            if (ocrTexts.Count > 0)
                item.RawText = "【画面文字】\n" + string.Join("\n---\n", ocrTexts);
            await db.SaveChangesAsync();

            jobs.Schedule<ICapturePipeline>(p => p.PollAsrTaskAsync(item.Id, taskId, 0), TimeSpan.FromSeconds(15));
            return PipelineOutcome.WaitingAsync;
        }
        finally
        {
            try { Directory.Delete(work, true); } catch { /* 忽略清理失败 */ }
        }
    }

    public async Task PollAsrTaskAsync(Guid captureId, ulong asrTaskId, int attempt)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == captureId);
        if (item == null || item.Status == CaptureStatus.Failed) return;

        var result = await asr.PollLongRecognitionAsync(asrTaskId);
        if (result == null)
        {
            if (attempt >= 60) { await FailAsync(item, "语音识别超时"); return; }
            jobs.Schedule<ICapturePipeline>(p => p.PollAsrTaskAsync(captureId, asrTaskId, attempt + 1),
                TimeSpan.FromSeconds(Math.Min(10 + attempt * 5, 60)));
            return;
        }
        if (!result.Success) { await FailAsync(item, result.Error ?? "语音识别失败"); return; }

        // 视频场景：合并已有关键帧 OCR 文本
        var asrText = result.Text ?? "";
        item.RawText = string.IsNullOrWhiteSpace(item.RawText)
            ? asrText
            : $"{asrText}\n\n{item.RawText}";

        await CorrectAndFinishAsync(item);
    }

    /// <summary>AI 修正 → 打标 → 向量化 → 逆地址解析 → ready。</summary>
    private async Task CorrectAndFinishAsync(CaptureItem item)
    {
        await SetStatusAsync(item, CaptureStatus.Correcting);

        var raw = item.RawText;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            if (item.Type == CaptureType.Text)
            {
                // 用户手打文本无需修正
                item.CorrectedText = raw;
            }
            else
            {
                try
                {
                    var r = await ai.ChatAsync(AiTaskType.Correction, item.UserId,
                        PromptTemplates.CorrectionSystem, raw!);
                    item.CorrectedText = string.IsNullOrWhiteSpace(r.Text) ? raw : r.Text!.Trim();
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "AI 修正失败，使用原文 capture={CaptureId}", item.Id);
                    item.CorrectedText = raw;
                }
            }

            // Embedding（失败不阻塞）
            var vec = await ai.EmbedAsync(item.UserId, item.CorrectedText!);
            if (vec != null) item.Embedding = JsonSerializer.Serialize(vec);
        }
        else
        {
            item.CorrectedText = "";
        }

        // 逆地址解析
        if (item is { Lat: not null, Lng: not null, ResolvedAddress: null })
            item.ResolvedAddress = await lbs.ReverseGeocodeAsync(item.Lat.Value, item.Lng.Value);

        await SetStatusAsync(item, CaptureStatus.Ready);
    }

    /// <summary>用户手动"重新修正"（走 DeepSeek）。</summary>
    public async Task RecorrectAsync(Guid captureId)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == captureId);
        if (item?.RawText == null) return;
        var r = await ai.ChatAsync(AiTaskType.Correction, item.UserId,
            PromptTemplates.CorrectionSystem, item.RawText, forceStrong: true);
        if (!string.IsNullOrWhiteSpace(r.Text)) item.CorrectedText = r.Text!.Trim();
        await SetStatusAsync(item, CaptureStatus.Ready);
    }

    private async Task SetStatusAsync(CaptureItem item, CaptureStatus status)
    {
        item.Status = status;
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await notifier.NotifyStatusAsync(item.UserId, item.Id, status);
    }

    private async Task FailAsync(CaptureItem? item, string reason)
    {
        if (item == null) return;
        item.Status = CaptureStatus.Failed;
        item.FailReason = reason.Length > 900 ? reason[..900] : reason;
        item.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        await notifier.NotifyStatusAsync(item.UserId, item.Id, CaptureStatus.Failed, item.FailReason);
    }

    private static string GuessAudioFormat(CaptureItem item)
    {
        var ext = Path.GetExtension(item.CosObjectKey ?? "")?.TrimStart('.').ToLowerInvariant();
        return ext switch
        {
            "mp3" or "wav" or "m4a" or "aac" or "ogg-opus" or "amr" => ext,
            "ogg" or "opus" or "webm" => "ogg-opus",
            _ => item.Mime?.Contains("webm") == true || item.Mime?.Contains("ogg") == true ? "ogg-opus" : "mp3"
        };
    }

    private async Task RunFfmpegAsync(string args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = ffmpegOpt.Value.Path,
            Arguments = args,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };
        using var proc = Process.Start(psi)!;
        var stderr = await proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"ffmpeg 失败 (exit {proc.ExitCode}): {stderr[^Math.Min(stderr.Length, 500)..]}");
    }
}
