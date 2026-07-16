import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService, NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { ApiService } from '../../core/api.service';
import {
  DecomposeDraft, DreamDto, PlanDto, PyramidAreaLabel, PyramidAreaStr, SmartSuggestion
} from '../../core/models';

@Component({
  selector: 'app-dream-detail',
  imports: [
    DatePipe, FormsModule, RouterLink, NzButtonModule, NzDatePickerModule, NzInputModule,
    NzModalModule, NzSelectModule, NzSpinModule, NzTagModule
  ],
  template: `
    <div class="page">
      <a routerLink="/dreams" class="back">← 返回梦想列表</a>

      @if (dream(); as d) {
        <!-- 梦想信息 -->
        <div class="kanau-card info-card">
          @if (coverUrl(); as url) {
            <img class="cover" [src]="url" alt="梦想封面" />
          }
          <div class="title-row">
            <h1>{{ d.title }}</h1>
            <nz-tag [nzColor]="statusColor(d.status)">{{ statusLabel(d.status) }}</nz-tag>
          </div>
          @if (d.quantifiedText) {
            <p class="quantified">🎯 {{ d.quantifiedText }}</p>
          }
          <div class="meta">
            <span>领域：{{ areaLabel(d.pyramidArea) }}</span>
            @if (d.targetDate) {
              <span>目标：{{ d.targetDate | date: 'yyyy年M月d日' }}{{ countdownText(d) }}</span>
            }
          </div>

          <div class="action-row">
            <button nz-button nzShape="round" [nzLoading]="rewriting()" (click)="smartRewrite()">🪄 AI 帮我量化</button>
            <button nz-button nzShape="round" [nzLoading]="decomposing()" (click)="decompose()">🧩 AI 拆解计划</button>
            @if (d.status !== 'achieved') {
              <button nz-button nzShape="round" nzType="primary" (click)="markAchieved()">🏆 标记已实现</button>
            }
          </div>
        </div>

        <!-- AI 量化建议 -->
        @if (suggestion(); as s) {
          <div class="kanau-card suggest-card">
            <div class="card-head">🪄 AI 量化建议</div>
            @if (s.reason) {
              <p class="reason">{{ s.reason }}</p>
            }
            <div class="field">
              <label>量化目标（可修改）</label>
              <textarea nz-input rows="3" [(ngModel)]="editQuantified"></textarea>
            </div>
            <div class="field">
              <label>建议领域</label>
              <nz-select [(ngModel)]="editArea" style="width: 100%">
                @for (a of areaOptions; track a.value) {
                  <nz-option [nzValue]="a.value" [nzLabel]="a.label" />
                }
              </nz-select>
            </div>
            <div class="field">
              <label>建议目标日期</label>
              <nz-date-picker [(ngModel)]="editTargetDate" style="width: 100%" />
            </div>
            <div class="btn-row">
              <button nz-button nzType="primary" [nzLoading]="adopting()" (click)="adoptSuggestion()">✅ 采纳</button>
              <button nz-button (click)="suggestion.set(null)">先不用</button>
            </div>
          </div>
        }

        <!-- AI 拆解中 -->
        @if (decomposing()) {
          <div class="kanau-card decompose-loading">
            <nz-spin nzSimple />
            <p>AI 正在认真拆解你的梦想，把它变成一步步能做到的小事…</p>
            <p class="small">大约需要 1 分钟，喝口水等一下吧 ☕</p>
          </div>
        }

        <!-- 拆解草稿（可编辑） -->
        @if (draft(); as dr) {
          <div class="kanau-card draft-card">
            <div class="card-head">🧩 AI 拆解草稿（可修改后采纳）</div>

            @if (dr.musts.length > 0) {
              <div class="draft-section">
                <h3>必须做到的事</h3>
                @for (m of dr.musts; track $index; let i = $index) {
                  <div class="draft-row">
                    <input nz-input [(ngModel)]="dr.musts[i]" />
                    <button nz-button nzDanger nzSize="small" (click)="dr.musts.splice(i, 1)">删</button>
                  </div>
                }
              </div>
            }

            @if (dr.yearlyFocus.length > 0) {
              <div class="draft-section">
                <h3>年度重点</h3>
                @for (y of dr.yearlyFocus; track $index; let i = $index) {
                  <div class="draft-row">
                    <span class="period-tag">{{ y.year }}年</span>
                    <input nz-input [(ngModel)]="y.focus" />
                    <button nz-button nzDanger nzSize="small" (click)="dr.yearlyFocus.splice(i, 1)">删</button>
                  </div>
                }
              </div>
            }

            @if (dr.monthlyPlans.length > 0) {
              <div class="draft-section">
                <h3>月度计划</h3>
                @for (mp of dr.monthlyPlans; track $index) {
                  <div class="period-group">
                    <div class="period-head">{{ mp.month }}</div>
                    @for (it of mp.items; track $index; let i = $index) {
                      <div class="draft-row">
                        <input nz-input [(ngModel)]="mp.items[i]" />
                        <button nz-button nzDanger nzSize="small" (click)="mp.items.splice(i, 1)">删</button>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            @if (dr.weeklyPlans.length > 0) {
              <div class="draft-section">
                <h3>每周安排</h3>
                @for (wp of dr.weeklyPlans; track $index) {
                  <div class="period-group">
                    <div class="period-head">{{ wp.week }}</div>
                    @for (it of wp.items; track $index; let i = $index) {
                      <div class="draft-row">
                        <input nz-input [(ngModel)]="wp.items[i]" />
                        <button nz-button nzDanger nzSize="small" (click)="wp.items.splice(i, 1)">删</button>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            @if (dr.dailyTodos.length > 0) {
              <div class="draft-section">
                <h3>近期每日待办</h3>
                @for (dt of dr.dailyTodos; track $index) {
                  <div class="period-group">
                    <div class="period-head">{{ dt.date }}</div>
                    @for (it of dt.items; track $index; let i = $index) {
                      <div class="draft-row">
                        <input nz-input [(ngModel)]="dt.items[i]" />
                        <button nz-button nzDanger nzSize="small" (click)="dt.items.splice(i, 1)">删</button>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <div class="btn-row">
              <button nz-button nzType="primary" nzBlock [nzLoading]="adoptingPlan()" (click)="adoptPlan()">✅ 采纳生成计划</button>
            </div>
            <button nz-button nzBlock class="cancel-draft" (click)="draft.set(null)">放弃这份草稿</button>
          </div>
        }

        <!-- 已有计划 -->
        @if (plans().length > 0) {
          <div class="kanau-card">
            <div class="card-head">📋 行动计划</div>
            @for (group of planGroups(); track group.level) {
              <div class="draft-section">
                <h3>{{ group.label }}</h3>
                @for (p of group.plans; track p.id) {
                  <div class="plan-row">
                    @if (p.period && p.period !== 'musts') {
                      <span class="period-tag">{{ p.period }}</span>
                    }
                    <span class="plan-content">{{ p.content }}</span>
                    <button nz-button nzSize="small" nzDanger nzType="text" (click)="deletePlan(p)">✕</button>
                  </div>
                }
              </div>
            }
          </div>
        }
      } @else {
        <div class="center"><nz-spin nzSimple /></div>
      }
    </div>
  `,
  styles: [`
    .back { display: inline-block; color: #b26a45; text-decoration: none; margin-bottom: 12px; font-size: 14px; }
    .center { display: flex; justify-content: center; padding: 40px 0; }
    .info-card { margin-bottom: 14px; }
    .cover { width: 100%; border-radius: 12px; margin-bottom: 10px; max-height: 200px; object-fit: cover; }
    .title-row { display: flex; align-items: center; gap: 8px; }
    .title-row h1 { flex: 1; font-size: 20px; font-weight: 700; color: #4a3428; margin: 0; }
    .quantified { margin: 10px 0 0; color: #8c6b53; font-size: 14px; }
    .meta { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 13px; color: #b0a094; }
    .action-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
    .action-row button { min-height: 40px; }
    .suggest-card, .draft-card { margin-bottom: 14px; border: 1px solid #ffe0c9; }
    .card-head { font-size: 15px; font-weight: 700; color: #4a3428; margin-bottom: 10px; }
    .reason { background: #fff8f0; border-radius: 10px; padding: 10px; font-size: 13px; color: #8c6b53; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-size: 13px; color: #8c6b53; margin-bottom: 6px; }
    .btn-row { display: flex; gap: 10px; margin-top: 6px; }
    .decompose-loading { text-align: center; padding: 26px 16px; margin-bottom: 14px; }
    .decompose-loading p { margin: 12px 0 0; color: #8c6b53; font-size: 14px; }
    .decompose-loading .small { font-size: 12px; color: #b0a094; margin-top: 4px; }
    .draft-section { margin-bottom: 14px; }
    .draft-section h3 { font-size: 14px; font-weight: 700; color: #b26a45; margin: 0 0 8px; }
    .draft-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
    .draft-row input { border-radius: 8px; }
    .period-group { margin-bottom: 10px; }
    .period-head { font-size: 12px; color: #b0a094; margin-bottom: 5px; }
    .period-tag { flex-shrink: 0; font-size: 11px; background: #fff4ec; color: #b26a45; border-radius: 8px; padding: 2px 8px; white-space: nowrap; }
    .plan-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #f3e5d8; }
    .plan-row:last-child { border-bottom: none; }
    .plan-content { flex: 1; font-size: 14px; color: #4a3428; }
    .cancel-draft { margin-top: 8px; }
  `]
})
export class DreamDetailPage implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private message = inject(NzMessageService);
  private modal = inject(NzModalService);

  readonly dream = signal<DreamDto | null>(null);
  readonly coverUrl = signal<string | null>(null);
  readonly plans = signal<PlanDto[]>([]);
  readonly planGroups = signal<{ level: string; label: string; plans: PlanDto[] }[]>([]);
  readonly suggestion = signal<SmartSuggestion | null>(null);
  readonly draft = signal<DecomposeDraft | null>(null);
  readonly rewriting = signal(false);
  readonly adopting = signal(false);
  readonly decomposing = signal(false);
  readonly adoptingPlan = signal(false);

  editQuantified = '';
  editArea: PyramidAreaStr = 'mind';
  editTargetDate: Date | null = null;

  readonly areaOptions = (Object.keys(PyramidAreaLabel) as PyramidAreaStr[]).map((k) => ({
    value: k,
    label: PyramidAreaLabel[k]
  }));

  private id = '';

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loadDream();
    this.loadPlans();
  }

  private loadDream(): void {
    this.api.getDream(this.id).subscribe({
      next: (d) => {
        this.dream.set(d);
        if (d.coverObjectKey) {
          this.api.dreamCoverUrl(d.id).subscribe({ next: (r) => this.coverUrl.set(r.url), error: () => void 0 });
        }
        // 已有未采纳的 AI 建议 → 直接展示
        if (d.aiSuggestion && !this.suggestion()) {
          try {
            const s = JSON.parse(d.aiSuggestion) as SmartSuggestion;
            this.showSuggestion(s);
          } catch { /* ignore */ }
        }
      },
      error: () => this.message.error('梦想加载失败')
    });
  }

  private loadPlans(): void {
    this.api.plansByDream(this.id).subscribe({
      next: (list) => {
        this.plans.set(list);
        const labels: Record<string, string> = { year: '年度', month: '月度', week: '每周' };
        const groups: { level: string; label: string; plans: PlanDto[] }[] = [];
        for (const level of ['year', 'month', 'week']) {
          const inLevel = list.filter((p) => p.level === level);
          if (inLevel.length > 0) groups.push({ level, label: labels[level], plans: inLevel });
        }
        this.planGroups.set(groups);
      },
      error: () => void 0
    });
  }

  areaLabel(a: string): string {
    return PyramidAreaLabel[a as PyramidAreaStr] ?? a;
  }

  statusLabel(s: string): string {
    return { draft: '草稿', active: '进行中', achieved: '已实现', archived: '已归档' }[s] ?? s;
  }

  statusColor(s: string): string {
    return { draft: 'default', active: 'orange', achieved: 'green', archived: 'default' }[s] ?? 'default';
  }

  countdownText(d: DreamDto): string {
    if (!d.targetDate) return '';
    const days = Math.ceil((new Date(d.targetDate).getTime() - Date.now()) / 86400000);
    if (days > 0) return `（还有 ${days} 天）`;
    if (days === 0) return '（就是今天！）';
    return `（已过 ${-days} 天）`;
  }

  // ==================== AI 量化 ====================
  smartRewrite(): void {
    this.rewriting.set(true);
    this.api.smartRewrite(this.id).subscribe({
      next: (s) => {
        this.rewriting.set(false);
        this.showSuggestion(s);
      },
      error: (err) => {
        this.rewriting.set(false);
        this.message.error(err?.error?.message || 'AI 暂时不可用，请稍后再试');
      }
    });
  }

  private showSuggestion(s: SmartSuggestion): void {
    this.suggestion.set(s);
    this.editQuantified = s.quantifiedText ?? '';
    const area = (s.pyramidArea || '').toLowerCase() as PyramidAreaStr;
    this.editArea = PyramidAreaLabel[area] ? area : (this.dream()?.pyramidArea ?? 'mind');
    this.editTargetDate = s.targetDate ? new Date(s.targetDate) : null;
  }

  adoptSuggestion(): void {
    const s = this.suggestion();
    if (!s || !this.editQuantified.trim()) return;
    this.adopting.set(true);
    this.api.adoptSuggestion(this.id, {
      quantifiedText: this.editQuantified.trim(),
      pyramidArea: this.editArea,
      targetDate: this.editTargetDate ? this.toDateStr(this.editTargetDate) : null,
      reason: s.reason
    }).subscribe({
      next: (d) => {
        this.adopting.set(false);
        this.suggestion.set(null);
        this.dream.set(d);
        this.message.success('已采纳 AI 建议 🎯');
      },
      error: () => {
        this.adopting.set(false);
        this.message.error('采纳失败，请重试');
      }
    });
  }

  // ==================== AI 拆解 ====================
  decompose(): void {
    this.decomposing.set(true);
    this.draft.set(null);
    this.api.decompose(this.id).subscribe({
      next: (dr) => {
        this.decomposing.set(false);
        this.draft.set({
          musts: dr.musts ?? [],
          yearlyFocus: dr.yearlyFocus ?? [],
          monthlyPlans: dr.monthlyPlans ?? [],
          weeklyPlans: dr.weeklyPlans ?? [],
          dailyTodos: dr.dailyTodos ?? []
        });
        this.message.success('拆解完成！可以修改后采纳');
      },
      error: (err) => {
        this.decomposing.set(false);
        this.message.error(err?.error?.message || 'AI 拆解暂时不可用，请稍后再试');
      }
    });
  }

  adoptPlan(): void {
    const dr = this.draft();
    if (!dr) return;
    this.adoptingPlan.set(true);
    this.api.adoptPlan(this.id, dr).subscribe({
      next: () => {
        this.adoptingPlan.set(false);
        this.draft.set(null);
        this.message.success('计划已生成！今天开始行动吧 💪');
        this.loadPlans();
      },
      error: () => {
        this.adoptingPlan.set(false);
        this.message.error('生成失败，请重试');
      }
    });
  }

  deletePlan(p: PlanDto): void {
    this.api.deletePlan(p.id).subscribe({
      next: () => this.loadPlans(),
      error: () => this.message.error('删除失败')
    });
  }

  // ==================== 状态 ====================
  markAchieved(): void {
    this.modal.confirm({
      nzTitle: '确认这个梦想已经实现了吗？',
      nzContent: '恭喜你！实现后会记录到你的成就里。',
      nzOkText: '实现啦 🎉',
      nzCancelText: '还没有',
      nzOnOk: () => {
        this.api.setDreamStatus(this.id, 2).subscribe({
          next: (d) => {
            this.dream.set(d);
            this.message.success('🏆 恭喜圆梦！');
          },
          error: () => this.message.error('操作失败，请重试')
        });
      }
    });
  }

  private toDateStr(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
}
