import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { EChartsOption } from 'echarts';
import { NgxEchartsDirective } from 'ngx-echarts';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule } from 'ng-zorro-antd/modal';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { ApiService } from '../../core/api.service';
import {
  CaptureDto, DreamDto, PyramidAreaLabel, PyramidAreaNum, PyramidAreaStat, PyramidAreaStr
} from '../../core/models';
import { CaptureInput } from '../../shared/capture-input/capture-input';

const AREA_COLORS: Record<PyramidAreaStr, string> = {
  wealth: '#f7b32b',
  work: '#3d9bff',
  family: '#ff6f91',
  health: '#42c98d',
  knowledge: '#9b5cff',
  mind: '#ff9a62'
};

/** 金字塔从顶到底的展示顺序：结果层 → 实现层 → 基础层 */
const PYRAMID_TOP_DOWN: { area: PyramidAreaStr; width: number; layer: string }[] = [
  { area: 'wealth', width: 42, layer: '结果层' },
  { area: 'work', width: 56, layer: '实现层' },
  { area: 'family', width: 68, layer: '实现层' },
  { area: 'health', width: 80, layer: '基础层' },
  { area: 'knowledge', width: 90, layer: '基础层' },
  { area: 'mind', width: 100, layer: '基础层' }
];

@Component({
  selector: 'app-dreams',
  imports: [
    FormsModule, RouterLink, NgxEchartsDirective, NzButtonModule, NzDatePickerModule,
    NzInputModule, NzModalModule, NzSelectModule, NzSpinModule, NzTagModule, CaptureInput
  ],
  template: `
    <div class="page">
      <div class="head-row">
        <h1 class="page-title">我的梦想金字塔</h1>
        <button nz-button nzType="primary" nzShape="round" (click)="openCreate()">＋ 新梦想</button>
      </div>

      <!-- 金字塔视图 -->
      <div class="kanau-card">
        @if (chartOption(); as opt) {
          <div echarts [options]="opt" class="pyramid-chart"></div>
        } @else {
          <div class="center"><nz-spin nzSimple /></div>
        }
        @if (emptyAreas().length > 0) {
          <div class="empty-hints">
            @for (a of emptyAreas(); track a) {
              <span class="empty-hint" [style.borderColor]="areaColor(a)" [style.color]="areaColor(a)">
                {{ areaLabel(a) }}：该领域还没有梦想
              </span>
            }
          </div>
        }
      </div>

      <!-- 梦想列表 -->
      <div class="section-head"><h2>梦想清单</h2></div>
      @if (loading()) {
        <div class="center"><nz-spin nzSimple /></div>
      }
      @for (d of dreams(); track d.id) {
        <a class="kanau-card dream-item" [routerLink]="['/dreams', d.id]">
          <div class="dream-top">
            <span class="area-dot" [style.background]="areaColor(d.pyramidArea)"></span>
            <span class="dream-title">{{ d.title }}</span>
            <nz-tag [nzColor]="statusColor(d.status)">{{ statusLabel(d.status) }}</nz-tag>
          </div>
          @if (d.quantifiedText) {
            <div class="dream-sub">{{ d.quantifiedText }}</div>
          }
          <div class="dream-meta">
            <span>{{ areaLabel(d.pyramidArea) }}</span>
            @if (countdown(d); as c) {
              <span class="countdown">{{ c }}</span>
            }
          </div>
        </a>
      } @empty {
        @if (!loading()) {
          <div class="kanau-card empty-card">还没有梦想，点右上角「＋ 新梦想」写下第一个吧 ✨</div>
        }
      }

      <!-- 创建梦想弹窗 -->
      <nz-modal [(nzVisible)]="createVisible" nzTitle="写下新的梦想 ✨" [nzFooter]="null"
                (nzOnCancel)="createVisible = false">
        <ng-container *nzModalContent>
          <div class="create-tabs">
            <button type="button" class="ctab" [class.active]="createMode() === 'form'" (click)="createMode.set('form')">手动填写</button>
            <button type="button" class="ctab" [class.active]="createMode() === 'capture'" (click)="createMode.set('capture')">语音/拍照速记</button>
          </div>

          <div class="field">
            <label>梦想领域</label>
            <nz-select [(ngModel)]="newArea" style="width: 100%">
              @for (a of areaOptions; track a.value) {
                <nz-option [nzValue]="a.value" [nzLabel]="a.label" />
              }
            </nz-select>
          </div>
          <div class="field">
            <label>目标日期（选填）</label>
            <nz-date-picker [(ngModel)]="newTargetDate" style="width: 100%" nzPlaceHolder="什么时候实现它？" />
          </div>

          @if (createMode() === 'form') {
            <div class="field">
              <label>梦想内容</label>
              <textarea nz-input rows="3" [(ngModel)]="newTitle" placeholder="例如：学会游泳 1000 米"></textarea>
            </div>
            <button nz-button nzType="primary" nzBlock nzSize="large" [nzLoading]="creating()"
                    [disabled]="!newTitle.trim()" (click)="createFromForm()">创建梦想</button>
          } @else {
            <p class="cap-hint">说出或写下你的梦想，完成后自动创建：</p>
            <app-capture-input placeholder="我的梦想是…" (captureReady)="createFromCapture($event)" />
          }
        </ng-container>
      </nz-modal>
    </div>
  `,
  styles: [`
    .head-row { display: flex; align-items: center; justify-content: space-between; }
    .head-row .page-title { margin: 4px 0; }
    .center { display: flex; justify-content: center; padding: 30px 0; }
    .pyramid-chart { width: 100%; height: 280px; }
    .empty-hints { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .empty-hint { font-size: 12px; border: 1px dashed; border-radius: 10px; padding: 3px 10px; }
    .section-head { margin: 18px 2px 10px; }
    .section-head h2 { font-size: 16px; font-weight: 700; color: #4a3428; margin: 0; }
    .dream-item { display: block; text-decoration: none; margin-bottom: 12px; }
    .dream-top { display: flex; align-items: center; gap: 8px; }
    .area-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .dream-title { flex: 1; font-size: 16px; font-weight: 600; color: #4a3428; }
    .dream-sub { margin-top: 6px; font-size: 13px; color: #8c6b53; }
    .dream-meta { display: flex; justify-content: space-between; margin-top: 8px; font-size: 12px; color: #b0a094; }
    .countdown { color: #d95a2b; font-weight: 600; }
    .empty-card { text-align: center; color: #b0a094; padding: 26px 14px; }
    .create-tabs { display: flex; background: #fff4ec; border-radius: 12px; padding: 4px; margin-bottom: 16px; }
    .ctab { flex: 1; border: none; background: transparent; border-radius: 10px; padding: 9px; font-size: 14px; color: #b26a45; cursor: pointer; }
    .ctab.active { background: linear-gradient(135deg, #ff9a62, #ff7847); color: #fff; font-weight: 600; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; color: #8c6b53; margin-bottom: 6px; }
    .cap-hint { font-size: 13px; color: #8c6b53; margin: 4px 0 10px; }
  `]
})
export class DreamsPage implements OnInit {
  private api = inject(ApiService);
  private message = inject(NzMessageService);

  readonly loading = signal(true);
  readonly dreams = signal<DreamDto[]>([]);
  readonly chartOption = signal<EChartsOption | null>(null);
  readonly emptyAreas = signal<PyramidAreaStr[]>([]);
  readonly creating = signal(false);
  readonly createMode = signal<'form' | 'capture'>('form');

  createVisible = false;
  newTitle = '';
  newArea: PyramidAreaStr = 'mind';
  newTargetDate: Date | null = null;

  readonly areaOptions = (Object.keys(PyramidAreaLabel) as PyramidAreaStr[]).map((k) => ({
    value: k,
    label: PyramidAreaLabel[k]
  }));

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.listDreams().subscribe({
      next: (list) => {
        this.dreams.set(list.filter((d) => d.status !== 'archived'));
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
    this.api.pyramid().subscribe({
      next: (stats) => this.buildChart(stats),
      error: () => void 0
    });
  }

  private buildChart(stats: PyramidAreaStat[]): void {
    const byArea = new Map(stats.map((s) => [s.area, s]));
    this.emptyAreas.set(PYRAMID_TOP_DOWN.filter((r) => (byArea.get(r.area)?.total ?? 0) === 0).map((r) => r.area));

    const data = PYRAMID_TOP_DOWN.map((row) => {
      const s = byArea.get(row.area);
      const total = s?.total ?? 0;
      return {
        name: PyramidAreaLabel[row.area],
        value: row.width,
        realTotal: total,
        achieved: s?.achieved ?? 0,
        layer: row.layer,
        itemStyle: {
          color: total > 0 ? AREA_COLORS[row.area] : '#e8ddd2',
          borderRadius: 6
        }
      };
    });

    this.chartOption.set({
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const d = (p as { data: { name: string; realTotal: number; achieved: number; layer: string } }).data;
          return `${d.layer} · ${d.name}<br/>梦想 ${d.realTotal} 个（已实现 ${d.achieved}）`;
        }
      },
      series: [
        {
          type: 'funnel',
          sort: 'ascending',
          left: '4%',
          top: 6,
          bottom: 6,
          width: '92%',
          gap: 5,
          minSize: '38%',
          maxSize: '100%',
          label: {
            show: true,
            position: 'inside',
            formatter: (p: unknown) => {
              const d = (p as { data: { name: string; realTotal: number } }).data;
              return d.realTotal > 0 ? `${d.name}  ${d.realTotal}` : `${d.name}  0`;
            },
            color: '#fff',
            fontSize: 13,
            fontWeight: 'bold'
          },
          labelLine: { show: false },
          itemStyle: { borderWidth: 0 },
          emphasis: { label: { fontSize: 14 } },
          data
        }
      ]
    });
  }

  areaLabel(area: string): string {
    return PyramidAreaLabel[area as PyramidAreaStr] ?? area;
  }

  areaColor(area: string): string {
    return AREA_COLORS[area as PyramidAreaStr] ?? '#ccc';
  }

  statusLabel(s: string): string {
    return { draft: '草稿', active: '进行中', achieved: '已实现', archived: '已归档' }[s] ?? s;
  }

  statusColor(s: string): string {
    return { draft: 'default', active: 'orange', achieved: 'green', archived: 'default' }[s] ?? 'default';
  }

  countdown(d: DreamDto): string | null {
    if (!d.targetDate) return null;
    const days = Math.ceil((new Date(d.targetDate).getTime() - Date.now()) / 86400000);
    if (d.status === 'achieved') return '🎉 已实现';
    if (days > 0) return `还有 ${days} 天`;
    if (days === 0) return '就是今天！';
    return `已过期 ${-days} 天`;
  }

  openCreate(): void {
    this.createVisible = true;
    this.createMode.set('form');
    this.newTitle = '';
    this.newTargetDate = null;
  }

  createFromForm(): void {
    const title = this.newTitle.trim();
    if (!title) return;
    this.create(title, null);
  }

  createFromCapture(cap: CaptureDto): void {
    const title = (cap.correctedText || cap.rawText || '').trim();
    if (!title) {
      this.message.warning('没有识别到内容，请重试');
      return;
    }
    this.create(title, cap.id);
  }

  private create(title: string, sourceCaptureId: string | null): void {
    this.creating.set(true);
    this.api.createDream({
      title,
      pyramidArea: PyramidAreaNum[this.newArea],
      targetDate: this.newTargetDate ? this.toDateStr(this.newTargetDate) : null,
      sourceCaptureId
    }).subscribe({
      next: () => {
        this.creating.set(false);
        this.createVisible = false;
        this.message.success('梦想已创建！🌟');
        this.load();
      },
      error: () => {
        this.creating.set(false);
        this.message.error('创建失败，请重试');
      }
    });
  }

  private toDateStr(d: Date): string {
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
}
