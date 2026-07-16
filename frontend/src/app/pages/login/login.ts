import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AuthService } from '../../core/auth.service';
import { SignalrService } from '../../core/signalr.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, NzButtonModule, NzInputModule],
  template: `
    <div class="login-wrap">
      <div class="brand">
        <div class="logo">🌈</div>
        <h1>圆梦笔记</h1>
        <p>把梦想写下来，一步步实现它</p>
      </div>

      <div class="kanau-card form-card">
        <div class="field">
          <label>用户名</label>
          <input nz-input [(ngModel)]="userName" placeholder="请输入用户名" autocomplete="username" />
        </div>
        <div class="field">
          <label>密码</label>
          <input nz-input type="password" [(ngModel)]="password" placeholder="请输入密码"
                 autocomplete="current-password" (keyup.enter)="submit()" />
        </div>

        <button nz-button nzType="primary" nzBlock nzSize="large" class="submit"
                [nzLoading]="loading()" [disabled]="!userName.trim() || !password"
                (click)="submit()">
          登录
        </button>
        <p class="hint">账号由管理员创建，如需开通请联系管理员</p>
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
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; color: #8c6b53; margin-bottom: 6px; }
    .field input { border-radius: 10px; height: 44px; font-size: 15px; }
    .submit { margin-top: 8px; border-radius: 12px; height: 48px; font-size: 16px; }
    .hint { text-align: center; margin: 12px 0 0; font-size: 12px; color: #c4a58c; }
  `]
})
export class LoginPage {
  private auth = inject(AuthService);
  private signalr = inject(SignalrService);
  private router = inject(Router);
  private message = inject(NzMessageService);

  readonly loading = signal(false);

  userName = '';
  password = '';

  submit(): void {
    const name = this.userName.trim();
    if (!name || !this.password) return;
    this.loading.set(true);
    this.auth.login(name, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.signalr.connect();
        this.message.success('欢迎回来！');
        this.router.navigate(['/home']);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.message.error(err.error?.message || '登录失败，请重试');
      }
    });
  }
}
