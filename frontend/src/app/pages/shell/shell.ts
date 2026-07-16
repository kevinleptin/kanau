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
          <span class="tab-icon">{{ tab.icon }}</span>
          <span class="tab-label">{{ tab.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: [`
    .shell-content { min-height: 100dvh; }
    .tab-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
      height: calc(var(--kanau-tabbar-height) + env(safe-area-inset-bottom, 0px));
      padding-bottom: env(safe-area-inset-bottom, 0px);
      background: #fff; display: flex;
      box-shadow: 0 -2px 12px rgba(74, 52, 40, .08);
    }
    .tab-item {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 2px; text-decoration: none; color: #b0a094; min-height: 48px;
    }
    .tab-icon { font-size: 22px; line-height: 1; filter: grayscale(1) opacity(.6); transition: all .15s; }
    .tab-label { font-size: 11px; }
    .tab-item.active { color: var(--kanau-primary); font-weight: 600; }
    .tab-item.active .tab-icon { filter: none; transform: scale(1.1); }
  `]
})
export class ShellPage implements OnInit {
  private api = inject(ApiService);
  private signalr = inject(SignalrService);

  readonly tabs = [
    { path: '/home', icon: '🏠', label: '首页' },
    { path: '/dreams', icon: '🌈', label: '梦想' },
    { path: '/notes', icon: '✏️', label: '速记' },
    { path: '/reviews', icon: '📖', label: '回顾' },
    { path: '/settings', icon: '👤', label: '我的' }
  ];

  ngOnInit(): void {
    this.signalr.connect();
    this.api.loadMe().subscribe({ error: () => void 0 });
  }
}
