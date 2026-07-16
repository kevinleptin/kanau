import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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

/** 书中的三层金字塔（顶→底）：结果层 1 域 / 实现层 2 域 / 基础层 3 域 */
const PYRAMID_TIERS: { key: string; name: string; sub: string; areas: PyramidAreaStr[] }[] = [
  { key: 'result', name: '结果层', sub: '自然的产物', areas: ['wealth'] },
  { key: 'doing', name: '实现层', sub: '达成梦想的手段', areas: ['work', 'family'] },
  { key: 'base', name: '基础层', sub: '人生的地基', areas: ['health', 'knowledge', 'mind'] }
];

@Component({
  selector: 'app-dreams',
  imports: [
    FormsModule, RouterLink, NzButtonModule, NzDatePickerModule,
    NzInputModule, NzModalModule, NzSelectModule, NzSpinModule, NzTagModule, CaptureInput
  ],
  template: `
    <div class="page">
      <div class="head-row">
        <h1 class="page-title">我的梦想金字塔</h1>
        <button nz-button nzType="primary" nzShape="round" (click)="openCreate()">＋ 新梦想</button>
      </div>

      <!-- 金字塔视图：三层（基础/实现/结果），空缺领域虚线镂空提示 -->
      <div class="kanau-card">
        @if (statsLoaded()) {
          <div class="pyramid">
            @for (tier of tiers(); track tier.key) {
              <div class="tier" [class]="'t-' + tier.key">
                <div class="tier-label">{{ tier.name }} <span class="tier-sub">{{ tier.sub }}</span></div>
                <div class="tier-areas">
                  @for (a of tier.areas; track a.area) {
                    <span class="area-chip" [class.empty]="a.total === 0" [style.--c]="areaColor(a.area)">
                      <span class="dot"></span>{{ areaLabel(a.area) }} <b>{{ a.total }}</b>
                      @if (a.achieved > 0) {
                        <span class="ach">✓{{ a.achieved }}</span>
                      }
                    </span>
                  }
                </div>
              </div>
            }
          </div>
          @if (emptyAreas().length > 0) {
            <div class="pyramid-hint">🌱 {{ emptyAreaNames() }} 还空着——空白的领域，正是金字塔想提醒你的</div>
          }
        } @else {
          <div class="center"><nz-spin nzSimple /></div>
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
    .pyramid { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 4px 0 2px; }
    .tier { padding: 8px 9% 10px; clip-path: polygon(7.5% 0, 92.5% 0, 100% 100%, 0 100%); text-align: center; }
    .t-result { width: 56%; background: #fdeecd; }
    .t-doing { width: 79%; background: #ffe7cf; }
    .t-base { width: 100%; background: #ffddbd; }
    .tier-label { font-size: 11px; color: #a8632f; margin-bottom: 6px; font-weight: 700; }
    .tier-sub { font-weight: 400; opacity: .7; margin-left: 4px; }
    .tier-areas { display: flex; justify-content: center; gap: 6px; flex-wrap: wrap; }
    .area-chip {
      display: inline-flex; align-items: center; gap: 5px; background: #fff; border-radius: 999px;
      padding: 3px 9px; font-size: 12px; color: #4a3428; box-shadow: 0 1px 3px rgba(74, 52, 40, .1);
      white-space: nowrap;
    }
    .area-chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    .area-chip b { font-weight: 700; }
    .area-chip .ach { font-size: 10px; color: #2f9e6e; font-weight: 700; }
    .area-chip.empty { background: rgba(255, 255, 255, .45); border: 1.5px dashed var(--c); box-shadow: none; color: #a08b7a; padding: 1.5px 7.5px; }
    .area-chip.empty b { color: var(--c); }
    .pyramid-hint { margin-top: 10px; font-size: 12px; color: #b26a45; background: #fff4ec; border-radius: 10px; padding: 7px 10px; }
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
  readonly pyramidStats = signal<PyramidAreaStat[]>([]);
  readonly statsLoaded = signal(false);
  readonly creating = signal(false);

  readonly tiers = computed(() => {
    const byArea = new Map(this.pyramidStats().map((s) => [s.area, s]));
    return PYRAMID_TIERS.map((t) => ({
      ...t,
      areas: t.areas.map((area) => ({
        area,
        total: byArea.get(area)?.total ?? 0,
        achieved: byArea.get(area)?.achieved ?? 0
      }))
    }));
  });

  readonly emptyAreas = computed(() =>
    this.tiers().flatMap((t) => t.areas).filter((a) => a.total === 0).map((a) => a.area)
  );

  readonly emptyAreaNames = computed(() => this.emptyAreas().map((a) => this.areaLabel(a)).join('、'));
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
      next: (stats) => {
        this.pyramidStats.set(stats);
        this.statsLoaded.set(true);
      },
      error: () => this.statsLoaded.set(true)
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
