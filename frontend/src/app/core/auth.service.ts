import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse } from './models';

const TOKEN_KEY = 'kanau_token';
const USER_KEY = 'kanau_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  readonly user = signal<AuthResponse | null>(this.load());

  private load(): AuthResponse | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthResponse) : null;
    } catch {
      return null;
    }
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isLoggedIn(): boolean {
    return !!this.token;
  }

  login(userName: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/login', { userName, password })
      .pipe(tap((r) => this.store(r)));
  }

  register(userName: string, password: string, nickname: string | null, isChild: boolean): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>('/api/auth/register', { userName, password, nickname, isChild })
      .pipe(tap((r) => this.store(r)));
  }

  private store(r: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, r.token);
    localStorage.setItem(USER_KEY, JSON.stringify(r));
    this.user.set(r);
  }

  /** 昵称修改后同步本地缓存。 */
  updateNickname(nickname: string): void {
    const u = this.user();
    if (!u) return;
    const updated = { ...u, nickname };
    localStorage.setItem(USER_KEY, JSON.stringify(updated));
    this.user.set(updated);
  }

  logout(redirect = true): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    if (redirect) this.router.navigate(['/login']);
  }
}
