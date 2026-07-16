using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

public record CreateTodoRequest(string Title, DateOnly? Date, Guid? DreamId, string? GeoFence);

[Route("api/todos")]
public class TodosController(KanauDbContext db) : KanauControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List(DateOnly? date = null)
    {
        var d = date ?? DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        var todos = await db.TodoItems
            .Where(t => t.UserId == UserId && t.Date == d && t.Status != TodoStatus.Cancelled)
            .OrderBy(t => t.CreatedAt).ToListAsync();
        return Ok(todos.Select(ToDto));
    }

    [HttpPost]
    public async Task<ActionResult> Create(CreateTodoRequest req)
    {
        var t = new TodoItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = req.Title.Trim(),
            Date = req.Date ?? DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8)),
            DreamId = req.DreamId, GeoFence = req.GeoFence
        };
        db.TodoItems.Add(t);
        await db.SaveChangesAsync();
        return Ok(ToDto(t));
    }

    [HttpPost("{id:guid}/toggle")]
    public async Task<ActionResult> Toggle(Guid id)
    {
        var t = await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return NotFound();
        if (t.Status == TodoStatus.Done) { t.Status = TodoStatus.Pending; t.DoneAt = null; }
        else { t.Status = TodoStatus.Done; t.DoneAt = DateTime.UtcNow; }
        await db.SaveChangesAsync();
        return Ok(ToDto(t));
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var t = await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return NotFound();
        t.Status = TodoStatus.Cancelled;
        await db.SaveChangesAsync();
        return Ok();
    }

    /// <summary>"今日一梦"：随机一个进行中的梦想 + 今日清单。</summary>
    [HttpGet("today-brief")]
    public async Task<ActionResult> TodayBrief()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(8));
        var dreams = await db.Dreams
            .Where(d => d.UserId == UserId && d.Status == DreamStatus.Active).ToListAsync();
        // 以"天"为种子的稳定随机，保证一天内刷新不变
        Dream? pick = null;
        if (dreams.Count > 0)
        {
            var seed = today.DayNumber;
            pick = dreams[seed % dreams.Count];
        }
        var todos = await db.TodoItems
            .Where(t => t.UserId == UserId && t.Date == today && t.Status != TodoStatus.Cancelled)
            .OrderBy(t => t.CreatedAt).ToListAsync();
        return Ok(new
        {
            dream = pick == null ? null : DreamsController.ToDto(pick),
            countdownDays = pick?.TargetDate == null
                ? (int?)null
                : (int)Math.Ceiling((pick.TargetDate.Value - DateTime.UtcNow.AddHours(8)).TotalDays),
            todos = todos.Select(ToDto)
        });
    }

    internal static object ToDto(TodoItem t) => new
    {
        t.Id, t.PlanId, t.DreamId, t.Date, t.Title,
        status = t.Status.ToString().ToLowerInvariant(),
        t.PostponeCount, t.GeoFence, t.DoneAt
    };
}
