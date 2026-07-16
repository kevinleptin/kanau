namespace Kanau.Application;

public class JwtOptions
{
    public string Issuer { get; set; } = "kanau";
    public string Audience { get; set; } = "kanau";
    public string Key { get; set; } = "";
    public int ExpireMinutes { get; set; } = 43200; // 30 天，家庭内部使用
}

public class TencentOptions
{
    public string SecretId { get; set; } = "";
    public string SecretKey { get; set; } = "";
}

public class CosOptions
{
    public string Bucket { get; set; } = "";
    public string Region { get; set; } = "";
    /// <summary>STS 临时密钥有效期（秒）。</summary>
    public int StsDurationSeconds { get; set; } = 1800;
}

public class AsrOptions
{
    public string Region { get; set; } = "ap-guangzhou";
    /// <summary>录音文件识别完成回调地址（公网）。</summary>
    public string CallbackUrl { get; set; } = "";
}

public class OcrOptions
{
    public string Region { get; set; } = "ap-guangzhou";
}

/// <summary>轻量 LLM 通道（OpenAI 兼容）。默认混元官方端点；
/// 注意 hunyuan-lite 已被腾讯下线，未另行配置可用轻量通道时，AiGateway 自动降级 DeepSeek。</summary>
public class HunyuanOptions
{
    public string Endpoint { get; set; } = "https://api.hunyuan.cloud.tencent.com/v1";
    public string ApiKey { get; set; } = "";
    public string ModelLite { get; set; } = "hunyuan-lite";
    public string ModelEmbedding { get; set; } = "hunyuan-embedding";
}

public class DeepSeekOptions
{
    public string Endpoint { get; set; } = "https://api.deepseek.com/v1";
    public string ApiKey { get; set; } = "";
    public string ModelChat { get; set; } = "deepseek-chat";
    public string ModelReasoner { get; set; } = "deepseek-reasoner";
}

public class LbsOptions
{
    public string Key { get; set; } = "";
    /// <summary>WebService API 签名校验的 SecretKey（控制台选"签名校验"时必填）。</summary>
    public string SecretKey { get; set; } = "";
}

public class FfmpegOptions
{
    public string Path { get; set; } = "/usr/bin/ffmpeg";
    public string WorkDir { get; set; } = "/tmp/kanau-media";
}
