using Kanau.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Kanau.Infrastructure.Data;

public class AppUser : IdentityUser<Guid>
{
    public string? Nickname { get; set; }
    public string? AvatarObjectKey { get; set; }
    public string TimeZone { get; set; } = "Asia/Shanghai";
    /// <summary>孩子账号：AI 教练语气更鼓励、语言更简单；位置默认关闭。</summary>
    public bool IsChild { get; set; }
    public bool LocationEnabled { get; set; }
    public long TotalPromptTokens { get; set; }
    public long TotalCompletionTokens { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class KanauDbContext(DbContextOptions<KanauDbContext> options)
    : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<CaptureItem> CaptureItems => Set<CaptureItem>();
    public DbSet<Dream> Dreams => Set<Dream>();
    public DbSet<TimelineEntry> TimelineEntries => Set<TimelineEntry>();
    public DbSet<ActionPlan> ActionPlans => Set<ActionPlan>();
    public DbSet<TodoItem> TodoItems => Set<TodoItem>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<NoteDreamLink> NoteDreamLinks => Set<NoteDreamLink>();
    public DbSet<AiTask> AiTasks => Set<AiTask>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        // MySQL 5.7 + utf8mb4：索引键列 ≤191 字符（767 字节前缀限制）
        foreach (var entity in b.Model.GetEntityTypes())
        {
            // Identity 表字符串主键/索引列收窄
            foreach (var prop in entity.GetProperties()
                         .Where(p => p.ClrType == typeof(string) && p.GetMaxLength() is null or > 191))
            {
                var isKeyOrIndex = prop.IsKey() || prop.IsIndex() ||
                                   entity.GetIndexes().Any(i => i.Properties.Contains(prop));
                if (isKeyOrIndex) prop.SetMaxLength(191);
            }
            // 时间列统一 datetime(6)
            foreach (var prop in entity.GetProperties()
                         .Where(p => p.ClrType == typeof(DateTime) || p.ClrType == typeof(DateTime?)))
                prop.SetColumnType("datetime(6)");
        }

        b.Entity<CaptureItem>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.Property(x => x.CosObjectKey).HasMaxLength(191);
            e.Property(x => x.Mime).HasMaxLength(100);
            e.Property(x => x.RawText).HasColumnType("mediumtext");
            e.Property(x => x.CorrectedText).HasColumnType("mediumtext");
            e.Property(x => x.Embedding).HasColumnType("mediumtext");
            e.Property(x => x.FailReason).HasMaxLength(1000);
            e.Property(x => x.ResolvedAddress).HasMaxLength(500);
        });

        b.Entity<Dream>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Status });
            e.Property(x => x.Title).HasMaxLength(191);
            e.Property(x => x.QuantifiedText).HasMaxLength(2000);
            e.Property(x => x.CoverObjectKey).HasMaxLength(191);
            e.Property(x => x.PlaceName).HasMaxLength(191);
            e.Property(x => x.AiSuggestion).HasColumnType("text");
        });

        b.Entity<TimelineEntry>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Year });
            e.Property(x => x.Content).HasMaxLength(1000);
        });

        b.Entity<ActionPlan>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.DreamId, x.Level });
            e.Property(x => x.Content).HasMaxLength(1000);
            e.Property(x => x.Period).HasMaxLength(20);
        });

        b.Entity<TodoItem>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.Date });
            e.Property(x => x.Title).HasMaxLength(500);
            e.Property(x => x.GeoFence).HasColumnType("text");
        });

        b.Entity<Review>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.PeriodType, x.PeriodStart }).IsUnique();
            e.Property(x => x.StatsSnapshot).HasColumnType("mediumtext");
            e.Property(x => x.AiComment).HasColumnType("mediumtext");
            e.Property(x => x.CaptureIds).HasColumnType("text");
        });

        b.Entity<Note>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasIndex(x => x.CaptureId);
            e.Property(x => x.Tags).HasColumnType("text");
        });

        b.Entity<NoteDreamLink>(e =>
        {
            e.HasIndex(x => new { x.NoteId, x.DreamId }).IsUnique();
        });

        b.Entity<AiTask>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.Property(x => x.Payload).HasColumnType("mediumtext");
            e.Property(x => x.Result).HasColumnType("mediumtext");
            e.Property(x => x.Error).HasMaxLength(2000);
            e.Property(x => x.Model).HasMaxLength(100);
        });
    }
}
