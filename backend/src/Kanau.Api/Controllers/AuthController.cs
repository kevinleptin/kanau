using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Kanau.Application;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Kanau.Api.Controllers;

public record LoginRequest(string UserName, string Password);
public record ChangePasswordRequest(string OldPassword, string NewPassword);
public record AuthResponse(string Token, Guid UserId, string UserName, string? Nickname, bool IsChild, bool IsAdmin);

[ApiController]
[Route("api/auth")]
public class AuthController(UserManager<AppUser> userManager, IOptions<JwtOptions> jwtOpt) : ControllerBase
{
    // 注册不开放：账号统一由 admin 在「用户管理」中创建（见 AdminController）。

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await userManager.FindByNameAsync(req.UserName.Trim());
        if (user == null || !await userManager.CheckPasswordAsync(user, req.Password))
            return Unauthorized(new { message = "用户名或密码错误" });
        return Ok(BuildToken(user));
    }

    /// <summary>登录用户修改自己的密码。</summary>
    [Authorize]
    [HttpPost("change-password")]
    public async Task<ActionResult> ChangePassword(ChangePasswordRequest req)
    {
        var userId = User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        var user = await userManager.FindByIdAsync(userId);
        if (user == null) return NotFound();
        var result = await userManager.ChangePasswordAsync(user, req.OldPassword, req.NewPassword);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join("；", result.Errors.Select(e => e.Description)) });
        return Ok(new { message = "密码已修改" });
    }

    internal static AuthResponse BuildTokenFor(AppUser user, JwtOptions o)
    {
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("name", user.UserName ?? ""),
            new Claim("isChild", user.IsChild ? "1" : "0"),
            new Claim("isAdmin", user.IsAdmin ? "1" : "0")
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key));
        var token = new JwtSecurityToken(
            issuer: o.Issuer, audience: o.Audience, claims: claims,
            expires: DateTime.UtcNow.AddMinutes(o.ExpireMinutes),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new AuthResponse(new JwtSecurityTokenHandler().WriteToken(token),
            user.Id, user.UserName!, user.Nickname, user.IsChild, user.IsAdmin);
    }

    private AuthResponse BuildToken(AppUser user) => BuildTokenFor(user, jwtOpt.Value);
}

[Authorize]
[ApiController]
public abstract class KanauControllerBase : ControllerBase
{
    protected Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
