using Kanau.Application;
using Kanau.Infrastructure.Ai;
using Kanau.Infrastructure.Data;
using Kanau.Infrastructure.Pipeline;
using Kanau.Infrastructure.Tencent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Kanau.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        var conn = config.GetConnectionString("MySql")
                   ?? throw new InvalidOperationException("缺少 ConnectionStrings:MySql");

        // MySQL 5.7：ServerVersion 显式指定，禁用 8.0 特性
        services.AddDbContext<KanauDbContext>(opt =>
            opt.UseMySql(conn, ServerVersion.Create(new Version(5, 7, 44), Pomelo.EntityFrameworkCore.MySql.Infrastructure.ServerType.MySql)));

        services.Configure<JwtOptions>(config.GetSection("Jwt"));
        services.Configure<TencentOptions>(config.GetSection("Tencent"));
        services.Configure<CosOptions>(config.GetSection("Cos"));
        services.Configure<AsrOptions>(config.GetSection("Asr"));
        services.Configure<OcrOptions>(config.GetSection("Ocr"));
        services.Configure<HunyuanOptions>(config.GetSection("Hunyuan"));
        services.Configure<DeepSeekOptions>(config.GetSection("DeepSeek"));
        services.Configure<LbsOptions>(config.GetSection("Lbs"));
        services.Configure<FfmpegOptions>(config.GetSection("Ffmpeg"));

        services.AddHttpClient("deepseek", c => c.Timeout = TimeSpan.FromMinutes(5));
        services.AddHttpClient("lbs", c => c.Timeout = TimeSpan.FromSeconds(10));

        services.AddScoped<IAiGateway, AiGateway>();
        services.AddSingleton<ICosService, CosService>();
        services.AddScoped<IAsrService, AsrService>();
        services.AddScoped<IOcrService, OcrService>();
        services.AddScoped<ILbsService, LbsService>();
        services.AddScoped<ICapturePipeline, CapturePipeline>();
        services.AddScoped<CapturePipeline>();
        services.AddScoped<IReviewGenerator, ReviewGenerator>();
        services.AddScoped<ITodoRolloverService, TodoRolloverService>();

        return services;
    }
}
