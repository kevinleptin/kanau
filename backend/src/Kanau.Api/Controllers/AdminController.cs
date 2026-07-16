using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Api.Controllers;

public record CreateUserRequest(string UserName, string Password, string? Nickname, bool IsChild = false);
public record ResetPasswordRequest(string NewPassword);

/// <summary>用户管理：仅 admin。家庭成员账号统一由 admin 创建/维护。</summary>
[Authorize(Policy = "AdminOnly")]
[ApiController]
[Route("api/admin/users")]
public class AdminController(UserManager<AppUser> userManager, KanauDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult> List()
    {
        var users = await db.Users.OrderBy(u => u.CreatedAt).ToListAsync();
        return Ok(users.Select(u => new
        {
            u.Id, u.UserName, u.Nickname, u.IsChild, u.IsAdmin,
            u.LocationEnabled, u.TotalPromptTokens, u.TotalCompletionTokens, u.CreatedAt
        }));
    }

    [HttpPost]
    public async Task<ActionResult> Create(CreateUserRequest req)
    {
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            UserName = req.UserName.Trim(),
            Nickname = string.IsNullOrWhiteSpace(req.Nickname) ? req.UserName.Trim() : req.Nickname.Trim(),
            IsChild = req.IsChild,
            LocationEnabled = false
        };
        var result = await userManager.CreateAsync(user, req.Password);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join("；", result.Errors.Select(e => e.Description)) });
        return Ok(new { user.Id, user.UserName, user.Nickname, user.IsChild });
    }

    [HttpPost("{id:guid}/reset-password")]
    public async Task<ActionResult> ResetPassword(Guid id, ResetPasswordRequest req)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user == null) return NotFound();
        var token = await userManager.GeneratePasswordResetTokenAsync(user);
        var result = await userManager.ResetPasswordAsync(user, token, req.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join("；", result.Errors.Select(e => e.Description)) });
        return Ok(new { message = "密码已重置" });
    }

    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var user = await userManager.FindByIdAsync(id.ToString());
        if (user == null) return NotFound();
        if (user.IsAdmin) return BadRequest(new { message = "不能删除管理员账号" });
        // 级联清理该用户的业务数据
        var uid = user.Id;
        db.TodoItems.RemoveRange(db.TodoItems.Where(x => x.UserId == uid));
        db.ActionPlans.RemoveRange(db.ActionPlans.Where(x => x.UserId == uid));
        db.NoteDreamLinks.RemoveRange(
            db.NoteDreamLinks.Where(l => db.Notes.Any(n => n.Id == l.NoteId && n.UserId == uid)));
        db.Notes.RemoveRange(db.Notes.Where(x => x.UserId == uid));
        db.Reviews.RemoveRange(db.Reviews.Where(x => x.UserId == uid));
        db.TimelineEntries.RemoveRange(db.TimelineEntries.Where(x => x.UserId == uid));
        db.Dreams.RemoveRange(db.Dreams.Where(x => x.UserId == uid));
        db.CaptureItems.RemoveRange(db.CaptureItems.Where(x => x.UserId == uid));
        db.AiTasks.RemoveRange(db.AiTasks.Where(x => x.UserId == uid));
        await db.SaveChangesAsync();
        await userManager.DeleteAsync(user);
        return Ok(new { message = "已删除" });
    }
}
