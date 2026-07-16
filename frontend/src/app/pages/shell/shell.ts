import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SignalrService } from '../../core/signalr.service';

/** 登录后的主壳：内容区 + 底部标签栏。 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="shell-content">
      <router-outlet />
    </div>

    <nav class="tab-bar">
      @for (tab of tabs; track tab.path) {
        <a class="tab-item" [routerLink]="tab.path" routerLinkActive="active">
          @if (tab.path === '/dreams') {
            <!-- 浇花壶：梦想要经常浇灌（Unicode 无浇水壶 emoji，用内联 SVG 保持彩色图标语言） -->
            <span class="tab-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#ff7847" d="M11.6 11.2 h6 l1.15 7.6 a1.3 1.3 0 0 1 -1.28 1.5 h-6.9 a1.3 1.3 0 0 1 -1.28 -1.5 z"/>
                <ellipse fill="#e8623a" cx="14.6" cy="11.2" rx="2.1" ry=".85"/>
                <path fill="none" stroke="#ff7847" stroke-width="1.7" stroke-linecap="round" d="M18.4 12.6 c2.6 .5 2.9 3.6 .5 4.8"/>
                <path fill="#ff9a62" d="M11 14.9 L5.1 8.9 L6.9 7.1 L12 12.3 z"/>
                <circle fill="#ff9a62" cx="5.7" cy="7.7" r="1.75"/>
                <circle fill="#3d9bff" cx="3.1" cy="10.1" r=".95"/>
                <circle fill="#3d9bff" cx="1.6" cy="13" r=".85"/>
                <circle fill="#3d9bff" cx="4.6" cy="12.6" r=".85"/>
                <path fill="none" stroke="#4ca787" stroke-width="1.5" stroke-linecap="round" d="M3.4 20.7 v-2.1"/>
                <path fill="#4ca787" d="M3.4 18.8 c-2.3 -.2 -3.2 -1.5 -3.4 -3.3 2.3 .2 3.3 1.4 3.4 3.3 z"/>
                <path fill="#6ecb8f" d="M3.4 18.8 c2.3 -.2 3.2 -1.5 3.4 -3.3 -2.3 .2 -3.3 1.4 -3.4 3.3 z"/>
              </svg>
            </span>
          } @else {
            <span class="tab-icon">{{ tab.icon }}</span>
          }
          <span class="tab-label">{{ tab.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: [`
    /* app-shell：壳占满视口，内容区内滚，底栏走文档流（iOS 上 fixed 底栏会随视觉视口漂移） */
    :host { display: flex; flex-direction: column; height: 100%; }
    .shell-content {
      flex: 1 1 0; min-height: 0;
      overflow-y: auto; overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior-y: contain;
    }
    .tab-bar {
      flex: none; display: flex;
      height: calc(var(--kanau-tabbar-height) + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      background: #fff;
      border-top: 0.5px solid rgba(74, 52, 40, .1);
      box-shadow: 0 -2px 12px rgba(74, 52, 40, .06);
    }
    .tab-item {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; text-decoration: none; color: #b0a094; -webkit-user-select: none; user-select: none;
    }
    .tab-icon { font-size: 22px; line-height: 1; filter: grayscale(1) opacity(.6); transition: filter .15s, transform .15s; }
    .tab-icon svg { display: block; width: 22px; height: 22px; }
    .tab-label { font-size: 11px; }
    .tab-item.active { color: var(--kanau-primary); font-weight: 600; }
    .tab-item.active .tab-icon { filter: none; transform: scale(1.1); }
    .tab-item:active .tab-icon { transform: scale(.92); }
  `]
})
export class ShellPage implements OnInit {
  private api = inject(ApiService);
  private signalr = inject(SignalrService);

  readonly tabs = [
    { path: '/home', icon: '🏠', label: '首页' },
    { path: '/dreams', icon: '', label: '梦想' },
    { path: '/notes', icon: '✏️', label: '速记' },
    { path: '/reviews', icon: '📖', label: '回顾' },
    { path: '/settings', icon: '👤', label: '我的' }
  ];

  ngOnInit(): void {
    this.signalr.connect();
    this.api.loadMe().subscribe({ error: () => void 0 });
  }
}
