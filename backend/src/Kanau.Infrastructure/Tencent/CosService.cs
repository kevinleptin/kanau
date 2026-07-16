using System.Text.Json;
using COSXML;
using COSXML.Auth;
using COSXML.Model.Object;
using COSXML.Model.Tag;
using Kanau.Application;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TencentCloud.Common;
using TencentCloud.Sts.V20180813;
using TencentCloud.Sts.V20180813.Models;

namespace Kanau.Infrastructure.Tencent;

public class CosService : ICosService
{
    private readonly TencentOptions _tc;
    private readonly CosOptions _cos;
    private readonly ILogger<CosService> _logger;
    private readonly Lazy<CosXml> _cosXml;

    public CosService(IOptions<TencentOptions> tc, IOptions<CosOptions> cos, ILogger<CosService> logger)
    {
        _tc = tc.Value;
        _cos = cos.Value;
        _logger = logger;
        _cosXml = new Lazy<CosXml>(() =>
        {
            var config = new CosXmlConfig.Builder()
                .IsHttps(true)
                .SetRegion(_cos.Region)
                .Build();
            var cred = new DefaultQCloudCredentialProvider(_tc.SecretId, _tc.SecretKey, 7200);
            return new CosXmlServer(config, cred);
        });
    }

    public async Task<CosStsCredential> GetUploadCredentialAsync(Guid userId, string ext, CancellationToken ct = default)
    {
        var safeExt = new string((ext ?? "bin").TrimStart('.').Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
        if (safeExt.Length is 0 or > 8) safeExt = "bin";
        var objectKey = $"captures/{userId}/{DateTime.UtcNow:yyyyMM}/{Guid.NewGuid():N}.{safeExt}";

        var policy = new
        {
            version = "2.0",
            statement = new object[]
            {
                new
                {
                    effect = "allow",
                    action = new[] { "cos:PutObject", "cos:InitiateMultipartUpload", "cos:ListMultipartUploads",
                        "cos:ListParts", "cos:UploadPart", "cos:CompleteMultipartUpload" },
                    resource = new[]
                    {
                        $"qcs::cos:{_cos.Region}:uid/{AppIdFromBucket()}:{_cos.Bucket}/{objectKey}"
                    }
                }
            }
        };

        var cred = new Credential { SecretId = _tc.SecretId, SecretKey = _tc.SecretKey };
        var client = new StsClient(cred, ExtractRegion());
        var req = new GetFederationTokenRequest
        {
            Name = "kanau-upload",
            Policy = Uri.EscapeDataString(JsonSerializer.Serialize(policy)),
            DurationSeconds = (ulong)_cos.StsDurationSeconds
        };
        var resp = await client.GetFederationToken(req);
        return new CosStsCredential(
            resp.Credentials.TmpSecretId,
            resp.Credentials.TmpSecretKey,
            resp.Credentials.Token,
            (long)(resp.ExpiredTime ?? 0),
            _cos.Bucket, _cos.Region, objectKey);
    }

    public string GetPresignedUrl(string objectKey, TimeSpan expires)
    {
        var s = new PreSignatureStruct
        {
            appid = AppIdFromBucket(),
            region = _cos.Region,
            bucket = _cos.Bucket,
            key = objectKey,
            httpMethod = "GET",
            isHttps = true,
            signDurationSecond = (long)expires.TotalSeconds,
            headers = null,
            queryParameters = null
        };
        return _cosXml.Value.GenerateSignURL(s);
    }

    public Task DownloadAsync(string objectKey, string localPath, CancellationToken ct = default)
    {
        return Task.Run(() =>
        {
            var dir = Path.GetDirectoryName(localPath)!;
            Directory.CreateDirectory(dir);
            var req = new GetObjectRequest(_cos.Bucket, objectKey, dir, Path.GetFileName(localPath));
            _cosXml.Value.GetObject(req);
        }, ct);
    }

    public Task UploadAsync(string objectKey, string localPath, CancellationToken ct = default)
    {
        return Task.Run(() =>
        {
            var req = new PutObjectRequest(_cos.Bucket, objectKey, localPath);
            _cosXml.Value.PutObject(req);
        }, ct);
    }

    /// <summary>bucket 命名约定 name-appid，取 appid。</summary>
    private string AppIdFromBucket()
    {
        var idx = _cos.Bucket.LastIndexOf('-');
        return idx >= 0 ? _cos.Bucket[(idx + 1)..] : "";
    }

    /// <summary>STS region 用 COS region（如 ap-guangzhou）。</summary>
    private string ExtractRegion() => _cos.Region;
}
