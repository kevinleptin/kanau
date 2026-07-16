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

public record RegisterRequest(string UserName, string Password, string? Nickname, bool IsChild = false);
public record LoginRequest(string UserName, string Password);
public record AuthResponse(string Token, Guid UserId, string UserName, string? Nickname, bool IsChild);

[ApiController]
[Route("api/auth")]
public class AuthController(UserManager<AppUser> userManager, IOptions<JwtOptions> jwtOpt) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var user = new AppUser
        {
            Id = Guid.NewGuid(),
            UserName = req.UserName.Trim(),
            Nickname = string.IsNullOrWhiteSpace(req.Nickname) ? req.UserName.Trim() : req.Nickname.Trim(),
            IsChild = req.IsChild,
            LocationEnabled = false // 默认关闭，孩子账号保持关闭
        };
        var result = await userManager.CreateAsync(user, req.Password);
        if (!result.Succeeded)
            return BadRequest(new { message = string.Join("；", result.Errors.Select(e => e.Description)) });
        return Ok(BuildToken(user));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var user = await userManager.FindByNameAsync(req.UserName.Trim());
        if (user == null || !await userManager.CheckPasswordAsync(user, req.Password))
            return Unauthorized(new { message = "用户名或密码错误" });
        return Ok(BuildToken(user));
    }

    private AuthResponse BuildToken(AppUser user)
    {
        var o = jwtOpt.Value;
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("name", user.UserName ?? ""),
            new Claim("isChild", user.IsChild ? "1" : "0")
        };
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(o.Key));
        var token = new JwtSecurityToken(
            issuer: o.Issuer, audience: o.Audience, claims: claims,
            expires: DateTime.UtcNow.AddMinutes(o.ExpireMinutes),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));
        return new AuthResponse(new JwtSecurityTokenHandler().WriteToken(token),
            user.Id, user.UserName!, user.Nickname, user.IsChild);
    }
}

[Authorize]
[ApiController]
public abstract class KanauControllerBase : ControllerBase
{
    protected Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
}
