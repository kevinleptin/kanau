using System.ComponentModel;
using Kanau.Domain;
using Kanau.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace Kanau.Api.Mcp;

[McpServerToolType]
public sealed class TodoTools(KanauDbContext db, IHttpContextAccessor http) : McpToolBase(http)
{
    private static object Dto(TodoItem t) => new
    {
        t.Id, t.Date, t.Title, t.Status, t.PostponeCount, t.DreamId, t.PlanId, t.DoneAt
    };

    [McpServerTool(Name = "list_todos"), Description("列出某天的待办事项（默认今天，北京时间）。状态：Pending(待办)/Done(完成)/Postponed(顺延)/Cancelled(取消)。")]
    public async Task<string> ListTodos(
        [Description("日期 yyyy-MM-dd，可选，默认今天")] string? date = null)
    {
        var day = DateOnly.TryParse(date, out var d) ? d : TodayCn();
        var list = await db.TodoItems.AsNoTracking()
            .Where(t => t.UserId == UserId && t.Date == day)
            .OrderBy(t => t.Status).ThenBy(t => t.CreatedAt).ToListAsync();
        return Json(new { date = day, todos = list.Select(Dto) });
    }

    [McpServerTool(Name = "create_todo"), Description("创建待办事项。可关联梦想或行动计划（体现「今天做的事与梦想相连」）。")]
    public async Task<string> CreateTodo(
        [Description("待办标题")] string title,
        [Description("日期 yyyy-MM-dd，可选，默认今天")] string? date = null,
        [Description("关联的梦想 ID，可选")] string? dreamId = null,
        [Description("关联的行动计划 ID，可选")] string? planId = null)
    {
        if (string.IsNullOrWhiteSpace(title)) return "标题不能为空";
        var t = new TodoItem
        {
            Id = Guid.NewGuid(), UserId = UserId, Title = title.Trim(),
            Date = DateOnly.TryParse(date, out var d) ? d : TodayCn(),
            DreamId = ParseId(dreamId), PlanId = ParseId(planId)
        };
        db.TodoItems.Add(t);
        await db.SaveChangesAsync();
        return Json(Dto(t));
    }

    [McpServerTool(Name = "toggle_todo"), Description("切换待办完成状态（未完成→完成，完成→未完成）。")]
    public async Task<string> ToggleTodo([Description("待办 ID")] string todoId)
    {
        var id = ParseId(todoId);
        var t = id == null ? null : await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return "未找到该待办";
        t.Status = t.Status == TodoStatus.Done ? TodoStatus.Pending : TodoStatus.Done;
        t.DoneAt = t.Status == TodoStatus.Done ? DateTime.UtcNow : null;
        await db.SaveChangesAsync();
        return Json(Dto(t));
    }

    [McpServerTool(Name = "delete_todo"), Description("删除一条待办事项。")]
    public async Task<string> DeleteTodo([Description("待办 ID")] string todoId)
    {
        var id = ParseId(todoId);
        var t = id == null ? null : await db.TodoItems.FirstOrDefaultAsync(x => x.Id == id && x.UserId == UserId);
        if (t == null) return "未找到该待办";
        db.TodoItems.Remove(t);
        await db.SaveChangesAsync();
        return "已删除";
    }

    [McpServerTool(Name = "today_brief"), Description("今日速览：今天的待办完成情况 + 进行中的梦想数。适合作为每日回顾/规划的起点。")]
    public async Task<string> TodayBrief()
    {
        var today = TodayCn();
        var todos = await db.TodoItems.AsNoTracking()
            .Where(t => t.UserId == UserId && t.Date == today).ToListAsync();
        var activeDreams = await db.Dreams.AsNoTracking()
            .CountAsync(d => d.UserId == UserId && d.Status == DreamStatus.Active);
        return Json(new
        {
            date = today,
            total = todos.Count,
            done = todos.Count(t => t.Status == TodoStatus.Done),
            pending = todos.Count(t => t.Status == TodoStatus.Pending),
            postponed = todos.Count(t => t.Status == TodoStatus.Postponed),
            activeDreams,
            todos = todos.Select(Dto)
        });
    }
}
