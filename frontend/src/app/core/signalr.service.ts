import { Injectable, inject } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { CaptureStatusStr } from './models';

export interface CaptureStatusEvent {
  captureId: string;
  status: CaptureStatusStr;
  failReason: string | null;
}

/** SignalR 实时通道：接收速记处理状态推送。 */
@Injectable({ providedIn: 'root' })
export class SignalrService {
  private auth = inject(AuthService);
  private connection: HubConnection | null = null;

  /** 速记状态变更事件流 */
  readonly captureStatus$ = new Subject<CaptureStatusEvent>();

  /** 登录后调用；重复调用安全。 */
  connect(): void {
    if (!this.auth.isLoggedIn) return;
    if (this.connection && this.connection.state !== HubConnectionState.Disconnected) return;

    this.connection = new HubConnectionBuilder()
      .withUrl('/hubs/capture', { accessTokenFactory: () => this.auth.token ?? '' })
      .withAutomaticReconnect()
      .build();

    this.connection.on('captureStatus', (e: CaptureStatusEvent) => this.captureStatus$.next(e));

    this.connection.start().catch((err) => console.warn('SignalR 连接失败（将依赖轮询兜底）', err));
  }

  disconnect(): void {
    this.connection?.stop().catch(() => void 0);
    this.connection = null;
  }
}
