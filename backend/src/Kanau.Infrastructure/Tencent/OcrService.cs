using System.Net.Http.Json;
using Kanau.Application;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TencentCloud.Common;
using TencentCloud.Ocr.V20181119;
using TencentCloud.Ocr.V20181119.Models;

namespace Kanau.Infrastructure.Tencent;

public class OcrService(IOptions<TencentOptions> tc, IOptions<OcrOptions> ocrOpt, ILogger<OcrService> logger)
    : IOcrService
{
    public async Task<string?> ExtractTextAsync(string imageUrl, CancellationToken ct = default)
    {
        var cred = new Credential { SecretId = tc.Value.SecretId, SecretKey = tc.Value.SecretKey };
        var client = new OcrClient(cred, ocrOpt.Value.Region);
        var req = new GeneralBasicOCRRequest { ImageUrl = imageUrl };
        var resp = await client.GeneralBasicOCR(req);
        if (resp.TextDetections == null || resp.TextDetections.Length == 0) return null;
        return string.Join('\n', resp.TextDetections.Select(t => t.DetectedText).Where(t => !string.IsNullOrEmpty(t)));
    }
}

public class LbsService(IHttpClientFactory httpFactory, IOptions<LbsOptions> lbsOpt, ILogger<LbsService> logger)
    : ILbsService
{
    public async Task<string?> ReverseGeocodeAsync(double lat, double lng, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(lbsOpt.Value.Key)) return null;
        try
        {
            var http = httpFactory.CreateClient("lbs");
            // 参数按 key 升序（腾讯 LBS 签名要求），location 值不做 URL 编码参与签名
            var query = $"key={lbsOpt.Value.Key}&location={lat},{lng}";
            var url = $"https://apis.map.qq.com/ws/geocoder/v1?{query}";
            // 控制台开启"签名校验"时附加 sig = md5(path?query + SK)
            if (!string.IsNullOrEmpty(lbsOpt.Value.SecretKey))
            {
                var raw = $"/ws/geocoder/v1?{query}{lbsOpt.Value.SecretKey}";
                var sig = Convert.ToHexString(System.Security.Cryptography.MD5.HashData(
                    System.Text.Encoding.UTF8.GetBytes(raw))).ToLowerInvariant();
                url += $"&sig={sig}";
            }
            var resp = await http.GetFromJsonAsync<System.Text.Json.JsonElement>(url, ct);
            if (resp.TryGetProperty("status", out var s) && s.GetInt32() == 0 &&
                resp.TryGetProperty("result", out var r) && r.TryGetProperty("address", out var addr))
                return addr.GetString();
            logger.LogWarning("逆地址解析被拒 status={Status} msg={Msg}",
                resp.TryGetProperty("status", out var s2) ? s2.GetInt32() : -1,
                resp.TryGetProperty("message", out var m) ? m.GetString() : "");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "逆地址解析失败 {Lat},{Lng}", lat, lng);
        }
        return null;
    }
}
