import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSwitchModule } from 'ng-zorro-antd/switch';
import { AuthService } from '../../core/auth.service';
import { SignalrService } from '../../core/signalr.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, NzButtonModule, NzInputModule, NzSwitchModule],
  template: `
    <div class="login-wrap">
      <div class="brand">
        <div class="logo">🌈</div>
        <h1>圆梦笔记</h1>
        <p>把梦想写下来，一步步实现它</p>
      </div>

      <div class="kanau-card form-card">
        <div class="tab-row">
          <button type="button" class="tab" [class.active]="!isRegister()" (click)="isRegister.set(false)">登录</button>
          <button type="button" class="tab" [class.active]="isRegister()" (click)="isRegister.set(true)">注册</button>
        </div>

        <div class="field">
          <label>用户名</label>
          <input nz-input [(ngModel)]="userName" placeholder="请输入用户名" autocomplete="username" />
        </div>
        <div class="field">
          <label>密码</label>
          <input nz-input type="password" [(ngModel)]="password" placeholder="请输入密码"
                 [attr.autocomplete]="isRegister() ? 'new-password' : 'current-password'" />
        </div>

        @if (isRegister()) {
          <div class="field">
            <label>昵称（选填）</label>
            <input nz-input [(ngModel)]="nickname" placeholder="想让大家怎么称呼你？" />
          </div>
          <div class="field switch-field">
            <label>是否孩子账号</label>
            <nz-switch [(ngModel)]="isChild" nzCheckedChildren="是" nzUnCheckedChildren="否" />
          </div>
        }

        <button nz-button nzType="primary" nzBlock nzSize="large" class="submit"
                [nzLoading]="loading()" [disabled]="!userName.trim() || !password"
                (click)="submit()">
          {{ isRegister() ? '注册并开始圆梦 🚀' : '登录' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .login-wrap { min-height: 100dvh; display: flex; flex-direction: column; justify-content: center; padding: 24px; max-width: 480px; margin: 0 auto; }
    .brand { text-align: center; margin-bottom: 24px; }
    .logo { font-size: 56px; }
    .brand h1 { margin: 8px 0 4px; font-size: 28px; font-weight: 800; color: #4a3428; }
    .brand p { margin: 0; color: #b08b6e; }
    .form-card { padding: 20px; }
    .tab-row { display: flex; background: #fff4ec; border-radius: 12px; padding: 4px; margin-bottom: 18px; }
    .tab { flex: 1; border: none; background: transparent; border-radius: 10px; padding: 10px; font-size: 15px; color: #b26a45; cursor: pointer; }
    .tab.active { background: linear-gradient(135deg, #ff9a62, #ff7847); color: #fff; font-weight: 600; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; color: #8c6b53; margin-bottom: 6px; }
    .field input { border-radius: 10px; height: 44px; font-size: 15px; }
    .switch-field { display: flex; align-items: center; justify-content: space-between; }
    .switch-field label { margin: 0; }
    .submit { margin-top: 8px; border-radius: 12px; height: 48px; font-size: 16px; }
  `]
})
export class LoginPage {
  private auth = inject(AuthService);
  private signalr = inject(SignalrService);
  private router = inject(Router);
  private message = inject(NzMessageService);

  readonly isRegister = signal(false);
  readonly loading = signal(false);

  userName = '';
  password = '';
  nickname = '';
  isChild = false;

  submit(): void {
    const name = this.userName.trim();
    if (!name || !this.password) return;
    this.loading.set(true);
    const req = this.isRegister()
      ? this.auth.register(name, this.password, this.nickname.trim() || null, this.isChild)
      : this.auth.login(name, this.password);
    req.subscribe({
      next: () => {
        this.loading.set(false);
        this.signalr.connect();
        this.message.success(this.isRegister() ? '欢迎加入圆梦笔记！' : '欢迎回来！');
        this.router.navigate(['/home']);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.message.error(err.error?.message || (this.isRegister() ? '注册失败，请重试' : '登录失败，请重试'));
      }
    });
  }
}
