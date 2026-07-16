import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { PyramidAreaLabel, TodayBrief, TodoDto } from '../../core/models';

@Component({
  selector: 'app-home',
  imports: [DatePipe, FormsModule, RouterLink, NzButtonModule, NzInputModule, NzSpinModule],
  template: `
    <div class="page">
      <h1 class="page-title">你好，{{ nickname() }} 👋</h1>

      @if (loading()) {
        <div class="center"><nz-spin nzSimple /></div>
      } @else if (brief(); as b) {
        <!-- 今日一梦 -->
        @if (b.dream; as dream) {
          <a class="kanau-card dream-card" [routerLink]="['/dreams', dream.id]">
            <div class="dream-head">
              <span class="dream-badge">🌟 今日一梦</span>
              <span class="dream-area">{{ areaLabel(dream.pyramidArea) }}</span>
            </div>
            @if (coverUrl(); as url) {
              <img class="dream-cover" [src]="url" alt="梦想封面" />
            }
            <div class="dream-title">{{ dream.title }}</div>
            @if (dream.quantifiedText) {
              <div class="dream-quantified">{{ dream.quantifiedText }}</div>
            }
            @if (b.countdownDays !== null) {
              <div class="dream-countdown">
                @if (b.countdownDays > 0) {
                  距离目标还有 <b>{{ b.countdownDays }}</b> 天，加油！
                } @else if (b.countdownDays === 0) {
                  🎉 就是今天！
                } @else {
                  目标日期已过 {{ -b.countdownDays }} 天，要不要调整一下计划？
                }
              </div>
            }
          </a>
        } @else {
          <a class="kanau-card dream-card empty" routerLink="/dreams">
            <div class="dream-title">还没有进行中的梦想</div>
            <div class="dream-quantified">去「梦想」页写下第一个梦想吧 →</div>
          </a>
        }

        <!-- 今日待办 -->
        <div class="section-head">
          <h2>今日待办</h2>
          <span class="date">{{ today | date: 'M月d日 EEEE' }}</span>
        </div>

        <div class="kanau-card">
          @for (todo of b.todos; track todo.id) {
            <div class="todo-row" [class.done]="todo.status === 'done'">
              <button type="button" class="todo-check" (click)="toggle(todo)">
                {{ todo.status === 'done' ? '✅' : '⬜' }}
              </button>
              <span class="todo-title">{{ todo.title }}</span>
              @if (todo.postponeCount > 0) {
                <span class="postpone-badge">顺延{{ todo.postponeCount }}次</span>
              }
            </div>
          } @empty {
            <div class="todo-empty">今天还没有待办，加一个吧 💪</div>
          }

          <div class="quick-add">
            <input nz-input [(ngModel)]="newTodo" placeholder="快速添加今日待办…"
                   (keyup.enter)="addTodo()" />
            <button nz-button nzType="primary" [disabled]="!newTodo.trim()" (click)="addTodo()">添加</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .center { display: flex; justify-content: center; padding: 40px 0; }
    .dream-card { display: block; text-decoration: none; margin-bottom: 18px;
      background: linear-gradient(135deg, #fff 0%, #fff2e8 100%); }
    .dream-card.empty { text-align: center; padding: 24px 14px; }
    .dream-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .dream-badge { font-size: 13px; font-weight: 700; color: var(--kanau-primary); }
    .dream-area { font-size: 12px; background: #ffe7d6; color: #b26a45; border-radius: 8px; padding: 2px 8px; }
    .dream-cover { width: 100%; border-radius: 12px; margin-bottom: 8px; max-height: 180px; object-fit: cover; }
    .dream-title { font-size: 18px; font-weight: 700; color: #4a3428; }
    .dream-quantified { margin-top: 4px; color: #8c6b53; font-size: 14px; }
    .dream-countdown { margin-top: 10px; font-size: 14px; color: #d95a2b; }
    .dream-countdown b { font-size: 20px; }
    .section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 4px 2px 10px; }
    .section-head h2 { font-size: 16px; font-weight: 700; color: #4a3428; margin: 0; }
    .section-head .date { font-size: 12px; color: #b0a094; }
    .todo-row { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px dashed #f3e5d8; }
    .todo-row:last-of-type { border-bottom: none; }
    .todo-check { border: none; background: transparent; font-size: 20px; cursor: pointer; padding: 4px; min-width: 36px; min-height: 36px; }
    .todo-title { flex: 1; font-size: 15px; color: #4a3428; }
    .todo-row.done .todo-title { text-decoration: line-through; color: #c2b3a5; }
    .postpone-badge { font-size: 11px; background: #fff1f0; color: #e84040; border-radius: 8px; padding: 2px 8px; white-space: nowrap; }
    .todo-empty { text-align: center; color: #b0a094; padding: 14px 0; font-size: 14px; }
    .quick-add { display: flex; gap: 8px; margin-top: 12px; }
    .quick-add input { border-radius: 10px; height: 40px; }
    .quick-add button { border-radius: 10px; height: 40px; }
  `]
})
export class HomePage implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private message = inject(NzMessageService);

  readonly loading = signal(true);
  readonly brief = signal<TodayBrief | null>(null);
  readonly coverUrl = signal<string | null>(null);
  readonly nickname = signal('朋友');
  readonly today = new Date();

  newTodo = '';

  ngOnInit(): void {
    const u = this.auth.user();
    if (u) this.nickname.set(u.nickname || u.userName);
    this.load();
  }

  private load(): void {
    this.api.todayBrief().subscribe({
      next: (b) => {
        this.brief.set(b);
        this.loading.set(false);
        if (b.dream?.coverObjectKey) {
          this.api.dreamCoverUrl(b.dream.id).subscribe({
            next: (r) => this.coverUrl.set(r.url),
            error: () => void 0
          });
        }
      },
      error: () => {
        this.loading.set(false);
        this.message.error('加载失败，请下拉刷新');
      }
    });
  }

  areaLabel(area: string): string {
    return PyramidAreaLabel[area as keyof typeof PyramidAreaLabel] ?? area;
  }

  toggle(todo: TodoDto): void {
    this.api.toggleTodo(todo.id).subscribe({
      next: (updated) => {
        const b = this.brief();
        if (!b) return;
        this.brief.set({ ...b, todos: b.todos.map((t) => (t.id === updated.id ? updated : t)) });
        if (updated.status === 'done') this.message.success('太棒了，又完成一项！🎉');
      },
      error: () => this.message.error('操作失败，请重试')
    });
  }

  addTodo(): void {
    const title = this.newTodo.trim();
    if (!title) return;
    this.api.createTodo({ title }).subscribe({
      next: (t) => {
        this.newTodo = '';
        const b = this.brief();
        if (b) this.brief.set({ ...b, todos: [...b.todos, t] });
      },
      error: () => this.message.error('添加失败，请重试')
    });
  }
}
