using System.Security.Claims;
using System.Text;
using Hangfire;
using Hangfire.MySql;
using Kanau.Api.Hubs;
using Kanau.Application;
using Kanau.Infrastructure;
using Kanau.Infrastructure.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddInfrastructure(builder.Configuration);

// ---------- Identity ----------
builder.Services.AddIdentityCore<AppUser>(opt =>
    {
        opt.Password.RequiredLength = 6;
        opt.Password.RequireNonAlphanumeric = false;
        opt.Password.RequireUppercase = false;
        opt.Password.RequireLowercase = false;
        opt.Password.RequireDigit = false;
        opt.User.AllowedUserNameCharacters =
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._@";
    })
    .AddRoles<IdentityRole<Guid>>()
    .AddEntityFrameworkStores<KanauDbContext>();

// ---------- JWT ----------
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            NameClaimType = ClaimTypes.NameIdentifier
        };
        // SignalR WebSocket 经 query string 传 token
        opt.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(accessToken) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization(opt =>
    opt.AddPolicy("AdminOnly", p => p.RequireClaim("isAdmin", "1")));

// ---------- Hangfire (MySQL 存储) ----------
var hangfireConn = builder.Configuration.GetConnectionString("Hangfire")
                   ?? builder.Configuration.GetConnectionString("MySql")!;
builder.Services.AddHangfire(cfg => cfg
    .SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
    .UseSimpleAssemblyNameTypeSerializer()
    .UseRecommendedSerializerSettings()
    .UseStorage(new MySqlStorage(hangfireConn, new MySqlStorageOptions
    {
        TablesPrefix = "hangfire_",
        QueuePollInterval = TimeSpan.FromSeconds(5)
    })));
builder.Services.AddHangfireServer(opt => opt.WorkerCount = 4);

builder.Services.AddSignalR();
builder.Services.AddSingleton<ICaptureNotifier, SignalRCaptureNotifier>();
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 开发期 CORS（生产同域，经 Nginx 反代）
builder.Services.AddCors(opt => opt.AddDefaultPolicy(p => p
    .WithOrigins("http://localhost:4200")
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

// 自动迁移 + 种子 admin（不开放注册，账号由 admin 管理）
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<KanauDbContext>();
    db.Database.Migrate();

    var userManager = scope.ServiceProvider.GetRequiredService<UserManager<AppUser>>();
    if (await userManager.FindByNameAsync("admin") == null)
    {
        var initialPwd = builder.Configuration["Admin:InitialPassword"];
        if (!string.IsNullOrEmpty(initialPwd))
        {
            var admin = new AppUser
            {
                Id = Guid.NewGuid(), UserName = "admin", Nickname = "管理员",
                IsAdmin = true, LocationEnabled = false
            };
            var created = await userManager.CreateAsync(admin, initialPwd);
            if (!created.Succeeded)
                app.Logger.LogError("admin 种子创建失败: {Errors}",
                    string.Join("；", created.Errors.Select(e => e.Description)));
        }
        else
        {
            app.Logger.LogWarning("未配置 Admin:InitialPassword，跳过 admin 种子创建");
        }
    }
}

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<CaptureHub>("/hubs/capture");
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", time = DateTime.UtcNow }));

// ---------- Hangfire 定时任务（北京时间） ----------
var cnTz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Shanghai");
var recurring = app.Services.GetRequiredService<IRecurringJobManager>();
recurring.AddOrUpdate<ITodoRolloverService>("todo-rollover",
    s => s.RolloverAsync(), "10 0 * * *", new RecurringJobOptions { TimeZone = cnTz });
recurring.AddOrUpdate<IReviewGenerator>("weekly-review",
    s => s.GenerateWeeklyReviewsAsync(), "0 20 * * 0", new RecurringJobOptions { TimeZone = cnTz });
recurring.AddOrUpdate<IReviewGenerator>("monthly-review",
    s => s.GenerateMonthlyReviewsAsync(), "0 20 28-31 * *", new RecurringJobOptions { TimeZone = cnTz });

app.Run();
