using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class DreamTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    private static object Dto(Dream d) => new
    {
        d.Id, d.Title, d.QuantifiedText, d.PyramidArea, d.TargetDate,
        d.Status, d.AchievedAt, d.CreatedAt
    };

    [McpServerTool(Name = "list_dreams"), Description("列出当前用户的梦想。可按状态过滤：Draft(草稿)/Active(进行中)/Achieved(已实现)/Archived(已归档)，不传则返回全部。")]
    public async Task<string> ListDreams(
        [Description("状态过滤，可选：Draft/Active/Achieved/Archived")] string? status = null)
    {
        var q = db.Dreams.AsNoTracking().Where(d => d.UserId == UserId);
        if (Enum.TryParse<DreamStatus>(status, true, out var st)) q = q.Where(d => d.Status == st);
        var list = await q.OrderByDescending(d => d.CreatedAt).ToListAsync();
        return Json(list.Select(Dto));
    }

    [McpServerTool(Name = "get_dream"), Description("查看一个梦想的详情，含其行动计划（年/月/周）。")]
    public async Task<string> GetDream([Description("梦想 ID")] string dreamId)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null
            : await db.Dreams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        var plans = await db.ActionPlans.AsNoTracking()
            .Where(p => p.DreamId == d.Id && p.UserId == UserId)
            .OrderBy(p => p.Level).ThenBy(p => p.Period).ThenBy(p => p.SortOrder).ToListAsync();
        return Json(new
        {
            dream = Dto(d),
            plans = plans.Select(p => new { p.Id, p.Level, p.Period, p.Content, p.Source })
        });
    }

    [McpServerTool(Name = "create_dream"), Description("创建一个新梦想（状态为 Active）。人生金字塔六领域：Health(健康)/Knowledge(修养知识)/Mind(心灵精神)为基础层，Work(社会工作)/Family(私人家庭)为实现层，Wealth(经济物质)为结果层。")]
    public async Task<string> CreateDream(
        [Description("梦想标题")] string title,
        [Description("所属领域：Health/Knowledge/Mind/Work/Family/Wealth")] string pyramidArea,
        [Description("SMART 量化描述，可选")] string? quantifiedText = null,
        [Description("目标日期 yyyy-MM-dd，可选")] string? targetDate = null)
    {
        if (string.IsNullOrWhiteSpace(title)) return "标题不能为空";
        if (!Enum.TryParse<PyramidArea>(pyramidArea, true, out var area))
            return "pyramidArea 无效，可选值：Health/Knowledge/Mind/Work/Family/Wealth";
        DateTime? target = DateTime.TryParse(targetDate, out var t) ? DateTime.SpecifyKind(t, DateTimeKind.Utc) : null;
        var d = new Dream
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = title.Trim(),
            QuantifiedText = quantifiedText, PyramidArea = area, TargetDate = target,
            Status = DreamStatus.Active
        };
        db.Dreams.Add(d);
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }

    [McpServerTool(Name = "update_dream"), Description("更新梦想。只传需要修改的字段，未传字段保持不变。")]
    public async Task<string> UpdateDream(
        [Description("梦想 ID")] string dreamId,
        [Description("新标题，可选")] string? title = null,
        [Description("新的 SMART 量化描述，可选")] string? quantifiedText = null,
        [Description("新领域：Health/Knowledge/Mind/Work/Family/Wealth，可选")] string? pyramidArea = null,
        [Description("新目标日期 yyyy-MM-dd，可选")] string? targetDate = null)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null : await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        if (!string.IsNullOrWhiteSpace(title)) d.Title = title.Trim();
        if (quantifiedText != null) d.QuantifiedText = quantifiedText;
        if (pyramidArea != null)
        {
            if (!Enum.TryParse<PyramidArea>(pyramidArea, true, out var area))
                return "pyramidArea 无效，可选值：Health/Knowledge/Mind/Work/Family/Wealth";
            d.PyramidArea = area;
        }
        if (targetDate != null && DateTime.TryParse(targetDate, out var t))
            d.TargetDate = DateTime.SpecifyKind(t, DateTimeKind.Utc);
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }

    [McpServerTool(Name = "set_dream_status"), Description("修改梦想状态：Active(进行中)/Achieved(已实现)/Archived(归档)。标记 Achieved 会记录实现时间。")]
    public async Task<string> SetDreamStatus(
        [Description("梦想 ID")] string dreamId,
        [Description("新状态：Draft/Active/Achieved/Archived")] string status)
    {
        var id = ParseId(dreamId);
        var d = id == null ? null : await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return "未找到该梦想";
        if (!Enum.TryParse<DreamStatus>(status, true, out var st))
            return "status 无效，可选值：Draft/Active/Achieved/Archived";
        d.Status = st;
        if (st == DreamStatus.Achieved) d.AchievedAt = DateTime.UtcNow;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Json(Dto(d));
    }
}
