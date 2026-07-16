using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Ai.Prompts;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

// ---- AI 拆解草稿结构（与 prompt schema 对应） ----
public record YearFocus(int Year, string Focus);
public record MonthPlan(string Month, List<string> Items);
public record WeekPlan(string Week, List<string> Items);
public record DayTodos(string Date, List<string> Items);
public record DecomposeDraft(List<string> Musts, List<YearFocus> YearlyFocus,
    List<MonthPlan> MonthlyPlans, List<WeekPlan> WeeklyPlans, List<DayTodos> DailyTodos);

[Route("api/plans")]
public class PlansController(KanauDbContext db, IAiGateway ai) : KanauControllerBase
{
    /// <summary>AI 拆解梦想 → 返回结构化草稿（不落正式数据）。</summary>
    [HttpPost("decompose/{dreamId:guid}")]
    public async Task<ActionResult> Decompose(Guid dreamId)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == dreamId && x.UserId == UserId);
        if (d == null) return NotFound();
        var user = await db.Users.FindAsync(UserId);
        var target = d.TargetDate?.ToString("yyyy-MM-dd") ?? "未设定";
        var draft = await ai.ChatJsonAsync<DecomposeDraft>(AiTaskType.Decompose, UserId,
            PromptTemplates.DecomposeSystem(user?.IsChild ?? false),
            $"今天是 {DateTime.UtcNow.AddHours(8):yyyy-MM-dd}。梦想：{d.QuantifiedText ?? d.Title}，目标日期：{target}。");
        if (draft == null) return StatusCode(502, new { message = "AI 拆解暂时不可用，请稍后再试" });
        return Ok(draft);
    }

    /// <summary>采纳（用户编辑后的）拆解草稿：生成正式计划与 TodoItem。</summary>
    [HttpPost("adopt/{dreamId:guid}")]
    public async Task<ActionResult> Adopt(Guid dreamId, DecomposeDraft draft)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == dreamId && x.UserId == UserId);
        if (d == null) return NotFound();

        var sort = 0;
        foreach (var yf in draft.YearlyFocus ?? [])
            db.ActionPlans.Add(new ActionPlan
            {
                Id = Guid.NewGuid(), UserId = UserId, DreamId = dreamId, Level = PlanLevel.Year,
                Content = yf.Focus, Period = yf.Year.ToString(), SortOrder = sort++, Source = PlanSource.Ai
            });
        foreach (var mp in draft.MonthlyPlans ?? [])
            foreach (var item in mp.Items)
                db.ActionPlans.Add(new ActionPlan
                {
                    Id = Guid.NewGuid(), UserId = UserId, DreamId = dreamId, Level = PlanLevel.Month,
                    Content = item, Period = mp.Month, SortOrder = sort++, Source = PlanSource.Ai
                });
        foreach (var wp in draft.WeeklyPlans ?? [])
            foreach (var item in wp.Items)
                db.ActionPlans.Add(new ActionPlan
                {
                    Id = Guid.NewGuid(), UserId = UserId, DreamId = dreamId, Level = PlanLevel.Week,
                    Content = item, Period = wp.Week, SortOrder = sort++, Source = PlanSource.Ai
                });

        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        foreach (var dt in draft.DailyTodos ?? [])
        {
            if (!DateOnly.TryParse(dt.Date, out var date)) continue;
            if (date < today) date = today;
            foreach (var item in dt.Items)
                db.TodoItems.Add(new TodoItem
                {
                    Id = Guid.NewGuid(), UserId = UserId, DreamId = dreamId,
                    Date = date, Title = item
                });
        }

        // 必需事项清单作为年度层级前置记录
        foreach (var must in draft.Musts ?? [])
            db.ActionPlans.Add(new ActionPlan
            {
                Id = Guid.NewGuid(), UserId = UserId, DreamId = dreamId, Level = PlanLevel.Year,
                Content = $"[必需] {must}", Period = "musts", SortOrder = sort++, Source = PlanSource.Ai
            });

        await db.SaveChangesAsync();
        return Ok(new { message = "计划已生成" });
    }

    [HttpGet("dream/{dreamId:guid}")]
    public async Task<ActionResult> ListByDream(Guid dreamId)
    {
        var plans = await db.ActionPlans
            .Where(p => p.UserId == UserId && p.DreamId == dreamId)
            .OrderBy(p => p.Level).ThenBy(p => p.SortOrder).ToListAsync();
        return Ok(plans.Select(p => new
        {
            p.Id, p.DreamId, level = p.Level.ToString().ToLowerInvariant(),
            p.Content, p.Period, p.SortOrder, source = p.Source.ToString().ToLowerInvariant()
        }));
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var p = await db.ActionPlans.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (p == null) return NotFound();
        db.ActionPlans.Remove(p);
        await db.SaveChangesAsync();
        return Ok();
    }
}
