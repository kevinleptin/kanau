namespace Kanau.Domain;

public enum CaptureType { Text = 0, Audio = 1, Image = 2, Video = 3 }

public enum CaptureStatus { Uploaded = 0, Extracting = 1, Correcting = 2, Ready = 3, Failed = 4 }

/// <summary>梦想·人生金字塔六大领域</summary>
public enum PyramidArea
{
    Health = 0,          // 健康（基础层）
    Knowledge = 1,       // 修养·知识（基础层）
    Mind = 2,            // 心灵·精神（基础层）
    Work = 3,            // 社会·工作（实现层）
    Family = 4,          // 私人·家庭（实现层）
    Wealth = 5           // 经济·物质（结果层）
}

public enum DreamStatus { Draft = 0, Active = 1, Achieved = 2, Archived = 3 }

public enum PlanLevel { Year = 0, Month = 1, Week = 2 }

public enum PlanSource { Ai = 0, Manual = 1 }

public enum TodoStatus { Pending = 0, Done = 1, Postponed = 2, Cancelled = 3 }

public enum PeriodType { Week = 0, Month = 1 }

public enum NoteType
{
    Inspiration = 0,     // 灵感
    Reading = 1,         // 读书摘录
    Meeting = 2,         // 会议
    Emotion = 3,         // 情绪
    Diary = 4,           // 日常
    Other = 9
}

public enum AiTaskType
{
    Correction = 0,      // 转写文本修正
    Tagging = 1,         // 打标分类
    Embedding = 2,       // 向量化
    SmartRewrite = 3,    // 梦想 SMART 化改写
    Decompose = 4,       // 梦想拆解
    Review = 5,          // 周期回顾点评
    Coach = 6            // 教练对话
}

public enum AiTaskStatus { Pending = 0, Running = 1, Succeeded = 2, Failed = 3 }
