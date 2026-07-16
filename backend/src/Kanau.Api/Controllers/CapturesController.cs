using Hangfire;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Kanau.Infrastructure.Pipeline;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

public record CreateTextCaptureRequest(string Text, double? Lat, double? Lng);
public record RequestUploadRequest(string Ext, string Mime);
public record ConfirmUploadRequest(string ObjectKey, string Mime, long SizeBytes, double? DurationSec,
    CaptureType Type, double? Lat, double? Lng);

[Route("api/captures")]
public class CapturesController(KanauDbContext db, ICosService cos, IBackgroundJobClient jobs) : KanauControllerBase
{
    /// <summary>纯文本输入：直接创建并异步做打标/向量化。</summary>
    [HttpPost("text")]
    public async Task<ActionResult> CreateText(CreateTextCaptureRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Text)) return BadRequest(new { message = "内容不能为空" });
        var item = new CaptureItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Type = CaptureType.Text,
            RawText = req.Text.Trim(), Status = CaptureStatus.Uploaded,
            Lat = req.Lat, Lng = req.Lng
        };
        db.CaptureItems.Add(item);
        await db.SaveChangesAsync();
        jobs.Enqueue<ICapturePipeline>(p => p.ProcessAsync(item.Id));
        return Ok(ToDto(item));
    }

    /// <summary>申请 COS 直传临时密钥。</summary>
    [HttpPost("upload-credential")]
    public async Task<ActionResult<CosStsCredential>> RequestUpload(RequestUploadRequest req) =>
        Ok(await cos.GetUploadCredentialAsync(UserId, req.Ext, HttpContext.RequestAborted));

    /// <summary>直传完成后确认，创建 CaptureItem 并进入管线。</summary>
    [HttpPost("confirm")]
    public async Task<ActionResult> ConfirmUpload(ConfirmUploadRequest req)
    {
        if (!req.ObjectKey.StartsWith($"captures/{UserId}/")) return Forbid();
        var item = new CaptureItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Type = req.Type,
            CosObjectKey = req.ObjectKey, Mime = req.Mime, SizeBytes = req.SizeBytes,
            DurationSec = req.DurationSec, Status = CaptureStatus.Uploaded,
            Lat = req.Lat, Lng = req.Lng
        };
        db.CaptureItems.Add(item);
        await db.SaveChangesAsync();
        jobs.Enqueue<ICapturePipeline>(p => p.ProcessAsync(item.Id));
        return Ok(ToDto(item));
    }

    [HttpGet]
    public async Task<ActionResult> List(int page = 1, int pageSize = 20)
    {
        var q = db.CaptureItems.Where(c => c.UserId == UserId).OrderByDescending(c => c.CreatedAt);
        var total = await q.CountAsync();
        var items = await q.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return Ok(new { total, items = items.Select(ToDto) });
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult> Get(Guid id)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == id && c.UserId == UserId);
        return item == null ? NotFound() : Ok(ToDto(item));
    }

    /// <summary>原件预签名下载 URL。</summary>
    [HttpGet("{id:guid}/original-url")]
    public async Task<ActionResult> OriginalUrl(Guid id)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == id && c.UserId == UserId);
        if (item?.CosObjectKey == null) return NotFound();
        return Ok(new { url = cos.GetPresignedUrl(item.CosObjectKey, TimeSpan.FromHours(1)) });
    }

    /// <summary>失败重试（不重复扣额度：直接重入管线）。</summary>
    [HttpPost("{id:guid}/retry")]
    public async Task<ActionResult> Retry(Guid id)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == id && c.UserId == UserId);
        if (item == null) return NotFound();
        if (item.Status != CaptureStatus.Failed) return BadRequest(new { message = "仅失败状态可重试" });
        item.Status = CaptureStatus.Uploaded;
        item.FailReason = null;
        await db.SaveChangesAsync();
        jobs.Enqueue<ICapturePipeline>(p => p.ProcessAsync(item.Id));
        return Ok(ToDto(item));
    }

    /// <summary>手动"重新修正"（走 DeepSeek）。</summary>
    [HttpPost("{id:guid}/recorrect")]
    public async Task<ActionResult> Recorrect(Guid id)
    {
        var item = await db.CaptureItems.FirstOrDefaultAsync(c => c.Id == id && c.UserId == UserId);
        if (item == null) return NotFound();
        jobs.Enqueue<CapturePipeline>(p => p.RecorrectAsync(item.Id));
        return Ok(new { message = "已提交重新修正" });
    }

    internal static object ToDto(CaptureItem c) => new
    {
        c.Id, type = c.Type.ToString().ToLowerInvariant(), c.CosObjectKey, c.Mime,
        c.SizeBytes, c.DurationSec, c.RawText, c.CorrectedText,
        status = c.Status.ToString().ToLowerInvariant(), c.FailReason,
        c.Lat, c.Lng, c.ResolvedAddress, c.CreatedAt
    };
}
