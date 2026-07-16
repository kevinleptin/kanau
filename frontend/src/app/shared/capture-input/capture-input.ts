import { Component, DestroyRef, OnDestroy, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import COS from 'cos-js-sdk-v5';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { ApiService } from '../../core/api.service';
import { GeoService } from '../../core/geo.service';
import { SignalrService } from '../../core/signalr.service';
import { CaptureDto, CaptureTypeNum, CaptureTypeStr } from '../../core/models';

type Mode = 'text' | 'audio' | 'image' | 'video';
type Phase = 'idle' | 'recording' | 'uploading' | 'processing' | 'failed';

/**
 * 统一输入组件：文本 / 语音 / 拍照 / 视频 四种方式，
 * 处理上传（COS 直传）、AI 管线状态跟踪（SignalR + 轮询兜底），
 * 完成后通过 captureReady 事件抛出最终的 Capture。
 */
@Component({
  selector: 'app-capture-input',
  imports: [FormsModule, NzButtonModule, NzInputModule, NzSpinModule],
  template: `
    <div class="capture-box">
      <div class="mode-row">
        @for (m of modes; track m.key) {
          <button type="button" class="mode-chip" [class.active]="mode() === m.key"
                  [disabled]="phase() !== 'idle' && phase() !== 'failed'"
                  (click)="switchMode(m.key)">
            <span class="mode-icon">{{ m.icon }}</span>{{ m.label }}
          </button>
        }
      </div>

      @switch (phase()) {
        @case ('idle') {
          @switch (mode()) {
            @case ('text') {
              <textarea nz-input [(ngModel)]="text" rows="3" [placeholder]="placeholder()"
                        class="capture-textarea"></textarea>
              <button nz-button nzType="primary" nzBlock class="submit-btn"
                      [disabled]="!text.trim()" (click)="submitText()">✨ 记下来</button>
            }
            @case ('audio') {
              <div class="audio-area">
                <button type="button" class="record-btn" (click)="startRecording()">🎤</button>
                <div class="hint">点击开始录音，再点一下结束</div>
              </div>
            }
            @case ('image') {
              <div class="audio-area">
                <button type="button" class="record-btn photo" (click)="imageInput.click()">📷</button>
                <div class="hint">拍一张照片，AI 帮你提取文字</div>
                <input #imageInput type="file" accept="image/*" capture="environment" hidden
                       (change)="onFilePicked($event, 'image')" />
              </div>
            }
            @case ('video') {
              <div class="audio-area">
                <button type="button" class="record-btn video" (click)="videoInput.click()">🎬</button>
                <div class="hint">选择或拍摄一段小视频</div>
                <input #videoInput type="file" accept="video/*" hidden
                       (change)="onFilePicked($event, 'video')" />
              </div>
            }
          }
        }
        @case ('recording') {
          <div class="audio-area recording">
            <button type="button" class="record-btn stop" (click)="stopRecording()">⏹</button>
            <div class="hint pulse">正在录音 {{ recordSeconds() }} 秒 · 点击结束</div>
          </div>
        }
        @case ('uploading') {
          <div class="state-area">
            <nz-spin nzSimple />
            <div class="hint">正在上传…</div>
          </div>
        }
        @case ('processing') {
          <div class="state-area">
            <nz-spin nzSimple />
            <div class="hint">{{ statusText() }}</div>
          </div>
        }
        @case ('failed') {
          <div class="state-area failed">
            <div class="hint">😢 处理失败{{ failReason() ? '：' + failReason() : '' }}</div>
            <div class="fail-actions">
              <button nz-button nzType="primary" nzSize="small" (click)="retry()">重试</button>
              <button nz-button nzSize="small" (click)="reset()">放弃</button>
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .capture-box { background: #fff; border-radius: 16px; padding: 12px; box-shadow: 0 2px 10px rgba(255, 120, 71, .1); }
    .mode-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .mode-chip {
      flex: 1; border: none; border-radius: 12px; padding: 8px 4px; font-size: 13px;
      background: #fff4ec; color: #b26a45; cursor: pointer; min-height: 44px;
      display: flex; flex-direction: column; align-items: center; gap: 2px;
    }
    .mode-chip.active { background: linear-gradient(135deg, #ff9a62, #ff7847); color: #fff; font-weight: 600; }
    .mode-chip:disabled { opacity: .5; }
    .mode-icon { font-size: 16px; line-height: 1; }
    .capture-textarea { border-radius: 12px; font-size: 15px; }
    .submit-btn { margin-top: 10px; border-radius: 12px; height: 42px; font-size: 15px; }
    .audio-area { display: flex; flex-direction: column; align-items: center; padding: 14px 0 10px; gap: 10px; }
    .record-btn {
      width: 72px; height: 72px; border-radius: 50%; border: none; font-size: 30px; cursor: pointer;
      background: linear-gradient(135deg, #ff9a62, #ff7847); box-shadow: 0 4px 14px rgba(255, 120, 71, .4);
    }
    .record-btn.photo { background: linear-gradient(135deg, #6ecbff, #3d9bff); box-shadow: 0 4px 14px rgba(61, 155, 255, .35); }
    .record-btn.video { background: linear-gradient(135deg, #c58bff, #9b5cff); box-shadow: 0 4px 14px rgba(155, 92, 255, .35); }
    .record-btn.stop { background: linear-gradient(135deg, #ff6b6b, #e84040); animation: breathe 1.2s infinite; }
    @keyframes breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
    .hint { color: #999; font-size: 13px; }
    .pulse { color: #e84040; font-weight: 600; }
    .state-area { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0 10px; }
    .state-area.failed .hint { color: #e84040; }
    .fail-actions { display: flex; gap: 12px; }
  `]
})
export class CaptureInput implements OnDestroy {
  private api = inject(ApiService);
  private geo = inject(GeoService);
  private signalr = inject(SignalrService);
  private message = inject(NzMessageService);
  private destroyRef = inject(DestroyRef);

  readonly placeholder = input('写下你的想法、灵感或梦想…');
  readonly captureReady = output<CaptureDto>();

  readonly modes: { key: Mode; icon: string; label: string }[] = [
    { key: 'text', icon: '✏️', label: '文本' },
    { key: 'audio', icon: '🎤', label: '语音' },
    { key: 'image', icon: '📷', label: '拍照' },
    { key: 'video', icon: '🎬', label: '视频' }
  ];

  readonly mode = signal<Mode>('text');
  readonly phase = signal<Phase>('idle');
  readonly statusText = signal('处理中…');
  readonly failReason = signal<string | null>(null);
  readonly recordSeconds = signal(0);

  text = '';

  private currentId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private recordTimer: ReturnType<typeof setInterval> | null = null;
  private recorder: MediaRecorder | null = null;
  private recordChunks: Blob[] = [];
  private recordMime = 'audio/webm';

  constructor() {
    this.signalr.captureStatus$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((e) => {
        if (e.captureId === this.currentId) this.checkStatus();
      });
  }

  ngOnDestroy(): void {
    this.stopPoll();
    this.stopRecordTimer();
    if (this.recorder && this.recorder.state !== 'inactive') {
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
  }

  switchMode(m: Mode): void {
    this.mode.set(m);
    if (this.phase() === 'failed') this.reset();
  }

  reset(): void {
    this.stopPoll();
    this.currentId = null;
    this.failReason.set(null);
    this.phase.set('idle');
  }

  // ==================== 文本 ====================
  async submitText(): Promise<void> {
    const t = this.text.trim();
    if (!t) return;
    this.phase.set('uploading');
    try {
      const geo = await this.geo.tryGet();
      const dto = await firstValueFrom(this.api.createTextCapture({ text: t, ...geo }));
      this.text = '';
      this.track(dto);
    } catch {
      this.message.error('提交失败，请重试');
      this.phase.set('idle');
    }
  }

  // ==================== 语音 ====================
  async startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordMime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      this.recorder = new MediaRecorder(stream, { mimeType: this.recordMime });
      this.recordChunks = [];
      this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.recordChunks.push(e.data); };
      this.recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(this.recordChunks, { type: this.recordMime });
        const duration = this.recordSeconds();
        this.stopRecordTimer();
        if (blob.size === 0) { this.phase.set('idle'); return; }
        const ext = this.recordMime.includes('webm') ? 'webm' : 'm4a';
        void this.uploadBlob(blob, ext, this.recordMime, 'audio', duration);
      };
      this.recorder.start();
      this.recordSeconds.set(0);
      this.recordTimer = setInterval(() => this.recordSeconds.update((s) => s + 1), 1000);
      this.phase.set('recording');
    } catch {
      this.message.error('无法访问麦克风，请检查权限设置');
    }
  }

  stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }

  private stopRecordTimer(): void {
    if (this.recordTimer) { clearInterval(this.recordTimer); this.recordTimer = null; }
  }

  // ==================== 拍照 / 视频 ====================
  onFilePicked(event: Event, type: 'image' | 'video'): void {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) return;
    const ext = (file.name.split('.').pop() || (type === 'image' ? 'jpg' : 'mp4')).toLowerCase();
    const mime = file.type || (type === 'image' ? 'image/jpeg' : 'video/mp4');
    void this.uploadBlob(file, ext, mime, type);
  }

  // ==================== COS 直传 + 确认 ====================
  private async uploadBlob(blob: Blob, ext: string, mime: string, type: CaptureTypeStr, durationSec?: number): Promise<void> {
    this.phase.set('uploading');
    try {
      const cred = await firstValueFrom(this.api.requestUploadCredential(ext, mime));
      const cos = new COS({
        getAuthorization: (_opt, cb) => cb({
          TmpSecretId: cred.tmpSecretId,
          TmpSecretKey: cred.tmpSecretKey,
          SecurityToken: cred.sessionToken,
          StartTime: Math.floor(Date.now() / 1000) - 30,
          ExpiredTime: cred.expiredTime
        })
      });
      await cos.putObject({
        Bucket: cred.bucket,
        Region: cred.region,
        Key: cred.objectKey,
        Body: blob as File,
        ContentType: mime
      });
      const geo = await this.geo.tryGet();
      const dto = await firstValueFrom(this.api.confirmUpload({
        objectKey: cred.objectKey, mime, sizeBytes: blob.size, durationSec,
        type: CaptureTypeNum[type], ...geo
      }));
      this.track(dto);
    } catch {
      this.message.error('上传失败，请检查网络后重试');
      this.phase.set('idle');
    }
  }

  // ==================== 处理状态跟踪 ====================
  private track(dto: CaptureDto): void {
    this.currentId = dto.id;
    this.applyStatus(dto);
    if (this.phase() === 'processing') {
      this.stopPoll();
      this.pollTimer = setInterval(() => this.checkStatus(), 4000);
    }
  }

  private checkStatus(): void {
    const id = this.currentId;
    if (!id) return;
    this.api.getCapture(id).subscribe({
      next: (dto) => { if (dto.id === this.currentId) this.applyStatus(dto); }
    });
  }

  private applyStatus(dto: CaptureDto): void {
    switch (dto.status) {
      case 'ready':
        this.stopPoll();
        this.currentId = null;
        this.phase.set('idle');
        this.message.success('记录完成！');
        this.captureReady.emit(dto);
        break;
      case 'failed':
        this.stopPoll();
        this.failReason.set(dto.failReason);
        this.phase.set('failed');
        break;
      case 'extracting':
        this.statusText.set(dto.type === 'audio' ? '语音识别中…' : '内容识别中…');
        this.phase.set('processing');
        break;
      case 'correcting':
        this.statusText.set('AI 修正中…');
        this.phase.set('processing');
        break;
      default:
        this.statusText.set('排队处理中…');
        this.phase.set('processing');
    }
  }

  retry(): void {
    const id = this.currentId;
    if (!id) { this.reset(); return; }
    this.api.retryCapture(id).subscribe({
      next: (dto) => this.track(dto),
      error: () => this.message.error('重试失败，请稍后再试')
    });
  }

  private stopPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }
}
