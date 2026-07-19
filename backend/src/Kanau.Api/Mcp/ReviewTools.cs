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
