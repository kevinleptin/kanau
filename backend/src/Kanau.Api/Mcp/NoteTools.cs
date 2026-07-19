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
