using System.Text.Json;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Ai.Prompts;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Kanau.Infrastructure.Pipeline;

public class ReviewGenerator(KanauDbContext db, IAiGateway ai, ILogger<ReviewGenerator> logger) : IReviewGenerator
{
    public async Task GenerateWeeklyReviewsAsync()
    {
        // 周日跑：回顾本周（周一为一周起点）
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8)); // 北京时间
        var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
        foreach (var userId in await ActiveUserIdsAsync())
        {
            try { await GenerateForUserAsync(userId, PeriodType.Week, weekStart); }
            catch (Exception ex) { logger.LogError(ex, "周回顾生成失败 user={UserId}", userId); }
        }
    }

    public async Task GenerateMonthlyReviewsAsync()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        var monthStart = new DateOnly(today.Year, today.Month, 1);
        foreach (var userId in await ActiveUserIdsAsync())
        {
            try { await GenerateForUserAsync(userId, PeriodType.Month, monthStart); }
            catch (Exception ex) { logger.LogError(ex, "月回顾生成失败 user={UserId}", userId); }
        }
    }

    public async Task GenerateForUserAsync(Guid userId, PeriodType periodType, DateOnly periodStart)
    {
        var periodEnd = periodType == PeriodType.Week ? periodStart.AddDays(7) : periodStart.AddMonths(1);

        var todos = await db.TodoItems
            .Where(t => t.UserId == userId && t.Date >= periodStart && t.Date < periodEnd)
            .ToListAsync();

        // 六领域投入占比（按完成 todo 关联梦想的领域）
        var dreamIds = todos.Where(t => t.DreamId != null).Select(t => t.DreamId!.Value).Distinct().ToList();
        var dreams = await db.Dreams.Where(d => dreamIds.Contains(d.Id)).ToListAsync();
        var areaMap = dreams.ToDictionary(d => d.Id, d => d.PyramidArea);

        var total = todos.Count;
        var done = todos.Count(t => t.Status == TodoStatus.Done);
        var mostPostponed = todos.OrderByDescending(t => t.PostponeCount).Take(3)
            .Where(t => t.PostponeCount > 0)
            .Select(t => new { t.Title, t.PostponeCount }).ToList();
        var areaStats = todos.Where(t => t.DreamId != null && areaMap.ContainsKey(t.DreamId.Value))
            .GroupBy(t => areaMap[t.DreamId!.Value])
            .ToDictionary(g => g.Key.ToString(), g => g.Count());

        var stats = new
        {
            total, done,
            completionRate = total == 0 ? 0 : Math.Round(done * 100.0 / total, 1),
            mostPostponed, areaStats
        };
        var statsJson = JsonSerializer.Serialize(stats);

        // 已存在则更新（幂等）
        var review = await db.Reviews.FirstOrDefaultAsync(r =>
            r.UserId == userId && r.PeriodType == periodType && r.PeriodStart == periodStart);
        if (review == null)
        {
            review = new Review { Id = Guid.NewGuid(), UserId = userId, PeriodType = periodType, PeriodStart = periodStart };
            db.Reviews.Add(review);
        }
        review.StatsSnapshot = statsJson;

        // 用户口述补充
        var extraTexts = new List<string>();
        if (!string.IsNullOrEmpty(review.CaptureIds))
        {
            var ids = JsonSerializer.Deserialize<List<Guid>>(review.CaptureIds) ?? [];
            var caps = await db.CaptureItems.Where(c => ids.Contains(c.Id)).ToListAsync();
            extraTexts.AddRange(caps.Where(c => !string.IsNullOrWhiteSpace(c.CorrectedText)).Select(c => c.CorrectedText!));
        }

        var user = await db.Users.FindAsync(userId);
        var isChild = user?.IsChild ?? false;
        var periodName = periodType == PeriodType.Week ? "周" : "月";
        var prompt = $"本{periodName}执行统计：{statsJson}" +
                     (extraTexts.Count > 0 ? $"\n用户口述补充：\n{string.Join("\n", extraTexts)}" : "");

        if (total > 0 || extraTexts.Count > 0)
        {
            var r = await ai.ChatAsync(AiTaskType.Review, userId, PromptTemplates.ReviewSystem(isChild), prompt);
            review.AiComment = r.Text;
        }
        else
        {
            review.AiComment = $"本{periodName}还没有记录任何事项，从写下一个小梦想开始吧！";
        }

        await db.SaveChangesAsync();
    }

    private async Task<List<Guid>> ActiveUserIdsAsync() =>
        await db.Users.Select(u => u.Id).ToListAsync();
}

public class TodoRolloverService(KanauDbContext db, ILogger<TodoRolloverService> logger) : ITodoRolloverService
{
    /// <summary>每日凌晨：昨天未完成的待办顺延到今天，顺延计数 +1。</summary>
    public async Task RolloverAsync()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        var overdue = await db.TodoItems
            .Where(t => t.Status == TodoStatus.Pending && t.Date < today)
            .ToListAsync();
        foreach (var t in overdue)
        {
            t.Date = today;
            t.PostponeCount++;
        }
        if (overdue.Count > 0)
        {
            await db.SaveChangesAsync();
            logger.LogInformation("顺延 {Count} 条待办到 {Today}", overdue.Count, today);
        }
    }
}
