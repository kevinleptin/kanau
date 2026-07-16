using System.Text.Json;
using Hangfire;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

// ==================== 回顾 ====================
public record AppendReviewCaptureRequest(Guid CaptureId);

[Route("api/reviews")]
public class ReviewsController(KanauDbContext db, IReviewGenerator generator, IBackgroundJobClient jobs)
    : KanauControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List(int limit = 12)
    {
        var reviews = await db.Reviews.Where(r => r.UserId == UserId)
            .OrderByDescending(r => r.PeriodStart).Take(limit).ToListAsync();
        return Ok(reviews.Select(ToDto));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult> Get(Guid id)
    {
        var r = await db.Reviews.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        return r == null ? NotFound() : Ok(ToDto(r));
    }

    /// <summary>手动触发本周/本月回顾生成（也用于验收）。</summary>
    [HttpPost("generate")]
    public ActionResult Generate([FromQuery] PeriodType periodType = PeriodType.Week)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        var start = periodType == PeriodType.Week
            ? today.AddDays(-(((int)today.DayOfWeek + 6) % 7))
            : new DateOnly(today.Year, today.Month, 1);
        var uid = UserId;
        jobs.Enqueue<IReviewGenerator>(g => g.GenerateForUserAsync(uid, periodType, start));
        return Ok(new { message = "回顾生成已排队，稍后刷新查看" });
    }

    /// <summary>口述补充：把语音速记并入回顾，并重新生成点评。</summary>
    [HttpPost("{id:guid}/append-capture")]
    public async Task<ActionResult> AppendCapture(Guid id, AppendReviewCaptureRequest req)
    {
        var r = await db.Reviews.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (r == null) return NotFound();
        var ids = string.IsNullOrEmpty(r.CaptureIds) ? [] : JsonSerializer.Deserialize<List<Guid>>(r.CaptureIds)!;
        if (!ids.Contains(req.CaptureId)) ids.Add(req.CaptureId);
        r.CaptureIds = JsonSerializer.Serialize(ids);
        await db.SaveChangesAsync();
        var uid = UserId;
        jobs.Enqueue<IReviewGenerator>(g => g.GenerateForUserAsync(uid, r.PeriodType, r.PeriodStart));
        return Ok(new { message = "已提交，AI 正在重新生成点评" });
    }

    private static object ToDto(Review r) => new
    {
        r.Id, periodType = r.PeriodType.ToString().ToLowerInvariant(),
        r.PeriodStart, stats = r.StatsSnapshot, r.AiComment, r.CaptureIds, r.CreatedAt
    };
}

// ==================== 未来年表 ====================
public record UpsertTimelineRequest(int Year, string Content, Guid? DreamId);

[Route("api/timeline")]
public class TimelineController(KanauDbContext db) : KanauControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List()
    {
        var entries = await db.TimelineEntries.Where(t => t.UserId == UserId)
            .OrderBy(t => t.Year).ToListAsync();
        return Ok(entries.Select(t => new { t.Id, t.Year, t.Content, t.DreamId }));
    }

    [HttpPost]
    public async Task<ActionResult> Create(UpsertTimelineRequest req)
    {
        var t = new TimelineEntry
        {
            Id = Guid.NewGuid(), UserId = UserId, Year = req.Year,
            Content = req.Content.Trim(), DreamId = req.DreamId
        };
        db.TimelineEntries.Add(t);
        await db.SaveChangesAsync();
        return Ok(new { t.Id, t.Year, t.Content, t.DreamId });
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult> Update(Guid id, UpsertTimelineRequest req)
    {
        var t = await db.TimelineEntries.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return NotFound();
        t.Year = req.Year; t.Content = req.Content.Trim(); t.DreamId = req.DreamId;
        await db.SaveChangesAsync();
        return Ok(new { t.Id, t.Year, t.Content, t.DreamId });
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var t = await db.TimelineEntries.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return NotFound();
        db.TimelineEntries.Remove(t);
        await db.SaveChangesAsync();
        return Ok();
    }
}

// ==================== 用户设置 ====================
public record UpdateProfileRequest(string? Nickname, string? AvatarObjectKey, bool? LocationEnabled);

[Route("api/users")]
public class UsersController(KanauDbContext db) : KanauControllerBase
{
    [HttpGet("me")]
    public async Task<ActionResult> Me()
    {
        var u = await db.Users.FindAsync(UserId);
        if (u == null) return NotFound();
        return Ok(new
        {
            u.Id, u.UserName, u.Nickname, u.AvatarObjectKey, u.IsChild,
            u.LocationEnabled, u.TotalPromptTokens, u.TotalCompletionTokens
        });
    }

    [HttpPut("me")]
    public async Task<ActionResult> Update(UpdateProfileRequest req)
    {
        var u = await db.Users.FindAsync(UserId);
        if (u == null) return NotFound();
        if (req.Nickname != null) u.Nickname = req.Nickname.Trim();
        if (req.AvatarObjectKey != null) u.AvatarObjectKey = req.AvatarObjectKey;
        if (req.LocationEnabled != null) u.LocationEnabled = req.LocationEnabled.Value;
        await db.SaveChangesAsync();
        return Ok(new { message = "已保存" });
    }

    /// <summary>清除历史位置数据。</summary>
    [HttpPost("me/clear-locations")]
    public async Task<ActionResult> ClearLocations()
    {
        var caps = await db.CaptureItems
            .Where(c => c.UserId == UserId && (c.Lat != null || c.Lng != null)).ToListAsync();
        foreach (var c in caps) { c.Lat = null; c.Lng = null; c.ResolvedAddress = null; }
        await db.SaveChangesAsync();
        return Ok(new { cleared = caps.Count });
    }
}
