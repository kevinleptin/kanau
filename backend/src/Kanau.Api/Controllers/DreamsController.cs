using System.Text.Json;
using Kanau.Application;
using Kanau.Domain;
using Kanau.Infrastructure.Ai.Prompts;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

public record UpsertDreamRequest(string Title, string? QuantifiedText, PyramidArea PyramidArea,
    DateTime? TargetDate, string? CoverObjectKey, double? Lat, double? Lng, string? PlaceName,
    Guid? SourceCaptureId);

public record SmartSuggestion(string QuantifiedText, string PyramidArea, string? TargetDate, string? Reason);

[Route("api/dreams")]
public class DreamsController(KanauDbContext db, IAiGateway ai, ICosService cos) : KanauControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List(DreamStatus? status = null)
    {
        var q = db.Dreams.Where(d => d.UserId == UserId);
        if (status != null) q = q.Where(d => d.Status == status);
        var dreams = await q.OrderByDescending(d => d.CreatedAt).ToListAsync();
        return Ok(dreams.Select(ToDto));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult> Get(Guid id)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        return d == null ? NotFound() : Ok(ToDto(d));
    }

    [HttpPost]
    public async Task<ActionResult> Create(UpsertDreamRequest req)
    {
        var d = new Dream
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = req.Title.Trim(),
            QuantifiedText = req.QuantifiedText, PyramidArea = req.PyramidArea,
            TargetDate = req.TargetDate, CoverObjectKey = req.CoverObjectKey,
            Lat = req.Lat, Lng = req.Lng, PlaceName = req.PlaceName,
            SourceCaptureId = req.SourceCaptureId,
            Status = DreamStatus.Active
        };
        db.Dreams.Add(d);
        await db.SaveChangesAsync();
        return Ok(ToDto(d));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult> Update(Guid id, UpsertDreamRequest req)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return NotFound();
        d.Title = req.Title.Trim();
        d.QuantifiedText = req.QuantifiedText;
        d.PyramidArea = req.PyramidArea;
        d.TargetDate = req.TargetDate;
        d.CoverObjectKey = req.CoverObjectKey;
        d.Lat = req.Lat; d.Lng = req.Lng; d.PlaceName = req.PlaceName;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(ToDto(d));
    }

    [HttpPost("{id:guid}/status")]
    public async Task<ActionResult> SetStatus(Guid id, [FromBody] DreamStatus status)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return NotFound();
        d.Status = status;
        if (status == DreamStatus.Achieved) d.AchievedAt = DateTime.UtcNow;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(ToDto(d));
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return NotFound();
        db.Dreams.Remove(d);
        await db.SaveChangesAsync();
        return Ok();
    }

    /// <summary>AI SMART 化改写：生成建议（草稿），不直接生效。</summary>
    [HttpPost("{id:guid}/smart-rewrite")]
    public async Task<ActionResult> SmartRewrite(Guid id)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return NotFound();
        var user = await db.Users.FindAsync(UserId);
        var input = string.IsNullOrWhiteSpace(d.QuantifiedText) ? d.Title : $"{d.Title}\n{d.QuantifiedText}";
        var suggestion = await ai.ChatJsonAsync<SmartSuggestion>(AiTaskType.SmartRewrite, UserId,
            PromptTemplates.SmartRewriteSystem(user?.IsChild ?? false),
            $"今天是 {DateTime.UtcNow.AddHours(8):yyyy-MM-dd}。我的愿望：{input}");
        if (suggestion == null) return StatusCode(502, new { message = "AI 暂时不可用，请稍后再试" });
        d.AiSuggestion = JsonSerializer.Serialize(suggestion);
        await db.SaveChangesAsync();
        return Ok(suggestion);
    }

    /// <summary>采纳 AI 建议（可带用户修改后的值）。</summary>
    [HttpPost("{id:guid}/adopt-suggestion")]
    public async Task<ActionResult> AdoptSuggestion(Guid id, SmartSuggestion final)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d == null) return NotFound();
        d.QuantifiedText = final.QuantifiedText;
        if (Enum.TryParse<PyramidArea>(final.PyramidArea, true, out var area)) d.PyramidArea = area;
        if (DateTime.TryParse(final.TargetDate, out var td)) d.TargetDate = td;
        d.Status = DreamStatus.Active;
        d.AiSuggestion = null;
        d.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(ToDto(d));
    }

    /// <summary>金字塔视图统计：六领域数量与进度。</summary>
    [HttpGet("pyramid")]
    public async Task<ActionResult> Pyramid()
    {
        var dreams = await db.Dreams.Where(d => d.UserId == UserId && d.Status != DreamStatus.Archived).ToListAsync();
        var areas = Enum.GetValues<PyramidArea>().Select(a =>
        {
            var inArea = dreams.Where(d => d.PyramidArea == a).ToList();
            return new
            {
                area = a.ToString().ToLowerInvariant(),
                total = inArea.Count,
                achieved = inArea.Count(d => d.Status == DreamStatus.Achieved),
                active = inArea.Count(d => d.Status == DreamStatus.Active)
            };
        });
        return Ok(areas);
    }

    /// <summary>封面图 URL。</summary>
    [HttpGet("{id:guid}/cover-url")]
    public async Task<ActionResult> CoverUrl(Guid id)
    {
        var d = await db.Dreams.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (d?.CoverObjectKey == null) return NotFound();
        return Ok(new { url = cos.GetPresignedUrl(d.CoverObjectKey, TimeSpan.FromHours(6)) });
    }

    internal static object ToDto(Dream d) => new
    {
        d.Id, d.Title, d.QuantifiedText,
        pyramidArea = d.PyramidArea.ToString().ToLowerInvariant(),
        d.TargetDate, status = d.Status.ToString().ToLowerInvariant(),
        d.CoverObjectKey, d.Lat, d.Lng, d.PlaceName, d.SourceCaptureId,
        aiSuggestion = d.AiSuggestion, d.CreatedAt, d.AchievedAt
    };
}
