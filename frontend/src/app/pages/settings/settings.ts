import { Component, OnInit, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService, NzModalModule } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { SignalrService } from '../../core/signalr.service';
import { UserMe } from '../../core/models';

@Component({
  selector: 'app-settings',
  imports: [DecimalPipe, FormsModule, RouterLink, NzButtonModule, NzInputModule, NzModalModule, NzSpinModule, NzSwitchModule],
  template: `
    <div class="page">
      <h1 class="page-title">我的 👤</h1>

      @if (me(); as u) {
        <!-- 个人信息 -->
        <div class="kanau-card">
          <div class="user-row">
            <div class="avatar">{{ (u.nickname || u.userName).charAt(0) }}</div>
            <div class="user-info">
              <div class="nick-row">
                @if (editingNick()) {
                  <input nz-input [(ngModel)]="nickDraft" class="nick-input" />
                  <button nz-button nzSize="small" nzType="primary" (click)="saveNick()">保存</button>
                  <button nz-button nzSize="small" (click)="editingNick.set(false)">取消</button>
                } @else {
                  <span class="nickname">{{ u.nickname || u.userName }}</span>
                  <button type="button" class="edit-link" (click)="startEditNick(u)">修改</button>
                }
              </div>
              <div class="username">账号：{{ u.userName }}{{ u.isChild ? ' · 孩子账号' : '' }}</div>
            </div>
          </div>
        </div>

        <!-- 位置 -->
        <div class="kanau-card setting-card">
          <div class="setting-row">
            <div>
              <div class="setting-title">位置记录</div>
              <div class="setting-desc">开启后速记会附带位置，方便回忆当时在哪里</div>
            </div>
            <nz-switch [ngModel]="u.locationEnabled" (ngModelChange)="toggleLocation($event)" />
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-title">清除历史位置</div>
              <div class="setting-desc">删除所有已记录的位置信息</div>
            </div>
            <button nz-button nzDanger nzSize="small" (click)="clearLocations()">清除</button>
          </div>
        </div>

        <!-- AI 用量 -->
        <div class="kanau-card setting-card">
          <div class="setting-title">AI 用量统计</div>
          <div class="token-row">
            <div class="token"><b>{{ u.totalPromptTokens | number }}</b><span>输入 tokens</span></div>
            <div class="token"><b>{{ u.totalCompletionTokens | number }}</b><span>输出 tokens</span></div>
          </div>
        </div>

        <!-- 修改密码 -->
        <div class="kanau-card setting-card">
          <div class="setting-row">
            <div>
              <div class="setting-title">修改密码</div>
              <div class="setting-desc">定期更换密码更安全</div>
            </div>
            <button nz-button nzSize="small" (click)="showPwd.set(!showPwd())">{{ showPwd() ? '收起' : '修改' }}</button>
          </div>
          @if (showPwd()) {
            <input nz-input type="password" [(ngModel)]="oldPwd" placeholder="当前密码" autocomplete="current-password" />
            <input nz-input type="password" [(ngModel)]="newPwd" placeholder="新密码(≥6位)" autocomplete="new-password" />
            <button nz-button nzType="primary" nzBlock [disabled]="!oldPwd || newPwd.length < 6" (click)="changePwd()">确认修改</button>
          }
        </div>

        @if (u.isAdmin) {
          <a class="kanau-card link-card" routerLink="/admin/users">
            <span>👥 用户管理</span>
            <span class="arrow">→</span>
          </a>
        }

        <!-- 未来年表 -->
        <a class="kanau-card link-card" routerLink="/timeline">
          <span>📜 未来年表</span>
          <span class="arrow">→</span>
        </a>

        <button nz-button nzBlock nzDanger class="logout-btn" (click)="logout()">退出登录</button>
      } @else {
        <div class="center"><nz-spin nzSimple /></div>
      }
    </div>
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 40px 0; }
    .kanau-card { margin-bottom: 14px; }
    .user-row { display: flex; align-items: center; gap: 14px; }
    .avatar { width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, #ff9a62, #ff7847);
      color: #fff; font-size: 24px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .user-info { flex: 1; min-width: 0; }
    .nick-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .nickname { font-size: 18px; font-weight: 700; color: #4a3428; }
    .nick-input { max-width: 140px; border-radius: 8px; }
    .edit-link { border: none; background: transparent; color: var(--kanau-primary); font-size: 13px; cursor: pointer; }
    .username { margin-top: 4px; font-size: 13px; color: #b0a094; }
    .setting-card { display: flex; flex-direction: column; gap: 14px; }
    .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .setting-title { font-size: 15px; font-weight: 600; color: #4a3428; }
    .setting-desc { font-size: 12px; color: #b0a094; margin-top: 2px; }
    .token-row { display: flex; gap: 10px; margin-top: 4px; }
    .token { flex: 1; background: #fff8f0; border-radius: 12px; padding: 10px; text-align: center; }
    .token b { display: block; font-size: 18px; color: #d95a2b; }
    .token span { font-size: 12px; color: #b0a094; }
    .link-card { display: flex; justify-content: space-between; align-items: center; text-decoration: none;
      font-size: 15px; font-weight: 600; color: #4a3428; }
    .arrow { color: #d0c0b2; }
    .logout-btn { margin-top: 8px; border-radius: 12px; height: 46px; }
  `]
})
export class SettingsPage implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private signalr = inject(SignalrService);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);

  readonly me = signal<UserMe | null>(null);
  readonly editingNick = signal(false);
  readonly showPwd = signal(false);

  nickDraft = '';
  oldPwd = '';
  newPwd = '';

  ngOnInit(): void {
    this.api.loadMe().subscribe({
      next: (u) => this.me.set(u),
      error: () => this.message.error('加载失败')
    });
  }

  startEditNick(u: UserMe): void {
    this.nickDraft = u.nickname || u.userName;
    this.editingNick.set(true);
  }

  saveNick(): void {
    const nick = this.nickDraft.trim();
    if (!nick) return;
    this.api.updateMe({ nickname: nick }).subscribe({
      next: () => {
        this.editingNick.set(false);
        const u = this.me();
        if (u) this.me.set({ ...u, nickname: nick });
        this.auth.updateNickname(nick);
        this.message.success('昵称已更新');
      },
      error: () => this.message.error('保存失败，请重试')
    });
  }

  toggleLocation(enabled: boolean): void {
    this.api.updateMe({ locationEnabled: enabled }).subscribe({
      next: () => {
        const u = this.me();
        if (u) {
          this.me.set({ ...u, locationEnabled: enabled });
          this.api.me.set({ ...u, locationEnabled: enabled });
        }
        this.message.success(enabled ? '已开启位置记录' : '已关闭位置记录');
      },
      error: () => this.message.error('设置失败，请重试')
    });
  }

  clearLocations(): void {
    this.modal.confirm({
      nzTitle: '确定清除所有历史位置吗？',
      nzContent: '清除后无法恢复。',
      nzOkText: '清除',
      nzOkDanger: true,
      nzCancelText: '取消',
      nzOnOk: () => {
        this.api.clearLocations().subscribe({
          next: (r) => this.message.success(`已清除 ${r.cleared} 条位置记录`),
          error: () => this.message.error('清除失败，请重试')
        });
      }
    });
  }

  changePwd(): void {
    this.auth.changePassword(this.oldPwd, this.newPwd).subscribe({
      next: () => {
        this.message.success('密码已修改');
        this.showPwd.set(false);
        this.oldPwd = this.newPwd = '';
      },
      error: (err) => this.message.error(err?.error?.message || '修改失败，请检查当前密码')
    });
  }

  logout(): void {
    this.signalr.disconnect();
    this.auth.logout();
  }
}
