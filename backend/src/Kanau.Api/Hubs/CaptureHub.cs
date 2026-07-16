using Kanau.Application;
using Kanau.Domain;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Kanau.Api.Hubs;

[Authorize]
public class CaptureHub : Hub
{
    // 客户端连接后按 userId 分组由 SignalR 用户标识（NameIdentifier claim）天然完成，
    // Clients.User(userId) 直接可用，无需手动分组。
}

public class SignalRCaptureNotifier(IHubContext<CaptureHub> hub) : ICaptureNotifier
{
    public Task NotifyStatusAsync(Guid userId, Guid captureId, CaptureStatus status, string? failReason = null) =>
        hub.Clients.User(userId.ToString()).SendAsync("captureStatus", new
        {
            captureId,
            status = status.ToString().ToLowerInvariant(),
            failReason
        });
}
