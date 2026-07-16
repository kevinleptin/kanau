import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService, NzModalModule } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiService } from '../../core/api.service';
import { AdminUserDto } from '../../core/models';

@Component({
  selector: 'app-admin-users',
  imports: [DatePipe, FormsModule, RouterLink, NzButtonModule, NzInputModule, NzModalModule,
    NzSpinModule, NzSwitchModule, NzTagModule],
  template: `
    <div class="page">
      <div class="head-row">
        <a routerLink="/settings" class="back">←</a>
        <h1 class="page-title">用户管理 👥</h1>
      </div>

      <!-- 新建成员 -->
      <div class="kanau-card form-card">
        <div class="card-title">添加家庭成员</div>
        <div class="field-row">
          <input nz-input [(ngModel)]="newName" placeholder="用户名" />
          <input nz-input [(ngModel)]="newPassword" placeholder="初始密码(≥6位)" />
        </div>
        <div class="field-row">
          <input nz-input [(ngModel)]="newNickname" placeholder="昵称(选填)" />
          <div class="switch-cell">
            <span>孩子账号</span>
            <nz-switch [(ngModel)]="newIsChild" nzCheckedChildren="是" nzUnCheckedChildren="否" />
          </div>
        </div>
        <button nz-button nzType="primary" nzBlock [nzLoading]="creating()"
                [disabled]="!newName.trim() || newPassword.length < 6" (click)="create()">
          创建账号
        </button>
      </div>

      <!-- 成员列表 -->
      @if (loading()) {
        <div class="center"><nz-spin nzSimple /></div>
      } @else {
        @for (u of users(); track u.id) {
          <div class="kanau-card user-card">
            <div class="user-main">
              <div class="avatar" [class.admin]="u.isAdmin">{{ (u.nickname || u.userName).charAt(0) }}</div>
              <div class="info">
                <div class="name-row">
                  <b>{{ u.nickname || u.userName }}</b>
                  @if (u.isAdmin) { <nz-tag nzColor="orange">管理员</nz-tag> }
                  @if (u.isChild) { <nz-tag nzColor="cyan">孩子</nz-tag> }
                </div>
                <div class="meta">账号 {{ u.userName }} · 创建于 {{ u.createdAt | date:'yyyy-MM-dd' }}</div>
                <div class="meta">AI 用量 {{ u.totalPromptTokens + u.totalCompletionTokens }} tokens</div>
              </div>
            </div>
            <div class="actions">
              <button nz-button nzSize="small" (click)="resetPassword(u)">重置密码</button>
              @if (!u.isAdmin) {
                <button nz-button nzSize="small" nzDanger (click)="remove(u)">删除</button>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .head-row { display: flex; align-items: center; gap: 10px; }
    .back { font-size: 22px; color: #b08b6e; text-decoration: none; line-height: 1; }
    .center { display: flex; justify-content: center; padding: 40px 0; }
    .kanau-card { margin-bottom: 14px; }
    .card-title { font-size: 15px; font-weight: 700; color: #4a3428; margin-bottom: 12px; }
    .field-row { display: flex; gap: 8px; margin-bottom: 10px; }
    .field-row input { border-radius: 10px; height: 42px; flex: 1; min-width: 0; }
    .switch-cell { flex: 1; display: flex; align-items: center; justify-content: space-between;
      background: #fff8f0; border-radius: 10px; padding: 0 12px; font-size: 13px; color: #8c6b53; }
    .user-card { display: flex; flex-direction: column; gap: 10px; }
    .user-main { display: flex; gap: 12px; align-items: center; }
    .avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #7fc8a9, #4ca787);
      color: #fff; font-size: 18px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .avatar.admin { background: linear-gradient(135deg, #ff9a62, #ff7847); }
    .info { flex: 1; min-width: 0; }
    .name-row { display: flex; align-items: center; gap: 6px; font-size: 15px; color: #4a3428; }
    .meta { font-size: 12px; color: #b0a094; margin-top: 2px; }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
  `]
})
export class AdminUsersPage implements OnInit {
  private api = inject(ApiService);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);

  readonly users = signal<AdminUserDto[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);

  newName = '';
  newPassword = '';
  newNickname = '';
  newIsChild = false;

  ngOnInit(): void { this.reload(); }

  reload(): void {
    this.loading.set(true);
    this.api.adminListUsers().subscribe({
      next: (us) => { this.users.set(us); this.loading.set(false); },
      error: () => { this.loading.set(false); this.message.error('加载失败'); }
    });
  }

  create(): void {
    this.creating.set(true);
    this.api.adminCreateUser({
      userName: this.newName.trim(),
      password: this.newPassword,
      nickname: this.newNickname.trim() || null,
      isChild: this.newIsChild
    }).subscribe({
      next: () => {
        this.creating.set(false);
        this.message.success(`账号 ${this.newName.trim()} 已创建`);
        this.newName = this.newPassword = this.newNickname = '';
        this.newIsChild = false;
        this.reload();
      },
      error: (err: HttpErrorResponse) => {
        this.creating.set(false);
        this.message.error(err.error?.message || '创建失败');
      }
    });
  }

  resetPassword(u: AdminUserDto): void {
    let pwd = '';
    this.modal.confirm({
      nzTitle: `重置「${u.nickname || u.userName}」的密码`,
      nzContent: '将设置为一个新的随机密码，请记下并转告对方。',
      nzOkText: '重置',
      nzCancelText: '取消',
      nzOnOk: () => {
        pwd = this.randomPassword();
        return new Promise<void>((resolve, reject) => {
          this.api.adminResetPassword(u.id, pwd).subscribe({
            next: () => {
              this.modal.success({
                nzTitle: '密码已重置',
                nzContent: `新密码：${pwd}`,
                nzOkText: '我已记下'
              });
              resolve();
            },
            error: (err: HttpErrorResponse) => {
              this.message.error(err.error?.message || '重置失败');
              reject();
            }
          });
        });
      }
    });
  }

  remove(u: AdminUserDto): void {
    this.modal.confirm({
      nzTitle: `确定删除「${u.nickname || u.userName}」吗？`,
      nzContent: '该成员的所有梦想、计划、速记等数据都会被删除，无法恢复。',
      nzOkText: '删除',
      nzOkDanger: true,
      nzCancelText: '取消',
      nzOnOk: () => {
        this.api.adminDeleteUser(u.id).subscribe({
          next: () => { this.message.success('已删除'); this.reload(); },
          error: (err: HttpErrorResponse) => this.message.error(err.error?.message || '删除失败')
        });
      }
    });
  }

  private randomPassword(): string {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const arr = new Uint32Array(10);
    crypto.getRandomValues(arr);
    return Array.from(arr, (n) => chars[n % chars.length]).join('');
  }
}
