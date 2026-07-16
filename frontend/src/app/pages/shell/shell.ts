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
