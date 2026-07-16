namespace Kanau.Domain;

/// <summary>统一输入载体：所有多媒体输入的原件与文本提取结果。</summary>
public class CaptureItem
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public CaptureType Type { get; set; }
    /// <summary>COS objectKey；纯文本输入为 null。</summary>
    public string? CosObjectKey { get; set; }
    public string? Mime { get; set; }
    public long? SizeBytes { get; set; }
    public double? DurationSec { get; set; }
    /// <summary>原始提取文本（ASR/OCR 原文，或用户直接输入的文本）。</summary>
    public string? RawText { get; set; }
    /// <summary>LLM 修正后的文本，界面默认展示。</summary>
    public string? CorrectedText { get; set; }
    public CaptureStatus Status { get; set; } = CaptureStatus.Uploaded;
    public string? FailReason { get; set; }
    public double? Lat { get; set; }
    public double? Lng { get; set; }
    public string? ResolvedAddress { get; set; }
    /// <summary>混元 Embedding 向量，JSON 数组字符串。</summary>
    public string? Embedding { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class Dream
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    /// <summary>量化描述（SMART 化后的表述）。</summary>
    public string? QuantifiedText { get; set; }
    public PyramidArea PyramidArea { get; set; }
    public DateTime? TargetDate { get; set; }
    public DreamStatus Status { get; set; } = DreamStatus.Draft;
    public string? CoverObjectKey { get; set; }
    public double? Lat { get; set; }
    public double? Lng { get; set; }
    public string? PlaceName { get; set; }
    public Guid? SourceCaptureId { get; set; }
    /// <summary>AI SMART 化建议（JSON，草稿，采纳后写入 QuantifiedText 等字段）。</summary>
    public string? AiSuggestion { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? AchievedAt { get; set; }
}

/// <summary>未来年表条目。</summary>
public class TimelineEntry
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? DreamId { get; set; }
    public int Year { get; set; }
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ActionPlan
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid DreamId { get; set; }
    public PlanLevel Level { get; set; }
    public string Content { get; set; } = "";
    /// <summary>该计划所属周期，如 "2026"、"2026-08"、"2026-W31"。</summary>
    public string? Period { get; set; }
    public int SortOrder { get; set; }
    public PlanSource Source { get; set; } = PlanSource.Manual;
    public Guid? AiDraftId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class TodoItem
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? PlanId { get; set; }
    public Guid? DreamId { get; set; }
    public DateOnly Date { get; set; }
    public string Title { get; set; } = "";
    public TodoStatus Status { get; set; } = TodoStatus.Pending;
    public int PostponeCount { get; set; }
    /// <summary>地理围栏 JSON：{lat,lng,radius,placeName}，可空。</summary>
    public string? GeoFence { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DoneAt { get; set; }
}

public class Review
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public PeriodType PeriodType { get; set; }
    public DateOnly PeriodStart { get; set; }
    /// <summary>统计快照 JSON：完成率、顺延 top、六领域投入等。</summary>
    public string? StatsSnapshot { get; set; }
    public string? AiComment { get; set; }
    /// <summary>用户口述补充的 captureId 列表，JSON 数组。</summary>
    public string? CaptureIds { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Note
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid CaptureId { get; set; }
    public NoteType NoteType { get; set; } = NoteType.Other;
    /// <summary>标签 JSON 数组，如 ["读书","英语"]。</summary>
    public string? Tags { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class NoteDreamLink
{
    public Guid Id { get; set; }
    public Guid NoteId { get; set; }
    public Guid DreamId { get; set; }
    public double Score { get; set; }
    public bool Confirmed { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AiTask
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public AiTaskType Type { get; set; }
    public string? Payload { get; set; }
    public AiTaskStatus Status { get; set; } = AiTaskStatus.Pending;
    public string? Model { get; set; }
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public long DurationMs { get; set; }
    public string? Result { get; set; }
    public string? Error { get; set; }
    /// <summary>降级标记：DeepSeek 不可用切混元时为 true。</summary>
    public bool Degraded { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
