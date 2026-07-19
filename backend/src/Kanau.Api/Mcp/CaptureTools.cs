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
