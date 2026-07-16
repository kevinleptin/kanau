import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { ApiService } from '../../core/api.service';
import { CaptureDto, ReviewDto, ReviewStats } from '../../core/models';
import { CaptureInput } from '../../shared/capture-input/capture-input';

const AREA_CN: Record<string, string> = {
  Health: '健康', Knowledge: '修养·知识', Mind: '心灵·精神',
  Work: '社会·工作', Family: '私人·家庭', Wealth: '经济·物质'
};

@Component({
  selector: 'app-reviews',
  imports: [DatePipe, NzButtonModule, NzSpinModule, NzTagModule, CaptureInput],
  template: `
    <div class="page">
      <div class="head-row">
        <h1 class="page-title">回顾 📖</h1>
        <button nz-button nzType="primary" nzShape="round" [nzLoading]="generating()"
                (click)="generate()">生成本周回顾</button>
      </div>

      @if (loading()) {
        <div class="center"><nz-spin nzSimple /></div>
      }

      @for (r of reviews(); track r.id) {
        <div class="kanau-card review-card" (click)="toggle(r.id)">
          <div class="review-head">
            <nz-tag [nzColor]="r.periodType === 'week' ? 'orange' : 'purple'">
              {{ r.periodType === 'week' ? '周回顾' : '月回顾' }}
            </nz-tag>
            <span class="period">{{ r.periodStart | date: 'yyyy年M月d日' }} 起</span>
            <span class="expand-mark">{{ expandedId() === r.id ? '▲' : '▼' }}</span>
          </div>

          @if (stats(r); as st) {
            <div class="stat-row">
              <div class="stat"><b>{{ st.total }}</b><span>待办总数</span></div>
              <div class="stat"><b>{{ st.done }}</b><span>已完成</span></div>
              <div class="stat"><b>{{ st.completionRate }}%</b><span>完成率</span></div>
            </div>
          }

          @if (expandedId() === r.id) {
            <div class="detail" (click)="$event.stopPropagation()">
              @if (stats(r); as st) {
                @if (areaEntries(st).length > 0) {
                  <div class="detail-section">
                    <h3>各领域投入</h3>
                    <div class="area-chips">
                      @for (a of areaEntries(st); track a.name) {
                        <span class="area-chip">{{ a.name }} × {{ a.count }}</span>
                      }
                    </div>
                  </div>
                }
                @if (st.mostPostponed.length > 0) {
                  <div class="detail-section">
                    <h3>最常顺延</h3>
                    @for (p of st.mostPostponed; track p.Title) {
                      <div class="postponed-row">{{ p.Title }}<span class="pc">顺延{{ p.PostponeCount }}次</span></div>
                    }
                  </div>
                }
              }

              @if (r.aiComment) {
                <div class="detail-section">
                  <h3>AI 点评</h3>
                  <div class="ai-comment" [innerHTML]="renderComment(r.aiComment)"></div>
                </div>
              } @else {
                <div class="detail-section"><p class="pending">AI 点评生成中，稍后刷新查看…</p></div>
              }

              <div class="detail-section">
                @if (appendingId() === r.id) {
                  <h3>口述补充</h3>
                  <p class="cap-hint">说说这周的感受，AI 会重新生成点评：</p>
                  <app-capture-input placeholder="这周我觉得…" (captureReady)="appendCapture(r, $event)" />
                  <button nz-button nzBlock class="cancel-append" (click)="appendingId.set(null)">收起</button>
                } @else {
                  <button nz-button nzBlock (click)="appendingId.set(r.id)">🎤 口述补充</button>
                }
              </div>
            </div>
          }
        </div>
      } @empty {
        @if (!loading()) {
          <div class="kanau-card empty-card">还没有回顾，点右上角「生成本周回顾」试试 ✨</div>
        }
      }
    </div>
  `,
  styles: [`
    .head-row { display: flex; align-items: center; justify-content: space-between; }
    .head-row .page-title { margin: 4px 0; }
    .center { display: flex; justify-content: center; padding: 30px 0; }
    .review-card { margin-bottom: 12px; cursor: pointer; margin-top: 12px; }
    .review-head { display: flex; align-items: center; gap: 8px; }
    .period { flex: 1; font-size: 13px; color: #8c6b53; }
    .expand-mark { color: #d0c0b2; font-size: 12px; }
    .stat-row { display: flex; gap: 10px; margin-top: 12px; }
    .stat { flex: 1; background: #fff8f0; border-radius: 12px; padding: 10px; text-align: center; }
    .stat b { display: block; font-size: 20px; color: #d95a2b; }
    .stat span { font-size: 12px; color: #b0a094; }
    .detail { margin-top: 14px; border-top: 1px dashed #f3e5d8; padding-top: 12px; cursor: default; }
    .detail-section { margin-bottom: 14px; }
    .detail-section h3 { font-size: 14px; font-weight: 700; color: #b26a45; margin: 0 0 8px; }
    .area-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .area-chip { font-size: 12px; background: #eef6ff; color: #3d6bff; border-radius: 8px; padding: 3px 10px; }
    .postponed-row { display: flex; justify-content: space-between; font-size: 13px; color: #4a3428; padding: 5px 0; }
    .pc { color: #e84040; font-size: 12px; }
    .ai-comment { background: #f7f3ff; border-radius: 12px; padding: 12px; font-size: 14px; color: #4a3428; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
    .pending { color: #b0a094; font-size: 13px; }
    .cap-hint { font-size: 13px; color: #8c6b53; margin: 0 0 8px; }
    .cancel-append { margin-top: 8px; }
    .empty-card { text-align: center; color: #b0a094; padding: 26px 14px; margin-top: 12px; }
  `]
})
export class ReviewsPage implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private message = inject(NzMessageService);

  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly reviews = signal<ReviewDto[]>([]);
  readonly expandedId = signal<string | null>(null);
  readonly appendingId = signal<string | null>(null);

  private statsCache = new Map<string, ReviewStats | null>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private load(): void {
    this.api.listReviews().subscribe({
      next: (list) => {
        this.statsCache.clear();
        this.reviews.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  toggle(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
    this.appendingId.set(null);
  }

  stats(r: ReviewDto): ReviewStats | null {
    if (!this.statsCache.has(r.id)) {
      let parsed: ReviewStats | null = null;
      if (r.stats) {
        try {
          const raw = JSON.parse(r.stats) as Partial<ReviewStats>;
          parsed = {
            total: raw.total ?? 0,
            done: raw.done ?? 0,
            completionRate: raw.completionRate ?? 0,
            mostPostponed: raw.mostPostponed ?? [],
            areaStats: raw.areaStats ?? {}
          };
        } catch { /* ignore */ }
      }
      this.statsCache.set(r.id, parsed);
    }
    return this.statsCache.get(r.id) ?? null;
  }

  areaEntries(st: ReviewStats): { name: string; count: number }[] {
    return Object.entries(st.areaStats).map(([k, v]) => ({ name: AREA_CN[k] ?? k, count: v }));
  }

  /** 极简 markdown 渲染：**加粗**、行首 - 列表符号 */
  renderComment(text: string): string {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/^[-*] /gm, '• ')
      .replace(/^#+\s*(.+)$/gm, '<b>$1</b>');
  }

  generate(): void {
    this.generating.set(true);
    this.api.generateReview(0).subscribe({
      next: (r) => {
        this.message.success(r.message || '回顾生成已排队，稍后刷新查看');
        // 几秒后自动刷新一次列表
        this.pollTimer = setTimeout(() => {
          this.generating.set(false);
          this.load();
        }, 6000);
      },
      error: () => {
        this.generating.set(false);
        this.message.error('生成失败，请稍后再试');
      }
    });
  }

  appendCapture(r: ReviewDto, cap: CaptureDto): void {
    this.api.appendReviewCapture(r.id, cap.id).subscribe({
      next: (res) => {
        this.message.success(res.message || '已提交，AI 正在重新生成点评');
        this.appendingId.set(null);
        this.pollTimer = setTimeout(() => this.load(), 8000);
      },
      error: () => this.message.error('提交失败，请重试')
    });
  }
}
