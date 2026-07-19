using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class PlanTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    [McpServerTool(Name = "list_plans"), Description("列出行动计划。可按梦想或周期过滤。层级：Year(年)/Month(月)/Week(周)；周期格式如 2026 / 2026-08 / 2026-W31。")]
    public async Task<string> ListPlans(
        [Description("梦想 ID，可选")] string? dreamId = null,
        [Description("周期过滤，如 2026-08，可选")] string? period = null)
    {
        var q = db.ActionPlans.AsNoTracking().Where(p => p.UserId == UserId);
        var did = ParseId(dreamId);
        if (did != null) q = q.Where(p => p.DreamId == did);
        if (!string.IsNullOrEmpty(period)) q = q.Where(p => p.Period == period);
        var list = await q.OrderBy(p => p.DreamId).ThenBy(p => p.Level)
            .ThenBy(p => p.Period).ThenBy(p => p.SortOrder).ToListAsync();
        return Json(list.Select(p => new { p.Id, p.DreamId, p.Level, p.Period, p.Content, p.Source }));
    }

    [McpServerTool(Name = "create_plan"), Description("为某个梦想创建一条行动计划。")]
    public async Task<string> CreatePlan(
        [Description("梦想 ID")] string dreamId,
        [Description("层级：Year/Month/Week")] string level,
        [Description("计划内容")] string content,
        [Description("所属周期，如 2026 / 2026-08 / 2026-W31，可选")] string? period = null)
    {
        var did = ParseId(dreamId);
        var dream = did == null ? null
            : await db.Dreams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == did && x.UserId == UserId);
        if (dream == null) return "未找到该梦想";
        if (!Enum.TryParse<PlanLevel>(level, true, out var lv)) return "level 无效，可选值：Year/Month/Week";
        if (string.IsNullOrWhiteSpace(content)) return "内容不能为空";
        var maxSort = await db.ActionPlans
            .Where(p => p.DreamId == dream.Id && p.Level == lv && p.Period == period)
            .Select(p => (int?)p.SortOrder).MaxAsync() ?? 0;
        var plan = new ActionPlan
        {
            Id = Guid.NewGuid(), UserId = UserId, DreamId = dream.Id, Level = lv,
            Content = content.Trim(), Period = period, SortOrder = maxSort + 1, Source = PlanSource.Manual
        };
        db.ActionPlans.Add(plan);
        await db.SaveChangesAsync();
        return Json(new { plan.Id, plan.DreamId, plan.Level, plan.Period, plan.Content });
    }

    [McpServerTool(Name = "delete_plan"), Description("删除一条行动计划。")]
    public async Task<string> DeletePlan([Description("计划 ID")] string planId)
    {
        var id = ParseId(planId);
        var p = id == null ? null : await db.ActionPlans.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (p == null) return "未找到该计划";
        db.ActionPlans.Remove(p);
        await db.SaveChangesAsync();
        return "已删除";
    }
}
